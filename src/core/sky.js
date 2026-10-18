/**
 * 天空 —— 物理大气散射 + 太阳 / 月亮（含月相）+ 转动的星空 + 受光的云带。
 * 全部程序化，无外部贴图。
 *
 *   · 天空颜色：瑞利 + 米氏单次散射（core/atmosphere.js），在穹顶顶点上积分，
 *     相位函数逐像素计算 —— 日落时太阳一侧橙红、背向一侧蓝紫，太阳周围的光晕锐利
 *   · 太阳：带临边昏暗（limb darkening）的圆盘，颜色是阳光穿过大气后的透射色
 *   · 月亮：按真实几何算明暗交界线，月相随天数变化；夜空的散射由月光提供（满月时夜空更亮）
 *   · 星空：随时间绕天极缓慢转动，靠近地平线被大气削弱
 *   · 云：被太阳染色（日落时云底发红），夜里只剩月光下的冷灰
 */
import * as THREE from "three";
import { SKY_ATMOSPHERE_GLSL } from "./atmosphere.js";

/** 太阳 / 月亮的光源强度（大气模型的尺度）；穹顶与 JS 侧的雾色计算用同一组值。 */
export const SUN_I = 22;
export const MOON_I = 22 * 0.012;
/** 大气输出到场景亮度的换算（与雾色计算一致，地平线上雾和天空才对得上）。 */
export const SKY_EXPOSURE = 0.55;

const SKY_VERT = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  varying vec3 vDir;
  varying vec3 vRaySun;
  varying vec3 vMieSun;
  varying vec3 vRayMoon;
  varying vec3 vMieMoon;
  ${SKY_ATMOSPHERE_GLSL}
  void main() {
    vDir = normalize(position);
    // 地平线以下的视线按略低于地平线积分（看到的是远处地面上方的空气）
    vec3 rd = normalize(vec3(vDir.x, max(vDir.y, -0.08), vDir.z));
    scatter(rd, normalize(uSunDir), vRaySun, vMieSun);
    scatter(rd, normalize(uMoonDir), vRayMoon, vMieMoon);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // 永远贴在远裁剪面
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  varying vec3 vRaySun;
  varying vec3 vMieSun;
  varying vec3 vRayMoon;
  varying vec3 vMieMoon;

  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uMoonDir;
  uniform float uMoonLight;   // 月光强度（月相 × 是否在地平线上）
  uniform float uNight;
  uniform float uTime;
  uniform float uStarAngle;   // 星空绕天极转过的角度
  uniform vec3 uCloudLit;     // 云的受光颜色（太阳 / 月亮 + 天光，由 JS 每帧算）
  uniform float uSkyGain;     // 暮光时的亮度适应（人眼 / 相机在暮色里会自动提亮，见 DayNight._skyDerived）

  float phaseRay(float mu) { return 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu); }
  float phaseMie(float mu) {
    const float g = 0.758;
    float gg = g * g;
    return 3.0 / (8.0 * 3.14159265) * ((1.0 - gg) * (1.0 + mu * mu)) / ((2.0 + gg) * pow(1.0 + gg - 2.0 * g * mu, 1.5));
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 sunD = normalize(uSunDir), moonD = normalize(uMoonDir);
    float muS = dot(dir, sunD), muM = dot(dir, moonD);

    // ---- 大气 ----
    vec3 col = ${SUN_I.toFixed(1)} * uSkyGain * (vRaySun * phaseRay(muS) + vMieSun * phaseMie(muS));
    col += ${MOON_I.toFixed(4)} * uMoonLight * (vRayMoon * phaseRay(muM) + vMieMoon * phaseMie(muM));
    col *= ${SKY_EXPOSURE.toFixed(3)};
    // 夜空的底色（气辉）：完全没有月光时也不是死黑
    col += vec3(0.0035, 0.0055, 0.011) * uNight;

    // ---- 太阳圆盘：临边昏暗，颜色 = 大气透射色 ----
    float sunR = 0.9997;
    if (muS > sunR - 0.0004) {
      float r = clamp((1.0 - muS) / (1.0 - sunR), 0.0, 1.0);
      float limb = 1.0 - 0.6 * (1.0 - sqrt(1.0 - r * r));
      float edge = smoothstep(sunR - 0.0004, sunR, muS);
      col += uSunColor * 26.0 * limb * edge * smoothstep(-0.03, 0.02, sunD.y);
    }

    // ---- 月亮：真实的明暗交界线（月相）+ 暗面的地照 ----
    // 用视线相对月心的切向偏移（≈ 角距离）定位月面坐标；不用 acos —— 1 附近的 acos 在 float 精度下会把圆盘压扁
    const float MOON_R = 0.032; // 角半径（弧度）
    if (muM > 0.998 && h > -0.05) {
      vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), moonD));
      vec3 up = cross(moonD, right);
      vec3 off = dir - moonD * muM;
      vec2 xy = vec2(dot(off, right), dot(off, up)) / MOON_R;
      float r2 = dot(xy, xy);
      float edge = 1.0 - smoothstep(0.92, 1.0, r2); // 抗锯齿的圆盘边缘
      if (edge > 0.0) {
        float z = sqrt(max(0.0, 1.0 - r2));
        // 月面法线（朝向观察者的半球）：被太阳照到的一侧亮
        vec3 n = normalize(xy.x * right + xy.y * up - z * moonD);
        float lit = smoothstep(-0.04, 0.10, dot(n, sunD));
        float maria = 0.80 + 0.20 * fbm(xy * 2.6 + 7.0);
        vec3 moonCol = vec3(0.96, 0.95, 0.90) * maria * (lit * 2.4 + 0.03);
        float vis = smoothstep(-0.05, 0.03, moonD.y);
        col = mix(col, moonCol, edge * vis);
      }
    }
    // 月晕：一圈淡淡的冷光，随月相变亮
    col += vec3(0.30, 0.38, 0.60) * pow(max(muM, 0.0), 2200.0) * 0.5 * uMoonLight * smoothstep(-0.05, 0.03, moonD.y);

    // ---- 星空：绕天极转动；靠近地平线、天越亮越看不见 ----
    if (uNight > 0.02 && h > -0.02) {
      float ca = cos(uStarAngle), sa = sin(uStarAngle);
      vec3 sd = vec3(ca * dir.x - sa * dir.y, sa * dir.x + ca * dir.y, dir.z); // 绕近似的天极轴转动
      vec2 sp = sd.xz / max(abs(sd.y) + 0.35, 0.35) * 26.0;
      float star = hash(floor(sp * 3.0));
      float twinkle = 0.6 + 0.4 * sin(uTime * 2.2 + star * 40.0);
      float vis = uNight * smoothstep(0.0, 0.18, h) * (1.0 - clamp(dot(col, vec3(0.33)) * 6.0, 0.0, 0.9));
      col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9955, 0.9995, star) * twinkle * vis * 1.6;
      vec2 sp2 = sd.xz / max(abs(sd.y) + 0.35, 0.35) * 62.0;
      float star2 = hash(floor(sp2 * 3.0) + 17.0);
      col += vec3(0.75, 0.82, 1.0) * smoothstep(0.9975, 0.9998, star2) * vis * 0.9;
      float band = 1.0 - abs(dot(sd, normalize(vec3(0.42, 0.30, -0.86))));
      float milky = smoothstep(0.86, 1.0, band) * (0.55 + 0.45 * fbm(sd.xz * 7.0));
      col += vec3(0.05, 0.06, 0.10) * milky * vis;
    }

    // ---- 云带：受光颜色 + 太阳一侧的前向散射亮边 ----
    if (h > 0.0) {
      vec2 cp = dir.xz / (h + 0.16) * 1.5 + vec2(uTime * 0.006, uTime * 0.002);
      float c = fbm(cp * 1.1);
      float band = smoothstep(0.46, 0.78, c) * smoothstep(0.0, 0.22, h) * (1.0 - smoothstep(0.5, 0.95, h));
      vec3 cloudCol = uCloudLit * (0.75 + 0.25 * c);
      cloudCol += uSunColor * pow(max(muS, 0.0), 6.0) * 0.6 * smoothstep(-0.05, 0.1, sunD.y);
      col = mix(col, cloudCol, band * 0.72);
    }

    // ---- 地平线以下：远方大地被大气遮蔽，看到的是同一层雾霾，只略微压暗（不能混成另一种颜色，否则地平线上会有一道硬边） ----
    float below = clamp(-h * 3.2, 0.0, 1.0);
    col *= 1.0 - below * 0.18;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uGround: { value: new THREE.Color(0x6b6f63) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
      uSunColor: { value: new THREE.Color(0xfff0c8) },
      uMoonDir: { value: new THREE.Vector3(-0.4, -0.7, -0.3) },
      uMoonLight: { value: 1 },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uStarAngle: { value: 0 },
      uCloudLit: { value: new THREE.Color(1, 1, 1) },
      uSkyGain: { value: 1 },
    };

    // 顶点上做散射积分：分辨率要够，日落时地平线附近的颜色过渡才平滑
    const geo = new THREE.SphereGeometry(1, 96, 64);
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

  /** @param {object} st DayNight.state */
  set(st) {
    const u = this.uniforms;
    u.uGround.value.copy(st.ground);
    u.uSunDir.value.copy(st.sunDir);
    u.uSunColor.value.copy(st.sunColor);
    u.uMoonDir.value.copy(st.moonDir);
    u.uMoonLight.value = st.moonLight;
    u.uNight.value = st.night;
    u.uStarAngle.value = st.starAngle;
    u.uCloudLit.value.copy(st.cloudLit);
    u.uSkyGain.value = st.skyGain;
  }
}
