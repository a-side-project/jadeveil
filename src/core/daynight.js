/**
 * 昼夜循环 —— 太阳/月亮角度、天空色、雾色、光照强度随时间平滑过渡。
 * 时间以「分钟」为单位，0 = 午夜，720 = 正午。
 */
import * as THREE from "three";

/** 关键帧：每个时刻的天空 / 光照配色。 */
const KEYS = [
  { t: 0,    zenith: 0x0d1738, horizon: 0x1e2c52, ground: 0x0d1220, sun: 0x5a6ea8, sunI: 0.30, hemiSky: 0x3a4a7e, hemiGround: 0x1a2030, hemiI: 0.52, fog: 0x1a2444, fogD: 0.0028, exposure: 1.30, night: 1.0, warm: 0 },
  { t: 270,  zenith: 0x122048, horizon: 0x2a3a62, ground: 0x121828, sun: 0x6a7eb8, sunI: 0.36, hemiSky: 0x44548a, hemiGround: 0x202838, hemiI: 0.58, fog: 0x223052, fogD: 0.0027, exposure: 1.32, night: 1.0, warm: 0 },
  { t: 330,  zenith: 0x2a3f74, horizon: 0x8a5a72, ground: 0x24222e, sun: 0xa86a78, sunI: 0.55, hemiSky: 0x5e5e92, hemiGround: 0x302838, hemiI: 0.70, fog: 0x6a4a62, fogD: 0.0026, exposure: 1.30, night: 0.72, warm: 0.15 },
  { t: 375,  zenith: 0x3a6aa8, horizon: 0xe8a074, ground: 0x3a3630, sun: 0xffb070, sunI: 1.05, hemiSky: 0x8aa8d0, hemiGround: 0x4a4038, hemiI: 0.82, fog: 0xd8a888, fogD: 0.0024, exposure: 1.20, night: 0.28, warm: 0.55 },
  { t: 420,  zenith: 0x2f6fb5, horizon: 0xf0c9a0, ground: 0x5a5648, sun: 0xffd9a0, sunI: 1.35, hemiSky: 0xa8c8e8, hemiGround: 0x6a6050, hemiI: 0.78, fog: 0xe4cbb0, fogD: 0.0023, exposure: 1.08, night: 0.06, warm: 0.30 },
  { t: 480,  zenith: 0x2a6ec4, horizon: 0xe8dcc8, ground: 0x6a6656, sun: 0xfff0d0, sunI: 1.60, hemiSky: 0xb8d4f0, hemiGround: 0x746a58, hemiI: 0.84, fog: 0xdce8f4, fogD: 0.0020, exposure: 1.06, night: 0.0, warm: 0.10 },
  { t: 540,  zenith: 0x2a6ec4, horizon: 0xcfe4f2, ground: 0x6e6a58, sun: 0xfff2d4, sunI: 1.75, hemiSky: 0xbcd8f0, hemiGround: 0x7a7060, hemiI: 0.88, fog: 0xd6e6f2, fogD: 0.0019, exposure: 1.06, night: 0.0, warm: 0 },
  { t: 720,  zenith: 0x1f66c8, horizon: 0xd8ecfa, ground: 0x76725e, sun: 0xfffaf0, sunI: 1.95, hemiSky: 0xc8e0f8, hemiGround: 0x847a66, hemiI: 0.95, fog: 0xdcecf8, fogD: 0.0016, exposure: 1.04, night: 0.0, warm: 0 },
  { t: 900,  zenith: 0x2a6ec0, horizon: 0xd0e2f0, ground: 0x726e5a, sun: 0xfff0cc, sunI: 1.70, hemiSky: 0xbcd4ec, hemiGround: 0x7c7260, hemiI: 0.88, fog: 0xd4e2ee, fogD: 0.0019, exposure: 1.06, night: 0.0, warm: 0 },
  { t: 990,  zenith: 0x2f5fa8, horizon: 0xf0b478, ground: 0x5e5648, sun: 0xffb464, sunI: 1.30, hemiSky: 0xa8b8d8, hemiGround: 0x6a5a48, hemiI: 0.76, fog: 0xe0b088, fogD: 0.0024, exposure: 1.10, night: 0.08, warm: 0.45 },
  { t: 1035, zenith: 0x2f5a9c, horizon: 0xff9a52, ground: 0x50463a, sun: 0xff9a4a, sunI: 1.15, hemiSky: 0xa898b0, hemiGround: 0x5e4a38, hemiI: 0.72, fog: 0xe89a62, fogD: 0.0025, exposure: 1.16, night: 0.14, warm: 0.85 },
  { t: 1080, zenith: 0x2a3f78, horizon: 0xe07a4a, ground: 0x3e3630, sun: 0xff8a48, sunI: 0.95, hemiSky: 0x8a7aa0, hemiGround: 0x4a3a30, hemiI: 0.74, fog: 0xc07a58, fogD: 0.0026, exposure: 1.22, night: 0.34, warm: 0.60 },
  { t: 1140, zenith: 0x22305e, horizon: 0x9a5a68, ground: 0x262430, sun: 0xb06a68, sunI: 0.55, hemiSky: 0x5a5478, hemiGround: 0x302838, hemiI: 0.66, fog: 0x7a4a58, fogD: 0.0027, exposure: 1.28, night: 0.72, warm: 0.18 },
  { t: 1230, zenith: 0x122048, horizon: 0x2a3a62, ground: 0x121828, sun: 0x6a7eb8, sunI: 0.36, hemiSky: 0x44548a, hemiGround: 0x202838, hemiI: 0.56, fog: 0x223052, fogD: 0.0028, exposure: 1.32, night: 1.0, warm: 0 },
  { t: 1440, zenith: 0x0d1738, horizon: 0x1e2c52, ground: 0x0d1220, sun: 0x5a6ea8, sunI: 0.30, hemiSky: 0x3a4a7e, hemiGround: 0x1a2030, hemiI: 0.52, fog: 0x1a2444, fogD: 0.0028, exposure: 1.30, night: 1.0, warm: 0 },
];

const lerp = (a, b, t) => a + (b - a) * t;

export class DayNight {
  constructor() {
    this.time = 420; // 起始：清晨
    this.speed = 1; // 1 = 每秒推进 1 分钟 → 一天 24 分钟
    this.playing = true;
    this._a = new THREE.Color();
    this._b = new THREE.Color();

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
    };
  }

  update(dt) {
    if (this.playing) {
      this.time = (this.time + dt * this.speed) % 1440;
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
    st.zenith.copy(this._a.setHex(a.zenith)).lerp(this._b.setHex(b.zenith), s);
    st.horizon.copy(this._a.setHex(a.horizon)).lerp(this._b.setHex(b.horizon), s);
    st.ground.copy(this._a.setHex(a.ground)).lerp(this._b.setHex(b.ground), s);
    st.sunColor.copy(this._a.setHex(a.sun)).lerp(this._b.setHex(b.sun), s);
    st.hemiSky.copy(this._a.setHex(a.hemiSky)).lerp(this._b.setHex(b.hemiSky), s);
    st.hemiGround.copy(this._a.setHex(a.hemiGround)).lerp(this._b.setHex(b.hemiGround), s);
    st.fogColor.copy(this._a.setHex(a.fog)).lerp(this._b.setHex(b.fog), s);

    st.sunIntensity = lerp(a.sunI, b.sunI, s);
    st.hemiIntensity = lerp(a.hemiI, b.hemiI, s);
    st.fogDensity = lerp(a.fogD, b.fogD, s);
    st.exposure = lerp(a.exposure, b.exposure, s);
    st.night = lerp(a.night, b.night, s);
    st.warm = lerp(a.warm ?? 0, b.warm ?? 0, s);

    // 太阳角度：t=360 日出（东），t=1080 日落（西）
    const dayAngle = ((t - 360) / 720) * Math.PI;
    const elev = Math.sin(dayAngle);
    const azim = Math.cos(dayAngle);
    st.sunElevation = elev;
    st.sunDir.set(azim * 0.86, elev, 0.34).normalize();
    st.moonDir.copy(st.sunDir).multiplyScalar(-1);
    return st;
  }

  get clockText() {
    const h = Math.floor(this.time / 60) % 24;
    const m = Math.floor(this.time % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
}
