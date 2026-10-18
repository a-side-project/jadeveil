/**
 * 大气散射 —— 单次散射的瑞利（Rayleigh）+ 米氏（Mie）模型。
 *
 * 天空的颜色不再是手调的关键帧渐变，而是从物理模型里算出来：
 *   · 正午天顶深蓝、地平线泛白（光程长，蓝光被散射得更多）
 *   · 日出日落时太阳一侧橙红、背对太阳一侧蓝紫（地影 + 维纳斯带）
 *   · 太阳本身的颜色 = 阳光穿过大气后剩下的部分（越接近地平线越红）
 *   · 臭氧层吸收（Chappuis 带，吸收红 / 绿光）：没有它，单次散射的暮光天空会整片发红；
 *     有了它，日落后的天顶保持蓝色，只有地平线附近一条粉色带 —— 与 Hillaire / Bruneton 模型一致
 *   · 软地影：采样点到太阳的光线掠过地球时按最近高度平滑过渡，避免硬判断产生的放射状条纹
 *
 * 同一套公式在两处使用，常数完全相同：
 *   GLSL（SKY_ATMOSPHERE_GLSL）—— 天空穹顶的顶点着色器里积分（O'Neil 的做法：顶点算散射、像素算相位函数）
 *   JS（skyColor / sunTransmittance）—— 每帧算出雾色、半球光颜色、太阳光颜色，保证雾和天空在地平线上无缝衔接
 */
import * as THREE from "three";

// 地球与大气（米）
export const R_PLANET = 6371e3;
export const R_ATMOS = 6471e3;
// 散射系数（米⁻¹）：瑞利对短波散射更强 → 天空是蓝的
export const K_RAY = [5.5e-6, 13.0e-6, 22.4e-6];
export const K_MIE = 21e-6;
export const H_RAY = 8e3;
export const H_MIE = 1.2e3;
export const MIE_G = 0.758;
// 臭氧：只吸收不散射，集中在 25km 高度附近的一层（帐篷形分布，半宽 15km）
export const K_OZONE = [0.650e-6, 1.881e-6, 0.085e-6];
export const OZONE_CENTER = 25e3;
export const OZONE_WIDTH = 15e3;
// 软地影的过渡厚度（米）
const SHADOW_SOFT = 3e3;
// 观察者海拔（米）：略高于地面，地平线更清楚
export const VIEW_ALT = 1000;
const STEPS = 16;
const LIGHT_STEPS = 6;

/** GLSL 片段：散射积分（只在穹顶顶点里调用，开销可以忽略）。 */
export const SKY_ATMOSPHERE_GLSL = /* glsl */ `
  const float R_PLANET = ${R_PLANET.toFixed(1)};
  const float R_ATMOS = ${R_ATMOS.toFixed(1)};
  const vec3 K_RAY = vec3(${K_RAY.map((v) => v.toExponential(3)).join(", ")});
  const float K_MIE = ${K_MIE.toExponential(3)};
  const float H_RAY = ${H_RAY.toFixed(1)};
  const float H_MIE = ${H_MIE.toFixed(1)};
  const float VIEW_ALT = ${VIEW_ALT.toFixed(1)};
  const vec3 K_OZONE = vec3(${K_OZONE.map((v) => v.toExponential(3)).join(", ")});
  const float OZONE_CENTER = ${OZONE_CENTER.toFixed(1)};
  const float OZONE_WIDTH = ${OZONE_WIDTH.toFixed(1)};
  const float SHADOW_SOFT = ${SHADOW_SOFT.toFixed(1)};

  float ozone(float h) { return max(0.0, 1.0 - abs(h - OZONE_CENTER) / OZONE_WIDTH); }

  // 从 p 沿 d 看向太阳：光线若向下掠过地球，按最近点的高度平滑决定还剩多少阳光（软地影）
  float sunVisible(vec3 p, vec3 d) {
    float b = dot(p, d);
    if (b >= 0.0) return 1.0; // 光线朝外，不会穿过地球
    float closest = sqrt(max(0.0, dot(p, p) - b * b));
    return smoothstep(R_PLANET - SHADOW_SOFT, R_PLANET + SHADOW_SOFT, closest);
  }

  vec2 raySphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float d = b * b - c;
    if (d < 0.0) return vec2(-1e9); // 不相交：两个参数都为负（调用方用 t0 > 0 判断「前方有交点」）
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }

  // 返回沿视线累积的瑞利、米氏散射量（未乘相位函数），相位函数在像素着色器里乘 —— 太阳光晕不会被顶点插值抹糊
  void scatter(vec3 rd, vec3 sunDir, out vec3 ray, out vec3 mie) {
    vec3 ro = vec3(0.0, R_PLANET + VIEW_ALT, 0.0);
    vec2 a = raySphere(ro, rd, R_ATMOS);
    float tEnd = a.y;
    vec2 g = raySphere(ro, rd, R_PLANET);
    if (g.x > 0.0) tEnd = min(tEnd, g.x); // 视线打到地面就停
    float ds = tEnd / float(${STEPS});
    float odR = 0.0, odM = 0.0, odO = 0.0;
    ray = vec3(0.0); mie = vec3(0.0);
    for (int i = 0; i < ${STEPS}; i++) {
      vec3 p = ro + rd * (ds * (float(i) + 0.5));
      float h = length(p) - R_PLANET;
      float dR = exp(-h / H_RAY) * ds, dM = exp(-h / H_MIE) * ds;
      odR += dR; odM += dM; odO += ozone(h) * ds;
      float vis = sunVisible(p, sunDir);
      if (vis <= 0.0) continue;
      // 这一点到太阳方向的光学厚度
      float tl = raySphere(p, sunDir, R_ATMOS).y;
      float dl = tl / float(${LIGHT_STEPS});
      float lR = 0.0, lM = 0.0, lO = 0.0;
      for (int j = 0; j < ${LIGHT_STEPS}; j++) {
        vec3 q = p + sunDir * (dl * (float(j) + 0.5));
        float hq = max(0.0, length(q) - R_PLANET);
        lR += exp(-hq / H_RAY) * dl;
        lM += exp(-hq / H_MIE) * dl;
        lO += ozone(hq) * dl;
      }
      vec3 att = exp(-(K_RAY * (odR + lR) + K_MIE * 1.1 * (odM + lM) + K_OZONE * (odO + lO))) * vis;
      ray += dR * att;
      mie += dM * att;
    }
    ray *= K_RAY;
    mie *= K_MIE;
  }

  float phaseRay(float mu) { return 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu); }
  float phaseMie(float mu) {
    const float g = ${MIE_G.toFixed(3)};
    float gg = g * g;
    return 3.0 / (8.0 * 3.14159265) * ((1.0 - gg) * (1.0 + mu * mu)) / ((2.0 + gg) * pow(1.0 + gg - 2.0 * g * mu, 1.5));
  }
`;

/* ---------------- JS 版本（与上面同一套公式） ---------------- */

function raySphere(ox, oy, oz, dx, dy, dz, r) {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const d = b * b - c;
  if (d < 0) return [-1e9, -1e9]; // 不相交：两个参数都为负（与 GLSL 版一致）
  const s = Math.sqrt(d);
  return [-b - s, -b + s];
}

const ozone = (h) => Math.max(0, 1 - Math.abs(h - OZONE_CENTER) / OZONE_WIDTH);
function sunVisible(px, py, pz, dx, dy, dz) {
  const b = px * dx + py * dy + pz * dz;
  if (b >= 0) return 1;
  const closest = Math.sqrt(Math.max(0, px * px + py * py + pz * pz - b * b));
  const k = Math.max(0, Math.min(1, (closest - (R_PLANET - SHADOW_SOFT)) / (2 * SHADOW_SOFT)));
  return k * k * (3 - 2 * k);
}

const phaseRay = (mu) => (3 / (16 * Math.PI)) * (1 + mu * mu);
function phaseMie(mu) {
  const g = MIE_G, gg = g * g;
  return (3 / (8 * Math.PI)) * ((1 - gg) * (1 + mu * mu)) / ((2 + gg) * Math.pow(1 + gg - 2 * g * mu, 1.5));
}

/**
 * 某个视线方向的天空颜色（线性 RGB，未曝光；与穹顶着色器同一尺度）。
 * @param {THREE.Vector3} dir 视线方向（单位向量）
 * @param {THREE.Vector3} sunDir 光源方向
 * @param {number} intensity 光源强度（太阳 22，月亮约 22 × 月相亮度 × 1/400000 再放大到可见）
 */
export function skyColor(dir, sunDir, intensity, out = new THREE.Color()) {
  const ox = 0, oy = R_PLANET + VIEW_ALT, oz = 0;
  const dx = dir.x, dy = dir.y, dz = dir.z;
  let tEnd = raySphere(ox, oy, oz, dx, dy, dz, R_ATMOS)[1];
  const g = raySphere(ox, oy, oz, dx, dy, dz, R_PLANET);
  if (g[0] > 0) tEnd = Math.min(tEnd, g[0]);
  const ds = tEnd / STEPS;
  let odR = 0, odM = 0, odO = 0;
  const ray = [0, 0, 0], mie = [0, 0, 0];
  const sx = sunDir.x, sy = sunDir.y, sz = sunDir.z;
  for (let i = 0; i < STEPS; i++) {
    const t = ds * (i + 0.5);
    const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
    const h = Math.hypot(px, py, pz) - R_PLANET;
    const dR = Math.exp(-h / H_RAY) * ds, dM = Math.exp(-h / H_MIE) * ds;
    odR += dR; odM += dM; odO += ozone(h) * ds;
    const vis = sunVisible(px, py, pz, sx, sy, sz);
    if (vis <= 0) continue;
    const tl = raySphere(px, py, pz, sx, sy, sz, R_ATMOS)[1];
    const dl = tl / LIGHT_STEPS;
    let lR = 0, lM = 0, lO = 0;
    for (let j = 0; j < LIGHT_STEPS; j++) {
      const u = dl * (j + 0.5);
      const hq = Math.max(0, Math.hypot(px + sx * u, py + sy * u, pz + sz * u) - R_PLANET);
      lR += Math.exp(-hq / H_RAY) * dl;
      lM += Math.exp(-hq / H_MIE) * dl;
      lO += ozone(hq) * dl;
    }
    for (let k = 0; k < 3; k++) {
      const att = Math.exp(-(K_RAY[k] * (odR + lR) + K_MIE * 1.1 * (odM + lM) + K_OZONE[k] * (odO + lO))) * vis;
      ray[k] += dR * att;
      mie[k] += dM * att;
    }
  }
  const mu = dx * sx + dy * sy + dz * sz;
  const pr = phaseRay(mu), pm = phaseMie(mu);
  out.setRGB(
    intensity * (ray[0] * K_RAY[0] * pr + mie[0] * K_MIE * pm),
    intensity * (ray[1] * K_RAY[1] * pr + mie[1] * K_MIE * pm),
    intensity * (ray[2] * K_RAY[2] * pr + mie[2] * K_MIE * pm),
  );
  return out;
}

/**
 * 阳光穿过大气到达地面后剩下的颜色（0..1，按最大分量归一）：正午近白、日落橙红。
 * 光源在地平线以下时返回最后可见时的红色（亮度由调用方淡出）。
 */
export function sunTransmittance(sunDir, out = new THREE.Color()) {
  const ox = 0, oy = R_PLANET + VIEW_ALT, oz = 0;
  // 低于地平线时按略高于地平线计算颜色，亮度另行淡出
  const sy = Math.max(sunDir.y, 0.015);
  const l = Math.hypot(sunDir.x, sy, sunDir.z);
  const dx = sunDir.x / l, dy = sy / l, dz = sunDir.z / l;
  const tl = raySphere(ox, oy, oz, dx, dy, dz, R_ATMOS)[1];
  const N = 16, dl = tl / N;
  let lR = 0, lM = 0, lO = 0;
  for (let j = 0; j < N; j++) {
    const u = dl * (j + 0.5);
    const h = Math.hypot(ox + dx * u, oy + dy * u, oz + dz * u) - R_PLANET;
    lR += Math.exp(-h / H_RAY) * dl;
    lM += Math.exp(-h / H_MIE) * dl;
    lO += ozone(h) * dl;
  }
  const r = Math.exp(-(K_RAY[0] * lR + K_MIE * 1.1 * lM + K_OZONE[0] * lO));
  const g = Math.exp(-(K_RAY[1] * lR + K_MIE * 1.1 * lM + K_OZONE[1] * lO));
  const b = Math.exp(-(K_RAY[2] * lR + K_MIE * 1.1 * lM + K_OZONE[2] * lO));
  const m = Math.max(r, g, b, 1e-6);
  return out.setRGB(r / m, g / m, b / m);
}
