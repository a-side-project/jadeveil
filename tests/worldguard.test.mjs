/**
 * 世界底 / 虚空保护测试
 *
 * 覆盖用户遇到的「挖穿后无限下坠」bug：
 *   1. 基岩不可破坏
 *   2. 基岩不可被放置覆盖
 *   3. 从高空自由落体 → 最终 onGround 且落在基岩顶面，不穿出世界底
 *   4. y 掉到世界底部以下 → 触发重生，重生后 onGround 且落点安全
 *   5. 出生点候选全部有实心支撑
 */
export const WORLDGUARD_TEST_SOURCE = `
(() => {
  const P = window.__pandaria;
  if (!P) return { error: "window.__pandaria not ready" };
  const { world, player, interaction } = P;
  const BLOCKS = P.BLOCKS;
  const AIR = 0;
  const BEDROCK_ID = BLOCKS.findIndex((b) => b && b.name === "bedrock");
  const BEDROCK_TOP = 2;
  const results = [];

  function reset(x, y, z) {
    player.position.set(x, y, z);
    player.velocity.set(0, 0, 0);
    player.flying = false;
    player.onGround = false;
    player.keys.clear();
    player.pitch = 0;
    player.targetPitch = 0;
  }

  // ---------- 1. 基岩不可破坏 ----------
  {
    const spots = [[0, 84], [40, 40], [-60, -60], [120, 120], [0, -140], [-150, 0], [90, -30]];
    const detail = [];
    for (const [x, z] of spots) {
      // 先把基岩以上清空，否则射线会打到上方地形而不是基岩
      for (let y = BEDROCK_TOP + 1; y < 60; y++) world.set(x, y, z, AIR);
      const before = world.get(x, BEDROCK_TOP, z);
      player.position.set(x + 0.5, BEDROCK_TOP + 2.2, z + 0.5);
      player.velocity.set(0, 0, 0);
      player.flying = true;
      player.onGround = false;
      player.pitch = -1.5;                 // 垂直向下看
      player.targetPitch = -1.5;
      player.yaw = Math.PI;
      player.targetYaw = Math.PI;
      player.update(1 / 60);
      interaction.update();
      const hitId = interaction.hit ? interaction.hit.id : -1;
      const broke = interaction.breakBlock();
      const after = world.get(x, BEDROCK_TOP, z);
      detail.push({
        pos: [x, z], hitId, bedrockId: before, broke, after,
        pass: before === BEDROCK_ID && hitId === BEDROCK_ID && !broke && after === before,
      });
    }
    results.push({
      test: "Bedrock cannot be broken",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // ---------- 2. 基岩不可被放置覆盖 ----------
  {
    const spots = [[0, 84], [40, 40], [-60, -60]];
    const detail = [];
    for (const [x, z] of spots) {
      for (let y = BEDROCK_TOP + 1; y < 60; y++) world.set(x, y, z, AIR);
      const before = world.get(x, BEDROCK_TOP, z);
      player.position.set(x + 0.5, BEDROCK_TOP + 2.2, z + 0.5);
      player.velocity.set(0, 0, 0);
      player.flying = true;
      player.onGround = false;
      player.pitch = -1.5;
      player.targetPitch = -1.5;
      player.update(1 / 60);
      interaction.update();
      interaction.selected = BLOCKS.findIndex((b) => b && b.name === "stone_dark");
      const placed = interaction.placeBlock();
      // 关键断言：基岩本身必须完好（允许放在基岩之上，不允许覆盖它）
      const after = world.get(x, BEDROCK_TOP, z);
      const bedrockIntact = before === BEDROCK_ID && after === BEDROCK_ID;
      // 若放置成功，应落在基岩上方而非替换基岩
      const above = world.get(x, BEDROCK_TOP + 1, z);
      detail.push({
        pos: [x, z], placed, bedrockAfter: after, blockAbove: above,
        pass: bedrockIntact && (!placed || above !== AIR),
      });
      // 清理本用例写入的方块
      for (let y = BEDROCK_TOP + 1; y < 60; y++) world.set(x, y, z, AIR);
    }
    results.push({
      test: "Bedrock cannot be overwritten by placing",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // ---------- 3. 高空自由落体落到基岩顶面，不穿出世界底 ----------
  {
    const spots = [[0, 84], [30, 30], [-100, 20], [140, -140]];
    const detail = [];
    for (const [x, z] of spots) {
      // 先把该列基岩以上的方块全部清空，模拟“被挖穿”的极端情况
      // 记录原状，测完恢复，避免污染后续测试
      const backup = [];
      for (let y = BEDROCK_TOP + 1; y < 160; y++) {
        backup.push([y, world.get(x, y, z)]);
        world.set(x, y, z, AIR);
      }
      reset(x + 0.5, 150, z + 0.5);
      let landed = false;
      let minY = 1e9;
      for (let i = 0; i < 900; i++) {
        player.update(1 / 60);
        if (player.position.y < minY) minY = player.position.y;
        if (player.onGround) { landed = true; break; }
      }
      const ok = landed
        && player.position.y >= BEDROCK_TOP + 1 - 0.05
        && player.position.y <= BEDROCK_TOP + 1 + 0.05;
      detail.push({
        pos: [x, z], finalY: +player.position.y.toFixed(3), minY: +minY.toFixed(2),
        expectedY: BEDROCK_TOP + 1, onGround: player.onGround, pass: ok,
      });
      // 恢复该列
      for (const [y, id] of backup) world.set(x, y, z, id);
    }
    results.push({
      test: "Free-fall onto bedrock, never exits world bottom",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // ---------- 4. 掉到世界底部以下触发重生 ----------
  {
    const detail = [];
    for (const [x, z] of [[0, 84], [50, 50], [-80, 60]]) {
      player.voidRespawns = 0;
      reset(x + 0.5, -30, z + 0.5);   // 直接置于世界底部以下
      player.velocity.set(0, -50, 0);
      let respawned = false;
      for (let i = 0; i < 60; i++) {
        player.update(1 / 60);
        if (player.voidRespawns > 0) { respawned = true; break; }
      }
      // 重生后再跑一段，确认稳定落地
      let settled = false;
      for (let i = 0; i < 300; i++) {
        player.update(1 / 60);
        if (player.onGround) { settled = true; break; }
      }
      const pw = Math.floor(player.position.x), pz = Math.floor(player.position.z);
      const supported = world.solidAt(pw, Math.floor(player.position.y - 0.1), pz);
      const insideSolid = world.solidAt(pw, Math.floor(player.position.y + 0.9), pz);
      detail.push({
        from: [x, z], respawned, settled,
        spawn: [+player.position.x.toFixed(1), +player.position.y.toFixed(1), +player.position.z.toFixed(1)],
        onGround: player.onGround, supported, insideSolid,
        pass: respawned && settled && player.onGround && supported && !insideSolid,
      });
    }
    results.push({
      test: "Void guard respawns to a safe, supported spot",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // ---------- 5. 出生点候选全部有实心支撑 ----------
  {
    const detail = [];
    // 遍历若干候选点，用 findSafeSpawn 求点，再断言下方有支撑、身体不卡方块
    const cands = [[0, 84], [40, 40], [-40, -40], [120, -60], [-120, 90], [80, 80], [-90, -120]];
    for (const [px, pz] of cands) {
      const p = player.findSafeSpawn(world, px, pz);
      const bx = Math.floor(p.x), bz = Math.floor(p.z);
      const belowSolid = world.solidAt(bx, Math.floor(p.y - 0.1), bz);
      const feetFree = !world.solidAt(bx, Math.floor(p.y), bz);
      const headFree = !world.solidAt(bx, Math.floor(p.y + 1.5), bz);
      detail.push({
        prefer: [px, pz], spawn: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
        belowSolid, feetFree, headFree,
        pass: belowSolid && feetFree && headFree,
      });
    }
    results.push({
      test: "Every safe-spawn candidate has solid support",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // ---------- 6. 区块网格必须真的可见（回归：剔除键类型不匹配导致全场景消失） ----------
  {
    const p = P;
    // 先正常刷新一次剔除
    p.chunks.update(player.position, true);
    p.chunks.cull(player.position);

    let total = 0;
    let visible = 0;
    let tris = 0;
    p.chunks.group.children.forEach((m) => {
      total++;
      if (m.visible) visible++;
      if (m.geometry && m.geometry.index) tris += m.geometry.index.count / 3;
    });

    // 玩家脚下必定有区块；可见数必须 > 0 且占总数的大多数
    const ratio = total ? visible / total : 0;
    const pass = total > 0 && visible > 0 && ratio > 0.5 && tris > 10000;

    results.push({
      test: "Chunk meshes are actually visible (cull regression)",
      detail: [{
        totalMeshes: total,
        visibleMeshes: visible,
        visibleRatio: +ratio.toFixed(2),
        trianglesRendered: Math.round(tris),
        pass,
      }],
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
