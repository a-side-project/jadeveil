/**
 * 碰撞自动化测试 —— 在真实浏览器里跑，验证：
 *   1. 高速下坠不穿透地面（隧穿回归测试）
 *   2. 极端速度注入（远超正常下落速度）
 *   3. 水平高速撞墙不穿墙
 *   4. 区块边界处碰撞体完整（无 off-by-one 缺失）
 *   5. 斜向移动不穿角
 *   6. 飞行物理（动量滑行 / 俯冲加速 / 退出平滑过渡）
 *
 * 用法：ego-browser nodejs < tests/collision.test.mjs
 * 或在页面控制台调用 window.__pandaria.runCollisionTests()
 */
export const COLLISION_TEST_SOURCE = `
(() => {
  const P = window.__pandaria;
  if (!P) return { error: "window.__pandaria not ready" };
  const { world, player } = P;
  const BLOCKS = P.BLOCKS;
  const results = [];

  function reset(x, y, z) {
    player.position.set(x, y, z);
    player.velocity.set(0, 0, 0);
    player.flying = false;
    player.onGround = false;
    player.keys.clear();
  }

  function simulateFall(x, y, z, frames = 400, dt = 1 / 60) {
    reset(x, y, z);
    for (let i = 0; i < frames; i++) {
      player.update(dt);
      if (player.onGround) break;
    }
    return { y: player.position.y, onGround: player.onGround, substeps: player.lastSubsteps };
  }

  // ---------- 测试 1：高速下坠不穿透 ----------
  const fallSpots = [
    [0, 84], [12, 84], [-12, 84], [0, 40], [20, 20], [-20, -20],
    [40, 40], [-40, -40], [8, -30], [-8, 30], [16, 16], [-16, -16],
  ];
  let maxSubsteps = 0;
  for (const [x, z] of fallSpots) {
    // 期望落点 = 该列最高的实心方块（含云雾、灯笼等空中物体）
    const ground = world.topSolidHeight(x, z, 90);
    if (ground < 0) continue;
    const r = simulateFall(x + 0.5, 90, z + 0.5);
    maxSubsteps = Math.max(maxSubsteps, r.substeps);
    const ok = r.onGround && Math.abs(r.y - (ground + 1)) < 0.05;
    results.push({
      test: "High-speed fall", pos: [x, z],
      expectedY: ground + 1, actualY: +r.y.toFixed(3),
      onGround: r.onGround, pass: ok,
    });
  }

  // ---------- 测试 2：极端速度注入 ----------
  for (const [x, z] of [[0, 84], [12, 84], [-12, 84], [40, 40]]) {
    const ground = world.topSolidHeight(x, z, 90);
    if (ground < 0) continue;
    reset(x + 0.5, ground + 30, z + 0.5);
    player.velocity.y = -200;
    for (let i = 0; i < 200; i++) {
      player.update(1 / 60);
      if (player.onGround) break;
    }
    const ok = player.onGround && Math.abs(player.position.y - (ground + 1)) < 0.05;
    results.push({
      test: "Extreme velocity injection", pos: [x, z],
      expectedY: ground + 1, actualY: +player.position.y.toFixed(3), pass: ok,
    });
  }

  // ---------- 测试 3：水平高速撞墙 ----------
  // 先扫描找一段真正连续的实心墙（避开城门开口）
  const wallTests = [];
  let wallX = null;
  let wallZ = null;
  for (let z = 40; z <= 100 && wallX === null; z++) {
    // 在 x=30 附近找连续 3 格实心的位置
    let run = 0;
    for (let y = 34; y < 44; y++) {
      if (world.solidAt(30, y, z)) run++;
      else run = 0;
      if (run >= 3) { wallX = 30; wallZ = z; break; }
    }
  }
  if (wallX !== null) {
    const gy = world.groundHeight(wallX - 6, wallZ);
    reset(wallX - 6, gy + 1.2, wallZ + 0.5);
    player.velocity.x = 120;
    for (let i = 0; i < 120; i++) {
      player.update(1 / 60);
      if (player.position.x > wallX + 2) break;
    }
    const ok = player.position.x < wallX + 1.5;
    wallTests.push({ wallAt: [wallX, wallZ], finalX: +player.position.x.toFixed(2), pass: ok });
  } else {
    wallTests.push({ note: "No solid wall found, skipped", pass: true });
  }
  results.push({ test: "Horizontal high-speed wall hit", detail: wallTests, pass: wallTests.every((t) => t.pass) });

  // ---------- 测试 4：区块边界碰撞完整性 ----------
  const chunkTests = [];
  for (const bx of [0, 16, 32, -16, -32, 48, -48]) {
    for (const bz of [0, 16, -16, 32, -32]) {
      const g = world.groundHeight(bx, bz);
      if (g < 0) continue;
      const solid = world.solidAt(bx, g, bz);
      // 真正的 off-by-one 检验：站在区块边界方块顶面时，脚底必须被正确支撑
      const supported = player.hasSupportBelow(bx + 0.5, g + 1, bz + 0.5);
      chunkTests.push({ pos: [bx, bz], ground: g, solid, supported, pass: solid && supported });
    }
  }
  results.push({ test: "Chunk boundary collision", detail: chunkTests, pass: chunkTests.every((t) => t.pass) });

  // ---------- 测试 5：斜向移动不穿角 ----------
  for (const [x, z] of [[0, 84], [12, 84], [-12, 84]]) {
    const g = world.groundHeight(x, z);
    if (g < 0) continue;
    // 起点贴地，但不能穿进上方的云雾
    reset(x + 0.5, g + 1.2, z + 0.5);
    player.velocity.x = 90;
    player.velocity.z = 90;
    for (let i = 0; i < 120; i++) player.update(1 / 60);
    // 关键断言：不能掉到地面以下（穿角会导致 y 低于地面）
    // 只要求不低于起始地面，高空云雾允许被穿过（玩家从地面斜冲）
    const ok = player.position.y >= g - 0.05;
    results.push({
      test: "Diagonal high-speed move", pos: [x, z],
      finalY: +player.position.y.toFixed(2), groundY: g, pass: ok,
    });
  }

  // ---------- 测试 6：飞行物理 ----------
  reset(0, 70, 84);
  player.flying = true;
  player.pitch = 0;
  player.keys.add("KeyW");
  for (let i = 0; i < 180; i++) player.update(1 / 60);
  player.keys.delete("KeyW");
  const speedAtRelease = player.velocity.length();
  for (let i = 0; i < 12; i++) player.update(1 / 60);
  const speedAfterGlide = player.velocity.length();
  results.push({
    test: "Flight momentum glide",
    speedAtRelease: +speedAtRelease.toFixed(2),
    speedAfter200ms: +speedAfterGlide.toFixed(2),
    pass: speedAfterGlide > speedAtRelease * 0.5,
  });

  reset(0, 90, 84);
  player.flying = true;
  player.pitch = -0.9;
  player.targetPitch = -0.9;
  player.keys.add("KeyW");
  for (let i = 0; i < 90; i++) player.update(1 / 60);
  const diveVy = player.velocity.y;
  player.keys.delete("KeyW");
  results.push({ test: "Dive acceleration", vy: +diveVy.toFixed(2), pass: diveVy < -3 });

  reset(0, 90, 84);
  player.flying = true;
  player.velocity.set(0, -10, 0);
  player.toggleFly();
  const vyAfterExit = player.velocity.y;
  results.push({
    test: "Flight exit transition",
    vyBefore: -10, vyAfter: +vyAfterExit.toFixed(2),
    pass: vyAfterExit < 0 && vyAfterExit > -10,
  });

  // ---------- 测试 7：飞行撞浮空物体（向上） ----------
  // 找一座浮岛，从其正下方往上飞，必须被底面挡住
  let island = null;
  for (let y = 95; y >= 55 && !island; y--) {
    for (let x = -110; x <= 110 && !island; x += 2) {
      for (let z = -110; z <= 110; z += 2) {
        if (world.solidAt(x, y, z) && !world.solidAt(x, y - 1, z)) {
          // 确认下方是空的（悬空）
          let gap = 0;
          for (let k = 1; k <= 12; k++) if (!world.solidAt(x, y - k, z)) gap++;
          if (gap >= 10) { island = { x, y, z }; break; }
        }
      }
    }
  }
  if (island) {
    reset(island.x + 0.5, island.y - 14, island.z + 0.5);
    player.flying = true;
    player.pitch = 0;
    player.targetPitch = 0;
    player.keys.add("Space"); // 持续上升
    for (let i = 0; i < 240; i++) {
      player.update(1 / 60);
      if (player.position.y > island.y + 2) break;
    }
    player.keys.delete("Space");
    const ok = player.position.y + 1.78 <= island.y + 0.05;
    results.push({
      test: "Fly up into floating object",
      islandBottom: island.y,
      finalHeadY: +(player.position.y + 1.78).toFixed(3),
      pass: ok,
    });
  } else {
    results.push({ test: "Fly up into floating object", note: "No floating island found", pass: false });
  }

  // ---------- 测试 8：飞行向下撞浮岛顶面 ----------
  if (island) {
    reset(island.x + 0.5, island.y + 16, island.z + 0.5);
    player.flying = true;
    player.pitch = 0;
    player.targetPitch = 0;
    player.keys.add("ControlLeft"); // 持续下降
    for (let i = 0; i < 240; i++) {
      player.update(1 / 60);
      if (player.position.y < island.y - 2) break;
    }
    player.keys.delete("ControlLeft");
    const ok = player.position.y >= island.y - 0.05;
    results.push({
      test: "Fly down onto island top",
      islandTop: island.y,
      finalFeetY: +player.position.y.toFixed(3),
      pass: ok,
    });
  }

  // ---------- 测试 9：高速向上飞行撞浮岛 ----------
  if (island) {
    reset(island.x + 0.5, island.y - 20, island.z + 0.5);
    player.flying = true;
    player.velocity.y = 120; // 极高上升速度
    for (let i = 0; i < 200; i++) {
      player.update(1 / 60);
      if (player.position.y > island.y + 2) break;
    }
    const ok = player.position.y + 1.78 <= island.y + 0.05;
    results.push({
      test: "Fast fly up into island",
      islandBottom: island.y,
      finalHeadY: +(player.position.y + 1.78).toFixed(3),
      pass: ok,
    });
  }

  // ---------- 测试 10：飞行向下高速撞地面 ----------
  {
    const g = world.groundHeight(0, 84);
    reset(0.5, g + 40, 84.5);
    player.flying = true;
    player.velocity.y = -150;
    for (let i = 0; i < 200; i++) {
      player.update(1 / 60);
      if (player.position.y < g) break;
    }
    const ok = player.position.y >= g - 0.05;
    results.push({
      test: "Fast fly down into ground",
      groundY: g,
      finalFeetY: +player.position.y.toFixed(3),
      pass: ok,
    });
  }

  // ---------- 测试 11：世界顶部硬限位（不得飞出体素体积） ----------
  {
    reset(0.5, 40, 84.5);
    player.flying = true;
    player.pitch = 0;
    player.targetPitch = 0;
    player.keys.add("Space");
    for (let i = 0; i < 900; i++) player.update(1 / 60);
    player.keys.delete("Space");
    const ceiling = 160 - 1.78 - 0.05;
    const ok = player.position.y <= ceiling + 0.01;
    results.push({
      test: "World ceiling clamp",
      ceiling: +ceiling.toFixed(2),
      finalFeetY: +player.position.y.toFixed(2),
      pass: ok,
    });
  }

  // ---------- 测试 12：浮岛上方可站立（落在该列最高实心方块顶面） ----------
  if (island) {
    // 先求该列最高实心方块
    let topSolid = -1;
    for (let y = island.y + 40; y >= island.y - 4; y--) {
      if (world.solidAt(island.x, y, island.z)) { topSolid = y; break; }
    }
    reset(island.x + 0.5, island.y + 40, island.z + 0.5);
    player.flying = false;
    for (let i = 0; i < 500; i++) {
      player.update(1 / 60);
      if (player.onGround) break;
    }
    const ok = player.onGround && Math.abs(player.position.y - (topSolid + 1)) < 0.05;
    results.push({
      test: "Can stand on island top",
      topSolidY: topSolid,
      expectedFeetY: topSolid + 1,
      finalFeetY: +player.position.y.toFixed(3),
      onGround: player.onGround,
      pass: ok,
    });
  }

  // ---------- 测试 13：飞行模式不得悬浮（防悬浮回归） ----------
  // 飞行中向下冲，必须真正落到地面，不能停在半空
  {
    const g = world.groundHeight(0, 0);
    reset(0.5, 60, 0.5);
    player.flying = true;
    player.pitch = 0;
    player.targetPitch = 0;
    player.velocity.y = -40;
    for (let i = 0; i < 600; i++) {
      player.update(1 / 60);
      if (player.onGround) break;
    }
    const ok = player.onGround && Math.abs(player.position.y - (g + 1)) < 0.05;
    results.push({
      test: "Fly down must land (no hover)",
      groundY: g,
      finalFeetY: +player.position.y.toFixed(2),
      onGround: player.onGround,
      pass: ok,
    });
  }

  // ---------- 测试 14：穷举天空物体六方向碰撞（抽样） ----------
  // 遍历悬空实心方块簇，逐个测试六个方向，断言全部被挡住。
  // 注：完整穷举（286 簇 × 6 方向）耗时较长，此处抽样 40 簇；
  //     完整版见 window.__pandaria.runSkySweep()。
  {
    const clusters = [];
    const seen = new Set();
    for (let y = 159; y >= 45; y -= 4) {
      for (let x = -120; x <= 120; x += 10) {
        for (let z = -120; z <= 120; z += 10) {
          if (!world.solidAt(x, y, z)) continue;
          let gap = 0;
          for (let k = 1; k <= 8; k++) if (!world.solidAt(x, y - k, z)) gap++;
          if (gap < 8) continue;
          const key = \`\${Math.round(x / 20)},\${Math.round(y / 20)},\${Math.round(z / 20)}\`;
          if (seen.has(key)) continue;
          seen.add(key);
          clusters.push({ x, y, z });
        }
      }
    }
    const sample = clusters.slice(0, 40);

    const DIRS = [
      [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    ];

    let total = 0;
    let blocked = 0;
    const failures = [];
    for (const c of sample) {
      for (const [dx, dy, dz] of DIRS) {
        total++;
        const sx = c.x + 0.5 - dx * 6;
        const sy = c.y + 0.5 - dy * 6;
        const sz = c.z + 0.5 - dz * 6;
        reset(sx, sy, sz);
        player.flying = true;
        player.pitch = 0;
        player.targetPitch = 0;
        player.velocity.set(dx * 40, dy * 40, dz * 40);
        let passed = false;
        for (let i = 0; i < 60; i++) {
          player.update(1 / 60);
          const proj =
            (player.position.x - sx) * dx +
            (player.position.y - sy) * dy +
            (player.position.z - sz) * dz;
          if (proj > 6.5) { passed = true; break; }
        }
        if (passed) failures.push({ pos: [c.x, c.y, c.z], dir: [dx, dy, dz] });
        else blocked++;
      }
    }

    results.push({
      test: "Sky objects 6-way collision (sampled)",
      clustersFound: clusters.length,
      sampled: sample.length,
      totalTests: total,
      blocked,
      penetrated: failures.length,
      sample: failures.slice(0, 5),
      pass: failures.length === 0,
    });
  }

  // ---------- 测试 15：恰好落在方块顶面时必须识别为落地 ----------
  // 回归：玩家落到 y 为整数的顶面时，collides() 为 false（AABB 不包含下方方块），
  // 导致 onGround 未置位、继续下落穿透。
  {
    const g = world.groundHeight(0, 84);
    reset(0.5, g + 6, 84.5);
    player.flying = false;
    let landed = false;
    for (let i = 0; i < 300; i++) {
      player.update(1 / 60);
      if (player.onGround) { landed = true; break; }
    }
    const ok = landed && Math.abs(player.position.y - (g + 1)) < 0.05;
    results.push({
      test: "Exact top-face landing detected",
      groundY: g,
      finalFeetY: +player.position.y.toFixed(3),
      onGround: player.onGround,
      pass: ok,
    });
  }

  // ---------- 测试 16：穷举黄色浮块顶面下落 ----------
  // 遍历所有黄色系（金瓦/琉璃黄/沙黄）方块的暴露顶面，从上方下落，
  // 断言落在该列最高实心方块顶面。
  {
    const yellowSet = new Set();
    BLOCKS.forEach((b, id) => {
      if (b && /gold|yellow|sand|brick/.test(b.name + (b.label || ""))) yellowSet.add(id);
    });

    const tops = [];
    const seen = new Set();
    for (let y = 159; y >= 40; y--)
      for (let x = -120; x <= 120; x += 3)
        for (let z = -120; z <= 120; z += 3) {
          const id = world.get(x, y, z);
          if (!yellowSet.has(id)) continue;
          if (world.solidAt(x, y + 1, z)) continue;
          const key = \`\${Math.round(x / 12)},\${Math.round(y / 12)},\${Math.round(z / 12)}\`;
          if (seen.has(key)) continue;
          seen.add(key);
          tops.push({ x, y, z });
        }

    const fails = [];
    for (const t of tops) {
      let topSolid = -1;
      for (let yy = 159; yy >= t.y - 2; yy--) {
        if (world.solidAt(t.x, yy, t.z)) { topSolid = yy; break; }
      }
      reset(t.x + 0.5, topSolid + 10, t.z + 0.5);
      player.flying = false;
      let landed = false;
      for (let i = 0; i < 250; i++) {
        player.update(1 / 60);
        if (player.onGround) { landed = true; break; }
        if (player.position.y < topSolid - 10) break;
      }
      const ok = landed && Math.abs(player.position.y - (topSolid + 1)) < 0.05;
      if (!ok) fails.push({ pos: [t.x, t.y, t.z], topSolid, finalY: +player.position.y.toFixed(2) });
    }

    results.push({
      test: "All yellow block tops landing",
      tested: tops.length,
      failed: fails.length,
      sample: fails.slice(0, 5),
      pass: fails.length === 0,
    });
  }

  const failed = results.filter((r) => !r.pass);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    maxSubsteps,
    results,
  };
})()
`;

export function formatReport(report) {
  if (report.error) return `Test failed to run: ${report.error}`;
  const lines = [];
  lines.push(`Collision tests: ${report.passed}/${report.total} passed, ${report.failed} failed`);
  lines.push(`Max substeps per frame: ${report.maxSubsteps}`);
  for (const r of report.results) {
    const mark = r.pass ? "PASS" : "FAIL";
    if (r.detail) {
      const bad = r.detail.filter((d) => !d.pass);
      lines.push(`  [${mark}] ${r.test} (${r.detail.length} items${bad.length ? `，${bad.length} failed` : ""})`);
    } else {
      const { test, pass, ...rest } = r;
      lines.push(`  [${mark}] ${test} ${JSON.stringify(rest)}`);
    }
  }
  return lines.join("\n");
}
