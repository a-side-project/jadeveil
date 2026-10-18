/**
 * 竖屏提示 —— 触屏设备只支持横屏游玩。
 *
 * 竖着拿手机时整屏盖一层提示：像素手机图标循环演示「竖 → 横」，加两行说明。
 * 从加载页开始就生效（层级高于加载页、标题页、所有菜单）；
 * 游戏中途转成竖屏时通过 onPortrait 通知 main.js 自动暂停。
 */
import { setPixelText } from "./pixelfont.js";

const PHONE = [
  "..KKKKKKKKKK..",
  ".KGGGGGGGGGGK.",
  ".KGKKKKKKKKGK.",
  ".KGKSSSSSSKGK.",
  ".KGKSSSSSSKGK.",
  ".KGKSSSSSSKGK.",
  ".KGKSSSSSSKGK.",
  ".KGKSSSSSSKGK.",
  ".KGKSSSSSSKGK.",
  ".KGKSSSSSSKGK.",
  ".KGKSSSSSSKGK.",
  ".KGKSSSSSSKGK.",
  ".KGKSSSSSSKGK.",
  ".KGKSSSSSSKGK.",
  ".KGKKKKKKKKGK.",
  ".KGGGGLLGGGGK.",
  ".KGGGGGGGGGGK.",
  "..KKKKKKKKKK..",
];
const LEGEND = { K: "#1a1208", G: "#e8b44a", L: "#ffe08a", S: "#4a9e8f" };

function phoneIcon(scale) {
  const c = document.createElement("canvas");
  c.width = PHONE[0].length * scale;
  c.height = PHONE.length * scale;
  const ctx = c.getContext("2d");
  PHONE.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!LEGEND[ch]) return;
    ctx.fillStyle = LEGEND[ch];
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }));
  return c;
}

export function installRotateGuard(touch) {
  const guard = { portrait: false, onPortrait: null };
  if (!touch) return guard;

  const s = document.createElement("style");
  s.textContent = `
    #rotate { position: fixed; inset: 0; z-index: 100; display: none; flex-direction: column; gap: 26px;
      align-items: center; justify-content: center; background: #05070a; padding: 24px; text-align: center; }
    #rotate.on { display: flex; }
    #rotate canvas.phone { image-rendering: pixelated; animation: jv-rotate 2.4s steps(1) infinite; }
    /* 像素风：不做平滑旋转，按 0° → 45° → 90° 三格跳，停在横屏上 */
    @keyframes jv-rotate { 0% { transform: rotate(0deg); } 30% { transform: rotate(-45deg); } 45%, 100% { transform: rotate(-90deg); } }
    #rotate .lines { display: flex; flex-direction: column; gap: 12px; align-items: center; }
  `;
  document.head.appendChild(s);

  const el = document.createElement("div");
  el.id = "rotate";
  el.setAttribute("role", "alert");
  el.setAttribute("aria-label", "ROTATE YOUR PHONE - JADEVEIL IS PLAYED IN LANDSCAPE");
  const icon = phoneIcon(6);
  icon.className = "phone";
  const lines = document.createElement("div");
  lines.className = "lines";
  const t1 = document.createElement("div");
  const t2 = document.createElement("div");
  const t3 = document.createElement("div");
  lines.append(t1, t2, t3);
  // 字号按屏宽取：每个字 6 像素宽（5 + 1 字距），两侧各留 16px，最小的手机（320px）也不出屏
  const fit = (text, max) => Math.max(1, Math.min(max, Math.floor((window.innerWidth - 32) / (text.length * 6))));
  let lastW = 0;
  const paint = () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    setPixelText(t1, "ROTATE YOUR PHONE", { color: "#ffe08a", outline: "#a8731f", scale: fit("ROTATE YOUR PHONE", 4), center: true });
    setPixelText(t2, "JADEVEIL IS PLAYED IN LANDSCAPE", { color: "#6fc0ae", scale: fit("JADEVEIL IS PLAYED IN LANDSCAPE", 2), center: true });
    setPixelText(t3, "YOUR GAME PAUSES AND WAITS FOR YOU", { color: "#8b93a0", scale: fit("YOUR GAME PAUSES AND WAITS FOR YOU", 2), center: true });
  };
  paint();
  el.append(icon, lines);
  document.body.appendChild(el);

  const mq = matchMedia("(orientation: portrait)");
  const check = () => {
    const p = mq.matches;
    if (p) paint();
    el.classList.toggle("on", p);
    if (p && !guard.portrait) guard.onPortrait?.();
    guard.portrait = p;
  };
  mq.addEventListener?.("change", check);
  window.addEventListener("resize", check);
  check();
  return guard;
}
