/**
 * PWA：注册 Service Worker，并把「安装到桌面 / 主屏幕」做成游戏内的一个按钮。
 *
 *   · Chromium（Chrome / Edge / Android）：拦下 beforeinstallprompt，菜单里出现 INSTALL APP，
 *     点击即弹出系统安装框
 *   · iOS / iPadOS Safari 没有安装事件：显示「分享 → 添加到主屏幕」的提示
 *   · 已经以应用方式运行（standalone / fullscreen）时什么都不显示
 *
 * 状态变化通过 onChange 回调通知菜单刷新。
 */
const listeners = new Set();
let deferred = null;

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.matchMedia("(display-mode: fullscreen)").matches ||
  window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const pwa = {
  /** "installed" | "prompt"（可一键安装）| "ios"（需手动添加）| "unavailable" */
  get state() {
    if (standalone()) return "installed";
    if (deferred) return "prompt";
    if (isIOS()) return "ios";
    return "unavailable";
  },

  onChange(fn) {
    listeners.add(fn);
    fn(this.state);
    return () => listeners.delete(fn);
  },

  /** 弹出系统安装框；返回用户是否接受。 */
  async install() {
    if (!deferred) return false;
    const e = deferred;
    deferred = null;
    e.prompt();
    const choice = await e.userChoice.catch(() => ({ outcome: "dismissed" }));
    emit();
    return choice.outcome === "accepted";
  },
};

function emit() {
  for (const fn of listeners) fn(pwa.state);
}

export function installPWA() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // 不让浏览器自己弹横幅，改由游戏菜单提供入口
    deferred = e;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });

  // ?nosw 用于排查缓存问题；file:// 与不支持的浏览器直接跳过
  if (!("serviceWorker" in navigator) || location.protocol === "file:" || new URLSearchParams(location.search).has("nosw")) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("[pwa] service worker registration failed", err);
    });
  });
}
