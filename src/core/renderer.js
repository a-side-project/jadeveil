/**
 * 渲染器 —— 体素材质（AO + 面朝向明暗 + 自发光）、光照、后处理。
 *
 * 材质策略：
 *  · 用 MeshStandardMaterial + onBeforeCompile 注入 aEmissive 属性，
 *    这样既保留 PBR 光照/阴影，又能让灯笼、金瓦自发光并参与 bloom。
 *  · 顶点色承载 AO 与面朝向明暗，直接乘进 diffuse。
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createWaterMaterial } from "./water.js";

/* ---------------- 后处理：暗角 + 色彩分级 ---------------- */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.62 },
    uVignetteSoft: { value: 0.42 },
    uSaturation: { value: 1.14 },
    uContrast: { value: 1.06 },
    uLift: { value: new THREE.Vector3(0.012, 0.008, 0.018) },
    uGain: { value: new THREE.Vector3(1.03, 1.0, 0.965) },
    uNight: { value: 0 },
    uWarm: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uVignetteSoft;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform float uNight;
    uniform float uWarm;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;

      // 对比度（围绕中灰）
      c = (c - 0.5) * uContrast + 0.5;

      // 饱和度
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);

      // 色彩分级：暗部偏冷、亮部偏暖
      c = c * uGain + uLift;
      c += vec3(0.012, 0.006, -0.014) * (1.0 - l) * (1.0 - uNight * 0.5);
      c += vec3(0.020, 0.010, -0.006) * smoothstep(0.6, 1.0, l);

      // 夜晚：暗部抬升为冷靖蓝，避免死黑；高光偏暖橙
      c += vec3(0.022, 0.030, 0.070) * uNight * (1.0 - smoothstep(0.0, 0.45, l));
      c += vec3(0.060, 0.030, -0.008) * uNight * smoothstep(0.45, 1.0, l);

      // 黄金时刻：暖橙注入，但保留暗部层次，避免整幅发橙
      float warmMask = 0.25 + 0.75 * smoothstep(0.30, 1.0, l);
      c += vec3(0.070, 0.032, -0.018) * uWarm * warmMask;
      c = mix(c, c * vec3(1.07, 1.00, 0.92), uWarm);
      // 黄金时刻暗部补一点冷色，拉开冷暖对比
      c += vec3(-0.010, -0.004, 0.020) * uWarm * (1.0 - smoothstep(0.0, 0.35, l));

      // 暗角
      vec2 d = vUv - 0.5;
      float r = length(d * vec2(1.0, 0.92));
      float vig = 1.0 - uVignette * smoothstep(uVignetteSoft, 0.86, r);
      c *= vig;

      gl_FragColor = vec4(max(c, 0.0), tex.a);
    }
  `,
};

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.info.autoReset = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd6e6f2, 0.0062);

    this.camera = new THREE.PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.08,
      900,
    );
    this.camera.position.set(0, 46, 96);

    this._setupLights();
    this._setupComposer();
    this._setupMaterials();

    window.addEventListener("resize", () => this.resize());
  }

  /* ---------------- 光照 ---------------- */
  _setupLights() {
    const scene = this.scene;

    // 太阳 / 月亮（方向光 + 阴影）
    this.sun = new THREE.DirectionalLight(0xfff2d4, 1.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 260;
    sc.left = -78;
    sc.right = 78;
    sc.top = 78;
    sc.bottom = -78;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.radius = 2.2;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // 半球光：天空色 → 地面色
    this.hemi = new THREE.HemisphereLight(0xbcd8f0, 0x7a7060, 0.9);
    scene.add(this.hemi);

    // 环境光：兜底，避免阴影处死黑
    this.ambient = new THREE.AmbientLight(0xffffff, 0.16);
    scene.add(this.ambient);

    // 补光：从相机侧后方打一点冷光，让暗部有层次
    this.fill = new THREE.DirectionalLight(0x9fc4e8, 0.22);
    this.fill.position.set(-40, 30, -50);
    scene.add(this.fill);

    // 灯笼点光源池（跟随玩家附近的灯笼，做数量预算）
    this.lanternLights = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffa64d, 0, 16, 2);
      l.castShadow = false;
      scene.add(l);
      this.lanternLights.push(l);
    }

    // 月光：夜间从月亮方向补一道冷光，让轮廓可读
    this.moon = new THREE.DirectionalLight(0x8fb0ff, 0);
    this.moon.position.set(40, 60, 30);
    scene.add(this.moon);
  }

  /* ---------------- 后处理 ---------------- */
  _setupComposer() {
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(window.innerWidth, window.innerHeight);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(size, 0.62, 0.72, 0.72);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.output = new OutputPass();
    this.composer.addPass(this.output);
  }

  /* ---------------- 体素材质 ---------------- */
  _setupMaterials() {
    const inject = (mat) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uEmissiveBoost = { value: 0.06 };
        mat.userData.shader = shader;

        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            `#include <common>
             attribute float aEmissive;
             varying float vEmissive;`,
          )
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
             vEmissive = aEmissive;`,
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
             varying float vEmissive;
             uniform float uEmissiveBoost;`,
          )
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
             totalEmissiveRadiance += diffuseColor.rgb * vEmissive * uEmissiveBoost * 2.2;`,
          );
      };
      mat.customProgramCacheKey = () => "voxel-emissive";
      return mat;
    };

    // 不透明体素
    this.matOpaque = inject(
      new THREE.MeshStandardMaterial({
        map: null,
        vertexColors: true,
        roughness: 0.82,
        metalness: 0.04,
        envMapIntensity: 0.5,
      }),
    );

    // 镂空（植物 / 灯笼 / 石狮）
    this.matCutout = inject(
      new THREE.MeshStandardMaterial({
        map: null,
        vertexColors: true,
        roughness: 0.78,
        metalness: 0.05,
        transparent: false,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        envMapIntensity: 0.5,
      }),
    );

    // 水：专用水面着色器（多层 Gerstner 波 + 菲涅尔 + 深浅水 + 泡沫）
    this.matWater = createWaterMaterial();
    this.waterUniforms = this.matWater.uniforms;

    // 云雾
    this.matCloud = new THREE.MeshStandardMaterial({
      map: null,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
      emissive: 0xdfe9f2,
      emissiveIntensity: 0.28,
    });
  }

  setAtlas(texture) {
    for (const m of [this.matOpaque, this.matCutout, this.matCloud]) {
      m.map = texture;
      m.needsUpdate = true;
    }
  }

  /** 每帧根据昼夜状态更新光照、雾、天空、曝光。 */
  applyDayNight(st, sky) {
    this.sun.color.copy(st.sunColor);
    this.sun.intensity = st.sunIntensity;
    this.hemi.color.copy(st.hemiSky);
    this.hemi.groundColor.copy(st.hemiGround);
    this.hemi.intensity = st.hemiIntensity;
    this.ambient.intensity = 0.10 + st.hemiIntensity * 0.10;
    this.fill.intensity = 0.10 + st.hemiIntensity * 0.16;

    // 月光：夜间补一道冷光，让建筑轮廓可读
    this.moon.intensity = st.night * 0.55;
    this.moon.color.setHex(0x8fb0ff);

    this.scene.fog.color.copy(st.fogColor);
    this.scene.fog.density = st.fogDensity;

    // 曝光：夜间不靠压暗，而是略提高曝光 + 抬暗部
    this.renderer.toneMappingExposure = st.exposure;
    this.grade.uniforms.uNight.value = st.night;
    this.grade.uniforms.uWarm.value = st.warm;
    this.grade.uniforms.uVignette.value = 0.50 + st.night * 0.16;
    this.grade.uniforms.uSaturation.value = 1.16 + st.night * 0.10 + st.warm * 0.06;
    this.grade.uniforms.uContrast.value = 1.05 + st.warm * 0.05;

    // 自发光随昼夜曲线：白天几乎不发光，入夜拉满
    const glow = 0.06 + st.night * 2.35 + st.warm * 0.35;
    this.emissiveBoost = glow;
    for (const m of [this.matOpaque, this.matCutout]) {
      if (m.userData.shader) m.userData.shader.uniforms.uEmissiveBoost.value = glow;
    }

    // 水面：太阳方向 / 天空色 / 昼夜
    if (this.waterUniforms) {
      this.waterUniforms.uSunDir.value.copy(st.sunDir);
      this.waterUniforms.uSunColor.value.copy(st.sunColor);
      this.waterUniforms.uSkyColor.value.copy(st.horizon);
      this.waterUniforms.uNight.value = st.night;
    }

    // bloom：只让灯笼 / 金瓦 / 水面高光溢出，阈值保持较高
    this.bloom.strength = 0.34 + st.night * 0.95 + st.warm * 0.22;
    this.bloom.threshold = 0.86 - st.night * 0.30 - st.warm * 0.06;
    this.bloom.radius = 0.55 + st.night * 0.30;

    if (sky) {
      sky.set(
        st.zenith, st.horizon, st.ground,
        st.sunDir, st.sunColor, st.moonDir, st.night,
      );
    }
  }

  /** 太阳方向光跟随玩家，保证阴影相机始终罩住视野。 */
  followSun(target) {
    const d = 110;
    this.sun.position.set(
      target.x + this._sunDir.x * d,
      target.y + this._sunDir.y * d + 12,
      target.z + this._sunDir.z * d,
    );
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }

  setSunDir(dir) {
    this._sunDir = dir;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    if (this.reflectRT) {
      this.reflectRT.setSize(
        Math.max(2, Math.floor(w * 0.5)),
        Math.max(2, Math.floor(h * 0.5)),
      );
    }
  }

  render() {
    this.renderReflection();
    this.composer.render();
  }

  /** 推进水面动画时间。 */
  tick(elapsed) {
    if (this.waterUniforms) this.waterUniforms.uTime.value = elapsed;
  }

  /* ================= 平面反射 ================= */

  /**
   * 水面平面反射：把场景以镜面相机渲染到一张 RT，供水着色器采样。
   *
   *  1. 镜面相机关于水面（y = waterLevel）镜像
   *  2. 隐藏水面材质，避免自反射反馈
   *  3. 计算 textureMatrix，把世界坐标映射到反射图 UV
   */
  renderReflection() {
    if (!this.reflectRT) return;
    const cam = this.camera;
    const L = this.waterLevel;

    // 只在相机高于水面时反射（水下不渲染反射，省开销）
    if (cam.position.y < L - 1) {
      this.matWater.visible = false;
      return;
    }

    const rc = this.reflectCam;
    rc.far = cam.far;
    rc.near = cam.near;

    // 位置镜像
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    rc.position.set(cx, 2 * L - cy, cz);

    // 朝向镜像
    const look = this._reflLook;
    cam.getWorldDirection(look);
    const tx = cx + look.x, ty = cy + look.y, tz = cz + look.z;
    rc.up.set(0, -1, 0);
    rc.lookAt(tx, 2 * L - ty, tz);

    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(cam.projectionMatrix);
    rc.projectionMatrixInverse.copy(cam.projectionMatrixInverse);

    // 纹理矩阵：世界坐标 → 反射图 UV
    const tm = this.waterUniforms.uReflectMatrix.value;
    tm.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    tm.multiply(rc.projectionMatrix);
    tm.multiply(rc.matrixWorldInverse);

    // 渲染（隐藏水面，避免反馈）
    this.matWater.visible = false;
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.reflectRT);
    this.renderer.clear();
    this.renderer.render(this.scene, rc);
    this.renderer.setRenderTarget(prevRT);
    this.matWater.visible = true;
  }

  /** 初始化反射用的渲染目标与镜面相机。 */
  initReflection(waterLevel = 35) {
    this.waterLevel = waterLevel;
    this._reflLook = new THREE.Vector3();
    const w = Math.max(2, Math.floor(window.innerWidth * 0.5));
    const h = Math.max(2, Math.floor(window.innerHeight * 0.5));
    this.reflectRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
    });
    this.reflectCam = new THREE.PerspectiveCamera();
    this.reflectCam.layers.enableAll();

    if (this.waterUniforms) {
      this.waterUniforms.uReflection.value = this.reflectRT.texture;
      this.waterUniforms.uWaterLevel.value = waterLevel;
    }
  }
}
