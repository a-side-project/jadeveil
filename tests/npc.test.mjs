/**
 * 居民导航与行为测试 —— 针对「NPC 穿墙 / 下水 / 原地打转」这一类反复出现的问题。
 *
 * 不是抽查几个点，而是让全部居民真的跑 90 秒（模拟时间），每 0.5 秒对「每一个」居民检查：
 *   inWall  身体半径内任一点与实心方块相交
 *   inWater 脚或躯干在液体里
 *   offNav  站在导航网格不可走的格子上
 * 三项在整个过程中的最大值都必须是 0。
 *
 * 另外两条：
 *   · 动态障碍：在主街上横着砌一堵墙，再跑 20 秒，没有任何人被困在墙里；拆墙后恢复
 *   · 不卡死：90 秒内大部分漫游居民的累计位移 > 6 格
 */
export const NPC_TEST_SOURCE = `
(() => {
  const P = window.__pandaria;
  if (!P) return { error: "window.__pandaria not ready" };
  const { npcs, nav, edits, world } = P;
  const BLOCKS = P.BLOCKS;
  const stoneId = BLOCKS.findIndex((b) => b && b.name === "stone_bricks");
  const results = [];
  // 玩家放在城外高处，避免打招呼 / 避让干扰统计
  const pp = { x: 0, y: 140, z: 160 };

  function simulate(seconds, dt, sample) {
    let worst = { inWall: 0, inWater: 0, offNav: 0 };
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      npcs.update(dt, pp, { night: 0, mounted: false });
      if (i % Math.round(0.5 / dt) === 0) {
        const s = npcs.stats();
        worst.inWall = Math.max(worst.inWall, s.inWall);
        worst.inWater = Math.max(worst.inWater, s.inWater);
        worst.offNav = Math.max(worst.offNav, s.offNav);
        if (sample) sample(s);
      }
    }
    return worst;
  }

  // 1. 全员 90 秒：0 穿墙、0 入水、0 离网
  const start = npcs.agents.map((a) => ({ x: a.pos.x, z: a.pos.z, travel: 0, lx: a.pos.x, lz: a.pos.z }));
  const worst = simulate(90, 1 / 30, () => {
    npcs.agents.forEach((a, i) => {
      const s = start[i];
      s.travel += Math.hypot(a.pos.x - s.lx, a.pos.z - s.lz);
      s.lx = a.pos.x; s.lz = a.pos.z;
    });
  });
  results.push({
    test: "All residents for 90 s: never inside a wall, never in water, never off the nav grid",
    detail: { residents: npcs.agents.length, worst },
    pass: worst.inWall === 0 && worst.inWater === 0 && worst.offNav === 0,
  });

  // 2. 不卡死：漫游者累计位移
  const roamers = npcs.agents.map((a, i) => ({ a, s: start[i] })).filter((o) => o.a.mode === "roam");
  const moving = roamers.filter((o) => o.s.travel > 6).length;
  const ratio = moving / Math.max(1, roamers.length);
  results.push({
    test: "Roaming residents keep moving (>= 80% travelled more than 6 blocks in 90 s)",
    detail: { roamers: roamers.length, moving, ratio: +ratio.toFixed(2), states: npcs.stats().byState },
    pass: ratio >= 0.8,
  });

  // 3. 动态障碍：主街横砌一堵 3 格高的墙（x -8..8, z 50），跑 20 秒
  const wall = [];
  const baseY = nav.heightAt(0, 50);
  for (let x = -8; x <= 8; x++) for (let y = baseY; y < baseY + 3; y++) {
    wall.push([x, y, 50, world.get(x, y, 50)]);
    edits.set(x, y, 50, stoneId);
  }
  const worstWall = simulate(20, 1 / 30);
  for (const [x, y, z, old] of wall) edits.set(x, y, z, old);
  const worstAfter = simulate(5, 1 / 30);
  results.push({
    test: "A wall built across the avenue: nobody ends up inside it; nav recovers after removal",
    detail: { duringWall: worstWall, afterRemoval: worstAfter, navCellOnWall: nav.heightAt(0.5, 50.5) },
    pass: worstWall.inWall === 0 && worstWall.offNav === 0 && worstAfter.inWall === 0 && worstAfter.offNav === 0,
  });

  // 4. 寻路正确性：主分量内随机 30 对点，A* 必须找到路，且路径每一段都满足身体可通过
  let found = 0, clean = 0;
  for (let k = 0; k < 30; k++) {
    const a = nav.randomWalkable(), b = nav.randomWalkable();
    const p = nav.findPath(a.x, a.z, b.x, b.z, 60000);
    if (!p) continue;
    found++;
    let ok = true;
    for (let i = 1; i < p.length; i++) if (!nav.clearLine(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1])) ok = false;
    if (ok) clean++;
  }
  results.push({
    test: "A* finds a path between random points in the main area, every segment body-clear",
    detail: { pairs: 30, found, clean },
    pass: found >= 28 && clean === found,
  });

  const failed = results.filter((r) => !r.pass);
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
})()
`;
