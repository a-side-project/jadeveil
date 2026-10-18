/**
 * 界面整体缩放 —— 所有面板按视口尺寸统一缩放，小窗口不出屏、大屏不显小。
 *
 * 设计基准是 1280×760：比它小就按比例缩小（最小 0.55），比它大就适度放大（最大 1.35）。
 * 用 CSS zoom 作用在各个界面容器上（标题、暂停、背包、死亡、设置、底部状态栏、小地图），
 * 3D 画面本身不受影响。另外给每个居中卡片设最大高度 + 内部滚动，作为极端比例下的兜底。
 *
 * 触屏设备另有下限：手指需要更大的点击目标（快捷栏格子不小于约 36px、菜单按钮不小于约 30px），
 * 所以手机横屏上 HUD 不会跟着屏幕一起缩到 0.55。
 *   --ui   菜单、背包、设置等窗口
 *   --hud  底部状态栏、小地图
 */
const BASE_W = 1280;
const BASE_H = 760;

export function installUIScale() {
  const style = document.createElement("style");
  style.textContent = `
    #overlay .card, #pause .card, #inv .panel, #death .card, #settings .win { zoom: var(--ui, 1); }
    #bottomhud, #minimap { zoom: var(--hud, 1); }
    #overlay .card, #pause .card, #inv .panel, #death .card, #settings .win {
      max-height: calc((100vh - 24px) / var(--ui, 1));
      max-height: calc((100dvh - 24px) / var(--ui, 1));
      overflow-y: auto;
      scrollbar-width: none;
      touch-action: pan-y;
    }
    /* 标题页只留标题卡片：HUD、居民气泡、伤害数字一律隐藏 */
    body.in-title #hud, body.in-title #npc-bubbles, body.in-title #dmglayer { display: none !important; }

    /* 矮屏（手机横屏）：标题页去掉 logo、收紧间距；暂停菜单按钮排成两列 */
    @media (max-height: 560px) {
      #overlay .menu > img { display: none; }
      #overlay .menu, #pause .menu { gap: 7px; }
      #pause .menu { display: grid; grid-template-columns: 1fr 1fr; column-gap: 10px; justify-items: stretch; }
      #pause .menu > :first-child, #pause .menu > .msg, #pause .menu > .meta { grid-column: 1 / -1; justify-self: center; }
      #pause .menu .btnrow { width: 300px; }
    }
  `;
  document.head.appendChild(style);

  const apply = () => {
    const touch = document.body.classList.contains("touch");
    const k = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
    const ui = Math.max(touch ? 0.7 : 0.55, Math.min(1.35, k));
    const hud = Math.max(touch ? 0.74 : 0.55, Math.min(touch ? 1.1 : 1.35, k));
    document.documentElement.style.setProperty("--ui", ui.toFixed(3));
    document.documentElement.style.setProperty("--hud", hud.toFixed(3));
  };
  apply();
  window.addEventListener("resize", apply);
  return apply;
}
