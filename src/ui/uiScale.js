/**
 * 界面整体缩放 —— 所有面板按视口尺寸统一缩放，小窗口不出屏、大屏不显小。
 *
 * 设计基准是 1280×760：比它小就按比例缩小（最小 0.55），比它大就适度放大（最大 1.35）。
 * 用 CSS zoom 作用在各个界面容器上（标题、暂停、背包、死亡、底部状态栏、小地图、设置），
 * 3D 画面本身不受影响。另外给每个居中卡片设最大高度 + 内部滚动，作为极端比例下的兜底。
 */
const BASE_W = 1280;
const BASE_H = 760;

export function installUIScale() {
  const style = document.createElement("style");
  style.textContent = `
    #overlay .card, #pause .card, #inv .panel, #death .card,
    #bottomhud, #minimap, #settings {
      zoom: var(--ui, 1);
    }
    #overlay .card, #pause .card, #inv .panel, #death .card {
      max-height: calc((100vh - 24px) / var(--ui, 1));
      overflow-y: auto;
      scrollbar-width: none;
    }
    /* 标题页只留标题卡片：HUD、居民气泡、伤害数字一律隐藏 */
    body.in-title #hud, body.in-title #npc-bubbles, body.in-title #dmglayer { display: none !important; }
  `;
  document.head.appendChild(style);

  const apply = () => {
    const k = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
    const ui = Math.max(0.55, Math.min(1.35, k));
    document.documentElement.style.setProperty("--ui", ui.toFixed(3));
  };
  apply();
  window.addEventListener("resize", apply);
}
