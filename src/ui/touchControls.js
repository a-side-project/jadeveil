/**
 * 触屏操作（手机 / 平板，横屏）—— 与键鼠共用同一套玩家逻辑，只是把输入换个来源。
 *
 *   左半屏   浮动摇杆：拇指落在哪里摇杆就出现在哪里；推到边缘自动疾跑（模拟量，轻推慢走）
 *   右半屏   拖动转视角；轻点 = 攻击 / 挖方块（等同鼠标左键）
 *   右下     JUMP（按住 = 空格，游泳上浮 / 骑龙爬升）、PLACE（放方块 / 火把）、
 *            CROUCH（点一下蹲下 / 再点站起，切换式 —— 右手拇指要留给视角）、
 *            DOWN（飞行 / 骑乘 / 游泳时才出现，按住 = C 下降；与 CROUCH 占同一个位置）
 *   顶部     MENU（暂停）、BAG（背包）、DRAGON（召唤 / 收回末影龙）、VIEW（切换视角）
 *   快捷栏   直接点格子选择；骑乘时点技能格放技能（吐息按住持续）
 *
 * 用 Pointer Events + setPointerCapture 跟踪每根手指，多指同时操作互不干扰；
 * 整层 touch-action: none，浏览器不会把手势当成滚动 / 缩放。
 */
import { setPixelText } from "./pixelfont.js";

const C = { gold: "#ffe08a", bone: "#f2e6cf", jade: "#6fc0ae", purple: "#e08aff" };

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

export class TouchControls {
  /**
   * @param {object} o { player, interaction, mount, skillEls, onPause, onInventory, onMount, onCamera, click }
   */
  constructor(o) {
    Object.assign(this, o);
    this.active = false; // 只在游戏进行中接管屏幕
    this.stick = null; // { id, ox, oy }
    this.look = null; // { id, x, y, t0, sx, sy, moved }
    this._css();
    this._build();
    this._bindSkills();
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
      #touch .btn { position: absolute; display: flex; align-items: center; justify-content: center;
        background: rgba(10, 14, 18, 0.55); border: 3px solid rgba(232, 180, 74, 0.7);
        box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.5); touch-action: none; }
      #touch .btn.down, #touch .btn:active { background: rgba(232, 180, 74, 0.5); border-color: #ffe08a; }
      #touch .btn.hide { display: none; }
      /* 右下动作区：避开 iPhone 底部横条与刘海的安全区 */
      #touch .b-jump { width: 84px; height: 84px; right: calc(22px + env(safe-area-inset-right)); bottom: calc(26px + env(safe-area-inset-bottom)); }
      #touch .b-place { width: 76px; height: 64px; right: calc(116px + env(safe-area-inset-right)); bottom: calc(40px + env(safe-area-inset-bottom)); }
      #touch .b-down, #touch .b-crouch { width: 84px; height: 56px; right: calc(22px + env(safe-area-inset-right)); bottom: calc(124px + env(safe-area-inset-bottom)); }
      #touch .b-crouch.on { background: rgba(111, 192, 174, 0.55); border-color: #d6fff0; }
      /* 顶部系统按钮：左上角一排（右上角是小地图） */
      #touch .top { position: absolute; left: calc(12px + env(safe-area-inset-left)); top: calc(10px + env(safe-area-inset-top)); display: flex; gap: 8px; }
      #touch .top .btn { position: static; height: 44px; padding: 0 12px; }
      #touch .top .b-dragon { border-color: rgba(224, 138, 255, 0.75); }
      /* 触屏下快捷栏与技能栏可直接点 */
      body.touch #rpg-hotbar, body.touch #skills { pointer-events: auto; touch-action: none; }
      body.touch #crosshair { opacity: 0.75; }
    `;
    document.head.appendChild(s);
  }

  _btn(parent, cls, label, color = C.bone, scale = 2) {
    const b = document.createElement("div");
    b.className = `btn ${cls}`;
    b.setAttribute("role", "button");
    b.setAttribute("aria-label", label);
    setPixelText(b, label, { color, scale, center: true });
    parent.appendChild(b);
    return b;
  }

  _build() {
    const root = document.createElement("div");
    root.id = "touch";
    root.innerHTML = `<div class="zone"></div><div class="stick"><i class="base"></i><i class="knob"></i></div><div class="top"></div>`;
    document.body.appendChild(root);
    this.root = root;
    this.zone = root.querySelector(".zone");
    this.stickEl = root.querySelector(".stick");
    this.knobEl = root.querySelector(".knob");

    const top = root.querySelector(".top");
    this._tapBtn(this._btn(top, "b-menu", "MENU", C.gold), () => this.onPause?.());
    this._tapBtn(this._btn(top, "b-bag", "BAG"), () => this.onInventory?.());
    this.dragonBtn = this._btn(top, "b-dragon", "DRAGON", C.purple);
    this._tapBtn(this.dragonBtn, () => this.onMount?.());
    this._tapBtn(this._btn(top, "b-view", "VIEW"), () => this.onCamera?.());

    this.jumpBtn = this._btn(root, "b-jump", "JUMP", C.gold, 2);
    this._holdBtn(this.jumpBtn, "Space");
    this.downBtn = this._btn(root, "b-down", "DOWN", C.jade, 2);
    this._holdBtn(this.downBtn, "KeyC");
    this.crouchBtn = this._btn(root, "b-crouch", "CROUCH", C.bone, 2);
    this._tapBtn(this.crouchBtn, () => this.player.toggleCrouch());
    this.placeBtn = this._btn(root, "b-place", "PLACE", C.bone, 2);
    this._tapBtn(this.placeBtn, () => {
      if (this.interaction.enabled) this.interaction.secondary();
    });

    this._bindZone();
  }

  /** 轻点按钮：按下即触发（不等抬起，手感更跟手）。 */
  _tapBtn(el, fn) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("down");
      this.click?.();
      fn();
    });
    const up = () => el.classList.remove("down");
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
  }

  /** 按住按钮：映射成键盘按键（复用玩家控制器里跳跃 / 上浮 / 下降的全部逻辑）。 */
  _holdBtn(el, code) {
    const keys = this.player.keys;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add("down");
      keys.add(code);
    });
    const up = () => {
      el.classList.remove("down");
      keys.delete(code);
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
  }

  /** 骑乘技能格：吐息按住持续，其余点一下释放。 */
  _bindSkills() {
    for (const [id, s] of Object.entries(this.skillEls || {})) {
      s.el.addEventListener("pointerdown", (e) => {
        if (!this.active || !this.mount.active) return;
        e.preventDefault();
        e.stopPropagation();
        s.el.setPointerCapture?.(e.pointerId);
        if (id === "breath") this.mount.setBreath(true);
        else this.mount.useSkill(id);
      });
      if (id === "breath") {
        const stop = () => this.mount.setBreath(false);
        s.el.addEventListener("pointerup", stop);
        s.el.addEventListener("pointercancel", stop);
        s.el.addEventListener("lostpointercapture", stop);
      }
    }
  }

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
        // 轻点 = 左键：攻击 / 挖方块（骑乘时由技能栏操作，轻点不做事，避免误触）
        const tap = e.type === "pointerup" && performance.now() - l.t0 < TAP_MS && l.moved < TAP_MOVE;
        if (tap && this.active && !this.mount.active && this.interaction.enabled) this.interaction.primary();
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

  /** 每帧：只在游戏中显示；按状态显隐 DOWN / PLACE。 */
  update(playing) {
    if (playing !== this.active) {
      this.active = playing;
      this.root.classList.toggle("on", playing);
      if (!playing) {
        // 离开游戏（暂停 / 背包 / 死亡）时松开一切，否则回来时角色会自己走
        if (this.stick) this._releaseStick();
        this.look = null;
        this.player.keys.delete("Space");
        this.player.keys.delete("KeyC");
        this.jumpBtn.classList.remove("down");
        this.downBtn.classList.remove("down");
      }
    }
    if (!playing) return;
    const p = this.player;
    const riding = this.mount.active;
    const airborne = p.flying || riding || p.swimming;
    this.downBtn.classList.toggle("hide", !airborne);
    this.crouchBtn.classList.toggle("hide", airborne);
    this.crouchBtn.classList.toggle("on", p.crouching);
    this.placeBtn.classList.toggle("hide", riding);
  }
}
