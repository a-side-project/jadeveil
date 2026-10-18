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

// 水下雾：浅处青绿透光，深处转为暗三蓝绿（按深度插值）
const WATER_FOG_SHALLOW = new THREE.Color(0x2c6d78);
const WATER_FOG_DEEP = new THREE.Color(0x0b2f3a);
// 焦散偏青：阳光经过水体后剩下的颜色
const CAUSTIC_TINT = new THREE.Color(0x8fe6ef);

// 选择性泛光：发光体所在的渲染层（官 webgl_postprocessing_unreal_bloom_selective 做法）
export const BLOOM_SCENE = 1;
// 体积光的遮挡遮罩层：天空穹顶所在层（见 _renderGodRayMask）
export const GODRAY_SKY = 2;

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

/* ---------------- 后处理：体积光（god rays） ---------------- */
const GodRayShader = {
  uniforms: {
    tDiffuse: { value: null },
    // 遮挡遮罩：只有天空是亮的、一切几何体全黑（见 _renderGodRayMask）。
    // 光束必须从「被建筑遮挡的天空」推出来，绝不能从画面本身推 ——
    // 从画面推的话，灯笼/金瓦/翅膀这些亮点会被径向模糊复制成一串等距残影。
    tMask: { value: null },
    uSunScreen: { value: new THREE.Vector2(0.5, 0.8) },
    uStrength: { value: 0.55 },
    uDecay: { value: 0.94 },
    uDensity: { value: 0.45 },
    // 光束颜色：白天取太阳色（暖），水下改青
    uSunTint: { value: new THREE.Color(0xfff0c8) },
    uNight: { value: 0 },
    // 水下程度：潜水时光束更强、更偏青（光经过水体长波先被吸收）
    uUnderwater: { value: 0 },
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
    uniform sampler2D tMask;
    uniform vec2 uSunScreen;
    uniform float uStrength;
    uniform float uDecay;
    uniform float uDensity;
    uniform vec3 uSunTint;
    uniform float uNight;
    uniform float uUnderwater;
    varying vec2 vUv;

    // 采样数从 24 提到 48：同样的光束长度、一半的步长，
    // 离散台阶随之减半，再配合下面的逐像素抖动基本看不到分阶。
    const int SAMPLES = 48;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 delta = (vUv - uSunScreen) * uDensity / float(SAMPLES);

      // 逐像素抖动：沿射线方向把采样点整体偏移一个亚步长，
      // 把残余的离散台阶打散成高频噪声，再由下游 FXAA 抹平。
      float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      vec2 uv = vUv + delta * (jitter - 0.5);

      vec3 acc = vec3(0.0);
      float decay = 1.0;
      float norm = 0.0;
      for (int i = 0; i < SAMPLES; i++) {
        uv -= delta;
        acc += texture2D(tMask, clamp(uv, 0.0, 1.0)).rgb * decay;
        norm += decay;
        decay *= uDecay;
      }
      // 遮罩是二值的（天空 = 纯白，几何 = 纯黑），所以累加后归一化就得到
      // 「这条射线通向太阳的路上，有多大比例没有被建筑挡住」——
      // 一个 0..1 的量，与遮罩分辨率、天空亮度、色调映射曲线都无关。
      // 旧版没归一化、直接阈值卡在亮度上，所以调亮度就会把整个效果调没。
      acc /= max(norm, 1e-4);

      // 太阳在屏幕外或夜晚则减弱
      float onScreen = step(0.0, uSunScreen.x) * step(uSunScreen.x, 1.0)
                     * step(0.0, uSunScreen.y) * step(uSunScreen.y, 1.0);
      float amt = uStrength * onScreen * (1.0 - uNight * 0.92);
      // 水下：丁达尔光束更密集、更明显
      amt *= 1.0 + uUnderwater * 1.15;
      vec3 tint = mix(uSunTint, vec3(0.55, 0.95, 0.92), uUnderwater);
      gl_FragColor = vec4(base.rgb + acc * amt * tint, base.a);
    }
  `,
};

/* FXAA 抗锯齿 —— EffectComposer 会把 MSAA 失效，这里用 FXAA 补齐边缘锯齿。 */
const FXAAShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
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
    uniform vec2 uResolution;
    varying vec2 vUv;
    #define FXAA_REDUCE_MIN (1.0/128.0)
    #define FXAA_REDUCE_MUL (1.0/8.0)
    #define FXAA_SPAN_MAX 8.0
    void main() {
      vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * uResolution).xyz;
      vec3 rgbNE = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * uResolution).xyz;
      vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * uResolution).xyz;
      vec3 rgbSE = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * uResolution).xyz;
      vec4 rgbaM = texture2D(tDiffuse, vUv);
      vec3 rgbM = rgbaM.xyz;
      vec3 luma = vec3(0.299, 0.587, 0.114);
      float lumaNW = dot(rgbNW, luma);
      float lumaNE = dot(rgbNE, luma);
      float lumaSW = dot(rgbSW, luma);
      float lumaSE = dot(rgbSE, luma);
      float lumaM = dot(rgbM, luma);
      float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
      float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
      vec2 dir;
      dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
      dir.y = ((lumaNW + lumaSW) - (lumaNE + lumaSE));
      float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
      float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
      dir = min(vec2(FXAA_SPAN_MAX, FXAA_SPAN_MAX), max(vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX), dir * rcpDirMin)) * uResolution;
      vec3 rgbA = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0/3.0 - 0.5)).xyz + texture2D(tDiffuse, vUv + dir * (2.0/3.0 - 0.5)).xyz);
      vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tDiffuse, vUv + dir * -0.5).xyz + texture2D(tDiffuse, vUv + dir * 0.5).xyz);
      float lumaB = dot(rgbB, luma);
      if (lumaB < lumaMin || lumaB > lumaMax) {
        gl_FragColor = vec4(rgbA, rgbaM.a);
      } else {
        gl_FragColor = vec4(rgbB, rgbaM.a);
      }
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

    // 画质开关（applyQuality 写入）。关掉的效果连对应的场景重绘一起跳过，而不只是不显示。
    this.pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.bloomOn = true;
    this.godraysOn = true;
    this.reflectOn = true;
    this.reflectScale = 0.5;
    // 本帧体积光是否有贡献（太阳在屏外 / 夜里时整遍遮罩渲染都可以省掉）
    this._godrayActive = true;
    // 由 main.js 注入：视野里有没有水面（没有就不渲染反射）
    this.isWaterVisible = null;
    // 烘焙光照（world/lighting.js）的换算参数：所有体素材质与实体材质共用同一组 uniform 对象
    this.lightUniforms = {
      uSkyFloor: { value: 0.36 }, // 完全不见天日处的亮度下限（洞穴 / 屋子深处仍看得清轮廓）
      uBlockColor: { value: new THREE.Color(1.0, 0.70, 0.40) }, // 灯笼 / 火把的暖光
      uBlockStrength: { value: 0.6 }, // 随昼夜变化（applyDayNight）
    };

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

    // 灯笼 / 火把不再用实时点光源：它们的光烘焙在体素光照里（world/lighting.js）——
    // 不穿墙、没有数量上限、不会在灯之间换手闪烁，也不给每个像素增加着色开销。

    // 月光：夜间从月亮方向补一道冷光，让轮廓可读
    this.moon = new THREE.DirectionalLight(0x8fb0ff, 0);
    this.moon.position.set(40, 60, 30);
    scene.add(this.moon);
  }

  /* ---------------- 后处理 ---------------- */
  _setupComposer() {
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const pr = Math.min(window.devicePixelRatio, 2);

    /* ---- 泛光专用 composer（官方做法）：渲染「变暗后的场景」并 bloom ----
     * renderToScreen = false，结果留在 renderTarget2，供主 composer 的 mix 采样。
     * 关键：用独立 composer 而不是手动调 UnrealBloomPass.render()，
     * 后者需要 composer 帮它管理 buffer/renderToScreen，单独调用会弄乱渲染状态。
     */
    this.bloomRT = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      type: THREE.HalfFloatType,
    });
    this.bloomComposer = new EffectComposer(this.renderer, this.bloomRT);
    this.bloomComposer.setPixelRatio(pr);
    this.bloomComposer.setSize(window.innerWidth, window.innerHeight);
    this.bloomComposer.renderToScreen = false;
    this.bloomRenderPass = new RenderPass(this.scene, this.camera);
    this.bloomComposer.addPass(this.bloomRenderPass);
    this.bloom = new UnrealBloomPass(size, 1.0, 0.6, 0.0);
    this.bloomComposer.addPass(this.bloom);

    /* ---- 主 composer：renderPass → mix(加回泛光) → godray → grade → fxaa → output ---- */
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // 官方 mix：base + bloomTexture * strength
    this.bloomMix = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
          bloomStrength: { value: 1.0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D baseTexture;
          uniform sampler2D bloomTexture;
          uniform float bloomStrength;
          varying vec2 vUv;
          void main() {
            gl_FragColor = (texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv) * bloomStrength);
          }`,
      }),
      "baseTexture",
    );
    this.bloomMix.needsSwap = true;
    this.composer.addPass(this.bloomMix);

    // 体积光的遮挡遮罩：1/4 分辨率就够了（只用来做模糊）
    this.godrayRT = new THREE.WebGLRenderTarget(
      Math.max(2, Math.floor(window.innerWidth / 4)),
      Math.max(2, Math.floor(window.innerHeight / 4)),
      { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true },
    );

    // 体积光：穿过竹林与屋檐的阳光束（采样源是上面的遮罩，不是画面本身）
    this.godrays = new ShaderPass(GodRayShader);
    this.godrays.uniforms.tMask.value = this.godrayRT.texture;
    this.composer.addPass(this.godrays);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    // FXAA 抗锯齿（composer 渲染到 render target 时 MSAA 失效，这里补上）
    this.fxaa = new ShaderPass(FXAAShader);
    this.fxaa.uniforms.uResolution.value.set(1 / (window.innerWidth * pr), 1 / (window.innerHeight * pr));
    this.composer.addPass(this.fxaa);

    this.output = new OutputPass();
    this.composer.addPass(this.output);
  }

  /* ---------------- 体素材质 ---------------- */
  _setupMaterials() {
    // 所有被注入焦散的材质着色器（每帧同步 uTime / uWaterLevel）
    this._causticShaders = [];
    const inject = (mat) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uEmissiveBoost = { value: 0.06 };
        // 水下焦散：水面波纹把阳光聚成游动的亮网，打在水下的地形与建筑上。
        // 这是「水里有水」最强的视觉线索 —— 只有水体才会产生这种图案。
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uWaterLevel = { value: 35 };
        shader.uniforms.uCausticStrength = { value: 1 };
        shader.uniforms.uCausticColor = { value: new THREE.Color(0xbfe9ef) };
        mat.userData.shader = shader;
        this._causticShaders.push(shader);

        Object.assign(shader.uniforms, this.lightUniforms);
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            `#include <common>
             attribute float aEmissive;
             attribute vec2 aLight;
             varying float vEmissive;
             varying vec2 vLight;
             varying vec3 vCWorld;`,
          )
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
             vEmissive = aEmissive;
             vLight = aLight;
             vCWorld = (modelMatrix * vec4(position, 1.0)).xyz;`,
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
             varying float vEmissive;
             varying vec2 vLight;
             varying vec3 vCWorld;
             uniform float uEmissiveBoost;
             uniform float uSkyFloor;
             uniform vec3 uBlockColor;
             uniform float uBlockStrength;
             vec3 jvAlbedo;
             uniform float uTime;
             uniform float uWaterLevel;
             uniform float uCausticStrength;
             uniform vec3 uCausticColor;

             // 经典焦散图案：两层干涉形成的游动亮网。
             //
             // 必须夹紧中间量：原式里的 1.0/length(...) 在 inten 很小时
             // 会出现除零 → Inf，pow 之后整屏雪白。
             float causticPattern(vec2 p, float t) {
               vec2 i = p;
               float c = 1.0;
               const float inten = 0.005;
               for (int n = 0; n < 2; n++) {
                 float tt = t * (1.0 - (3.5 / float(n + 1)));
                 i = p + vec2(cos(tt - i.x) + sin(tt + i.y),
                              sin(tt - i.y) + cos(tt + i.x));
                 float denom = length(vec2(p.x / (sin(i.x + tt) / inten),
                                           p.y / (cos(i.y + tt) / inten)));
                 c += 1.0 / max(denom, 1e-3);
               }
               c /= 2.0;
               c = clamp(c, 0.0, 1.6);
               c = 1.17 - pow(c, 1.4);
               return clamp(pow(abs(c), 8.0), 0.0, 0.16);
             }`,
          )
          .replace(
            "#include <color_fragment>",
            `#include <color_fragment>
             // 烘焙光照：天空光决定这一面能分到多少太阳 / 天空光（屋里、檐下、洞里逐格变暗）
             jvAlbedo = diffuseColor.rgb;
             diffuseColor.rgb *= mix(uSkyFloor, 1.0, pow(vLight.x, 1.5));`,
          )
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
             // 发光体本身：保留纸灯笼的橙红色（系数过大时色调映射会把它压成一团白）
             totalEmissiveRadiance += jvAlbedo * vEmissive * uEmissiveBoost * 0.85;
             // 方块光：灯笼 / 火把的暖光，按光照等级平滑衰减（1.35 次方：近处亮、远处收尾长而柔和）；
             // 发光体自己的面不再叠加，避免双重提亮
             totalEmissiveRadiance += jvAlbedo * uBlockColor * pow(vLight.y, 1.35) * uBlockStrength * (1.0 - vEmissive);

             // 只要片元在水面以下就投焦散，与相机在哪无关：
             // 从岸上看水里时湖底的那张亮网也是同一个效果。
             if (vCWorld.y < uWaterLevel) {
               float depthMask = smoothstep(uWaterLevel, uWaterLevel - 1.6, vCWorld.y);
               vec2 cp = vCWorld.xz * 1.75;
               float c1 = causticPattern(cp, uTime * 0.62);
               float c2 = causticPattern(cp * 1.9 + 13.0, uTime * 0.47);
               // c1/c2 各自已限幅在 0.16 以内
               float caus = clamp(c1 * 0.85 + c2 * 0.60, 0.0, 0.20);
               totalEmissiveRadiance += uCausticColor * caus * depthMask * uCausticStrength * 0.42;
             }`,
          );
      };
      mat.customProgramCacheKey = () => "voxel-emissive-caustic-light";
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

    /* ---------------- 选择性泛光（移植官方示例） ----------------
     * 官方 webgl_postprocessing_unreal_bloom_selective 的核心：
     *   每帧先 traverse 把「非泛光」对象换成黑材质，用一个独立 composer 渲染这份
     *   变暗的场景并做 bloom；再还原材质，主 composer 渲染完整场景并把 bloom
     *   纹理加回去。
     *
     * 本项目的差异：体素网格里「自发光面」与「普通面」在同一个 mesh 上（用
     * aEmissive 顶点属性区分），无法按对象分层。所以体素网格不换成纯黑，
     * 而是换成「只输出自发光」的着色器 —— 金瓦/灯笼/发光块仍会泛光。
     */
    this.bloomLayer = new THREE.Layers();
    this.bloomLayer.set(BLOOM_SCENE);

    // 非泛光 mesh → 纯黑（官方做法）
    this._darkMaterial = new THREE.MeshBasicMaterial({ color: "black" });

    // 体素网格 → 只输出自发光（aEmissive > 0 的面才亮）。
    // 泛光的颜色必须来自发光体自己的贴图：旧版输出纯白（vec3(vEmissive * 3.0)），
    // 于是纸灯笼的光晕是白的，近看时一大片白光叠上去直接过曝（实测灯笼前 7.7% 的像素被压成纯白）。
    this._glowMaterial = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, uGlow: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aEmissive;
        varying float vEmissive;
        varying vec2 vUv;
        void main() {
          vEmissive = aEmissive;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform float uGlow;
        varying float vEmissive;
        varying vec2 vUv;
        void main() {
          vec4 t = texture2D(map, vUv);
          if (t.a < 0.5) discard; // 镂空灯笼的透明像素不发光
          gl_FragColor = vec4(t.rgb * vEmissive * uGlow, 1.0);
        }`,
    });

    this._savedMaterial = {};
    this._savedVisible = {};

    this._darkenNonBloomed = (obj) => {
      if (!obj.material) return;
      // 体素网格：换成自发光遮罩（保持金瓦/灯笼参与泛光）
      if (obj.material === this.matOpaque || obj.material === this.matCutout) {
        this._savedMaterial[obj.uuid] = obj.material;
        obj.material = this._glowMaterial;
        return;
      }
      if (this.bloomLayer.test(obj.layers)) return; // 发光体保留原样
      // 粒子/精灵/线：泛光通道里直接隐藏（它们不写深度，不需要用黑材质挡光）
      if (obj.isPoints || obj.isSprite || obj.isLine) {
        this._savedVisible[obj.uuid] = obj.visible;
        obj.visible = false;
        return;
      }
      this._savedMaterial[obj.uuid] = obj.material;
      obj.material = this._darkMaterial;
    };

    this._restoreMaterial = (obj) => {
      if (this._savedMaterial[obj.uuid]) {
        obj.material = this._savedMaterial[obj.uuid];
        delete this._savedMaterial[obj.uuid];
      }
      if (obj.uuid in this._savedVisible) {
        obj.visible = this._savedVisible[obj.uuid];
        delete this._savedVisible[obj.uuid];
      }
    };

    /* ---------------- 体积光的「遮挡遮罩」材料 ----------------
     * 与泛光那套完全独立（各自一份 saved 表，互不干扰）。
     */
    this.godraySkyLayer = new THREE.Layers();
    this.godraySkyLayer.set(GODRAY_SKY);
    this._godrayBlack = new THREE.MeshBasicMaterial({ color: "black" });
    // 天空在遮罩里要变成「纯白的遮挡板」：遮罩是二值的，光束强度才由遮挡决定，
    // 而不是被天空自身的亮度与色调映射曲线左右。
    // （天空穹顶自己就是 depthWrite/depthTest 全关 + BackSide，这里保持一致。）
    this._godrayWhite = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    this._grSavedMaterial = {};
    this._grSavedVisible = {};

    this._darkenForGodRay = (obj) => {
      if (!obj.material) return;
      // 天空：换成纯白遮挡板（保留原材质，渲染完恢复）
      if (obj.layers.test(this.godraySkyLayer)) {
        this._grSavedMaterial[obj.uuid] = obj.material;
        obj.material = this._godrayWhite;
        return;
      }
      // 半透明体（水面、云海、雾带）与粒子一律隐藏，而不是涂黑 ——
      // 涂黑的话它们会在遮罩里把天空挡住，光束会在这些区域整片消失。
      if (obj.isPoints || obj.isSprite || obj.isLine || obj.material.transparent) {
        this._grSavedVisible[obj.uuid] = obj.visible;
        obj.visible = false;
        return;
      }
      this._grSavedMaterial[obj.uuid] = obj.material;
      obj.material = this._godrayBlack;
    };

    this._restoreForGodRay = (obj) => {
      if (this._grSavedMaterial[obj.uuid]) {
        obj.material = this._grSavedMaterial[obj.uuid];
        delete this._grSavedMaterial[obj.uuid];
      }
      if (obj.uuid in this._grSavedVisible) {
        obj.visible = this._grSavedVisible[obj.uuid];
        delete this._grSavedVisible[obj.uuid];
      }
    };
  }

  /**
   * 渲染「遮挡遮罩」：只有天空是亮的，一切实体几何都是黑的。
   *
   * 体积光必须从这份遮罩推出来，而不是从最终画面推出来。
   * 旧做法是拿最终画面直接做径向模糊，于是画面里每一个亮点（灯笼、金瓦高光、
   * 翅膀符文）都会被复制成一串等距残影 —— 这就是「发光体上总挂着一条很重复的
   * 残影」的根因，也是之前调阈值／调强度治不好的原因：残影不是亮度问题，
   * 是采样源错了。
   *
   * 换成遮罩后：发光体在遮罩里是纯黑，不可能产生任何光束；光束只来自
   * 「被建筑遮挡的天空」，这才是体积光本来的物理含义。
   */
  _renderGodRayMask() {
    const r = this.renderer;
    if (!this.godrayRT) return;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    const prevClear = new THREE.Color();
    r.getClearColor(prevClear);
    const prevClearAlpha = r.getClearAlpha();
    // 遮罩里看不见阴影，重算一遍阴影贴图等于白花一倍开销
    const prevShadowAuto = r.shadowMap.autoUpdate;

    this.scene.traverse(this._darkenForGodRay);
    r.shadowMap.autoUpdate = false;
    r.autoClear = true;
    r.setClearColor(0x000000, 1);
    r.setRenderTarget(this.godrayRT);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);

    r.shadowMap.autoUpdate = prevShadowAuto;
    r.autoClear = prevAutoClear;
    r.setClearColor(prevClear, prevClearAlpha);
    this.scene.traverse(this._restoreForGodRay);
  }

  setAtlas(texture) {
    for (const m of [this.matOpaque, this.matCutout, this.matCloud]) {
      m.map = texture;
      m.needsUpdate = true;
    }
    this._glowMaterial.uniforms.map.value = texture;
  }

  /** 应用法线图 / 粗糙度图，拉开材质「手感」差异。 */
  setPBR({ normalTex, roughTex }) {
    for (const m of [this.matOpaque, this.matCutout]) {
      m.normalMap = normalTex;
      m.normalScale = new THREE.Vector2(0.85, 0.85);
      m.roughnessMap = roughTex;
      m.roughness = 1.0;      // 由贴图驱动，这里做乘子
      m.metalness = 0.10;     // 基础介电质，琉璃/金瓦靠低粗糙度出高光
      m.needsUpdate = true;
    }
  }

  /** 每帧根据昼夜状态更新光照、雾、天空、曝光。 */
  applyDayNight(st, sky) {
    // 主光源：白天是太阳、夜里是月亮（方向由 setSunDir(st.lightDir) 给出）
    this.sun.color.copy(st.lightColor);
    this.sun.intensity = st.lightIntensity;
    this.hemi.color.copy(st.hemiSky);
    this.hemi.groundColor.copy(st.hemiGround);
    this.hemi.intensity = st.hemiIntensity;
    this.ambient.intensity = 0.10 + st.hemiIntensity * 0.10;
    this.fill.intensity = 0.10 + st.hemiIntensity * 0.16;

    // 夜间的冷色补光：月亮已经是主光源（带阴影），这里只留一点让背光面的轮廓可读
    this.moon.intensity = st.night * 0.14;
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

    // 方块光：白天被阳光盖过，只在屋里 / 檐下看得出；入夜成为主光源
    this.lightUniforms.uBlockStrength.value = 0.5 + st.night * 1.5 + st.warm * 0.35;

    // 自发光随昼夜曲线：白天几乎不发光，入夜拉满
    // 上限控制在色调映射还能保住颜色的范围内（浅色发光块超过约 1.6 就会被压成纯白）
    const glow = 0.06 + st.night * 1.3 + st.warm * 0.25;
    this.emissiveBoost = glow;
    // 泛光输入跟自发光同一条昼夜曲线：白天几乎没有光晕，入夜灯笼才有一圈暖光
    this._glowMaterial.uniforms.uGlow.value = 0.2 + st.night * 0.8 + st.warm * 0.25;
    for (const m of [this.matOpaque, this.matCutout]) {
      if (m.userData.shader) m.userData.shader.uniforms.uEmissiveBoost.value = glow;
    }

    // 水面：太阳方向 / 天空色 / 昼夜
    if (this.waterUniforms) {
      // 水面高光跟主光源走：夜里映出的是月亮
      this.waterUniforms.uSunDir.value.copy(st.lightDir);
      this.waterUniforms.uSunColor.value.copy(st.lightColor).multiplyScalar(Math.min(1, st.lightIntensity));
      this.waterUniforms.uSkyColor.value.copy(st.horizon);
      this.waterUniforms.uNight.value = st.night;
    }

    // bloom：只让灯笼 / 金瓦 / 水面高光溢出，阈值保持较高
    // 选择性泛光：泛光通道里只剩发光体，阈值设 0；强度随昼夜
    // 泛光要克制：只给发光体一圈紧凑的光晕，光主要体现在「照亮周围」（方块光），而不是画面一片白
    this.bloom.strength = 0.45 + st.night * 0.45 + st.warm * 0.15;
    this.bloom.radius = 0.35 + st.night * 0.15;
    if (this.bloomMix) this.bloomMix.uniforms.bloomStrength.value = 1.0;

    if (sky) sky.set(st);

    // 体积光参数随昼夜
    if (this.godrays) {
      this.godrays.uniforms.uNight.value = st.night;
      // 累积量已归一化到 0..1（“到太阳的路上没被挡住的比例”），所以强度
      // 直接就是「最多加多少光」，不再需要用高阈值去躲开发光体。
      // 这个系数是体积光唯一的「调子」旋钮：旧阀值卡在天空亮度上，
      // 实际上把光束本身也一起卡没了（旧版全图贡献仅 1% 像素），
      // 这里刻意取小值，使整体亮度与之前相近 —— 只去掉残影，不改变画面观感。
      // 光束只在太阳挂在天上时出现：落山后主光源换成月亮，若仍按旧的太阳色（暮光里是深红）
      // 从月亮的位置往外推光束，整片天空会被涂成暗红色的放射条纹
      const sunUp = Math.max(0, Math.min(1, (st.sunElevation + 0.02) / 0.1));
      this.godrays.uniforms.uStrength.value = (0.04 + st.warm * 0.10) * sunUp;
      this.godrays.uniforms.uSunTint.value.copy(st.lightColor);
      // updateWaterView() 需要它来算水下阈值，必须存下来
      this._nightFactor = st.night;
    }

    // 水下焦散：颜色跟随太阳，夜间基本消失
    if (this._causticShaders) {
      const strength = 1 - st.night * 0.88;
      for (const s of this._causticShaders) {
        s.uniforms.uCausticStrength.value = strength;
        s.uniforms.uWaterLevel.value = this.waterLevel;
        s.uniforms.uCausticColor.value.copy(st.sunColor).lerp(CAUSTIC_TINT, 0.55);
      }
    }
  }

  /** 把太阳世界坐标投影到屏幕，供体积光使用。 */
  updateSunScreen() {
    if (!this.godrays || !this._sunDir) return;
    const v = this._sunScreenTmp || (this._sunScreenTmp = new THREE.Vector3());
    v.copy(this.camera.position).addScaledVector(this._sunDir, 400);
    v.project(this.camera);
    const sx = v.x * 0.5 + 0.5, sy = v.y * 0.5 + 0.5;
    this.godrays.uniforms.uSunScreen.value.set(sx, sy);
    // 与着色器里的判定一致：太阳不在屏幕内（或在相机背后）、或夜里强度几乎为 0 时，体积光没有任何贡献
    const u = this.godrays.uniforms;
    const onScreen = v.z < 1 && sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1;
    const amt = u.uStrength.value * (1 - u.uNight.value * 0.92) * (1 + u.uUnderwater.value * 1.15);
    this._godrayActive = onScreen && amt > 0.004;
  }

  /**
   * 太阳方向光跟随玩家，保证阴影相机始终罩住视野。
   *
   * 阴影相机的位置按阴影贴图的纹素（texel）对齐：否则玩家每移动一点点，
   * 整张阴影贴图就相对世界滑动不到一个纹素，所有阴影边缘都会跟着抖（shimmering）——
   * 这是方向光阴影的经典问题，标准解法就是把投影中心吸附到纹素网格上。
   */
  followSun(target) {
    const d = 110;
    const sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    // 光空间基：forward = -sunDir；right / up 与之正交
    const f = this._sunF || (this._sunF = new THREE.Vector3());
    const r = this._sunR || (this._sunR = new THREE.Vector3());
    const u = this._sunU || (this._sunU = new THREE.Vector3());
    f.copy(this._sunDir).negate().normalize();
    r.set(0, 1, 0).cross(f);
    if (r.lengthSq() < 1e-6) r.set(1, 0, 0);
    r.normalize();
    u.copy(f).cross(r).normalize();
    // 目标点在光空间的 right / up 坐标吸附到纹素网格，沿光线方向的分量不影响阴影位置
    const t = this._sunT || (this._sunT = new THREE.Vector3());
    const pr = Math.round(target.dot(r) / texel) * texel;
    const pu = Math.round(target.dot(u) / texel) * texel;
    const pf = target.dot(f);
    t.copy(r).multiplyScalar(pr).addScaledVector(u, pu).addScaledVector(f, pf);
    this.sun.position.set(
      t.x + this._sunDir.x * d,
      t.y + this._sunDir.y * d,
      t.z + this._sunDir.z * d,
    );
    this.sun.target.position.copy(t);
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
    if (this.bloomComposer) this.bloomComposer.setSize(w, h);
    if (this.godrayRT) this.godrayRT.setSize(Math.max(2, Math.floor(w / 4)), Math.max(2, Math.floor(h / 4)));
    const pr = this.pixelRatio;
    if (this.fxaa) this.fxaa.uniforms.uResolution.value.set(1 / (w * pr), 1 / (h * pr));
    if (this.reflectRT) {
      this.reflectRT.setSize(
        Math.max(2, Math.floor(w * this.reflectScale)),
        Math.max(2, Math.floor(h * this.reflectScale)),
      );
    }
  }

  /**
   * 应用画质配置（见 core/quality.js）。阴影 / 灯光数量变化会触发一次着色器重编译，
   * 只在玩家换档或自动降档时发生。
   */
  applyQuality(p) {
    const r = this.renderer;
    // 分辨率
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, p.pixelRatio);
    r.setPixelRatio(this.pixelRatio);
    this.composer.setPixelRatio(this.pixelRatio);
    this.bloomComposer.setPixelRatio(this.pixelRatio);
    // 阴影
    const shadowChanged = r.shadowMap.enabled !== p.shadows || this.sun.shadow.mapSize.x !== p.shadowMap;
    r.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    if (this.sun.shadow.mapSize.x !== p.shadowMap) {
      this.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    // 泛光 / 体积光：pass 关掉的同时，render() 里对应的场景重绘也一并跳过
    this.bloomOn = p.bloom;
    this.bloomMix.enabled = p.bloom;
    this.godraysOn = p.godrays;
    // 水面反射：关掉时让水面只用天空色做菲涅尔反射
    this.reflectOn = p.reflections;
    this.reflectScale = p.reflectScale;
    if (this.waterUniforms && this.waterUniforms.uReflectStrength) {
      if (this._reflectStrength === undefined) this._reflectStrength = this.waterUniforms.uReflectStrength.value;
      this.waterUniforms.uReflectStrength.value = p.reflections ? this._reflectStrength : 0;
    }
    if (shadowChanged) {
      this.scene.traverse((o) => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
      });
    }
    this.resize();
  }

  render() {
    // 每一遍额外的场景重绘都要有贡献才做：
    //   反射 —— 画质开启且视野里确实有水面
    //   体积光遮罩 —— 画质开启且太阳在屏幕内、强度不为 0
    //   泛光 —— 画质开启
    if (this.reflectOn && (!this.isWaterVisible || this.isWaterVisible())) this.renderReflection();
    // 体积光的遮挡遮罩：必须在主画面之前重算（它会把场景里的材质临时换掉）
    const rays = this.godraysOn && this._godrayActive;
    this.godrays.enabled = rays;
    if (rays) this._renderGodRayMask();
    // 选择性泛光（官方做法）：
    //   1) 把非发光体换黑（体素网格换成只输出自发光的材质）
    //   2) 独立 composer 只对这份「变暗场景」做 bloom
    //   3) 还原材质，主 composer 渲染完整场景并把泛光加回去
    if (this.bloomOn) {
      this.scene.traverse(this._darkenNonBloomed);
      this.bloomComposer.render();
      this.scene.traverse(this._restoreMaterial);
    }
    this.composer.render();
  }

  /** 推进水面动画时间。 */
  tick(elapsed) {
    if (this.waterUniforms) this.waterUniforms.uTime.value = elapsed;
    // 焦散与水面波纹同步，否则湖底亮网会和水面脱节
    if (this._causticShaders) {
      for (const s of this._causticShaders) s.uniforms.uTime.value = elapsed;
    }
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

    // 水下：跳过反射渲染（省一次全场景重绘）。
    //
    // 注意：绝不能在这里隐藏水面材质！
    // 潜水时向上看到的正是这层水面本身，曾经这里写了
    // `this.matWater.visible = false; return;` 且没有恢复，
    // 导致入水后整个水面消失（用户报告的 bug）。
    // 水面是否可见由 updateWaterView() 负责，与反射无关。
    if (cam.position.y < L - 1) return;

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

  /**
   * 水下氛围：整个场景染成水体色 + 拉近雾距，形成真实的「泡在水里」感。
   *
   * 相机会在水面上下频繁穿越，所以用阻尼量 underwaterBlend 平滑过渡，
   * 避免入水/出水瞬间雾色突变。
   *
   * 必须在 applyDayNight() 之后、render() 之前调用。
   */
  updateWaterView(dt) {
    const under = this.camera.position.y < this.waterLevel;
    const target = under ? 1 : 0;
    this.underwaterBlend += (target - this.underwaterBlend) * (1 - Math.exp(-9 * dt));
    const b = this.underwaterBlend;

    if (b > 0.001) {
      // 越深吸收越强：可见度随深度衰减
      const depth = Math.max(0, this.waterLevel - this.camera.position.y);
      const absorb = 1 - Math.exp(-depth * 0.05);

      const night = this.waterUniforms ? this.waterUniforms.uNight.value : 0;
      const waterFog = this._fogTmp
        .copy(WATER_FOG_SHALLOW)
        .lerp(WATER_FOG_DEEP, absorb)
        .multiplyScalar(1 - night * 0.72);

      this.scene.fog.color.lerp(waterFog, b);

      const baseDensity = this.scene.fog.density;
      const uwDensity = 0.009 + absorb * 0.020;
      this.scene.fog.density = baseDensity * (1 - b) + uwDensity * b;

      // 水下整体略压曝光，强化「在水里」的观感
      this.renderer.toneMappingExposure *= 1 - b * 0.10;
    }

    if (this.waterUniforms) this.waterUniforms.uUnderwater.value = b;
    // 水下散射更强，光束更明显（强度由 shader 里的 uUnderwater 项放大，
    // 不再需要下调亮度阈值 —— 遮罩是二值的，阈值那套已经不需要了）
    if (this.godrays) this.godrays.uniforms.uUnderwater.value = b;
  }

  /** 初始化反射用的渲染目标与镜面相机。 */
  initReflection(waterLevel = 35) {
    this.waterLevel = waterLevel;
    this.underwaterBlend = 0;
    this._fogTmp = new THREE.Color();
    this._reflLook = new THREE.Vector3();
    const w = Math.max(2, Math.floor(window.innerWidth * this.reflectScale));
    const h = Math.max(2, Math.floor(window.innerHeight * this.reflectScale));
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
