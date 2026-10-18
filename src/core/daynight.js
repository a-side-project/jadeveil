/**
 * 昼夜循环 —— 太阳 / 月亮的轨道、月相、光照与天空颜色随时间变化。
 * 时间以「分钟」为单位，0 = 午夜，720 = 正午。
 *
 * 颜色来自物理大气模型（core/atmosphere.js），关键帧只保留「强度类」参数：
 *   · 天空、雾、半球光、太阳的颜色都由同一个散射模型算出 —— 雾与天空在地平线上无缝衔接，
 *     日落时阳光自然变红、天光变紫，不再是手调的几组色值
 *   · 主光源（投阴影的方向光）白天是太阳，太阳落山后换成月亮：
 *     旧版夜里仍沿用太阳方向，「月光」其实从地平线以下往上照，阴影方向也是反的
 *   · 月相：8 天一个周期（满月 → 新月 → 满月），月亮在天上的位置随月相偏离太阳的正对面，
 *     新月的夜晚最暗，灯笼与火把成为真正的光源
 */
import * as THREE from "three";
import { skyColor, sunTransmittance } from "./atmosphere.js";
import { SUN_I, MOON_I, SKY_EXPOSURE } from "./sky.js";

/** 关键帧：光照强度、曝光、雾浓度、地面色与夜晚程度（颜色由大气模型计算）。 */
const KEYS = [
  { t: 0,    ground: 0x0d1220, sunI: 0.30, hemiGround: 0x1a2030, hemiI: 0.52, fogD: 0.0028, exposure: 1.30, night: 1.0, warm: 0 },
  { t: 270,  ground: 0x121828, sunI: 0.36, hemiGround: 0x202838, hemiI: 0.58, fogD: 0.0027, exposure: 1.32, night: 1.0, warm: 0 },
  { t: 330,  ground: 0x24222e, sunI: 0.55, hemiGround: 0x302838, hemiI: 0.70, fogD: 0.0026, exposure: 1.30, night: 0.72, warm: 0.15 },
  { t: 375,  ground: 0x3a3630, sunI: 1.05, hemiGround: 0x4a4038, hemiI: 0.82, fogD: 0.0024, exposure: 1.20, night: 0.28, warm: 0.55 },
  { t: 420,  ground: 0x5a5648, sunI: 1.35, hemiGround: 0x6a6050, hemiI: 0.78, fogD: 0.0023, exposure: 1.08, night: 0.06, warm: 0.30 },
  { t: 480,  ground: 0x6a6656, sunI: 1.60, hemiGround: 0x746a58, hemiI: 0.84, fogD: 0.0020, exposure: 1.06, night: 0.0, warm: 0.10 },
  { t: 540,  ground: 0x6e6a58, sunI: 1.75, hemiGround: 0x7a7060, hemiI: 0.88, fogD: 0.0019, exposure: 1.06, night: 0.0, warm: 0 },
  { t: 720,  ground: 0x76725e, sunI: 1.95, hemiGround: 0x847a66, hemiI: 0.95, fogD: 0.0016, exposure: 1.04, night: 0.0, warm: 0 },
  { t: 900,  ground: 0x726e5a, sunI: 1.70, hemiGround: 0x7c7260, hemiI: 0.88, fogD: 0.0019, exposure: 1.06, night: 0.0, warm: 0 },
  { t: 990,  ground: 0x5e5648, sunI: 1.30, hemiGround: 0x6a5a48, hemiI: 0.76, fogD: 0.0024, exposure: 1.10, night: 0.08, warm: 0.45 },
  { t: 1035, ground: 0x50463a, sunI: 1.15, hemiGround: 0x5e4a38, hemiI: 0.72, fogD: 0.0025, exposure: 1.16, night: 0.14, warm: 0.85 },
  { t: 1080, ground: 0x3e3630, sunI: 0.95, hemiGround: 0x4a3a30, hemiI: 0.74, fogD: 0.0026, exposure: 1.22, night: 0.34, warm: 0.60 },
  { t: 1140, ground: 0x262430, sunI: 0.55, hemiGround: 0x302838, hemiI: 0.66, fogD: 0.0027, exposure: 1.28, night: 0.72, warm: 0.18 },
  { t: 1230, ground: 0x121828, sunI: 0.36, hemiGround: 0x202838, hemiI: 0.56, fogD: 0.0028, exposure: 1.32, night: 1.0, warm: 0 },
  { t: 1440, ground: 0x0d1220, sunI: 0.30, hemiGround: 0x1a2030, hemiI: 0.52, fogD: 0.0028, exposure: 1.30, night: 1.0, warm: 0 },
];

/** 月相周期（游戏天数）。day 0 是满月。 */
export const LUNAR_DAYS = 8;
const MOON_TINT = new THREE.Color(0.62, 0.72, 1.0);

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };

export class DayNight {
  constructor() {
    this.time = 420; // 起始：清晨
    this.day = 0; // 已过去的游戏天数（决定月相）
    this.speed = 1; // 1 = 每秒推进 1 分钟 → 一天 24 分钟
    this.playing = true;
    this._a = new THREE.Color();
    this._b = new THREE.Color();
    this._c = new THREE.Color();
    this._d = new THREE.Vector3();
    this._lastColorT = -1;

    this.state = {
      zenith: new THREE.Color(),
      horizon: new THREE.Color(),
      ground: new THREE.Color(),
      sunColor: new THREE.Color(),
      sunIntensity: 1,
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      hemiIntensity: 1,
      fogColor: new THREE.Color(),
      fogDensity: 0.006,
      exposure: 1,
      night: 0,
      warm: 0,
      sunDir: new THREE.Vector3(),
      moonDir: new THREE.Vector3(),
      sunElevation: 0,
      // 主光源（投阴影的方向光）：白天 = 太阳，夜里 = 月亮
      lightDir: new THREE.Vector3(0, 1, 0),
      lightColor: new THREE.Color(),
      lightIntensity: 1,
      moonPhase: 0, // 0 满月 → 0.5 新月 → 1 满月
      moonLight: 1, // 月亮照亮的比例 × 是否在地平线上
      starAngle: 0,
      cloudLit: new THREE.Color(),
      skyGain: 1,
    };
  }

  update(dt) {
    if (this.playing) {
      const t = this.time + dt * this.speed;
      if (t >= 1440) this.day++;
      this.time = t % 1440;
      if (this.time < 0) this.time += 1440;
    }
    this.sample(this.time);
    return this.state;
  }

  sample(t) {
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const span = b.t - a.t || 1;
    let f = (t - a.t) / span;
    f = Math.max(0, Math.min(1, f));
    const s = f * f * (3 - 2 * f); // 平滑插值，避免关键帧折角

    const st = this.state;
    st.ground.copy(this._a.setHex(a.ground)).lerp(this._b.setHex(b.ground), s);
    st.hemiGround.copy(this._a.setHex(a.hemiGround)).lerp(this._b.setHex(b.hemiGround), s);
    st.hemiIntensity = lerp(a.hemiI, b.hemiI, s);
    st.fogDensity = lerp(a.fogD, b.fogD, s);
    st.exposure = lerp(a.exposure, b.exposure, s);
    st.night = lerp(a.night, b.night, s);
    st.warm = lerp(a.warm ?? 0, b.warm ?? 0, s);
    const sunI = lerp(a.sunI, b.sunI, s);

    // ---- 太阳：t=360 日出（东），t=1080 日落（西） ----
    const dayAngle = ((t - 360) / 720) * Math.PI;
    const elev = Math.sin(dayAngle);
    st.sunElevation = elev;
    st.sunDir.set(Math.cos(dayAngle) * 0.86, elev, 0.34).normalize();

    // ---- 月亮：每天比太阳晚升起一点，8 天转一圈；满月时正对太阳 ----
    const phase = (((this.day + t / 1440) / LUNAR_DAYS) % 1 + 1) % 1;
    st.moonPhase = phase;
    const moonAngle = dayAngle + Math.PI - phase * Math.PI * 2;
    st.moonDir.set(Math.cos(moonAngle) * 0.86, Math.sin(moonAngle), -0.34).normalize();
    const lit = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2); // 被照亮的比例：满月 1、新月 0
    const moonUp = smooth(-0.04, 0.08, st.moonDir.y);
    st.moonLight = (0.08 + 0.92 * lit) * moonUp;
    // 星空跟着时间绕天极转一圈 / 天
    st.starAngle = (t / 1440) * Math.PI * 2 * 0.25;

    // ---- 主光源：白天太阳，落山后交给月亮（在地平线附近两者都淡到 0，切换看不出来） ----
    const sunUp = smooth(-0.02, 0.08, elev);
    sunTransmittance(st.sunDir, st.sunColor);
    if (elev > -0.02) {
      st.lightDir.copy(st.sunDir);
      st.lightColor.copy(st.sunColor);
      st.lightIntensity = sunI * sunUp;
    } else {
      st.lightDir.copy(st.moonDir);
      st.lightColor.copy(MOON_TINT);
      st.lightIntensity = 0.42 * st.moonLight;
    }
    st.sunIntensity = st.lightIntensity;

    // ---- 天空派生色：雾（地平线一圈的平均天空色）、半球光天空色（天顶）、云的受光 ----
    // 只在时间变化超过 0.25 分钟时重算（每次约 0.1ms）
    if (Math.abs(t - this._lastColorT) > 0.25 || this._lastPhase !== phase) {
      this._lastColorT = t;
      this._lastPhase = phase;
      this._skyDerived(st);
    }
    return st;
  }

  /** 由大气模型算出雾色、天顶色、地平线色与云的受光颜色（与穹顶着色器同一尺度）。 */
  _skyDerived(st) {
    const d = this._d, c = this._c;
    // 暮光亮度适应：太阳落到地平线附近时，物理上的天空亮度只剩白天的几十分之一，
    // 但人眼 / 相机会自动提亮 —— 按太阳贡献的天顶亮度给一个增益（白天约 1，暮光最多约 6 倍），
    // 余晖的橙红与蓝紫才看得见。月光那一项不加增益（夜空本来的样子就是暗的）。
    d.set(0, 1, 0);
    skyColor(d, st.sunDir, SUN_I, c);
    const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * SKY_EXPOSURE;
    st.skyGain = Math.max(1, Math.min(6, Math.sqrt(0.16 / (lum + 0.0045))));
    const fog = st.fogColor.setRGB(0, 0, 0);
    const N = 8;
    for (let i = 0; i < N; i++) {
      const az = (i / N) * Math.PI * 2;
      d.set(Math.cos(az), 0.06, Math.sin(az)).normalize();
      skyColor(d, st.sunDir, SUN_I * st.skyGain, c);
      fog.r += c.r; fog.g += c.g; fog.b += c.b;
      skyColor(d, st.moonDir, MOON_I * st.moonLight, c);
      fog.r += c.r; fog.g += c.g; fog.b += c.b;
    }
    fog.multiplyScalar(SKY_EXPOSURE / N);
    // 夜空底色（与着色器里的气辉一致）
    fog.r += 0.0035 * st.night; fog.g += 0.0055 * st.night; fog.b += 0.011 * st.night;
    st.horizon.copy(fog);

    d.set(0, 1, 0);
    skyColor(d, st.sunDir, SUN_I * st.skyGain, st.zenith);
    st.zenith.add(skyColor(d, st.moonDir, MOON_I * st.moonLight, c));
    st.zenith.multiplyScalar(SKY_EXPOSURE);
    // 半球光天空色：取天顶的色相，亮度由关键帧的 hemiI 决定
    const m = Math.max(st.zenith.r, st.zenith.g, st.zenith.b, 1e-5);
    st.hemiSky.setRGB(st.zenith.r / m, st.zenith.g / m, st.zenith.b / m).lerp(this._c.set(0xffffff), 0.35);

    // 云：主光源颜色 × 强度 + 天光
    st.cloudLit.copy(st.lightColor).multiplyScalar(0.55 * Math.min(1.6, st.lightIntensity))
      .add(this._c.copy(st.zenith).multiplyScalar(1.4))
      .add(this._c.setRGB(0.02, 0.025, 0.035));
  }

  get clockText() {
    const h = Math.floor(this.time / 60) % 24;
    const m = Math.floor(this.time % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
}
