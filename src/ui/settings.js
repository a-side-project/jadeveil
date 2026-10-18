/**
 * 设置窗口 —— 居中的模态窗口，三个分页：画面 / 操作 / 声音。
 *
 * 只负责界面；画质落到渲染器由 main.js 注入的 onGraphics 完成。
 * 打开 / 关闭时指针的释放与重新锁定也由 main.js 的状态机处理（见 openSettings / closeSettings）。
 *
 *   画面  QUALITY  AUTO / LOW / MED / HIGH / ULTRA，单项开关（阴影 / 泛光 / 体积光 / 水面反射），视野
 *   操作  视角灵敏度、镜头晃动；键鼠或触屏的操作说明
 *   声音  音效音量与开关
 */
import { setPixelText, attachPixelText } from "./pixelfont.js";
import { PRESETS, TOGGLES } from "../core/quality.js";

const C = { gold: "#ffe08a", goldDeep: "#a8731f", bone: "#f2e6cf", jade: "#6fc0ae", dim: "#8b93a0" };
const CONTROLS_STORE = "jadeveil.controls.v1";
const CONTROL_DEFAULTS = { sens: 1, bob: true, crouch: "hold", sprint: "hold" };
const C_RED = "#ff7a6a";

const TIER_LABEL = { auto: "AUTO", low: "LOW", medium: "MED", high: "HIGH", ultra: "ULTRA" };
const TOGGLE_LABEL = { shadows: "SHADOWS", bloom: "BLOOM GLOW", godrays: "GOD RAYS", reflections: "WATER REFLECTIONS" };

// 第三列：操作方式 —— HOLD 按住才生效、PRESS 按一下、CLICK 鼠标点击；
// "sprint" / "crouch" 跟随玩家在上面选的模式显示 HOLD 或 TOGGLE
const KEYS = [
  ["WASD", "MOVE", "HOLD"],
  ["SPACE", "JUMP  -  HOLD TO SWIM / FLY UP", "PRESS"],
  ["SHIFT", "SPRINT", "sprint"],
  ["C", "CROUCH  -  DESCEND WHEN FLYING", "crouch"],
  ["LMB", "ATTACK / BREAK BLOCK", "CLICK"],
  ["RMB", "PLACE BLOCK / TORCH", "CLICK"],
  ["1-9 / WHEEL", "SELECT ITEM", "PRESS"],
  ["E", "INVENTORY", "PRESS"],
  ["F", "SUMMON / DISMISS DRAGON", "PRESS"],
  ["1 MOUNTED", "DRAGON BREATH", "HOLD"],
  ["2-4 MOUNTED", "FIREBALL / DASH / ROAR", "PRESS"],
  ["V", "CAMERA VIEW", "PRESS"],
  ["O", "SETTINGS", "PRESS"],
  ["T", "TIME SPEED", "PRESS"],
  ["ESC", "PAUSE", "PRESS"],
];
const TOUCH = [
  ["LEFT THUMB", "MOVE  -  PUSH TO EDGE TO SPRINT", "HOLD"],
  ["RIGHT DRAG", "LOOK AROUND", "HOLD"],
  ["TAP SCREEN", "ATTACK / BREAK BLOCK", "TAP"],
  ["JUMP", "JUMP  -  HOLD TO SWIM / FLY UP", "HOLD"],
  ["DOWN", "DESCEND WHEN FLYING / SWIMMING", "HOLD"],
  ["CROUCH", "CROUCH ON / OFF", "TOGGLE"],
  ["PLACE", "PLACE BLOCK / TORCH", "TAP"],
  ["HOTBAR", "SELECT ITEM", "TAP"],
  ["DRAGON", "SUMMON / DISMISS DRAGON", "TAP"],
  ["BREATH SKILL", "DRAGON BREATH", "HOLD"],
  ["OTHER SKILLS", "FIREBALL / DASH / ROAR", "TAP"],
];

/**
 * GPU 名称精简：「ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)」→「APPLE M3 MAX」，
 * 「ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)」→「NVIDIA GEFORCE RTX 4070」。
 */
export function prettyGpu(raw) {
  let g = String(raw || "UNKNOWN GPU");
  const m = g.match(/^ANGLE \((?:[^,]*),\s*([^,]+)/i);
  if (m) g = m[1];
  g = g.replace(/ANGLE \w+ Renderer:\s*/i, "")
    .replace(/\s*(Direct3D\S*|vs_\S+|ps_\S+|OpenGL.*|\(0x[0-9a-f]+\)|Unspecified Version)/gi, "")
    .trim();
  return g.toUpperCase().replace(/[^A-Z0-9 .,()\-+/]/g, "").slice(0, 48) || "UNKNOWN GPU";
}

export class SettingsUI {
  /**
   * @param {object} o { graphics: GraphicsSettings, player, audio, fullscreen, touch: boolean,
   *                     onGraphics(profile), onClose(), click() }
   */
  constructor(o) {
    Object.assign(this, o);
    this.isOpen = false;
    this.page = "graphics";
    this._loadControls();
    this._css();
    this._build();
    this.sync();
  }

  _loadControls() {
    this.controls = { ...CONTROL_DEFAULTS };
    try {
      const s = JSON.parse(localStorage.getItem(CONTROLS_STORE));
      if (s && Number.isFinite(s.sens)) this.controls.sens = Math.max(0.3, Math.min(3, s.sens));
      if (s && typeof s.bob === "boolean") this.controls.bob = s.bob;
      if (s && (s.crouch === "hold" || s.crouch === "toggle")) this.controls.crouch = s.crouch;
      if (s && (s.sprint === "hold" || s.sprint === "toggle")) this.controls.sprint = s.sprint;
    } catch { /* 无存储 */ }
    this._applyControls();
  }

  _saveControls() {
    try { localStorage.setItem(CONTROLS_STORE, JSON.stringify(this.controls)); } catch { /* 无存储 */ }
  }

  _applyControls() {
    const p = this.player;
    p.sensitivity = 0.0022 * this.controls.sens;
    p.headBob = this.controls.bob;
    p.baseFov = this.graphics.fov;
    // 触屏的蹲下固定为切换：右手拇指要一直负责转视角，按住按钮就没法看
    p.crouchMode = this.touch ? "toggle" : this.controls.crouch;
    p.sprintMode = this.controls.sprint;
    if (p.crouchMode === "hold") p.crouchToggled = false;
    if (p.sprintMode === "hold") p.sprintToggled = false;
  }

  _css() {
    const s = document.createElement("style");
    s.textContent = `
      #settings { position: fixed; inset: 0; z-index: 50; display: none; align-items: center; justify-content: center;
        background: rgba(5, 7, 10, 0.55); pointer-events: auto; }
      #settings.open { display: flex; }
      #settings .win { width: 680px; max-width: calc((100vw - 24px) / var(--ui, 1)); position: relative; }
      #settings .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      #settings .head .btnrow { margin: 0; width: 44px; }
      #settings .tabs { display: flex; gap: 4px; margin: 0 0 14px; }
      #settings .tabs button { flex: 1; padding: 9px 4px !important; }
      #settings .page { display: none; min-height: 300px; }
      #settings .page.on { display: block; }
      #settings .row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 36px; margin-bottom: 6px; }
      #settings .row .ctl { display: flex; align-items: center; gap: 10px; }
      #settings .tiers { display: flex; gap: 4px; }
      #settings .tiers button { min-width: 76px; padding: 8px 6px !important; }
      #settings input[type=range] { width: 230px; }
      #settings .toggle { display: flex; align-items: center; justify-content: space-between; min-height: 32px; margin-bottom: 4px; }
      #settings .toggle .sw { width: 34px; height: 16px; position: relative; flex: none; }
      #settings .toggle .sw::after { content: ""; position: absolute; transition: none; }
      #settings .info { margin: 2px 0 14px; display: flex; flex-direction: column; gap: 6px; }
      #settings .sep { height: 2px; background: rgba(232, 180, 74, 0.25); margin: 10px 0 12px; }
      #settings .keys { display: grid; grid-template-columns: auto auto 1fr; gap: 9px 18px; margin-top: 4px; align-items: center; }
      #settings .foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 12px; }
      #settings .foot .btnrow { width: 160px; margin: 0; }
      #settings .foot .btnrow.reset { width: 300px; }
    `;
    document.head.appendChild(s);
  }

  _text(el, text, opts = {}) {
    setPixelText(el, text, { color: C.bone, scale: 1, ...opts });
    return el;
  }

  _button(parent, label, fn, opts = {}) {
    const b = document.createElement("button");
    b.setAttribute("aria-label", label);
    if (opts.id) b.id = opts.id;
    b._label = { text: label, scale: opts.scale ?? 1, color: opts.color ?? C.bone };
    this._paintButton(b, false);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      this.click?.();
      fn();
    });
    parent.appendChild(b);
    return b;
  }

  _build() {
    const root = document.createElement("div");
    root.id = "settings";
    root.innerHTML = `
      <div class="panel win" role="dialog" aria-label="SETTINGS">
        <div class="head"><div class="t"></div><div class="btnrow"></div></div>
        <div class="tabs btnrow"></div>
        <div class="page" data-page="graphics"></div>
        <div class="page" data-page="controls"></div>
        <div class="page" data-page="audio"></div>
        <div class="foot"><div class="btnrow reset"></div><div class="btnrow done"></div></div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    // 点窗口外的遮罩 = 关闭
    root.addEventListener("click", (e) => { if (e.target === root) this.close(); });

    this._text(root.querySelector(".head .t"), "SETTINGS", { color: C.gold, outline: C.goldDeep, scale: 3 });
    this._button(root.querySelector(".head .btnrow"), "X", () => this.close(), { id: "set-close", scale: 2, color: C.gold });
    this._button(root.querySelector(".foot .done"), "DONE", () => this.close(), { id: "set-done", scale: 2, color: C.gold });
    // 还原默认：点两次才生效（第一次变红提示，与「新游戏覆盖存档」的确认方式一致）
    this.resetBtn = this._button(root.querySelector(".foot .reset"), "RESTORE DEFAULTS", () => this._resetClick(), { id: "set-reset", scale: 2 });

    const tabs = root.querySelector(".tabs");
    this.tabBtns = {};
    for (const [id, label] of [["graphics", "GRAPHICS"], ["controls", "CONTROLS"], ["audio", "AUDIO"]]) {
      this.tabBtns[id] = this._button(tabs, label, () => this.setPage(id), { id: `set-tab-${id}`, scale: 2 });
    }
    this.pages = {};
    root.querySelectorAll(".page").forEach((p) => { this.pages[p.dataset.page] = p; });

    this._buildGraphics(this.pages.graphics);
    this._buildControls(this.pages.controls);
    this._buildAudio(this.pages.audio);
    this.setPage("graphics");
  }

  /** 选中的按钮底色是亮金，文字改成深墨色 + 亮边，否则读不清。 */
  _paintButton(b, on) {
    const l = b._label;
    this._text(b, l.text, on
      ? { scale: l.scale, center: true, color: "#1a1208", outline: "#ffe08a" }
      : { scale: l.scale, center: true, color: l.color });
  }

  _setOn(b, on) {
    if (b.classList.contains("on") === on && b._painted) return;
    b._painted = true;
    b.classList.toggle("on", on);
    this._paintButton(b, on);
  }

  _row(parent, label) {
    const row = document.createElement("div");
    row.className = "row";
    const l = document.createElement("div");
    this._text(l, label, { scale: 2 });
    const ctl = document.createElement("div");
    ctl.className = "ctl";
    row.append(l, ctl);
    parent.appendChild(row);
    return ctl;
  }

  _slider(parent, label, { min, max, step, value, fmt, onInput, id }) {
    const ctl = this._row(parent, label);
    const r = document.createElement("input");
    r.type = "range";
    Object.assign(r, { min, max, step, value });
    if (id) r.id = id;
    r.setAttribute("aria-label", label);
    const v = document.createElement("span");
    const readout = attachPixelText(v, { color: C.gold, scale: 2, initial: fmt(Number(value)) });
    r.addEventListener("input", () => {
      const n = Number(r.value);
      readout.set(fmt(n));
      onInput(n);
    });
    ctl.append(r, v);
    return { input: r, readout, fmt };
  }

  _toggle(parent, label, on, fn, id) {
    const node = document.createElement("div");
    node.className = "toggle" + (on ? " on" : "");
    if (id) node.id = id;
    node.setAttribute("role", "switch");
    node.setAttribute("aria-label", label);
    const l = document.createElement("span");
    this._text(l, label, { scale: 2 });
    const sw = document.createElement("span");
    sw.className = "sw";
    node.append(l, sw);
    node.addEventListener("click", (e) => {
      e.stopPropagation();
      node.classList.toggle("on");
      this.click?.();
      fn(node.classList.contains("on"));
    });
    parent.appendChild(node);
    return node;
  }

  /* ---------------- 画面 ---------------- */
  _buildGraphics(page) {
    const ctl = this._row(page, "QUALITY");
    const tiers = document.createElement("div");
    tiers.className = "tiers";
    ctl.appendChild(tiers);
    this.tierBtns = {};
    for (const mode of ["auto", "low", "medium", "high", "ultra"]) {
      this.tierBtns[mode] = this._button(tiers, TIER_LABEL[mode], () => {
        this.graphics.setMode(mode);
        this.onGraphics?.(this.graphics.profile);
        this.sync();
      }, { id: `q-${mode}`, scale: 2 });
    }
    const info = document.createElement("div");
    info.className = "info";
    const l1 = document.createElement("div");
    const l2 = document.createElement("div");
    info.append(l1, l2);
    page.appendChild(info);
    this.infoTier = attachPixelText(l1, { color: C.jade, scale: 1, initial: "" });
    this.infoGpu = attachPixelText(l2, { color: C.dim, scale: 1, initial: "" });

    this.toggleEls = {};
    for (const k of TOGGLES) {
      this.toggleEls[k] = this._toggle(page, TOGGLE_LABEL[k], true, (on) => {
        this.graphics.setToggle(k, on);
        this.onGraphics?.(this.graphics.profile);
        this.sync();
      }, `t-${k}`);
    }
    const sep = document.createElement("div");
    sep.className = "sep";
    page.appendChild(sep);
    this.fov = this._slider(page, "FIELD OF VIEW", {
      min: 55, max: 100, step: 1, value: this.graphics.fov, id: "r-fov", fmt: (n) => String(n),
      onInput: (n) => { this.graphics.fov = n; this.player.baseFov = n; this.graphics.save(); },
    });
    if (this.fullscreen?.supported) {
      this.fsToggle = this._toggle(page, "START IN FULLSCREEN", this.fullscreen.auto, (on) => this.fullscreen.setAuto(on), "t-fullscreen");
    }
  }

  /** 两个选项的分段按钮（HOLD / TOGGLE）。 */
  _choice(parent, label, options, value, fn, id) {
    const ctl = this._row(parent, label);
    const box = document.createElement("div");
    box.className = "tiers";
    ctl.appendChild(box);
    const btns = {};
    for (const [v, text] of options) {
      btns[v] = this._button(box, text, () => {
        for (const [k, b] of Object.entries(btns)) this._setOn(b, k === v);
        fn(v);
      }, { id: `${id}-${v}`, scale: 2 });
    }
    for (const [k, b] of Object.entries(btns)) this._setOn(b, k === value);
    return btns;
  }

  _renderKeys() {
    const keys = this.keysEl;
    keys.innerHTML = "";
    for (const [k, v, kind] of this.touch ? TOUCH : KEYS) {
      const how = kind === "sprint" ? this.controls.sprint.toUpperCase() : kind === "crouch" ? this.controls.crouch.toUpperCase() : kind;
      const a = document.createElement("div");
      const b = document.createElement("div");
      const c = document.createElement("div");
      this._text(a, k, { color: C.gold, scale: 2 });
      // 第二列是操作方式：需要按住的用青色标出来，一眼能分清
      this._text(c, how, { color: how === "HOLD" ? C.jade : C.dim, scale: 2 });
      this._text(b, v, { scale: 2 });
      keys.append(a, c, b);
    }
  }

  /* ---------------- 操作 ---------------- */
  _buildControls(page) {
    this.sens = this._slider(page, "LOOK SENSITIVITY", {
      min: 0.3, max: 3, step: 0.1, value: this.controls.sens, id: "r-sens", fmt: (n) => n.toFixed(1),
      onInput: (n) => { this.controls.sens = n; this._applyControls(); this._saveControls(); },
    });
    this.bobEl = this._toggle(page, "HEAD BOB", this.controls.bob, (on) => {
      this.controls.bob = on;
      this._applyControls();
      this._saveControls();
    }, "t-bob");
    if (!this.touch) {
      const modes = [["hold", "HOLD"], ["toggle", "TOGGLE"]];
      this.crouchBtns = this._choice(page, "CROUCH", modes, this.controls.crouch, (v) => {
        this.controls.crouch = v; this._applyControls(); this._saveControls(); this._renderKeys();
      }, "c-crouch");
      this.sprintBtns = this._choice(page, "SPRINT", modes, this.controls.sprint, (v) => {
        this.controls.sprint = v; this._applyControls(); this._saveControls(); this._renderKeys();
      }, "c-sprint");
    }
    const sep = document.createElement("div");
    sep.className = "sep";
    page.appendChild(sep);
    this.keysEl = document.createElement("div");
    this.keysEl.className = "keys";
    page.appendChild(this.keysEl);
    this._renderKeys();
  }

  /* ---------------- 声音 ---------------- */
  _buildAudio(page) {
    const a = this.audio;
    const s = a.settings;
    this.sfxVol = this._slider(page, "SOUND FX VOLUME", {
      min: 0, max: 1, step: 0.05, value: s.sfxVol, id: "r-sfxvol", fmt: (n) => `${Math.round(n * 100)}%`,
      onInput: (n) => a.setSfxVol(n),
    });
    this.sfxEl = this._toggle(page, "SOUND FX", s.sfxOn, (on) => a.setSfxOn(on), "t-sfx");
  }

  /* ---------------- 还原默认 ---------------- */
  _resetClick() {
    if (!this._confirmReset) {
      this._confirmReset = true;
      this.resetBtn._label = { text: "CLICK AGAIN TO RESET", scale: 2, color: C_RED };
      this._paintButton(this.resetBtn, false);
      return;
    }
    this.restoreDefaults();
  }

  _clearResetConfirm() {
    if (!this._confirmReset) return;
    this._confirmReset = false;
    this.resetBtn._label = { text: "RESTORE DEFAULTS", scale: 2, color: C.bone };
    this._paintButton(this.resetBtn, false);
  }

  /** 画面、操作、声音全部回到出厂设置（存档不受影响）。 */
  restoreDefaults() {
    this._clearResetConfirm();
    // 画面
    this.graphics.fov = 72;
    this.graphics.setMode("auto");
    this.fullscreen?.setAuto(true);
    if (this.fsToggle) this.fsToggle.classList.toggle("on", !!this.fullscreen?.auto);
    this.onGraphics?.(this.graphics.profile);
    // 操作
    this.controls = { ...CONTROL_DEFAULTS };
    this._applyControls();
    this._saveControls();
    // 声音
    this.audio.setSfxVol(1);
    this.audio.setSfxOn(true);
    // 界面跟着刷新
    const setSlider = (sl, v) => { sl.input.value = String(v); sl.readout.set(sl.fmt(v)); };
    setSlider(this.fov, 72);
    setSlider(this.sens, 1);
    setSlider(this.sfxVol, 1);
    this.bobEl.classList.add("on");
    this.sfxEl.classList.add("on");
    for (const [btns, v] of [[this.crouchBtns, "hold"], [this.sprintBtns, "hold"]]) {
      if (btns) for (const [k, b] of Object.entries(btns)) this._setOn(b, k === v);
    }
    this._renderKeys();
    this.sync();
  }

  /* ---------------- 状态 ---------------- */
  setPage(id) {
    this.page = id;
    for (const [k, p] of Object.entries(this.pages)) p.classList.toggle("on", k === id);
    for (const [k, b] of Object.entries(this.tabBtns)) this._setOn(b, k === id);
  }

  /** 把界面同步到当前设置（换档后开关会回到该档位的默认值）。 */
  sync() {
    const g = this.graphics;
    for (const [mode, b] of Object.entries(this.tierBtns)) this._setOn(b, mode === g.mode);
    const p = g.profile;
    for (const k of TOGGLES) this.toggleEls[k].classList.toggle("on", !!p[k]);
    const auto = g.mode === "auto";
    this.infoTier.set(
      auto
        ? `AUTO PICKED ${TIER_LABEL[g.tier]}  -  LOWERS ITSELF IF THE GAME RUNS SLOW`
        : `${TIER_LABEL[g.tier]}  -  VIEW ${PRESETS[g.tier].viewDistance} CHUNKS  -  ${Math.min(window.devicePixelRatio || 1, PRESETS[g.tier].pixelRatio)}X RESOLUTION`,
    );
    this.infoGpu.set(prettyGpu(g.detected.gpu));
  }

  /** 打开时每秒刷新一次帧率读数，方便玩家边调边看。 */
  update(fps) {
    if (!this.isOpen) return;
    this._fpsT = (this._fpsT || 0) + 1;
    if (this._fpsT % 30 !== 0) return;
    this.infoGpu.set(`${fps} FPS  -  ${prettyGpu(this.graphics.detected.gpu)}`);
  }

  open(page) {
    if (page) this.setPage(page);
    this.sync();
    this.root.classList.add("open");
    this.isOpen = true;
  }

  close() {
    if (!this.isOpen) return;
    this._clearResetConfirm();
    this.root.classList.remove("open");
    this.isOpen = false;
    this.onClose?.();
  }
}
