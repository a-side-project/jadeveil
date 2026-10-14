/**
 * 主城规划 —— 有规划的城市布局，而非随机散布。
 *
 * 空间序列（沿 -Z 方向由南向北）：
 *   南城门 → 牌坊 → 灯笼长街（坊市）→ 中央广场（水池/曲桥）→ 主殿 → 后苑（塔林/竹林）
 * 东西两侧对称布置坊市街区，屋顶天际线高低错落。
 */

export const CITY_PLAN = {
  axis: { x: 0 },
  gate: { z: 104, halfW: 12, height: 12 },
  archway: { z: 92 },
  street: { zFrom: 88, zTo: 30, halfW: 7 },
  plaza: { z: 8, radius: 26 },
  pond: { z: 8, radius: 15 },
  hall: { z: -46, halfW: 17, halfD: 13 },
  rear: { zFrom: -70, zTo: -110 },
  wall: { half: 62, height: 7 },

  // 坊市街区（东西对称，高度错落）
  blocks: [
    { x: -34, z: 62, w: 12, d: 10, h: 6, roof: "ink" },
    { x: 34, z: 62, w: 12, d: 10, h: 6, roof: "ink" },
    { x: -34, z: 34, w: 11, d: 9, h: 7, roof: "gold" },
    { x: 34, z: 34, w: 11, d: 9, h: 7, roof: "gold" },
    { x: -36, z: -8, w: 13, d: 11, h: 8, roof: "ink" },
    { x: 36, z: -8, w: 13, d: 11, h: 8, roof: "ink" },
    { x: -38, z: -34, w: 10, d: 9, h: 6, roof: "gold" },
    { x: 38, z: -34, w: 10, d: 9, h: 6, roof: "gold" },
  ],

  pagodas: [
    { x: -50, z: -62, levels: 6 },
    { x: 50, z: -62, levels: 6 },
    { x: -50, z: 78, levels: 4 },
    { x: 50, z: 78, levels: 4 },
  ],

  islands: [
    { x: -78, y: 104, z: -58, r: 12 },
    { x: 82, y: 116, z: -40, r: 10 },
    { x: 22, y: 124, z: -98, r: 9 },
    { x: -98, y: 100, z: 36, r: 11 },
    { x: 60, y: 108, z: 70, r: 10 },
    { x: -40, y: 120, z: 96, r: 9 },
  ],

  // NPC 巡逻路径
  npcPaths: [
    { name: "Central Avenue", points: [[0, 86], [0, 60], [0, 34], [0, 12]] },
    { name: "East Market", points: [[26, 62], [26, 34], [26, 6], [26, -20]] },
    { name: "West Market", points: [[-26, 62], [-26, 34], [-26, 6], [-26, -20]] },
    { name: "Plaza Loop", points: [[18, 8], [0, 26], [-18, 8], [0, -10]] },
    { name: "Hall Forecourt", points: [[-12, -26], [12, -26], [12, -34], [-12, -34]] },
  ],
};
