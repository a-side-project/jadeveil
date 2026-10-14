/**
 * 天空 —— 渐变穹顶 + 太阳/月亮 + 星空 + 云带。
 * 全部程序化，无外部贴图。
 */
import * as THREE from "three";

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // 永远贴在远裁剪面
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;

  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uMoonDir;
  uniform float uNight;
  uniform float uTime;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;

    vec3 col;
    float t = clamp(h * 1.35 + 0.06, 0.0, 1.0);
    col = mix(uHorizon, uZenith, pow(t, 0.72));
    float below = clamp(-h * 3.2, 0.0, 1.0);
    col = mix(col, uGround, below);

    // 太阳光晕
    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sd, 220.0) * 2.4;
    col += uSunColor * pow(sd, 12.0) * 0.30;
    col += uSunColor * pow(sd, 3.0) * 0.09;

    // 月亮：本体圆盘 + 月晕
    float md = max(dot(dir, normalize(uMoonDir)), 0.0);
    float disc = smoothstep(0.99955, 0.99985, md);
    col += vec3(0.95, 0.96, 1.0) * disc * 3.4 * uNight;
    col += vec3(0.72, 0.80, 1.0) * pow(md, 900.0) * 2.2 * uNight;
    col += vec3(0.42, 0.52, 0.78) * pow(md, 26.0) * 0.26 * uNight;

    // 星空：多层星点 + 银河带
    if (uNight > 0.02 && h > -0.02) {
      vec2 sp = dir.xz / max(abs(h) + 0.28, 0.28) * 26.0;
      float star = hash(floor(sp * 3.0));
      float twinkle = 0.6 + 0.4 * sin(uTime * 2.2 + star * 40.0);
      float s = smoothstep(0.9955, 0.9995, star) * twinkle;
      col += vec3(0.85, 0.9, 1.0) * s * uNight * 2.0;

      // 第二层更细密的星
      vec2 sp2 = dir.xz / max(abs(h) + 0.28, 0.28) * 62.0;
      float star2 = hash(floor(sp2 * 3.0) + 17.0);
      float s2 = smoothstep(0.9975, 0.9998, star2);
      col += vec3(0.75, 0.82, 1.0) * s2 * uNight * 1.1;

      // 银河：一条斜向的淡雾带
      float band = 1.0 - abs(dot(normalize(dir), normalize(vec3(0.42, 0.30, -0.86))));
      float milky = smoothstep(0.86, 1.0, band) * (0.55 + 0.45 * fbm(dir.xz * 7.0));
      col += vec3(0.16, 0.18, 0.30) * milky * uNight * smoothstep(0.0, 0.25, h);
    }

    // 云带
    if (h > 0.0) {
      vec2 cp = dir.xz / (h + 0.16) * 1.5 + vec2(uTime * 0.006, uTime * 0.002);
      float c = fbm(cp * 1.1);
      float band = smoothstep(0.46, 0.78, c) * smoothstep(0.0, 0.22, h) * (1.0 - smoothstep(0.5, 0.95, h));
      vec3 cloudCol = mix(vec3(0.62, 0.66, 0.74), vec3(1.0, 0.97, 0.92), 1.0 - uNight * 0.72);
      cloudCol = mix(cloudCol, uSunColor * 1.25, pow(sd, 4.0) * 0.55);
      col = mix(col, cloudCol, band * 0.72);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uZenith: { value: new THREE.Color(0x2f6fb5) },
      uHorizon: { value: new THREE.Color(0xbcd8ea) },
      uGround: { value: new THREE.Color(0x6b6f63) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
      uSunColor: { value: new THREE.Color(0xfff0c8) },
      uMoonDir: { value: new THREE.Vector3(-0.4, -0.7, -0.3) },
      uNight: { value: 0 },
      uTime: { value: 0 },
    };

    const geo = new THREE.SphereGeometry(1, 48, 32);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);
    this.scene = scene;
  }

  /** 让穹顶跟随相机，并保持刚好在远裁剪面内。 */
  update(camera, time) {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(camera.far * 0.9);
    this.uniforms.uTime.value = time;
  }

  set(zenith, horizon, ground, sunDir, sunColor, moonDir, night) {
    this.uniforms.uZenith.value.copy(zenith);
    this.uniforms.uHorizon.value.copy(horizon);
    this.uniforms.uGround.value.copy(ground);
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uMoonDir.value.copy(moonDir);
    this.uniforms.uNight.value = night;
  }
}
