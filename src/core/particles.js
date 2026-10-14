/**
 * 环境粒子与动态细节 —— 让世界「活」起来。
 *
 *  · 飘落的花瓣 / 竹叶（随风飘摆）
 *  · 香炉烟雾（缓慢上升扩散）
 *  · 灯笼轻微摇摆
 *
 * 全部用 Points + 顶点着色器驱动，避免每帧新建对象。
 */
import * as THREE from "three";

/* ---------------- 花瓣 / 竹叶 ---------------- */

const PETAL_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uTime;
  uniform vec3 uOrigin;
  uniform float uRange;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    float t = mod(uTime * aSpeed + aPhase * 37.0, 1.0);
    float y = uOrigin.y + uRange * (1.0 - t * 2.0);
    float sway = sin(uTime * 1.3 + aPhase * 12.0) * 1.6;
    float drift = cos(uTime * 0.7 + aPhase * 8.0) * 1.2;
    vec3 pos = vec3(
      uOrigin.x + position.x + sway,
      y,
      uOrigin.z + position.z + drift
    );
    float ang = uTime * 1.8 + aPhase * 20.0;
    pos.x += cos(ang) * 0.12;
    pos.z += sin(ang) * 0.12;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * 300.0 / max(-mv.z, 1.0);
    vAlpha = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.82, 1.0, t));
  }
`;

const PETAL_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c * vec2(1.0, 1.7));
    if (d > 0.5) discard;
    float edge = smoothstep(0.5, 0.34, d);
    gl_FragColor = vec4(vColor, vAlpha * edge * 0.92);
  }
`;

export class PetalField {
  constructor(scene, count = 900, opts = {}) {
    this.count = count;
    this.range = opts.range ?? 26;

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const speed = new Float32Array(count);
    const size = new Float32Array(count);
    const color = new Float32Array(count * 3);

    const palette = opts.palette || [
      [0.95, 0.62, 0.72],
      [0.98, 0.78, 0.84],
      [0.62, 0.78, 0.42],
      [0.78, 0.86, 0.48],
      [0.92, 0.72, 0.36],
    ];

    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.range;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = Math.sin(a) * r;
      phase[i] = Math.random();
      speed[i] = 0.035 + Math.random() * 0.05;
      size[i] = 0.5 + Math.random() * 0.9;
      const c = palette[(Math.random() * palette.length) | 0];
      color[i * 3] = c[0];
      color[i * 3 + 1] = c[1];
      color[i * 3 + 2] = c[2];
    }

    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(color, 3));

    this.uniforms = {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3(0, 40, 0) },
      uRange: { value: 22 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: PETAL_VERT,
      fragmentShader: PETAL_FRAG,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  update(elapsed, playerPos) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uOrigin.value.set(playerPos.x, playerPos.y + 6, playerPos.z);
  }
}

/* ---------------- 香炉烟雾 ---------------- */

const SMOKE_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  varying float vAlpha;
  void main() {
    float t = mod(uTime * 0.16 + aPhase, 1.0);
    vec3 pos = position;
    pos.y += t * 7.0;
    pos.x += sin(uTime * 0.5 + aPhase * 9.0) * (0.4 + t * 1.6);
    pos.z += cos(uTime * 0.42 + aPhase * 7.0) * (0.4 + t * 1.6);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * (1.0 + t * 3.2) * 260.0 / max(-mv.z, 1.0);
    vAlpha = (1.0 - t) * 0.30 * smoothstep(0.0, 0.15, t);
  }
`;

const SMOKE_FRAG = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    gl_FragColor = vec4(0.92, 0.90, 0.86, a);
  }
`;

export class SmokeField {
  constructor(scene, sources, countPerSource = 26) {
    this.sources = sources;
    const total = Math.max(1, sources.length * countPerSource);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(total * 3);
    const phase = new Float32Array(total);
    const size = new Float32Array(total);

    let i = 0;
    for (const s of sources) {
      for (let k = 0; k < countPerSource; k++) {
        pos[i * 3] = s[0] + (Math.random() - 0.5) * 0.5;
        pos[i * 3 + 1] = s[1];
        pos[i * 3 + 2] = s[2] + (Math.random() - 0.5) * 0.5;
        phase[i] = Math.random();
        size[i] = 0.5 + Math.random() * 0.7;
        i++;
      }
    }

    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));

    this.uniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  update(elapsed) {
    this.uniforms.uTime.value = elapsed;
  }
}

/**
 * 孔明灯 —— 夜间升空的暖色光点，最有氛围感的动态事件。
 *
 * 用 Points + 顶点着色器实现：每盏灯沿自己的时间相位从低处缓缓升起，
 * 轻微横漂，升到顶后循环。仅在夜晚出现。
 */
export class SkyLanterns {
  constructor(scene, count = 120, opts = {}) {
    this.count = count;
    this.baseY = opts.baseY ?? 36;
    this.rise = opts.rise ?? 70;
    this.range = opts.range ?? 130;
    this.origin = new THREE.Vector3(0, 0, 0);

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const speed = new Float32Array(count);
    const size = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.range;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = Math.sin(a) * r;
      phase[i] = Math.random();
      speed[i] = 0.020 + Math.random() * 0.022;
      size[i] = 0.7 + Math.random() * 0.9;
    }

    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));

    this.uniforms = {
      uTime: { value: 0 },
      uOrigin: { value: this.origin.clone() },
      uBaseY: { value: this.baseY },
      uRise: { value: this.rise },
      uVisible: { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aSpeed;
        attribute float aSize;
        uniform float uTime;
        uniform vec3 uOrigin;
        uniform float uBaseY;
        uniform float uRise;
        uniform float uVisible;
        varying float vAlpha;
        void main() {
          float t = fract(uTime * aSpeed + aPhase);
          vec3 p = vec3(
            uOrigin.x + position.x + sin(uTime * 0.25 + aPhase * 12.0) * 2.3,
            uBaseY + t * uRise,
            uOrigin.z + position.z + cos(uTime * 0.21 + aPhase * 8.0) * 2.3
          );
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * 190.0 / max(-mv.z, 1.0);
          // 升起淡入、顶端淡出
          vAlpha = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.85, 1.0, t)) * uVisible;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          // 灯体：暖橙色，中心偏白
          vec3 warm = mix(vec3(1.0, 0.62, 0.26), vec3(1.0, 0.93, 0.72), smoothstep(0.34, 0.0, d));
          float a = smoothstep(0.5, 0.06, d) * vAlpha;
          gl_FragColor = vec4(warm, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  update(elapsed, playerPos, night) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uOrigin.value.set(playerPos.x, 0, playerPos.z);
    // 只在傍晚到黎明之间出现
    this.uniforms.uVisible.value = Math.max(0, Math.min(1, (night - 0.25) / 0.5));
    this.points.visible = this.uniforms.uVisible.value > 0.01;
  }
}

/**
 * 分层雾带 —— 大气透视的「纵深」来源。
 *
 * 在几个不同高度平铺半透明的云雾面，近景清晰、中景淡、远景只剩剪影。
 * 面片跟随相机（只水平跟随），配合全局雾效形成层次。
 */
export class MistLayers {
  constructor(scene, heights = [38, 46, 56, 70]) {
    this.layers = [];
    this.scene = scene;

    const tex = this._makeMistTexture();

    for (let i = 0; i < heights.length; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        // 极淡：多层叠加不能把画面洗白，只做微弱的纵深提示
        opacity: 0.062 - i * 0.012,
        color: new THREE.Color(0xdfe9f2),
        fog: false,
        blending: THREE.NormalBlending,
      });
      const geo = new THREE.PlaneGeometry(1, 1);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(520, 520, 1);
      mesh.position.y = heights[i];
      mesh.renderOrder = -500 + i;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.layers.push({ mesh, mat, speed: 0.6 + i * 0.35, y: heights[i], baseOpacity: 0.062 - i * 0.012 });
    }
  }

  /** 生成柔和的云雾贴图（逐像素，带 alpha）。 */
  _makeMistTexture(size = 128) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const hash = (x, y) => {
      let h = x * 374761393 + y * 668265263;
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const fade = (t) => t * t * (3 - 2 * t);
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = fade(xf), v = fade(yf);
      const a = hash(xi, yi), b = hash(xi + 1, yi);
      const cc = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      return (a + (b - a) * u) + ((cc + (d - cc) * u) - (a + (b - a) * u)) * v;
    };
    const fbm = (x, y) => {
      let v = 0, amp = 0.5, f = 1;
      for (let i = 0; i < 4; i++) { v += amp * noise(x * f, y * f); f *= 2.03; amp *= 0.5; }
      return v;
    };
    // 可平铺：用环形坐标采样
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ang = (x / size) * Math.PI * 2;
        const rad = (y / size) * Math.PI * 2;
        const nx = Math.cos(ang) * 6, ny = Math.sin(ang) * 6;
        const n = fbm(nx + 10, ny + 10) * 0.6 + fbm(ny * 1.7 + 3, nx * 1.7 + 7) * 0.4;
        const a = Math.max(0, Math.min(255, (n - 0.42) * 620));
        const o = (y * size + x) * 4;
        img.data[o] = 240; img.data[o + 1] = 244; img.data[o + 2] = 250;
        img.data[o + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  update(elapsed, camera, nightFactor = 0) {
    for (const L of this.layers) {
      // 水平跟随相机（保持覆盖），并缓慢漂移
      const drift = (elapsed * L.speed) % 520;
      L.mesh.position.x = camera.position.x + drift;
      L.mesh.position.z = camera.position.z + drift * 0.35;

      // 关键：相机高于雾层时淡出。
      // 否则从高空俯瞰时，水平面会被掠射角拉伸成不透明的白墙。
      const above = camera.position.y - L.y;
      const fade = Math.max(0, Math.min(1, 1 - above / 44));
      L.mat.opacity = L.baseOpacity * fade * (1 - nightFactor * 0.45);
      L.mesh.visible = fade > 0.01;

      // 夜晚变暗
      L.mat.color.setRGB(0.87 - nightFactor * 0.6, 0.91 - nightFactor * 0.6, 0.97 - nightFactor * 0.5);
    }
  }
}


export class LanternSway {
  constructor(instMesh, basePositions) {
    this.mesh = instMesh;
    this.base = basePositions;
    this.dummy = new THREE.Object3D();
  }

  update(elapsed) {
    const d = this.dummy;
    for (let i = 0; i < this.base.length; i++) {
      const p = this.base[i];
      const ph = i * 1.7;
      const sway = Math.sin(elapsed * 0.9 + ph) * 0.055;
      const sway2 = Math.cos(elapsed * 0.7 + ph * 1.3) * 0.045;
      d.position.set(p[0] + sway, p[1] + Math.sin(elapsed * 1.1 + ph) * 0.02, p[2] + sway2);
      d.rotation.set(sway * 0.6, 0, sway2 * 0.6);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
