/**
 * 音频总管 —— 唯一的 AudioContext 入口。
 *
 *  · 主总线 → 音乐总线 + 音效总线（各自独立开关与音量）
 *  · 共享一个卷积混响，拨弦/钟/入水走混响，其他走干声
 *  · 水下自动压低音效高频（低频传导，高频被水吸收），进出水平滑过渡
 *  · 设置持久化到 localStorage
 */
import { makeReverb } from "./synth.js";
import { SFX } from "./sfx.js";
import { Music } from "./music.js";

const LS_KEY = "jadeveil.audio.v1";

export class AudioManager {
  constructor() {
    this.ctx = null;
    this._underwater = 0;
    this.settings = { musicOn: true, musicVol: 0.8, sfxOn: true, sfxVol: 1.0 };
    this._load();
  }

  _load() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      if (s && typeof s === "object") Object.assign(this.settings, s);
    } catch {
      /* ignore */
    }
  }

  _save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  /** 惰性创建 AudioContext（必须在用户手势后调用）。 */
  ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);

    const rev = makeReverb(ctx, { seconds: 3.4, decay: 2.5, mix: 0.45 });
    rev.output.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.settings.musicOn ? this.settings.musicVol : 0;
    this.musicBus.connect(this.master);

    // 水下低通：插在 SFX 干声之前
    this.sfxLP = ctx.createBiquadFilter();
    this.sfxLP.type = "lowpass";
    this.sfxLP.frequency.value = 20000;
    this.sfxLP.Q.value = 0.4;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.settings.sfxOn ? this.settings.sfxVol : 0;
    this.sfxLP.connect(this.sfxBus);
    this.sfxBus.connect(this.master);

    this.sfx = new SFX(ctx, { dry: this.sfxLP, wet: rev.input });
    this.music = new Music(ctx, this.musicBus, rev.input);

    const resume = () => {
      if (ctx.state === "suspended") ctx.resume();
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);

    this.ctx = ctx;
    return ctx;
  }

  /** 用户手势后：确保上下文运行并启动音乐。 */
  begin() {
    this.ensure();
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.music.start();
  }

  /** 每帧调用：水下滤波 + 音乐昼夜。 */
  update(dt, night, headUnderwater) {
    if (!this.ctx) return;
    this._underwater += ((headUnderwater ? 1 : 0) - this._underwater) * Math.min(1, dt * 8);
    const t = this.ctx.currentTime;
    this.sfxLP.frequency.setTargetAtTime(20000 - this._underwater * 19000, t, 0.3);
    this.sfxLP.Q.value = 0.4 + this._underwater * 0.7;
    this.music.update(night);
  }

  /* ---------------- 设置 ---------------- */
  setMusicOn(on) {
    this.settings.musicOn = on;
    this._applyMusic();
    this._save();
  }
  setMusicVol(v) {
    this.settings.musicVol = v;
    this._applyMusic();
    this._save();
  }
  setSfxOn(on) {
    this.settings.sfxOn = on;
    this._applySfx();
    this._save();
  }
  setSfxVol(v) {
    this.settings.sfxVol = v;
    this._applySfx();
    this._save();
  }
  _applyMusic() {
    if (!this.musicBus) return;
    const v = this.settings.musicOn ? this.settings.musicVol : 0;
    this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  _applySfx() {
    if (!this.sfxBus) return;
    const v = this.settings.sfxOn ? this.settings.sfxVol : 0;
    this.sfxBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /* ---------------- 便捷播放接口（带开关判断） ---------------- */
  // 注意：方法名以字符串传入、在守卫内再查 this.sfx[name]。
  // 否则「AudioContext 尚未创建（用户还没触发首次手势）」时 this.sfx 为 undefined，
  // 直接写 this.sfx.land 会在传参阶段就抛 TypeError。
  _sfx(name, ...args) {
    if (this.ctx && this.sfx && this.settings.sfxOn) this.sfx[name](...args);
  }
  breakBlock(name) {
    this._sfx("breakBlock", name);
  }
  placeBlock(name) {
    this._sfx("placeBlock", name);
  }
  footstep(surface, running) {
    this._sfx("footstep", surface, running);
  }
  jump() {
    this._sfx("jump");
  }
  land(fall) {
    this._sfx("land", fall);
  }
  splash(kind) {
    this._sfx("splash", kind);
  }
  swimStroke() {
    this._sfx("swimStroke");
  }
  bubble() {
    this._sfx("bubble");
  }
  uiClick() {
    this._sfx("uiClick");
  }
  uiHover() {
    this._sfx("uiHover");
  }
  uiSelect() {
    this._sfx("uiSelect");
  }
  blocked() {
    this._sfx("blocked");
  }
}
