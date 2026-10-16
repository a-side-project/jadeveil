/**
 * HUD —— 全英文界面，文字一律由位图像素字体绘制。
 */
import { HOTBAR, BLOCKS, ID, blockDef } from "../world/blocks.js";
import { CAMERA_LABELS } from "../player/controller.js";
import { Minimap } from "./minimap.js";
import { setPixelText, attachPixelText, renderText } from "./pixelfont.js";

export const BRAND = "JADEVEIL";
export const TAGLINE = "A VOXEL REALM OF MIST AND JADE";

const C = {
  gold: "#ffe08a",
  goldDeep: "#a8731f",
  bone: "#f2e6cf",
  jade: "#6fc0ae",
  dim: "#8b93a0",
};

/** 快捷方式：把元素内容设为像素文本 */
const say = (id, text, opts = {}) => setPixelText(document.getElementById(id), text, { color: C.bone, scale: 2, ...opts });

export class HUD {
  constructor(atlas, player, daynight, interaction, world) {
    this.atlas = atlas;
    this.player = player;
    this.daynight = daynight;
    this.interaction = interaction;
    this.world = world;

    this.el = {
      hud: document.getElementById("hud"),
      overlay: document.getElementById("overlay"),
      pause: document.getElementById("pause"),
      crosshair: document.getElementById("crosshair"),
      settings: document.getElementById("settings"),
      hotbar: document.getElementById("hotbar"),
      itemname: document.getElementById("itemname"),
      minimap: document.getElementById("minimap"),
      chunkprog: document.getElementById("chunkprog"),
      loading: document.getElementById("loading"),
      loadbar: document.getElementById("loadbar"),
      slider: document.getElementById("timeslider"),
    };

    this.slotIndex = 0;
    this.hidden = false;
    this._nameTimer = 0;
    this.audio = null; // 由 main.js 注入，用于 UI 音效
    this.speeds = [1, 4, 12, 40];
    this.speedIndex = 0;

    this._buildStaticLabels();
    this._buildHotbar();
    this._bindTime();
    this._bindKeys();
    this._bindSettings();
    this.selectSlot(0, true);

    const mmCanvas = document.getElementById("minimap-canvas");
    this.minimap = world ? new Minimap(world, player, mmCanvas) : null;
  }

  /* ---------------- 静态标签 ---------------- */
  _buildStaticLabels() {
    // 统计面板
    say("t-brand", BRAND, { color: C.gold, scale: 2 });
    say("k-fps", "FPS", { color: C.dim, scale: 1 });
    say("k-pos", "POS", { color: C.dim, scale: 1 });
    say("k-view", "VIEW", { color: C.dim, scale: 1 });
    say("k-chunk", "CHUNKS", { color: C.dim, scale: 1 });
    this.dyn = {
      fps: attachPixelText(document.getElementById("s-fps"), { color: C.gold, scale: 1, initial: "--" }),
      pos: attachPixelText(document.getElementById("s-pos"), { color: C.gold, scale: 1, initial: "--" }),
      mode: attachPixelText(document.getElementById("s-mode"), { color: C.gold, scale: 1, initial: "FIRST PERSON" }),
      chunk: attachPixelText(document.getElementById("s-chunk"), { color: C.gold, scale: 1, initial: "--" }),
      clock: attachPixelText(document.getElementById("t-clock"), { color: C.gold, scale: 2, initial: "06:00" }),
      sens: attachPixelText(document.getElementById("v-sens"), { color: C.gold, scale: 1, initial: "1.0" }),
      fov: attachPixelText(document.getElementById("v-fov"), { color: C.gold, scale: 1, initial: "72" }),
      musicvol: attachPixelText(document.getElementById("v-musicvol"), { color: C.gold, scale: 1, initial: "80%" }),
      sfxvol: attachPixelText(document.getElementById("v-sfxvol"), { color: C.gold, scale: 1, initial: "100%" }),
      chunkprog: attachPixelText(document.getElementById("chunkprog"), { color: C.jade, scale: 1, initial: "" }),
      itemname: attachPixelText(document.getElementById("itemname"), { color: C.gold, scale: 2, initial: "" }),
      loadmsg: attachPixelText(document.getElementById("loadmsg"), { color: C.jade, scale: 1, initial: "PREPARING..." }),
    };

    // 时间面板
    say("t-time", "TIME OF DAY", { color: C.gold, scale: 2 });
    say("b-dawn", "DAWN", { scale: 1 });
    say("b-noon", "NOON", { scale: 1 });
    say("b-dusk", "DUSK", { scale: 1 });
    say("b-night", "NIGHT", { scale: 1 });
    this.btnCycle = document.getElementById("btn-cycle");
    this.btnSpeed = document.getElementById("btn-speed");
    this._refreshTimeButtons();

    // 设置面板
    say("t-settings", "SETTINGS", { color: C.gold, scale: 2 });
    say("l-quality", "QUALITY", { scale: 1 });
    say("q-low", "LOW", { scale: 1 });
    say("q-medium", "MED", { scale: 1 });
    say("q-high", "HIGH", { scale: 1 });
    say("q-ultra", "ULTRA", { scale: 1 });
    say("l-sens", "SENSITIVITY", { scale: 1 });
    say("l-fov", "FIELD OF VIEW", { scale: 1 });
    say("l-bob", "HEAD BOB", { scale: 1 });
    say("l-shadow", "SHADOWS", { scale: 1 });
    say("l-bloom", "BLOOM", { scale: 1 });
    say("l-audio", "AUDIO", { color: C.gold, scale: 1 });
    say("l-musicvol", "MUSIC VOLUME", { scale: 1 });
    say("l-sfxvol", "SFX VOLUME", { scale: 1 });
    say("l-music", "MUSIC (REMOVED)", { scale: 1 });
    say("l-sfx", "SOUND FX", { scale: 1 });
    document.querySelector('#settings .tiers button[data-q="high"]')?.classList.add("on");

    // 小地图
    say("t-map", "MAP", { color: C.gold, scale: 1 });

    // 操作提示
    say("h-move-l", "MOVE", { color: C.gold, scale: 1 });
    say("h-move-v", "WASD  SPACE  SHIFT", { scale: 1 });
    say("h-view-l", "VIEW", { color: C.gold, scale: 1 });
    say("h-view-v", "MOUSE   V   F", { scale: 1 });
    say("h-build-l", "BUILD", { color: C.gold, scale: 1 });
    say("h-build-v", "LMB BREAK  RMB PLACE  1-9", { scale: 1 });
    say("h-world-l", "WORLD", { color: C.gold, scale: 1 });
    say("h-world-v", "T TIME  B BOB  O SET  M MAP  H HIDE", { scale: 1 });
    say("h-esc", "ESC - RELEASE MOUSE", { color: C.jade, scale: 1 });

    // 开场页
    setPixelText(document.getElementById("o-title"), BRAND, { color: C.gold, outline: C.goldDeep, shadow: "#000", scale: 6, tracking: 2, center: true });
    setPixelText(document.getElementById("o-sub"), TAGLINE, { color: C.jade, scale: 2, tracking: 1, center: true });
    setPixelText(document.getElementById("o-k1"), "WASD MOVE   SPACE JUMP   SHIFT SPRINT", { scale: 2, center: true });
    setPixelText(document.getElementById("o-k2"), "LMB BREAK BLOCK   RMB PLACE BLOCK", { scale: 2, center: true });
    setPixelText(document.getElementById("o-k3"), "F FLY   V CAMERA   T TIME OF DAY", { scale: 2, center: true });
    setPixelText(document.getElementById("o-cta"), "CLICK TO ENTER", { color: C.gold, outline: C.goldDeep, scale: 3, tracking: 1, center: true });
    setPixelText(document.getElementById("o-credit"), "CRIMSON WALLS - GILDED ROOFS - LANTERN STREETS", { color: C.dim, scale: 1, center: true });

    // 暂停页
    setPixelText(document.getElementById("p-title"), "PAUSED", { color: C.gold, outline: C.goldDeep, shadow: "#000", scale: 5, tracking: 2, center: true });
    setPixelText(document.getElementById("p-sub"), BRAND, { color: C.jade, scale: 2, center: true });
    setPixelText(document.getElementById("p-k1"), "WASD MOVE   SPACE JUMP   SHIFT SPRINT", { scale: 2, center: true });
    setPixelText(document.getElementById("p-k2"), "LMB BREAK   RMB PLACE   1-9 SELECT", { scale: 2, center: true });
    setPixelText(document.getElementById("p-k3"), "F FLY   V CAMERA   O SETTINGS   M MAP", { scale: 2, center: true });
    setPixelText(document.getElementById("p-cta"), "CLICK TO RESUME", { color: C.gold, scale: 3, center: true });

    // 加载页
    setPixelText(document.getElementById("load-glyph"), BRAND, { color: C.gold, outline: C.goldDeep, shadow: "#000", scale: 4, tracking: 2, center: true });
  }

  _refreshTimeButtons() {
    const playing = this.daynight.playing;
    setPixelText(this.btnCycle, playing ? "CYCLE ON" : "CYCLE OFF", { color: playing ? C.gold : C.dim, scale: 1 });
    this.btnCycle.classList.toggle("on", playing);
    setPixelText(this.btnSpeed, `SPEED x${this.speeds[this.speedIndex]}`, { color: C.bone, scale: 1 });
  }

  /* ---------------- 快捷栏 ---------------- */
  _buildHotbar() {
    const bar = this.el.hotbar;
    bar.innerHTML = "";
    this.slots = [];
    HOTBAR.forEach((name, i) => {
      const id = ID[name];
      const slot = document.createElement("div");
      slot.className = "slot";

      const canvas = this.atlas.tileCanvas(BLOCKS[id].faces[2], 64);
      canvas.className = "icon";
      slot.appendChild(canvas);

      const num = document.createElement("span");
      num.className = "num";
      setPixelText(num, String(i + 1), { color: C.gold, scale: 1 });
      slot.appendChild(num);

      slot.addEventListener("click", () => this.selectSlot(i));
      bar.appendChild(slot);
      this.slots.push(slot);
    });
  }

  selectSlot(i, silent = false) {
    this.slotIndex = ((i % HOTBAR.length) + HOTBAR.length) % HOTBAR.length;
    this.slots.forEach((s, k) => s.classList.toggle("active", k === this.slotIndex));
    const id = ID[HOTBAR[this.slotIndex]];
    this.interaction.selected = id;
    if (!silent) {
      this.showItemName(blockDef(id).label);
      this.audio?.uiSelect();
    }
  }

  showItemName(text) {
    this.dyn.itemname.set(text);
    const el = this.el.itemname;
    el.classList.add("show");
    this._nameTimer = 1.6;
  }

  /* ---------------- 时间控制 ---------------- */
  _bindTime() {
    const dn = this.daynight;
    this.el.slider.addEventListener("input", () => {
      dn.time = Number(this.el.slider.value);
      dn.playing = false;
      this._refreshTimeButtons();
    });
    document.querySelectorAll("#timepanel [data-time]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dn.time = Number(btn.dataset.time);
        this.el.slider.value = String(dn.time);
        this.audio?.uiClick();
      });
    });
    this.btnCycle.addEventListener("click", () => {
      dn.playing = !dn.playing;
      this._refreshTimeButtons();
      this.audio?.uiClick();
    });
    this.btnSpeed.addEventListener("click", () => {
      this.speedIndex = (this.speedIndex + 1) % this.speeds.length;
      dn.speed = this.speeds[this.speedIndex];
      this._refreshTimeButtons();
      this.audio?.uiClick();
    });
  }

  /* ---------------- 设置 ---------------- */
  _bindSettings() {
    const player = this.player;
    document.querySelectorAll("#settings .tiers button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#settings .tiers button").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        if (this.onQuality) this.onQuality(btn.dataset.q);
        this.showItemName(`QUALITY ${btn.dataset.q.toUpperCase()}`);
        this.audio?.uiClick();
      });
    });
    const sens = document.getElementById("r-sens");
    sens.addEventListener("input", () => {
      const v = Number(sens.value);
      player.sensitivity = 0.0022 * v;
      this.dyn.sens.set(v.toFixed(1));
    });
    const fov = document.getElementById("r-fov");
    fov.addEventListener("input", () => {
      const v = Number(fov.value);
      player.baseFov = v;
      this.dyn.fov.set(String(v));
    });
    const toggle = (id, fn) => {
      const node = document.getElementById(id);
      node.addEventListener("click", () => {
        node.classList.toggle("on");
        fn(node.classList.contains("on"));
        this.audio?.uiClick();
      });
    };
    toggle("t-bob", (on) => { player.headBob = on; });
    toggle("t-shadow", (on) => { if (this.onShadow) this.onShadow(on); });
    toggle("t-bloom", (on) => { if (this.onBloom) this.onBloom(on); });

    // 音频：音乐 / 音效各自开关与音量
    document.getElementById("r-musicvol").addEventListener("input", (e) => {
      this.audio?.setMusicVol(Number(e.target.value));
      this._updateAudioReadout();
    });
    document.getElementById("r-sfxvol").addEventListener("input", (e) => {
      this.audio?.setSfxVol(Number(e.target.value));
      this._updateAudioReadout();
    });
    toggle("t-music", (on) => { this.audio?.setMusicOn(on); this._updateAudioReadout(); });
    toggle("t-sfx", (on) => { this.audio?.setSfxOn(on); this._updateAudioReadout(); });
  }

  _updateAudioReadout() {
    const a = this.audio;
    if (!a) return;
    const s = a.settings;
    // BGM 已移除：音乐读数恒为 OFF，不再显示音量百分比
    this.dyn.musicvol?.set("OFF");
    this.dyn.sfxvol?.set(s.sfxOn ? Math.round(s.sfxVol * 100) + "%" : "OFF");
  }

  /** 把界面同步到（可能持久化的）音频设置。 */
  syncAudioSettings() {
    const a = this.audio;
    if (!a) return;
    const s = a.settings;
    const mv = document.getElementById("r-musicvol");
    const sv = document.getElementById("r-sfxvol");
    if (mv) mv.value = String(s.musicVol);
    if (sv) sv.value = String(s.sfxVol);
    document.getElementById("t-music")?.classList.toggle("on", s.musicOn);
    document.getElementById("t-sfx")?.classList.toggle("on", s.sfxOn);
    this._updateAudioReadout();
  }

  toggleSettings() {
    this.el.settings.classList.toggle("open");
  }

  setPaused(paused) {
    this.el.pause.classList.toggle("open", paused);
    if (paused) this.el.overlay.classList.add("hidden");
  }

  /* ---------------- 键盘 ---------------- */
  _bindKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.code.startsWith("Digit")) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= HOTBAR.length) this.selectSlot(n - 1);
      }
      if (e.code === "KeyH") {
        this.hidden = !this.hidden;
        this.el.hud.style.display = this.hidden ? "none" : "";
      }
      if (e.code === "KeyO") this.toggleSettings();
      if (e.code === "KeyM" && this.minimap) {
        this.minimap.visible = !this.minimap.visible;
        this.el.minimap.style.display = this.minimap.visible ? "" : "none";
        if (this.minimap.visible) this.minimap.update(true);
      }
    });
    window.addEventListener("wheel", (e) => {
      if (!this.player.locked) return;
      this.selectSlot(this.slotIndex + (e.deltaY > 0 ? 1 : -1));
    }, { passive: true });
  }

  /* ---------------- 每帧刷新 ---------------- */
  update(dt, stats) {
    if (this._nameTimer > 0) {
      this._nameTimer -= dt;
      if (this._nameTimer <= 0) this.el.itemname.classList.remove("show");
    }
    this.dyn.fps.set(String(stats.fps));
    const p = this.player.position;
    this.dyn.pos.set(`${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`);
    this.dyn.mode.set(
      CAMERA_LABELS[this.player.mode].toUpperCase() + (this.player.flying ? " / FLY" : ""),
    );
    this.dyn.chunk.set(`${stats.chunks} / ${Math.round(stats.tris / 1000)}K`);
    this.dyn.clock.set(this.daynight.clockText);
    if (this.daynight.playing) this.el.slider.value = String(Math.floor(this.daynight.time));
    if (this.minimap && (this._mmTick = (this._mmTick || 0) + 1) % 10 === 0) this.minimap.update();
  }

  setChunkProgress(pending) {
    const el = this.el.chunkprog;
    if (pending > 0) {
      this.dyn.chunkprog.set(`BUILDING CHUNKS  ${pending}`);
      el.classList.add("show");
    } else {
      el.classList.remove("show");
    }
  }

  setLocked(locked) {
    this.el.overlay.classList.toggle("hidden", locked);
    this.el.crosshair.classList.toggle("hidden", !locked || this.player.mode === "orbit");
  }

  setLoading(pct, msg) {
    this.el.loadbar.style.width = `${Math.round(pct * 100)}%`;
    if (msg) this.dyn.loadmsg.set(msg);
  }

  hideLoading() {
    this.el.loading.classList.add("hidden");
  }
}
