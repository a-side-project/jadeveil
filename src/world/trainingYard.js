/**
 * 训练场 —— 主殿前院西侧的一块演武场，摆放训练假人（武器、龙技能的靶场）。
 *
 * 在世界生成之后、导航建图之前确定性地写入（同一种子每次结果一致），
 * 所以不属于玩家编辑、不进存档差量。
 *
 *   · 13×13 石砖地坪，外圈一道汉白玉矮栏，东、南两侧留入口
 *   · 四角立灯柱，柱顶插火把
 *   · 假人位置：两排各三个
 */
import { ID } from "./blocks.js";

export const YARD = { x: -14, z: -18, half: 6, floorY: 34 };

/** 写入训练场；返回 { torches: [[x,y,z]...], dummies: [[x,z]...] } */
export function buildTrainingYard(world) {
  const { x: cx, z: cz, half, floorY } = YARD;
  const torches = [];
  for (let dx = -half; dx <= half; dx++) {
    for (let dz = -half; dz <= half; dz++) {
      const x = cx + dx, z = cz + dz;
      const edge = Math.abs(dx) === half || Math.abs(dz) === half;
      // 地坪：中心一圈玉砖，其余石砖
      world.setRaw(x, floorY, z, Math.max(Math.abs(dx), Math.abs(dz)) <= 1 ? ID.jade_floor : ID.stone_bricks);
      for (let y = floorY + 1; y <= floorY + 5; y++) world.setRaw(x, y, z, ID.air);
      if (!edge) continue;
      // 入口：东侧（+x）与南侧（+z）中间 3 格不设栏杆
      const gateE = dx === half && Math.abs(dz) <= 1;
      const gateS = dz === half && Math.abs(dx) <= 1;
      if (!gateE && !gateS) world.setRaw(x, floorY + 1, z, ID.railing_marble);
    }
  }
  // 四角灯柱 + 柱顶火把
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = cx + sx * half, z = cz + sz * half;
    world.setRaw(x, floorY + 1, z, ID.pillar_red);
    world.setRaw(x, floorY + 2, z, ID.pillar_red);
    world.setRaw(x, floorY + 3, z, ID.torch);
    torches.push([x, floorY + 3, z]);
  }
  const dummies = [];
  for (const dz of [-3, 2]) for (const dx of [-3, 0, 3]) dummies.push([cx + dx + 0.5, cz + dz + 0.5]);
  return { torches, dummies };
}
