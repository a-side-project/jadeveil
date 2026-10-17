/**
 * 特效粒子池 —— Minecraft 风格的方形像素粒子（不是圆形光斑）。
 *
 *   · 一个 Points + 固定容量环形缓冲，所有技能特效共用，单 draw call
 *   · 每粒子独立的速度 / 阻尼 / 重力 / 寿命 / 尺寸变化 / 颜色渐变
 *   · 加色混合、不写深度；挂在选择性泛光层 —— 龙息、火球自带辉光
 *   · 片元里做硬边方块 + 一圈暗边，保持像素风
 */
import * as THREE from "three";
import { BLOOM_SCENE } from "../core/renderer.js";

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.5, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    if (vAlpha <= 0.002) discard;
    // 硬边方块粒子：中心亮、外圈 1/4 稍暗，像 MC 的 2×2 像素粒子
    vec2 p = abs(gl_PointCoord - 0.5);
    float edge = step(0.36, max(p.x, p.y));
    vec3 c = vColor * (1.0 - edge * 0.45);
    gl_FragColor = vec4(c * vAlpha, vAlpha);
  }
`;

export class FXParticles {
  constructor(scene, capacity = 6000) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.col0 = new Float32Array(capacity * 3);
    this.col1 = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.next = 0;
    this.alive = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 420 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.layers.enable(BLOOM_SCENE);
    scene.add(this.points);
  }

  /** 视口高度变化时同步点尺寸（保证粒子的像素大小与分辨率无关）。 */
  setViewportHeight(h) {
    this.mat.uniforms.uScale.value = h * 0.5;
  }

  /**
   * 发射一个粒子。
   * @param {object} o { x,y,z, vx,vy,vz, life, size, size1, color:[r,g,b], color1, drag, gravity }
   */
  emit(o) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    const c0 = o.color || [1, 1, 1];
    const c1 = o.color1 || c0;
    this.col0[i3] = c0[0]; this.col0[i3 + 1] = c0[1]; this.col0[i3 + 2] = c0[2];
    this.col1[i3] = c1[0]; this.col1[i3 + 1] = c1[1]; this.col1[i3 + 2] = c1[2];
    this.size0[i] = o.size ?? 0.3;
    this.size1[i] = o.size1 ?? this.size0[i];
    this.maxLife[i] = o.life ?? 1;
    this.life[i] = this.maxLife[i];
    this.drag[i] = o.drag ?? 1.5;
    this.grav[i] = o.gravity ?? 0;
  }

  /** 球面随机方向的爆发。 */
  burst(x, y, z, n, o = {}) {
    const speed = o.speed ?? 6;
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.35 + Math.random() * 0.65);
      this.emit({
        ...o,
        x: x + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0),
        y: y + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0),
        z: z + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0),
        vx: r * Math.cos(th) * s, vy: u * s * (o.flatY ?? 1) + (o.lift ?? 0), vz: r * Math.sin(th) * s,
        life: (o.life ?? 1) * (0.6 + Math.random() * 0.4),
      });
    }
  }

  /** 水平冲击环。 */
  ring(x, y, z, n, o = {}) {
    const speed = o.speed ?? 12;
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2 + Math.random() * 0.05;
      this.emit({
        ...o, x, y: y + (Math.random() - 0.5) * 0.3, z,
        vx: Math.cos(th) * speed, vy: (Math.random() - 0.3) * 0.8, vz: Math.sin(th) * speed,
      });
    }
  }

  update(dt) {
    let alive = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      alive++;
      const i3 = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= k;
      this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt;
      this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i]; // 0 → 1
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.col[i3] = this.col0[i3] + (this.col1[i3] - this.col0[i3]) * t;
      this.col[i3 + 1] = this.col0[i3 + 1] + (this.col1[i3 + 1] - this.col0[i3 + 1]) * t;
      this.col[i3 + 2] = this.col0[i3 + 2] + (this.col1[i3 + 2] - this.col0[i3 + 2]) * t;
      // 淡入 10%、淡出 35%
      this.alpha[i] = Math.min(1, t / 0.1) * Math.min(1, (1 - t) / 0.35);
    }
    this.alive = alive;
    const a = this.geo.attributes;
    a.position.needsUpdate = true;
    a.aColor.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
  }
}
