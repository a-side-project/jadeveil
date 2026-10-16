/**
 * 音频总管 —— 播放真实音频素材（授权见 audio/CREDITS.md）。
 *
 *  · 音乐：`<audio>` + MediaElementSource 接入 Web Audio 图，循环播放、走音乐总线
 *  · 音效：解码成 AudioBuffer，按名取随机变体，走「水下低通 → 音效总线」
 *  · 音乐 / 音效各自独立开关与音量，持久化到 localStorage
 *  · AudioContext 惰性创建（首次用户手势后）
 */
const BASE = "./audio";

/** 方块名 → 材质类别（决定破坏/脚步用哪组音）。 */
export function materialOf(name) {
  const n = name || "";
  if (/roof|gold|brick|ridge|eave|corner|lantern|glow|tassel/.test(n)) return "metal";
  if (/jade|marble/.test(n)) return "glass"; // 玉/大理石：清脆
  if (/grass|leaf|flower|lotus|tuft|pine/.test(n)) return "plant";
  if (/water/.test(n)) return "water";
  if (/wood|beam|railing|bamboo/.test(n)) return "wood";
  if (/dirt|sand|earth/.test(n)) return "dirt";
  return "stone";
}

// 每个音效名对应的变体数量（文件为 <name>_<i>.ogg）
const SFX_COUNT = {
  break_stone: 3, break_wood: 2, break_glass: 2, break_metal: 2,
  break_plant: 2, break_dirt: 2, place: 3,
  step_stone: 3, step_wood: 3, step_grass: 3,
  jump: 1, land: 2, land_heavy: 2, splash: 2,
  ui_click: 2, ui_select: 2, ui_hover: 2, ui_error: 1,
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this._buffers = {}; // name -> AudioBuffer[]
    this._musicEl = null;
    this._underwater = 0;
    this.settings = { musicOn: true, musicVol: 0.8, sfxOn: true, sfxVol: 1.0 };
    this._load();
  }

  _load() {
    try {
      const s = JSON.parse(localStorage.getItem("jadeveil.audio.v1"));
      if (s && typeof s === "object") Object.assign(this.settings, s);
    } catch { /* ignore */ }
  }
  _save() {
    try { localStorage.setItem("jadeveil.audio.v1", JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  /**
   * 惰性创建 AudioContext。必须在首次用户手势里「同步」调用，
   * 以便在同一手势内完成 resume() + play()（自动播放策略要求手势）。
   * 素材解码异步进行，不阻塞。
   */
  ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.settings.musicOn ? this.settings.musicVol : 0;
    this.musicBus.connect(this.master);

    this.sfxLP = ctx.createBiquadFilter();
    this.sfxLP.type = "lowpass";
    this.sfxLP.frequency.value = 20000;
    this.sfxLP.Q.value = 0.4;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.settings.sfxOn ? this.settings.sfxVol : 0;
    this.sfxLP.connect(this.sfxBus);
    this.sfxBus.connect(this.master);

    // 手势内立即解锁；后续任何交互再尝试（防御性）
    if (ctx.state === "suspended") ctx.resume();
    const resume = () => { if (ctx.state === "suspended") ctx.resume(); };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);

    this._setupMusic();
    this._loadSfx(); // 异步；未就绪时 play() 静默跳过

    return ctx;
  }

  async _decode(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const ab = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(ab);
    } catch (e) {
      console.warn("[audio] decode failed:", url, e);
      return null;
    }
  }

  async _loadSfx() {
    for (const [name, count] of Object.entries(SFX_COUNT)) {
      const bufs = [];
      for (let i = 0; i < count; i++) {
        const buf = await this._decode(`${BASE}/sfx/${name}_${i}.ogg`);
        if (buf) bufs.push(buf);
      }
      if (bufs.length) this._buffers[name] = bufs;
    }
  }

  _setupMusic() {
    // BGM 已移除（用户最终决定只保留音效）。不再创建 <audio>、不加载
    // theme.ogg、不播放任何背景音乐。保留本方法与 musicBus，将来要恢复时
    // 在这里改回即可。_applyMusic() 会因 _musicEl 为 null 而静默跳过。
    this._musicEl = null;
  }

  /** 用户手势后：确保上下文运行并开始放音乐。 */
  begin() {
    this.ensure();
    if (this.ctx.state === "suspended") this.ctx.resume();
    this._applyMusic();
    this._applySfx();
  }

  /** 每帧：水下滤波（低频传导、高频被水吸收）。 */
  update(dt, _night, headUnderwater) {
    if (!this.ctx) return;
    this._underwater += ((headUnderwater ? 1 : 0) - this._underwater) * Math.min(1, dt * 8);
    this.sfxLP.frequency.setTargetAtTime(20000 - this._underwater * 19000, this.ctx.currentTime, 0.3);
    this.sfxLP.Q.value = 0.4 + this._underwater * 0.7;
  }

  /* ---------------- 设置 ---------------- */
  setMusicOn(on) { this.settings.musicOn = on; this._applyMusic(); this._save(); }
  setMusicVol(v) { this.settings.musicVol = v; this._applyMusic(); this._save(); }
  setSfxOn(on) { this.settings.sfxOn = on; this._applySfx(); this._save(); }
  setSfxVol(v) { this.settings.sfxVol = v; this._applySfx(); this._save(); }

  _applyMusic() {
    const el = this._musicEl;
    if (!el) return;
    if (this.settings.musicOn) {
      this.musicBus.gain.setTargetAtTime(this.settings.musicVol, this.ctx.currentTime, 0.1);
      el.play().catch(() => { /* 自动播放受限时静默重试 */ });
    } else {
      this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      el.pause();
    }
  }
  _applySfx() {
    if (!this.sfxBus) return;
    const v = this.settings.sfxOn ? this.settings.sfxVol : 0;
    this.sfxBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /* ---------------- 播放 ---------------- */
  play(name, opts = {}) {
    if (!this.ctx || !this.settings.sfxOn) return;
    const list = this._buffers[name];
    if (!list || !list.length) return;
    const buf = list[(Math.random() * list.length) | 0];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const rate = opts.rate ?? (0.92 + Math.random() * 0.16);
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    src.connect(g);
    g.connect(this.sfxLP);
    src.start();
  }

  /* ---------------- 便捷接口 ---------------- */
  breakBlock(name) { this.play("break_" + materialOf(name), { volume: 0.9 }); }
  placeBlock(name) { this.play("place", { volume: 0.8 }); }
  footstep(surface, running) {
    if (surface === "water") { this.play("splash", { volume: 0.3, rate: 0.9 }); return; }
    const m = materialOf(surface);
    const key = m === "plant" ? "step_grass" : (m === "wood" ? "step_wood" : "step_stone");
    this.play(key, { volume: running ? 0.75 : 0.5 });
  }
  jump() { this.play("jump", { volume: 0.4 }); }
  land(fall) {
    const heavy = fall > 8;
    this.play(heavy ? "land_heavy" : "land", { volume: Math.min(1, 0.45 + fall * 0.05) });
  }
  splash(kind) {
    if (kind === "enter") this.play("splash", { volume: 0.9 });
    else if (kind === "exit") this.play("splash", { volume: 0.55 });
    else if (kind === "dive") this.play("splash", { volume: 0.32, rate: 0.72 });
  }
  swimStroke() { this.play("splash", { volume: 0.22, rate: 0.85 + Math.random() * 0.2 }); }
  bubble() { this.play("splash", { volume: 0.14, rate: 1.25 + Math.random() * 0.2 }); }
  uiClick() { this.play("ui_click", { volume: 0.6, rate: 1 }); }
  uiHover() { this.play("ui_hover", { volume: 0.35, rate: 1 }); }
  uiSelect() { this.play("ui_select", { volume: 0.6, rate: 1 }); }
  blocked() { this.play("ui_error", { volume: 0.6, rate: 1 }); }
}
