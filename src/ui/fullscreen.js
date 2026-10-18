/**
 * 全屏 —— 进入游戏默认全屏（浏览器与 PWA 都一样），玩家可以在设置里关掉。
 *
 *  · 只能在用户手势里请求（NEW GAME / CONTINUE / 菜单按钮的点击），浏览器才会放行
 *  · 全屏后用 Keyboard Lock 接管 ESC（Chromium）：轻按 ESC 只打开暂停菜单，
 *    长按才退出全屏 —— 否则每次按 ESC 暂停都会被踢出全屏
 *  · 触屏设备全屏后顺便把屏幕方向锁成横屏（安卓 Chrome 支持；iPhone 不支持网页全屏，靠竖屏提示）
 */
const STORE = "jadeveil.fullscreen.v1";

export class Fullscreen {
  constructor() {
    this.supported = !!document.fullscreenEnabled;
    this.auto = this.supported;
    try {
      const v = localStorage.getItem(STORE);
      if (v === "0") this.auto = false;
    } catch { /* 无存储 */ }
    document.addEventListener("fullscreenchange", () => {
      if (document.fullscreenElement) this._lockKeys();
    });
  }

  get active() {
    return !!document.fullscreenElement;
  }

  setAuto(on) {
    this.auto = on && this.supported;
    try { localStorage.setItem(STORE, on ? "1" : "0"); } catch { /* 无存储 */ }
  }

  enter() {
    if (!this.supported || this.active) return;
    try {
      const r = document.documentElement.requestFullscreen({ navigationUI: "hide" });
      if (r && r.catch) r.catch(() => { /* 没有手势 / 被用户拒绝：留在窗口模式 */ });
    } catch { /* 不支持 */ }
  }

  exit() {
    if (this.active) document.exitFullscreen().catch(() => {});
  }

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  _lockKeys() {
    try { navigator.keyboard?.lock?.(["Escape"])?.catch?.(() => {}); } catch { /* 不支持 */ }
    try { screen.orientation?.lock?.("landscape")?.catch?.(() => {}); } catch { /* 不支持 */ }
  }
}
