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

/* ---------------- 灯笼摇摆 ---------------- */

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
