/**
 * 浮岛可达性验收测试
 *
 * 模拟真实操作路径：从地面起飞 → 沿石阶/飞行路径上升 → 降落到岛顶。
 * 断言必须是行为断言：onGround === true 且 y === 岛顶高度。
 *
 * 穷举所有浮岛，全部通过才算达标。
 */
export const ISLAND_ACCESS_TEST_SOURCE = `
(async () => {
  const P = window.__pandaria;
  if (!P) return { error: "window.__pandaria not ready" };
  const { world, player } = P;
  const BLOCKS = P.BLOCKS;
  const { CITY_PLAN } = await import("/src/world/cityPlan.js");

  const results = [];

  function reset(x, y, z) {
    player.position.set(x, y, z);
    player.velocity.set(0, 0, 0);
    player.flying = true;
    player.onGround = false;
    player.keys.clear();
    player.pitch = 0;
    player.targetPitch = 0;
  }

  /**
   * 找某列的岛顶高度。
   * 只统计不透明方块（草地/石作），跳过竹叶、松针、云雾等空中装饰，
   * 否则会把高空树叶误当成岛顶。
   */
  function topSolidAt(x, z, from = 159) {
    return world.groundHeight(x, z, from);
  }

  for (const isl of CITY_PLAN.islands) {
    const { x, y, z, r } = isl;
    const topY = topSolidAt(x, z);
    if (topY < 0) {
      results.push({ island: [x, y, z], r, error: "No solid block in column", pass: false });
      continue;
    }

    // ---- 路径 A：从地面起飞，飞到岛顶上方，再降落 ----
    // 起点选在浮岛外侧地面（石阶起点附近）
    // 像真实玩家一样：在岛外侧找一列头顶一路净空的位置起飞（云是可以踩的实心方块，正上方有云就换个地方）；
    // 平飞的高度要高过航线上最高的障碍（岛上的树冠）
    const anySolid = (cx, cz, y0, y1) => { for (let yy = y0; yy <= y1; yy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (world.solidAt(cx + dx, yy, cz + dz)) return true; return false; };
    let startX = x + r + 10, startZ = z;
    for (let k = 0; k < 24; k++) {
      const sx = x + r + 10 + (k % 6), sz = z + ((k / 6) | 0) * 3 - 4;
      const g = topSolidAt(sx, sz);
      if (g >= 0 && !anySolid(sx, sz, g + 1, topY + 12)) { startX = sx; startZ = sz; break; }
    }
    let cruise = topY + 4;
    for (let cx = x; cx <= startX; cx++) for (let yy = topY; yy < topY + 30; yy++) if (anySolid(cx, startZ, yy, yy)) cruise = Math.max(cruise, yy + 3);
    const groundY = topSolidAt(startX, startZ);
    reset(startX + 0.5, (groundY < 0 ? 40 : groundY + 2), startZ + 0.5);
    player.yaw = Math.PI / 2;
    player.targetYaw = Math.PI / 2;

    // 1) 飞行上升到航线高度
    player.keys.add("Space");
    let rose = false;
    for (let i = 0; i < 1500; i++) {
      player.update(1 / 60);
      if (player.position.y > cruise) { rose = true; break; }
    }
    player.keys.delete("Space");
    const afterRise = { y: +player.position.y.toFixed(2), rose };

    // 2) 横移到岛心上方（保持高度，不继续爬升）；同时把横向偏差修正回岛心这一行
    player.keys.add("KeyW");
    let moved = false;
    for (let i = 0; i < 900; i++) {
      // 保持水平飞行：每帧把垂直速度归零，避免一边前进一边爬升
      player.velocity.y = 0;
      player.position.y = afterRise.y;
      player.velocity.z = (z + 0.5 - player.position.z) * 4;
      player.update(1 / 60);
      if (Math.abs(player.position.x - (x + 0.5)) < 1.2 && Math.abs(player.position.z - (z + 0.5)) < 1.2) { moved = true; break; }
    }
    player.keys.delete("KeyW");
    const afterMove = { x: +player.position.x.toFixed(2), y: +player.position.y.toFixed(2), moved };

    // 3) 关飞行，自然降落到岛顶
    player.toggleFly();
    let landed = false;
    for (let i = 0; i < 600; i++) {
      player.update(1 / 60);
      if (player.onGround) { landed = true; break; }
      if (player.position.y < topY - 20) break;
    }

    const finalY = +player.position.y.toFixed(3);
    const pass = landed && Math.abs(finalY - (topY + 1)) < 0.05;

    results.push({
      island: [x, y, z],
      r,
      topY,
      expectedFeetY: topY + 1,
      afterRise,
      afterMove,
      finalY,
      landed,
      onGround: player.onGround,
      pass,
    });
  }

  const failed = results.filter((r) => !r.pass);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
})()
`;

