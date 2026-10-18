/**
 * RPG 界面层 —— 血条 / 氧气 / 快捷栏 / 技能栏 / 能量 / 伤害数字 / 目标血条 / 受伤闪红 / 死亡界面。
 *
 * 全部像素风：图标逐像素绘制、文字走位图像素字体、硬边无圆角。
 * 只读游戏状态 + 订阅事件，不反向修改游戏逻辑（按钮回调由 main.js 注入）。
 */
import * as THREE from "three";
import { HOTBAR_SIZE } from "../game/inventory.js";
import { itemDef } from "../game/items.js";
import { itemIcon } from "../game/itemModels.js";
import { MAX_HP, MAX_AIR } from "../game/health.js";
import { DRAGON_SKILLS, ENERGY_MAX } from "../mount/dragon.js";
import { events } from "../game/events.js";
import { renderText, setPixelText } from "./pixelfont.js";
import { pixelCanvas, DRAGON_ICONS, DRAGON_LEGEND, PLAYER_ICONS, JADE_LEGEND } from "./skillIcons.js";
import { PLAYER_SKILLS } from "../game/skills.js";

const C = {
  gold: "#ffe08a",
  goldDeep: "#a8731f",
  bone: "#f2e6cf",
  jade: "#6fc0ae",
  dim: "#8b93a0",
  red: "#ff5a4a",
  purple: "#e08aff",
};

/* ------------------------------------------------------------------ */
/* 像素图标                                                             */
/* ------------------------------------------------------------------ */

const HEART = [
  ".KK...KK.",
  "KRRK.KRRK",
  "KRWRKRRRK",
  "KRRRRRRRK",
  "KRRRRRRDK",
  ".KRRRRDK.",
  "..KRRDK..",
  "...KDK...",
  "....K....",
];
const HEART_HALF = HEART.map((r) => [...r].map((ch, x) => (x > 4 && "RWD".includes(ch) ? "E" : ch)).join(""));
const HEART_EMPTY = HEART.map((r) => r.replace(/[RWD]/g, "E"));
const HEART_LEGEND = { K: "#1a0606", R: "#e0262b", W: "#ffb7b0", D: "#a3141a", E: "#3d1212" };
const BUBBLE = [
  "..KKKKK..",
  ".KBBBBBK.",
  "KBWWBBBBK",
  "KBWBBBBBK",
  "KBBBBBBBK",
  "KBBBBBBBK",
  "KBBBBBBDK",
  ".KBBBBDK.",
  "..KKKKK..",
];
const BUBBLE_LEGEND = { K: "#0b2a44", B: "#3f9fe0", W: "#d8f2ff", D: "#24679a" };

/* ------------------------------------------------------------------ */

// 底部状态栏宽度 = 快捷栏外宽：9 格 × 50 + 8 个 2px 间隙 + 两侧 6px 内边距
const BAR_W = 9 * 50 + 8 * 2 + 12;
// 技能栏 4 格与快捷栏等宽：(BAR_W - 内边距 12 - 3 个间隙) / 4
const SKILL_W = (BAR_W - 12 - 3 * 2) / 4;
// 人物技能栏 6 格，同样与快捷栏等宽
const PSKILL_W = (BAR_W - 12 - 5 * 2) / 6;

/* ------------------------------------------------------------------ */

export class RpgHud {
  /**
   * @param {object} deps { atlas, inventory, health, mount, combat, camera, player }
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.root = document.getElementById("hud");
    this._v = new THREE.Vector3();
    this._css();
    this.bottom = document.createElement("div");
    this.bottom.id = "bottomhud";
    this.root.appendChild(this.bottom);
    const itemName = document.getElementById("itemname");
    if (itemName) this.bottom.appendChild(itemName);
    this._buildVitals();
    this._buildHotbar();
    this._buildSkillbar();
    this._buildPlayerSkillbar();
    this._buildOverlayLayers();
    this._bindEvents();
    this.refreshHotbar();
  }

  _css() {
    const s = document.createElement("style");
    s.textContent = `
      /* 底部状态栏：一个竖向容器，三行等宽居中 —— 血条 / (骑乘时)能量 / 快捷栏或技能栏 */
      #bottomhud { position: absolute; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom)); transform: translateX(-50%);
        width: ${BAR_W}px; display: flex; flex-direction: column; align-items: stretch; gap: 5px; pointer-events: none; }
      #vitals { display: flex; justify-content: space-between; align-items: flex-end; height: 18px; padding: 0 6px; }
      #vitals .row { display: flex; gap: 2px; }
      #vitals .air { flex-direction: row-reverse; }
      #vitals .heart.shake { transform: translateY(-2px); }
      #rpg-hotbar { display: flex; gap: 2px; padding: 6px; pointer-events: auto; }
      #rpg-hotbar .slot, #inv .slot { width: 50px; height: 50px; position: relative; }
      .slot canvas.icon { position: absolute; left: 7px; top: 7px; width: 36px; height: 36px; image-rendering: pixelated; }
      .slot .count { position: absolute; right: 3px; bottom: 2px; pointer-events: none; }
      .slot .key { position: absolute; left: 4px; top: 3px; opacity: 0.85; pointer-events: none; }
      #mounthud { display: none; flex-direction: column; gap: 5px; }
      #mounthud.on { display: flex; }
      #mounthud .label { display: flex; justify-content: space-between; align-items: flex-end; height: 14px; padding: 0 6px; }
      /* 显式覆盖全局 .slot 的固定 48px 宽：能量条要撑满整行 */
      #energy { width: auto !important; height: 12px; margin: 0 6px; padding: 2px; position: relative; display: block; }
      #energy i { display: block; height: 100%; background: linear-gradient(#f0b8ff, #9b3fe0 55%, #5e1f99); }
      #skills { display: flex; gap: 2px; padding: 6px; }
      #skills .sk { width: ${SKILL_W}px; height: 50px; position: relative; display: flex; align-items: center; overflow: hidden; }
      #skills .sk canvas.ic { width: 36px; height: 36px; margin-left: 7px; flex: none; image-rendering: pixelated; }
      #skills .sk .nm { margin-left: 6px; display: flex; flex-direction: column; gap: 3px; }
      #skills .sk .cd { position: absolute; left: 0; right: 0; bottom: 0; background: rgba(5,3,10,0.72); }
      #skills .sk .cdt { position: absolute; left: 7px; top: 7px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; }
      #skills .sk.active { outline: 3px solid #e08aff; outline-offset: -3px; }
      #skills .sk.low { filter: grayscale(0.8) brightness(0.6); }
      /* 人物技能栏（冒险模式）：与快捷栏同一位置、同宽 */
      #pskills { display: none; gap: 2px; padding: 6px; pointer-events: auto; }
      #pskills.on { display: flex; }
      #pskills .sk { width: ${PSKILL_W}px; height: 50px; position: relative; display: flex; align-items: center; overflow: hidden; }
      #pskills .sk canvas.ic { width: 30px; height: 30px; margin-left: 5px; flex: none; image-rendering: pixelated; }
      #pskills .sk .nm { margin-left: 5px; display: flex; flex-direction: column; gap: 3px; }
      #pskills .sk .cd { position: absolute; left: 0; right: 0; bottom: 0; background: rgba(2,10,8,0.72); }
      #pskills .sk .cdt { position: absolute; left: 5px; top: 10px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; }
      #pskills .sk.locked canvas.ic, #pskills .sk.locked .nm { filter: grayscale(1) brightness(0.45); }
      #pskills .sk .lock { position: absolute; left: 0; right: 0; bottom: 3px; display: none; justify-content: center; }
      #pskills .sk.locked .lock { display: flex; }
      #modebadge { position: absolute; left: 6px; bottom: 100%; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
      /* 触屏：技能由右下的环形技能盘操作，底部只留血条与（建造模式的）快捷栏 */
      body.touch #pskills, body.touch #skills { display: none !important; }
      body.touch #mounthud .label .r { display: none; }
      #hurtflash { position: fixed; inset: 0; pointer-events: none; z-index: 20; opacity: 0;
        background: radial-gradient(ellipse at center, rgba(160,0,0,0) 45%, rgba(170,0,0,0.75) 100%); }
      #dmglayer { position: fixed; inset: 0; pointer-events: none; z-index: 9; overflow: hidden; } /* 世界空间的标注，压在 HUD 之下 */
      #dmglayer canvas { position: absolute; image-rendering: pixelated; }
      #dmglayer .hpbar { position: absolute; width: 56px; height: 9px; background: #120a08; border: 2px solid #050302; }
      #dmglayer .hpbar i { display: block; height: 100%; background: #d63b2f; }
      #death { position: fixed; inset: 0; z-index: 70; display: none; align-items: center; justify-content: center;
        background: rgba(90, 0, 0, 0.55); pointer-events: auto; }
      #death.open { display: flex; }
      #death .card { text-align: center; display: flex; flex-direction: column; gap: 18px; align-items: center; }
      /* 物品名 / 提示文字：底部状态栏的第一行，永远贴在血条正上方 */
      #bottomhud #itemname { position: static; transform: none; align-self: center; height: 16px; margin-bottom: 2px; }
    `;
    document.head.appendChild(s);
  }

  /* ---------------- 血条 / 氧气 ---------------- */
  _buildVitals() {
    const el = document.createElement("div");
    el.id = "vitals";
    el.innerHTML = `<div class="row hearts"></div><div class="row air"></div>`;
    this.bottom.appendChild(el);
    this.vitals = el;
    this.heartEls = [];
    this.airEls = [];
    const hearts = el.querySelector(".hearts");
    const air = el.querySelector(".air");
    this._heartCanvas = {
      full: pixelCanvas(HEART, HEART_LEGEND, 2),
      half: pixelCanvas(HEART_HALF, HEART_LEGEND, 2),
      empty: pixelCanvas(HEART_EMPTY, HEART_LEGEND, 2),
    };
    for (let i = 0; i < MAX_HP / 2; i++) {
      const c = document.createElement("canvas");
      c.width = 18;
      c.height = 18;
      c.className = "heart";
      hearts.appendChild(c);
      this.heartEls.push(c);
    }
    const bubble = pixelCanvas(BUBBLE, BUBBLE_LEGEND, 2);
    for (let i = 0; i < MAX_AIR; i++) {
      const c = document.createElement("canvas");
      c.width = 18;
      c.height = 18;
      c.getContext("2d").drawImage(bubble, 0, 0);
      air.appendChild(c);
      this.airEls.push(c);
    }
    this._lastHp = -1;
    this._lastAir = -1;
  }

  _drawHearts(hp, lowShake) {
    for (let i = 0; i < this.heartEls.length; i++) {
      const c = this.heartEls[i];
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, 18, 18);
      const v = hp - i * 2;
      const img = v >= 2 ? this._heartCanvas.full : v === 1 ? this._heartCanvas.half : this._heartCanvas.empty;
      ctx.drawImage(img, 0, 0);
      // 低血量时心形轻微抖动（MC 的危险提示）
      c.classList.toggle("shake", lowShake && Math.random() < 0.5);
    }
  }

  /* ---------------- 快捷栏 ---------------- */
  _buildHotbar() {
    // 旧 HUD 的方块快捷栏换成背包驱动的快捷栏
    const old = document.getElementById("hotbar");
    if (old) old.style.display = "none";
    const bar = document.createElement("div");
    bar.id = "rpg-hotbar";
    this.bottom.appendChild(bar);
    this.hotbarEl = bar;
    this.hotSlots = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = document.createElement("div");
      s.className = "slot";
      const key = document.createElement("span");
      key.className = "key";
      setPixelText(key, String(i + 1), { color: C.gold, scale: 1 });
      s.appendChild(key);
      s.addEventListener("click", () => this.inventory.select(i));
      bar.appendChild(s);
      this.hotSlots.push(s);
    }
  }

  /** 把一格背包渲染进 slot 元素（图标 + 数量）。背包界面也复用它。 */
  paintSlot(el, stack) {
    el.querySelector("canvas.icon")?.remove();
    el.querySelector(".count")?.remove();
    if (!stack) return;
    const def = itemDef(stack.id);
    if (!def) return;
    el.appendChild(this._iconFor(def));
    if (stack.count > 1) {
      const n = document.createElement("span");
      n.className = "count";
      setPixelText(n, String(stack.count), { color: "#ffffff", outline: "#1a1208", scale: 2 });
      el.appendChild(n);
    }
  }

  _iconFor(def) {
    const src = itemIcon(def, this.atlas, 64);
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    c.className = "icon";
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  }

  refreshHotbar() {
    const inv = this.inventory;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      this.paintSlot(this.hotSlots[i], inv.slots[i]);
      this.hotSlots[i].classList.toggle("active", i === inv.selected);
    }
  }

  /* ---------------- 技能栏（骑乘时替换快捷栏） ---------------- */
  _buildSkillbar() {
    const el = document.createElement("div");
    el.id = "mounthud";
    el.innerHTML = `<div class="label"><span class="l"></span><span class="r"></span></div>
      <div id="energy" class="slot"><i></i></div><div id="skills"></div>`;
    // 放在快捷栏之前：骑乘时快捷栏隐藏，技能栏占据同一位置
    this.bottom.insertBefore(el, this.hotbarEl);
    this.skillbar = el;
    this.energyFill = el.querySelector("#energy i");
    setPixelText(el.querySelector(".label .l"), "ENDER DRAGON", { color: C.purple, outline: "#1a0626", scale: 2 });
    setPixelText(el.querySelector(".label .r"), "F  DISMOUNT", { color: C.dim, scale: 1 });
    this.skillEls = {};
    const slots = el.querySelector("#skills");
    const NAMES = { breath: ["BREATH", "HOLD"], fireball: ["FIREBALL", "25 EN"], dash: ["VOID", "DASH"], roar: ["DRAGON", "ROAR"] };
    for (const sk of DRAGON_SKILLS) {
      const s = document.createElement("div");
      s.className = "sk slot";
      const ic = pixelCanvas(DRAGON_ICONS[sk.id], DRAGON_LEGEND, 3);
      ic.className = "ic";
      s.appendChild(ic);
      const nm = document.createElement("div");
      nm.className = "nm";
      for (const [k, line] of NAMES[sk.id].entries()) {
        const t = document.createElement("div");
        setPixelText(t, line, { color: k === 0 ? C.bone : C.dim, scale: 1 });
        nm.appendChild(t);
      }
      s.appendChild(nm);
      const cd = document.createElement("div");
      cd.className = "cd";
      s.appendChild(cd);
      const cdt = document.createElement("div");
      cdt.className = "cdt";
      s.appendChild(cdt);
      const key = document.createElement("span");
      key.className = "key";
      setPixelText(key, String(sk.slot), { color: C.purple, scale: 1 });
      s.appendChild(key);
      slots.appendChild(s);
      this.skillEls[sk.id] = { el: s, cd, cdt, lastT: "" };
    }
  }

  /* ---------------- 人物技能栏（冒险模式时替换快捷栏） ---------------- */
  _buildPlayerSkillbar() {
    const el = document.createElement("div");
    el.id = "pskills";
    this.bottom.insertBefore(el, this.hotbarEl);
    this.pskillbar = el;
    this.pskillEls = {};
    for (const sk of PLAYER_SKILLS) {
      const s = document.createElement("div");
      s.className = "sk slot";
      s.dataset.skill = sk.id;
      const ic = pixelCanvas(PLAYER_ICONS[sk.id], JADE_LEGEND, 3);
      ic.className = "ic";
      s.appendChild(ic);
      const nm = document.createElement("div");
      nm.className = "nm";
      for (const [k, line] of sk.short.entries()) {
        const t = document.createElement("div");
        setPixelText(t, line, { color: k === 0 ? C.bone : C.dim, scale: 1 });
        nm.appendChild(t);
      }
      s.appendChild(nm);
      const cd = document.createElement("div");
      cd.className = "cd";
      s.appendChild(cd);
      const cdt = document.createElement("div");
      cdt.className = "cdt";
      s.appendChild(cdt);
      const lock = document.createElement("div");
      lock.className = "lock";
      s.appendChild(lock);
      const key = document.createElement("span");
      key.className = "key";
      setPixelText(key, sk.key, { color: C.jade, scale: 1 });
      s.appendChild(key);
      s.addEventListener("click", () => this.skills?.use(sk.id));
      el.appendChild(s);
      this.pskillEls[sk.id] = { el: s, cd, cdt, lock, lastT: "", lastLock: "" };
    }
  }

  /** 冒险 / 建造模式（由 main.js 设置）。 */
  setGameMode(mode) {
    this.gameMode = mode;
  }

  /* ---------------- 叠加层 ---------------- */
  _buildOverlayLayers() {
    this.hurtEl = document.createElement("div");
    this.hurtEl.id = "hurtflash";
    document.body.appendChild(this.hurtEl);
    this._hurt = 0;

    this.dmgLayer = document.createElement("div");
    this.dmgLayer.id = "dmglayer";
    document.body.appendChild(this.dmgLayer);
    this.floaters = [];
    this.hpBars = new Map();

    const death = document.createElement("div");
    death.id = "death";
    death.innerHTML = `<div class="card"><div id="d-title"></div><div id="d-cause"></div>
      <div class="btnrow" style="width: 320px"><button id="d-respawn"></button></div>
      <div class="btnrow" style="width: 320px"><button id="d-title-btn"></button></div></div>`;
    document.body.appendChild(death);
    this.deathEl = death;
    setPixelText(death.querySelector("#d-title"), "YOU DIED", { color: "#ff6a5a", outline: "#2a0505", shadow: "#000", scale: 7, tracking: 2, center: true });
    setPixelText(death.querySelector("#d-respawn"), "RESPAWN", { color: C.bone, scale: 2, center: true });
    death.querySelector("#d-respawn").setAttribute("aria-label", "RESPAWN");
    death.querySelector("#d-title-btn").setAttribute("aria-label", "TITLE SCREEN");
    setPixelText(death.querySelector("#d-title-btn"), "TITLE SCREEN", { color: C.bone, scale: 2, center: true });
    death.querySelector("#d-respawn").addEventListener("click", () => this.onRespawn?.());
    death.querySelector("#d-title-btn").addEventListener("click", () => this.onTitle?.());
  }

  _bindEvents() {
    events.on("inventory:change", () => this.refreshHotbar());
    events.on("inventory:select", () => this.refreshHotbar());
    events.on("player:damage", () => { this._hurt = 1; });
    events.on("player:death", ({ text }) => {
      setPixelText(this.deathEl.querySelector("#d-cause"), `JJ ${text}`, { color: C.bone, scale: 2, center: true });
      this.deathEl.classList.add("open");
    });
    events.on("player:respawn", () => this.deathEl.classList.remove("open"));
    events.on("entity:hit", ({ entity, amount, crit, source }) => this._floatDamage(entity, amount, crit, source));
  }

  /* ---------------- 伤害数字 ---------------- */
  _floatDamage(e, amount, crit, source) {
    if (amount <= 0) return;
    const dragon = source === "breath" || source === "fireball" || source === "roar" || source === "dot";
    const text = (amount < 1 ? amount.toFixed(1) : String(Math.round(amount))) + (crit ? "!" : "");
    const color = crit ? "#ffd04a" : dragon ? "#f0a8ff" : "#ffffff";
    const el = renderText(text, { color, outline: "#120814", scale: crit ? 4 : 3 });
    this.dmgLayer.appendChild(el);
    this.floaters.push({
      el,
      // 从血条（头顶 +0.35）上方起飘，两者不重叠
      pos: new THREE.Vector3(e.pos.x + (Math.random() - 0.5) * 0.6, e.pos.y + e.height + 0.8, e.pos.z + (Math.random() - 0.5) * 0.6),
      t: 0,
      dur: crit ? 1.1 : 0.85,
    });
    if (this.floaters.length > 40) {
      this.floaters.shift().el.remove();
    }
  }

  _project(pos) {
    const v = this._v.copy(pos).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  /* ---------------- 每帧 ---------------- */
  update(dt) {
    const h = this.health;
    // 血条
    const low = h.hp <= 4 && !h.dead;
    if (h.hp !== this._lastHp || low) {
      this._lastHp = h.hp;
      this._drawHearts(h.hp, low);
    }
    // 氧气：只在水下或未回满时显示
    const airN = Math.ceil(h.air);
    const showAir = h.air < MAX_AIR - 0.01;
    // 整行用 visibility（保留占位，心形不会左右跳）；子元素不能再单独设 visible，否则会盖过父级的 hidden
    if (showAir !== this._showAir) {
      this._showAir = showAir;
      (this._airRow ||= this.vitals.querySelector(".air")).style.visibility = showAir ? "visible" : "hidden";
    }
    if (airN !== this._lastAir) {
      this._lastAir = airN;
      this.airEls.forEach((c, i) => (c.style.opacity = i < airN ? "1" : "0"));
    }

    // 骑乘：快捷栏 ↔ 技能栏
    const m = this.mount;
    const mounted = !!(m && m.active);
    this.skillbar.classList.toggle("on", mounted);
    const adventure = this.gameMode !== "build";
    this.pskillbar.classList.toggle("on", !mounted && adventure);
    this.hotbarEl.style.display = mounted || adventure ? "none" : "flex";
    if (!mounted && adventure && this.skills) {
      const P = this.skills;
      for (const sk of PLAYER_SKILLS) {
        const s = this.pskillEls[sk.id];
        const cd = P.cooldowns[sk.id] || 0;
        s.cd.style.height = sk.cd ? `${Math.min(1, cd / sk.cd) * 100}%` : "0%";
        const t = cd > 0.05 && sk.cd > 1 ? (cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1)) : "";
        if (t !== s.lastT) {
          s.lastT = t;
          s.cdt.innerHTML = "";
          if (t) s.cdt.appendChild(renderText(t, { color: "#ffffff", outline: "#000", scale: 2 }));
        }
        const locked = !P.learned.has(sk.id);
        s.el.classList.toggle("locked", locked);
        const prog = P.progress(sk.id);
        const lt = prog ? `${prog.have}/${prog.need}` : "";
        if (lt !== s.lastLock) {
          s.lastLock = lt;
          setPixelText(s.lock, lt, { color: C.gold, outline: "#000", scale: 1 });
        }
      }
    }
    if (mounted) {
      this.energyFill.style.width = `${(m.energy / ENERGY_MAX) * 100}%`;
      for (const sk of DRAGON_SKILLS) {
        const s = this.skillEls[sk.id];
        const cd = m.cooldowns[sk.id] || 0;
        s.cd.style.height = sk.cd ? `${Math.min(1, cd / sk.cd) * 100}%` : "0%";
        const t = cd > 0 ? cd.toFixed(1) : "";
        if (t !== s.lastT) {
          s.lastT = t;
          s.cdt.innerHTML = "";
          if (t) s.cdt.appendChild(renderText(t, { color: "#ffffff", outline: "#000", scale: 2 }));
        }
        s.el.classList.toggle("active", sk.id === "breath" && m.breathing);
        s.el.classList.toggle("low", m.energy < (sk.cost ?? 5));
      }
    }

    // 受伤闪红
    this._hurt = Math.max(0, this._hurt - dt * 2.2);
    this.hurtEl.style.opacity = String(Math.max(this._hurt, low ? 0.25 + Math.sin(performance.now() * 0.006) * 0.1 : 0));

    // 伤害数字：上浮 + 淡出
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const p = this._project(this._v.set(f.pos.x, f.pos.y + k * 1.1, f.pos.z));
      if (!p) { f.el.style.display = "none"; continue; }
      f.el.style.display = "block";
      f.el.style.left = `${Math.round(p.x - f.el.width / 2)}px`;
      f.el.style.top = `${Math.round(p.y - f.el.height / 2)}px`;
      f.el.style.opacity = String(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }

    // 目标血条：附近、受过伤或倒地的可攻击实体
    const seen = new Set();
    const pp = this.player.position;
    for (const e of this.combat.entities) {
      const near = Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z) < 22;
      if (!near || (e.hp >= e.maxHp && e.alive)) continue;
      seen.add(e);
      let bar = this.hpBars.get(e);
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "hpbar";
        bar.innerHTML = "<i></i>";
        this.dmgLayer.appendChild(bar);
        this.hpBars.set(e, bar);
      }
      const p = this._project(this._v.set(e.pos.x, e.pos.y + e.height + 0.35, e.pos.z));
      if (!p) { bar.style.display = "none"; continue; }
      bar.style.display = "block";
      bar.style.left = `${Math.round(p.x - 30)}px`;
      bar.style.top = `${Math.round(p.y)}px`;
      bar.firstChild.style.width = `${(Math.max(0, e.hp) / e.maxHp) * 100}%`;
    }
    for (const [e, bar] of this.hpBars) {
      if (!seen.has(e)) {
        bar.remove();
        this.hpBars.delete(e);
      }
    }
  }

  /** 触屏：骑乘提示改成按钮说明（没有 F 键）。 */
  setTouchMode(on) {
    setPixelText(this.skillbar.querySelector(".label .r"), on ? "DRAGON BUTTON - DISMOUNT" : "F  DISMOUNT", { color: C.dim, scale: 1 });
  }

  setVisible(v) {
    this.bottom.style.display = v ? "flex" : "none";
  }
}
