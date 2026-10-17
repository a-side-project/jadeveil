/**
 * 标题页与暂停菜单 —— 存档入口都在这里。
 *
 *   标题页：CONTINUE（有存档时，显示上次保存时间）/ NEW GAME / LOAD SAVE FILE
 *   暂停页：RESUME / SAVE GAME / EXPORT SAVE / LOAD SAVE FILE / SETTINGS / CONTROLS / TITLE SCREEN
 *
 * 只负责界面与按钮，具体动作由 main.js 注入的回调完成。
 */
import { setPixelText } from "./pixelfont.js";

const C = { gold: "#ffe08a", goldDeep: "#a8731f", bone: "#f2e6cf", jade: "#6fc0ae", dim: "#8b93a0", red: "#ff7a6a" };

export const BRAND = "JADEVEIL";
export const TAGLINE = "A VOXEL REALM OF MIST AND JADE";

const CONTROLS = [
  ["WASD", "MOVE"], ["SPACE", "JUMP / ASCEND"], ["SHIFT", "SPRINT"],
  ["LMB", "ATTACK / BREAK"], ["RMB", "PLACE / TORCH"], ["1-9 / WHEEL", "SELECT ITEM"],
  ["E", "INVENTORY"], ["F", "SUMMON / DISMISS DRAGON"], ["1-4 MOUNTED", "DRAGON SKILLS"],
  ["V", "CAMERA"], ["T", "TIME SPEED"], ["F3", "DEBUG INFO"], ["ESC", "PAUSE"],
];

function fmtTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtPlay(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}H ${m}M` : `${m}M`;
}

export class Menus {
  constructor(cb) {
    this.cb = cb;
    this._css();
    this._buildTitle();
    this._buildPause();
  }

  _css() {
    const s = document.createElement("style");
    s.textContent = `
      .menu { display: flex; flex-direction: column; align-items: center; gap: 10px; }
      .menu .btnrow { width: 340px; margin-top: 0; }
      .menu .btnrow button { cursor: pointer; padding: 10px 6px !important; }
      .menu .btnrow button.dis { filter: grayscale(1) brightness(0.55); cursor: default; }
      .menu .meta { min-height: 14px; margin-top: -4px; }
      .menu .msg { min-height: 16px; }
      .controls { display: grid; grid-template-columns: auto auto; gap: 6px 22px; margin-top: 8px; }
      #overlay { cursor: default !important; }
    `;
    document.head.appendChild(s);
  }

  _btn(parent, label, fn, color = C.bone) {
    const row = document.createElement("div");
    row.className = "btnrow";
    const b = document.createElement("button");
    // 稳定 id（文字是 canvas 像素字，自动化与无障碍都靠它）：btn-new-game、btn-continue ...
    b.id = `btn-${label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`;
    b.setAttribute("aria-label", label);
    setPixelText(b, label, { color, scale: 2, center: true });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (b.classList.contains("dis")) return;
      this.cb.click?.();
      fn();
    });
    row.appendChild(b);
    parent.appendChild(row);
    return b;
  }

  /* ---------------- 标题页 ---------------- */
  _buildTitle() {
    const card = document.querySelector("#overlay .card");
    card.innerHTML = "";
    const menu = document.createElement("div");
    menu.className = "menu";
    card.appendChild(menu);
    const title = document.createElement("div");
    setPixelText(title, BRAND, { color: C.gold, outline: C.goldDeep, shadow: "#000", scale: 7, tracking: 2, center: true });
    menu.appendChild(title);
    const sub = document.createElement("div");
    setPixelText(sub, TAGLINE, { color: C.jade, scale: 2, tracking: 1, center: true });
    sub.style.marginBottom = "18px";
    menu.appendChild(sub);

    this.btnContinue = this._btn(menu, "CONTINUE", () => this.cb.onContinue(), C.gold);
    this.continueMeta = document.createElement("div");
    this.continueMeta.className = "meta";
    menu.appendChild(this.continueMeta);
    this.btnNew = this._btn(menu, "NEW GAME", () => this._newGame());
    this._btn(menu, "LOAD SAVE FILE", () => this.cb.onLoadFile());
    this.titleMsg = document.createElement("div");
    this.titleMsg.className = "msg";
    menu.appendChild(this.titleMsg);
    const credit = document.createElement("div");
    setPixelText(credit, "SINGLE PLAYER  -  SAVES STAY IN THIS BROWSER", { color: C.dim, scale: 1, center: true });
    menu.appendChild(credit);
    this._confirmNew = false;
  }

  _newGame() {
    // 已有存档时，新游戏需要再点一次确认（会覆盖存档）
    if (this.hasSave && !this._confirmNew) {
      this._confirmNew = true;
      setPixelText(this.btnNew, "CLICK AGAIN TO OVERWRITE SAVE", { color: C.red, scale: 2, center: true });
      return;
    }
    this.cb.onNewGame();
  }

  /** @param {{savedAt:number, playTime:number}|{corrupt:true}|null} info */
  showTitle(info) {
    this.hasSave = !!(info && !info.corrupt);
    this.btnContinue.classList.toggle("dis", !this.hasSave);
    this.continueMeta.innerHTML = "";
    if (this.hasSave) {
      setPixelText(this.continueMeta, `SAVED ${fmtTime(info.savedAt)}   PLAYED ${fmtPlay(info.playTime)}`, { color: C.dim, scale: 1, center: true });
    } else if (info && info.corrupt) {
      setPixelText(this.continueMeta, "SAVE COULD NOT BE READ", { color: C.red, scale: 1, center: true });
    }
    this._confirmNew = false;
    setPixelText(this.btnNew, "NEW GAME", { color: C.bone, scale: 2, center: true });
    document.getElementById("overlay").classList.remove("hidden");
  }

  hideTitle() {
    document.getElementById("overlay").classList.add("hidden");
  }

  titleMessage(text, color = C.red) {
    setPixelText(this.titleMsg, text, { color, scale: 1, center: true });
  }

  /* ---------------- 暂停页 ---------------- */
  _buildPause() {
    const pause = document.getElementById("pause");
    const card = pause.querySelector(".card");
    card.innerHTML = "";
    const menu = document.createElement("div");
    menu.className = "menu";
    card.appendChild(menu);
    const t = document.createElement("div");
    setPixelText(t, "PAUSED", { color: C.gold, outline: C.goldDeep, shadow: "#000", scale: 5, tracking: 2, center: true });
    t.style.marginBottom = "12px";
    menu.appendChild(t);
    this._btn(menu, "RESUME", () => this.cb.onResume(), C.gold);
    this._btn(menu, "SAVE GAME", () => this.cb.onSave());
    this._btn(menu, "EXPORT SAVE FILE", () => this.cb.onExport());
    this._btn(menu, "LOAD SAVE FILE", () => this.cb.onLoadFile());
    this._btn(menu, "SETTINGS", () => this.cb.onSettings());
    this.btnControls = this._btn(menu, "CONTROLS", () => this._toggleControls());
    this._btn(menu, "SAVE AND QUIT TO TITLE", () => this.cb.onQuitTitle());
    this.pauseMsg = document.createElement("div");
    this.pauseMsg.className = "msg";
    menu.appendChild(this.pauseMsg);

    this.controls = document.createElement("div");
    this.controls.className = "controls";
    this.controls.style.display = "none";
    for (const [k, v] of CONTROLS) {
      const a = document.createElement("div");
      setPixelText(a, k, { color: C.gold, scale: 1 });
      const b = document.createElement("div");
      setPixelText(b, v, { color: C.bone, scale: 1 });
      this.controls.append(a, b);
    }
    menu.appendChild(this.controls);
    // 暂停页背景点击 = 继续（与原来的行为一致）
    pause.addEventListener("click", (e) => {
      if (e.target === pause) this.cb.onResume();
    });
  }

  _toggleControls() {
    this.controls.style.display = this.controls.style.display === "none" ? "grid" : "none";
  }

  pauseMessage(text, color = C.jade) {
    setPixelText(this.pauseMsg, text, { color, scale: 1, center: true });
  }

  showPause() {
    this.pauseMessage("");
    document.getElementById("pause").classList.add("open");
  }

  hidePause() {
    document.getElementById("pause").classList.remove("open");
  }
}
