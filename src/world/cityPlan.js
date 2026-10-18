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
  archway: { z: 89 },
  street: { zFrom: 88, zTo: 30, halfW: 7 },
  plaza: { z: 8, radius: 26 },
  pond: { z: 8, radius: 15 },
  hall: { z: -46, halfW: 17, halfD: 13 },
  rear: { zFrom: -70, zTo: -110 },
  grandPagoda: { z: -92, levels: 9 },
  // 宫墙：南墙就是城门所在的那条线，北墙在通天塔之后；东西两侧把坊市、宝塔都围在里面
  wall: { halfX: 66, north: -120, south: 104, height: 7 },

  // 坊市街区（东西对称，高度错落）
  blocks: [
    { x: -34, z: 62, w: 12, d: 10, h: 6, roof: "ink" },
    { x: 34, z: 62, w: 12, d: 10, h: 6, roof: "ink" },
    { x: -34, z: 34, w: 11, d: 9, h: 7, roof: "gold" },
    { x: 34, z: 34, w: 11, d: 9, h: 7, roof: "gold" },
    { x: -36, z: -8, w: 13, d: 11, h: 8, roof: "ink" },
    { x: 36, z: -8, w: 13, d: 11, h: 8, roof: "ink" },
    { x: -38, z: -38, w: 10, d: 9, h: 6, roof: "gold" },
    { x: 38, z: -38, w: 10, d: 9, h: 6, roof: "gold" },
  ],

  pagodas: [
    { x: -46, z: -66, levels: 6 },
    { x: 46, z: -66, levels: 6 },
    { x: -56, z: 86, levels: 4 },
    { x: 56, z: 86, levels: 4 },
  ],

  islands: [
    { x: -78, y: 104, z: -58, r: 12 },
    { x: 82, y: 116, z: -40, r: 10 },
    { x: 48, y: 124, z: -100, r: 9 },
    { x: -98, y: 100, z: 36, r: 11 },
    { x: 88, y: 112, z: 62, r: 10 },
    { x: -88, y: 120, z: 96, r: 9 },
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
