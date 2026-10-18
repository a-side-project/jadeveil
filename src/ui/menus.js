/**
 * 标题页与暂停菜单 —— 存档入口都在这里。
 *
 *   标题页：CONTINUE（有存档时，显示上次保存时间）/ NEW GAME / LOAD SAVE FILE / SETTINGS
 *   暂停页：RESUME / SAVE GAME / EXPORT SAVE / LOAD SAVE FILE / SETTINGS / CONTROLS / FULLSCREEN / TITLE SCREEN
 *
 * 只负责界面与按钮，具体动作由 main.js 注入的回调完成。
 */
import { setPixelText } from "./pixelfont.js";

const C = { gold: "#ffe08a", goldDeep: "#a8731f", bone: "#f2e6cf", jade: "#6fc0ae", dim: "#8b93a0", red: "#ff7a6a" };

export const BRAND = "JADEVEIL";
export const TAGLINE = "A VOXEL REALM OF MIST AND JADE";

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
      #overlay { cursor: default !important; }
    `;
    document.head.appendChild(s);
  }

  _btn(parent, label, fn, color = C.bone) {
    const row = document.createElement("div");
    row.className = "btnrow";
    const b = document.createElement("button");
    // 稳定 id（文字是 canvas 像素字，自动化与无障碍都靠它）：btn-new-game、btn-continue ...
    // 标题页与暂停页有同名按钮（SETTINGS / LOAD SAVE FILE）：暂停页的加 pause- 前缀，保证 id 唯一
    const slug = label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
    b.id = document.getElementById(`btn-${slug}`) || parent.closest?.("#pause") ? `btn-pause-${slug}` : `btn-${slug}`;
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
    // 品牌 logo（与 favicon / 应用图标同一份像素数据）
    const logo = document.createElement("img");
    logo.src = "/favicon.svg";
    logo.alt = "";
    logo.width = 88;
    logo.height = 88;
    logo.style.cssText = "image-rendering: pixelated; margin-bottom: 6px;";
    menu.appendChild(logo);
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
    this._btn(menu, "SETTINGS", () => this.cb.onSettings());
    this.install = [this._installEntry(menu)];
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
    this.install.push(this._installEntry(menu));
    this._btn(menu, "SETTINGS", () => this.cb.onSettings());
    this._btn(menu, "CONTROLS", () => this.cb.onControls());
    // 全屏：浏览器支持时才出现（iPhone Safari 不支持网页全屏，那里靠「添加到主屏幕」）
    this.btnFullscreen = this._btn(menu, "FULLSCREEN", () => this.cb.onFullscreen());
    if (!document.fullscreenEnabled) this.btnFullscreen.parentElement.style.display = "none";
    document.addEventListener("fullscreenchange", () => {
      setPixelText(this.btnFullscreen, document.fullscreenElement ? "EXIT FULLSCREEN" : "FULLSCREEN", { color: C.bone, scale: 2, center: true });
    });
    this._btn(menu, "SAVE AND QUIT TO TITLE", () => this.cb.onQuitTitle());
    this.pauseMsg = document.createElement("div");
    this.pauseMsg.className = "msg";
    menu.appendChild(this.pauseMsg);
    // 暂停页背景点击 = 继续（与原来的行为一致）。
    // 防「幽灵点击」：触屏上按下 MENU 的瞬间暂停页就出现在手指下面，抬手时浏览器补发的 click
    // 会落在背景上把暂停立刻取消 —— 所以暂停页出现后 500ms 内不响应背景点击。
    pause.addEventListener("click", (e) => {
      if (e.target === pause && performance.now() - this._pauseShownAt > 500) this.cb.onResume();
    });
  }

  /** 「安装为应用」入口：一键安装按钮 + iOS 的手动添加提示，默认都隐藏。 */
  _installEntry(menu) {
    const btn = this._btn(menu, "INSTALL APP", () => this.cb.onInstall?.(), C.jade);
    const row = btn.parentElement;
    row.style.display = "none";
    const hint = document.createElement("div");
    hint.className = "meta";
    hint.style.display = "none";
    setPixelText(hint, "SAFARI: SHARE  >  ADD TO HOME SCREEN", { color: C.jade, scale: 1, center: true });
    menu.appendChild(hint);
    return { row, hint };
  }

  /** @param {"installed"|"prompt"|"ios"|"unavailable"} state */
  setInstallState(state) {
    for (const { row, hint } of this.install) {
      row.style.display = state === "prompt" ? "" : "none";
      hint.style.display = state === "ios" ? "" : "none";
    }
  }

  pauseMessage(text, color = C.jade) {
    setPixelText(this.pauseMsg, text, { color, scale: 1, center: true });
  }

  showPause() {
    this._pauseShownAt = performance.now();
    this.pauseMessage("");
    document.getElementById("pause").classList.add("open");
  }

  hidePause() {
    document.getElementById("pause").classList.remove("open");
  }
}
