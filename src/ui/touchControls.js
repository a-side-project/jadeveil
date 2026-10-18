/**
 * 触屏操作（手机 / 平板，横屏）—— 与键鼠共用同一套玩家逻辑，只是把输入换个来源。
 *
 *   左半屏   浮动摇杆：拇指落在哪里摇杆就出现在哪里；轻推慢走，推到边缘自动疾跑
 *   右半屏   拖动转视角；轻点 = 冒险模式出招（JADE SLASH）/ 建造模式挖方块
 *   右下     环形技能盘（主流动作手游的布局）：大号主按钮 + 一圈技能按钮，随情境切换
 *              冒险  主按钮 = 普攻（按住连续出招），环上 = 突刺 / 旋风斩 / 玉月斩 / 玉愈 / 闪避
 *              骑龙  主按钮 = 龙息（按住），环上 = 火球 / 冲刺 / 龙吼
 *              建造  主按钮 = 放置方块，快捷栏直接点选
 *            技能按钮显示冷却扫光与秒数；没学会的显示学习进度
 *            旁边：跳跃（按住 = 上浮 / 爬升）、蹲下（切换）/ 下降（飞行与游泳时，按住）
 *   左上     系统按钮（像素图标）：菜单 / 背包 / 模式 / 末影龙 / 视角
 *
 * 用 Pointer Events + setPointerCapture 跟踪每根手指，多指同时操作互不干扰；
 * 整层 touch-action: none，浏览器不会把手势当成滚动 / 缩放。
 */
import { setPixelText, renderText } from "./pixelfont.js";
import { pixelCanvas, DRAGON_ICONS, DRAGON_LEGEND, PLAYER_ICONS, JADE_LEGEND, UI_ICONS, UI_LEGEND } from "./skillIcons.js";
import { PLAYER_SKILLS } from "../game/skills.js";
import { DRAGON_SKILLS } from "../mount/dragon.js";

/** 是否进入触屏模式：主指针是手指（手机 / 平板）。?touch=1 / ?touch=0 可强制（验收用）。 */
export function detectTouch() {
  const q = new URLSearchParams(location.search).get("touch");
  if (q === "1") return true;
  if (q === "0") return false;
  return matchMedia("(pointer: coarse)").matches;
}

const STICK_R = 58; // 摇杆行程（CSS 像素）
const TAP_MS = 260; // 轻点判定：按下到抬起的最长时间
const TAP_MOVE = 14; // 轻点判定：允许的最大位移
const LOOK_GAIN = 2.4; // 触屏视角增益（相对鼠标灵敏度：手指一次滑动的距离远小于鼠标）

// 环形技能盘几何（以主按钮中心为原点，向左为负 x、向上为负 y）
const MAIN = 88;
const SLOT = 60;
const RING_GAP = 6; // 按钮之间、按钮与小地图 / 屏幕边缘之间至少留的缝
const ARC_FROM = 190; // 度：技能弧从主按钮左偏下开始，逆时针往右上走
const SIDE_X = -190; // 建造模式（没有技能弧）时跳跃键的位置
const JUMP = 72;

const C = { gold: "#ffe08a", bone: "#f2e6cf", jade: "#6fc0ae", purple: "#e08aff" };

export class TouchControls {
  /**
   * @param {object} o { player, interaction, mount, skills, getMode, onPause, onInventory, onMode, onMount, onCamera, click }
   */
  constructor(o) {
    Object.assign(this, o);
    this.active = false; // 只在游戏中接管屏幕
    this.stick = null;
    this.look = null;
    this.context = null; // "adventure" | "build" | "mount"
    this._held = new Set(); // 正在按住的主按钮动作
    this._css();
    this._build();
    this._bindZone();
  }

  _css() {
    const s = document.createElement("style");
    s.textContent = `
      #touch { position: fixed; inset: 0; z-index: 12; display: none; touch-action: none;
        -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
      #touch.on { display: block; }
      #touch .zone { position: absolute; inset: 0; }
      #touch .stick { position: absolute; width: ${STICK_R * 2 + 28}px; height: ${STICK_R * 2 + 28}px; margin: -${STICK_R + 14}px 0 0 -${STICK_R + 14}px;
        pointer-events: none; opacity: 0; transition: opacity 0.12s; }
      #touch .stick.show { opacity: 1; }
      #touch .stick .base { position: absolute; inset: 0; background: rgba(10, 14, 18, 0.38);
        border: 3px solid rgba(232, 180, 74, 0.55); box-shadow: inset 0 0 0 3px rgba(10, 14, 18, 0.5); }
      #touch .stick .knob { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px 0 0 -27px;
        background: rgba(232, 180, 74, 0.82); border: 3px solid #ffe08a; box-shadow: 3px 3px 0 rgba(0,0,0,0.5); }
      #touch .stick.sprint .knob { background: rgba(111, 192, 174, 0.9); border-color: #d6fff0; }

      /* 通用按钮：像素边框，按下时整体下沉一格 */
      #touch .tb { position: absolute; display: flex; align-items: center; justify-content: center;
        background: rgba(10, 14, 18, 0.62); border: 3px solid rgba(232, 180, 74, 0.75);
        box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.55); touch-action: none; }
      #touch .tb canvas { image-rendering: pixelated; pointer-events: none; }
      #touch .tb.down { background: rgba(232, 180, 74, 0.42); box-shadow: 1px 1px 0 rgba(0,0,0,0.55); }
      #touch .tb.hide { display: none; }
      #touch .tb.on { background: rgba(111, 192, 174, 0.5); border-color: #d6fff0; }

      /* 环形技能盘：容器是一个 0×0 的点，落在主按钮中心 */
      #touch .cluster { position: absolute; width: 0; height: 0;
        right: calc(26px + ${MAIN / 2}px + env(safe-area-inset-right));
        bottom: calc(22px + ${MAIN / 2}px + env(safe-area-inset-bottom)); }
      #touch .cluster .tb { transform: translate(-50%, -50%); }
      #touch .cluster .tb.down { transform: translate(calc(-50% + 2px), calc(-50% + 2px)); }
      #touch .main { width: ${MAIN}px; height: ${MAIN}px; border-width: 4px; border-color: #ffe08a; background: rgba(28, 22, 10, 0.7); }
      #touch .main.mount { border-color: #e08aff; background: rgba(30, 10, 40, 0.7); }
      #touch .main.adv { border-color: #9ff0d6; background: rgba(8, 30, 26, 0.7); }
      #touch .skill { width: ${SLOT}px; height: ${SLOT}px; overflow: hidden; }
      #touch .skill.mount { border-color: rgba(224, 138, 255, 0.85); }
      #touch .skill.adv { border-color: rgba(111, 192, 174, 0.9); }
      #touch .skill .sweep { position: absolute; inset: 0; pointer-events: none;
        background: conic-gradient(rgba(0,0,0,0.68) calc(var(--cd, 0) * 360deg), transparent 0); }
      #touch .skill .secs { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
      #touch .skill.locked canvas { filter: grayscale(1) brightness(0.4); }
      #touch .skill .prog { position: absolute; left: 0; right: 0; bottom: 3px; display: flex; justify-content: center; pointer-events: none; }
      #touch .skill.low canvas { filter: grayscale(0.8) brightness(0.55); }
      #touch .jump { width: ${JUMP}px; height: ${JUMP}px; }
      #touch .small { width: 54px; height: 54px; }

      /* 左上系统按钮 */
      #touch .top { position: absolute; left: calc(12px + env(safe-area-inset-left)); top: calc(10px + env(safe-area-inset-top)); display: flex; gap: 8px; }
      #touch .top .tb { position: relative; width: 46px; height: 46px; }
      #touch .top .b-dragon { border-color: rgba(224, 138, 255, 0.85); }
      #touch .top .b-mode { width: auto; padding: 0 10px 0 6px; gap: 6px; }

      /* 触屏下快捷栏要能点：HUD 层提到触屏层之上（HUD 本身不接收事件，只有快捷栏格子接收） */
      body.touch #hud { z-index: 13; }
      body.touch #rpg-hotbar { pointer-events: auto; touch-action: none; }
      body.touch #crosshair { opacity: 0.75; }
    `;
    document.head.appendChild(s);
  }

  /** 生成一个按钮：图标（可选）。 */
  _tb(parent, cls, icon, legend, scale, label) {
    const b = document.createElement("div");
    b.className = `tb ${cls}`;
    b.setAttribute("role", "button");
    b.setAttribute("aria-label", label);
    if (icon) b.appendChild(pixelCanvas(icon, legend, scale));
    parent.appendChild(b);
    return b;
  }

  _build() {
    const root = document.createElement("div");
    root.id = "touch";
    root.innerHTML = `<div class="zone"></div><div class="stick"><i class="base"></i><i class="knob"></i></div><div class="top"></div><div class="cluster"></div>`;
    document.body.appendChild(root);
    this.root = root;
    this.zone = root.querySelector(".zone");
    this.stickEl = root.querySelector(".stick");
    this.knobEl = root.querySelector(".knob");

    // ---- 左上：系统按钮 ----
    const top = root.querySelector(".top");
    this._tap(this._tb(top, "b-menu", UI_ICONS.menu, UI_LEGEND, 3, "MENU"), () => this.onPause?.());
    this._tap(this._tb(top, "b-bag", UI_ICONS.bag, UI_LEGEND, 3, "BAG"), () => this.onInventory?.());
    this.modeBtn = this._tb(top, "b-mode", null, null, 3, "MODE");
    this._tap(this.modeBtn, () => this.onMode?.());
    this.dragonBtn = this._tb(top, "b-dragon", UI_ICONS.dragon, UI_LEGEND, 3, "DRAGON");
    this._tap(this.dragonBtn, () => this.onMount?.());
    this._tap(this._tb(top, "b-view", UI_ICONS.view, UI_LEGEND, 3, "VIEW"), () => this.onCamera?.());

    // ---- 右下：环形技能盘 ----
    const cl = root.querySelector(".cluster");
    this.cluster = cl;
    this.mainBtn = this._tb(cl, "main", null, null, 5, "ACTION");
    this._place(this.mainBtn, 0, 0);
    this._hold(this.mainBtn, () => this._mainDown(), () => this._mainUp());

    // 跳跃 / 蹲下 / 下降在技能弧的外侧，位置随弧的半径变化（_placeSide）
    this.jumpBtn = this._tb(cl, "jump", UI_ICONS.jump, UI_LEGEND, 4, "JUMP");
    this._holdKey(this.jumpBtn, "Space");

    this.crouchBtn = this._tb(cl, "small", UI_ICONS.crouch, UI_LEGEND, 3, "CROUCH");
    this._tap(this.crouchBtn, () => this.player.toggleCrouch());
    this.downBtn = this._tb(cl, "small", UI_ICONS.down, UI_LEGEND, 3, "DOWN");
    this._holdKey(this.downBtn, "KeyC");
    this._placeSide(SIDE_X);

    // 技能按钮按情境重建（_setContext）
    this.slots = [];
  }

  _place(el, dx, dy) {
    el.style.left = `${dx}px`;
    el.style.top = `${dy}px`;
  }

  /**
   * 技能盘布局：沿主按钮左上方的椭圆弧从左下往右上走，每颗技能放在第一个满足全部约束的位置——
   *   · 不和已放的技能、主按钮重叠（按钮是方的：看横、纵两个方向上的最大距离，而不是圆心距 ——
   *     沿对角线排的两颗方块，圆心距够了，角还是压在一起）
   *   · 整颗在屏幕内、不压小地图
   * 放不下就把椭圆横向拉宽再试。按真实屏幕尺寸算：固定半径的正圆弧在 375 高的手机上，
   * 五颗技能要么互相压住、要么顶进小地图。屏幕尺寸变化时重算（update 里检测）。
   */
  _layoutRing() {
    const n = this.slots.length;
    const mr = this.mainBtn.getBoundingClientRect();
    if (!mr.width) return;
    this._layoutSize = `${window.innerWidth}x${window.innerHeight}`;
    if (!n) { this._placeSide(SIDE_X); return; }
    const cx = mr.left + mr.width / 2, cy = mr.top + mr.height / 2;
    const vw = window.innerWidth, vh = window.innerHeight;
    const mm = document.getElementById("minimap");
    const mmr = mm && mm.offsetParent ? mm.getBoundingClientRect() : null;
    const H = SLOT / 2, need = SLOT + RING_GAP, mainNeed = MAIN / 2 + RING_GAP + H;
    // 纵向半径：往上最多到小地图底下；大屏也不超过 150（拇指够得着）
    const ceil = (mmr ? mmr.bottom : 0) + RING_GAP + H;
    const Ry = Math.max(mainNeed, Math.min(150, cy - ceil));
    const fits = (x, y) => {
      const sx = cx + x, sy = cy + y;
      if (sx - H < 4 || sx + H > vw - 4 || sy - H < 4 || sy + H > vh - 4) return false;
      if (mmr && sx + H > mmr.left - RING_GAP && sx - H < mmr.right + RING_GAP && sy - H < mmr.bottom + RING_GAP) return false;
      return Math.max(Math.abs(x), Math.abs(y)) >= mainNeed;
    };
    let pos = [];
    for (let Rx = Ry * 1.2; Rx <= Ry * 2.6 && pos.length < n; Rx += 8) {
      pos = [];
      for (let a = ARC_FROM; a >= 20 && pos.length < n; a -= 0.5) {
        const r = (a * Math.PI) / 180;
        const x = Math.cos(r) * Rx, y = -Math.sin(r) * Ry;
        if (fits(x, y) && pos.every(([px, py]) => Math.max(Math.abs(x - px), Math.abs(y - py)) >= need)) pos.push([x, y]);
      }
    }
    // 极端小屏放不下：剩下的往最左那颗的左边排（不重叠，宁可远一点）
    while (pos.length < n) {
      const [lx, ly] = pos.reduce((m, p) => (p[0] < m[0] ? p : m), [0, 0]);
      pos.push([lx - need, ly]);
    }
    this.slots.forEach((sl, i) => this._place(sl.el, pos[i][0], pos[i][1]));
    this._placeSide(Math.min(...pos.map((p) => p[0])) - H - 14 - JUMP / 2);
  }

  /** 跳跃 / 蹲下 / 下降：放在技能弧外侧（x = 它们的中心）。 */
  _placeSide(sideX) {
    this._place(this.jumpBtn, sideX, 6);
    this._place(this.crouchBtn, sideX, -JUMP / 2 - 40);
    this._place(this.downBtn, sideX, -JUMP / 2 - 40);
  }

  /* ---------------- 按钮行为 ---------------- */

  /** 轻点按钮：按下即触发（不等抬起，手感更跟手）。 */
  _tap(el, fn) {
    this._hold(el, fn, null);
  }

  /** 按住按钮：按下 / 抬起各一个回调；被系统打断（来电、切后台）也算抬起。 */
  _hold(el, down, up) {
    let id = null;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (id !== null) return;
      id = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      el.classList.add("down");
      this.click?.();
      down?.();
    });
    const release = (e) => {
      if (id === null || (e && e.pointerId !== id)) return;
      id = null;
      el.classList.remove("down");
      up?.();
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
    el._release = () => { if (id !== null) { id = null; el.classList.remove("down"); up?.(); } };
  }

  /** 按住按钮映射成键盘按键（复用玩家控制器里跳跃 / 上浮 / 下降的全部逻辑）。 */
  _holdKey(el, code) {
    this._hold(el, () => this.player.keys.add(code), () => this.player.keys.delete(code));
  }

  _mainDown() {
    const c = this.context;
    if (c === "mount") this.mount.setBreath(true);
    else if (c === "adventure") { this._held.add("slash"); this.skills.use("slash"); }
    else if (c === "build" && this.interaction.enabled) this.interaction.secondary();
  }

  _mainUp() {
    if (this.context === "mount") this.mount.setBreath(false);
    this._held.delete("slash");
  }

  /* ---------------- 情境：冒险 / 建造 / 骑龙 ---------------- */

  _setContext(ctx) {
    if (ctx === this.context) return;
    // 切换情境时松开主按钮（例如骑着龙按住吐息时下龙）
    this.mainBtn._release?.();
    this.context = ctx;
    for (const s of this.slots) s.el.remove();
    this.slots = [];

    const main = this.mainBtn;
    main.innerHTML = "";
    main.classList.toggle("mount", ctx === "mount");
    main.classList.toggle("adv", ctx === "adventure");
    if (ctx === "mount") main.appendChild(pixelCanvas(DRAGON_ICONS.breath, DRAGON_LEGEND, 5));
    else if (ctx === "adventure") main.appendChild(pixelCanvas(PLAYER_ICONS.slash, JADE_LEGEND, 5));
    else main.appendChild(pixelCanvas(UI_ICONS.place, UI_LEGEND, 5));
    main.setAttribute("aria-label", ctx === "mount" ? "DRAGON BREATH" : ctx === "adventure" ? "JADE SLASH" : "PLACE");

    const defs = ctx === "mount"
      ? DRAGON_SKILLS.filter((s) => s.id !== "breath").map((s) => ({ ...s, icon: DRAGON_ICONS[s.id], legend: DRAGON_LEGEND, kind: "mount" }))
      : ctx === "adventure"
        ? PLAYER_SKILLS.filter((s) => s.id !== "slash").map((s) => ({ ...s, icon: PLAYER_ICONS[s.id], legend: JADE_LEGEND, kind: "adv" }))
        : [];
    defs.forEach((d) => {
      const el = this._tb(this.cluster, `skill ${d.kind}`, d.icon, d.legend, 4, d.label);
      el.dataset.skill = d.id;
      const sweep = document.createElement("i");
      sweep.className = "sweep";
      const secs = document.createElement("i");
      secs.className = "secs";
      const prog = document.createElement("i");
      prog.className = "prog";
      el.append(sweep, secs, prog);
      this._tap(el, () => (ctx === "mount" ? this.mount.useSkill(d.id) : this.skills.use(d.id)));
      this.slots.push({ def: d, el, sweep, secs, prog, lastT: "", lastP: "" });
    });
    this._layoutRing();

    // 模式按钮：显示「切到另一种模式」的图标与文字
    const mb = this.modeBtn;
    mb.innerHTML = "";
    const toBuild = ctx !== "build";
    mb.appendChild(pixelCanvas(toBuild ? UI_ICONS.build : UI_ICONS.adventure, UI_LEGEND, 3));
    const t = document.createElement("span");
    setPixelText(t, toBuild ? "BUILD" : "FIGHT", { color: C.gold, scale: 2 });
    mb.appendChild(t);
    mb.setAttribute("aria-label", toBuild ? "BUILD MODE" : "ADVENTURE MODE");
    mb.classList.toggle("hide", ctx === "mount");
  }

  /* ---------------- 屏幕手势：摇杆 / 视角 / 轻点 ---------------- */

  _bindZone() {
    const z = this.zone;
    z.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      e.preventDefault();
      // 左侧 42% 是移动区，其余是视角区；每个区同时只认一根手指
      if (e.clientX < window.innerWidth * 0.42 && !this.stick) {
        z.setPointerCapture?.(e.pointerId);
        const m = STICK_R + 18;
        const ox = Math.max(m, Math.min(window.innerWidth - m, e.clientX));
        const oy = Math.max(m, Math.min(window.innerHeight - m, e.clientY));
        this.stick = { id: e.pointerId, ox, oy };
        this.stickEl.style.left = `${ox}px`;
        this.stickEl.style.top = `${oy}px`;
        this.stickEl.classList.add("show");
        this._moveStick(e.clientX, e.clientY);
      } else if (!this.look) {
        z.setPointerCapture?.(e.pointerId);
        this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), moved: 0 };
      }
    });
    z.addEventListener("pointermove", (e) => {
      if (this.stick && e.pointerId === this.stick.id) this._moveStick(e.clientX, e.clientY);
      else if (this.look && e.pointerId === this.look.id) {
        const l = this.look;
        const dx = e.clientX - l.x, dy = e.clientY - l.y;
        l.x = e.clientX;
        l.y = e.clientY;
        l.moved = Math.max(l.moved, Math.hypot(e.clientX - l.sx, e.clientY - l.sy));
        const p = this.player;
        const k = p.sensitivity * LOOK_GAIN;
        p.targetYaw -= dx * k;
        p.targetPitch -= dy * k;
        const lim = Math.PI / 2 - 0.02;
        p.targetPitch = Math.max(-lim, Math.min(lim, p.targetPitch));
      }
    });
    const end = (e) => {
      if (this.stick && e.pointerId === this.stick.id) this._releaseStick();
      else if (this.look && e.pointerId === this.look.id) {
        const l = this.look;
        this.look = null;
        // 轻点：冒险模式出招，建造模式挖方块；骑龙时不做事（技能都在技能盘上，避免误触）
        const tap = e.type === "pointerup" && performance.now() - l.t0 < TAP_MS && l.moved < TAP_MOVE;
        if (!tap || !this.active) return;
        if (this.context === "adventure") this.skills.use("slash");
        else if (this.context === "build" && this.interaction.enabled) this.interaction.primary();
      }
    };
    z.addEventListener("pointerup", end);
    z.addEventListener("pointercancel", end);
    z.addEventListener("lostpointercapture", end);
  }

  _moveStick(x, y) {
    const s = this.stick;
    let dx = x - s.ox, dy = y - s.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    const mi = this.player.moveInput;
    // 中心 12% 的死区：拇指放上去不动时不会慢慢漂移
    const mag = Math.min(1, d / STICK_R);
    const k = mag < 0.12 ? 0 : (mag - 0.12) / 0.88 / Math.max(mag, 1e-6);
    mi.x = (dx / STICK_R) * k;
    mi.y = (-dy / STICK_R) * k;
    mi.active = true;
    // 推到边缘疾跑（带一点回滞，避免在边界上来回切）
    mi.sprint = mi.sprint ? mag > 0.86 : mag > 0.94;
    this.stickEl.classList.toggle("sprint", mi.sprint);
  }

  _releaseStick() {
    this.stick = null;
    const mi = this.player.moveInput;
    mi.x = mi.y = 0;
    mi.active = false;
    mi.sprint = false;
    this.knobEl.style.transform = "";
    this.stickEl.classList.remove("show", "sprint");
  }

  /**
   * 底部状态栏（快捷栏）不能压住右下的技能盘：按实际渲染出来的位置检测，重叠就把状态栏往左让开。
   * 用实测而不是写死的偏移 —— 任何屏幕尺寸、界面缩放下都成立（例如 667×375 的手机）。
   */
  _avoidHotbar() {
    const bar = document.getElementById("bottomhud");
    if (!bar) return;
    bar.style.marginLeft = "";
    const b = bar.getBoundingClientRect();
    let left = Infinity;
    for (const el of [this.jumpBtn, this.crouchBtn, this.downBtn, ...this.slots.map((s) => s.el)]) {
      if (el.classList.contains("hide")) continue;
      const r = el.getBoundingClientRect();
      if (r.top < b.bottom && r.bottom > b.top) left = Math.min(left, r.left);
    }
    const overlap = b.right + 8 - left;
    if (overlap > 0) {
      const zoom = parseFloat(getComputedStyle(bar).zoom) || 1;
      const room = b.left - 12; // 左边最多让到屏幕边缘 12px
      bar.style.marginLeft = `${-Math.min(overlap, room) / zoom}px`;
    }
  }

  /* ---------------- 每帧 ---------------- */

  update(playing) {
    if (playing !== this.active) {
      this.active = playing;
      this.root.classList.toggle("on", playing);
      if (!playing) {
        // 离开游戏（暂停 / 背包 / 死亡）时松开一切，否则回来时角色会自己走、龙会一直吐息
        if (this.stick) this._releaseStick();
        this.look = null;
        for (const b of this.root.querySelectorAll(".tb")) b._release?.();
        this.player.keys.delete("Space");
        this.player.keys.delete("KeyC");
      }
    }
    if (!playing) return;
    const p = this.player;
    const riding = this.mount.active;
    this._setContext(riding ? "mount" : this.getMode());
    if (this._layoutSize !== `${window.innerWidth}x${window.innerHeight}`) this._layoutRing();
    if ((this._layoutTick = (this._layoutTick | 0) + 1) % 20 === 1) this._avoidHotbar();

    // 按住主按钮 = 连续普攻（冷却到了就出下一刀）
    if (this._held.has("slash") && this.context === "adventure") this.skills.use("slash");

    const airborne = p.flying || riding || p.swimming;
    this.downBtn.classList.toggle("hide", !airborne);
    this.crouchBtn.classList.toggle("hide", airborne);
    this.crouchBtn.classList.toggle("on", p.crouching);

    // 技能按钮：冷却扫光 + 秒数 + 学习进度 + 能量不足
    for (const s of this.slots) {
      const d = s.def;
      let cd, low = false, prog = null, locked = false;
      if (d.kind === "mount") {
        cd = this.mount.cooldowns[d.id] || 0;
        low = this.mount.energy < (d.cost ?? 5);
      } else {
        cd = this.skills.cooldowns[d.id] || 0;
        locked = !this.skills.learned.has(d.id);
        prog = this.skills.progress(d.id);
      }
      s.el.style.setProperty("--cd", String(Math.min(1, cd / (d.cd || 1))));
      s.el.classList.toggle("low", low);
      s.el.classList.toggle("locked", locked);
      const t = cd > 0.05 ? (cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1)) : "";
      if (t !== s.lastT) {
        s.lastT = t;
        s.secs.innerHTML = "";
        if (t) s.secs.appendChild(renderText(t, { color: "#ffffff", outline: "#000", scale: 2 }));
      }
      const pt = prog ? `${prog.have}/${prog.need}` : "";
      if (pt !== s.lastP) {
        s.lastP = pt;
        s.prog.innerHTML = "";
        if (pt) s.prog.appendChild(renderText(pt, { color: C.gold, outline: "#000", scale: 1 }));
      }
    }
  }
}
