/**
 * 交互 / 化身质量回归测试。
 *
 * 覆盖用户点名的两处体验缺陷：
 *   1. V 切到第三人称（全身）时，第一人称的游泳手臂仍悬在屏幕上
 *   2. 对着脚下放方块，Minecraft 行为应把玩家顶到新方块上（自建台阶爬升）
 * 以及保持原有约束：往身体/头部放方块依旧要拒绝。
 */
export const QUALITY_TEST_SOURCE = `
(() => {
  const P = window.__pandaria;
  if (!P) return { error: "window.__pandaria not ready" };
  const { world, player, avatar, interaction } = P;
  const BLOCKS = P.BLOCKS;
  const AIR = 0;
  const WATER_ID = BLOCKS.findIndex((b) => b && b.name === "water");
  const GRASS_ID = BLOCKS.findIndex((b) => b && b.name === "grass");
  const results = [];

  function place(x, y, z) {
    player.position.set(x, y, z);
    player.velocity.set(0, 0, 0);
    player.flying = false;
    player.onGround = true;
    player.keys.clear();
    player.pitch = 0;
    player.targetPitch = 0;
  }

  function stepAvatar(dt) {
    avatar.placeTo(player.position);
    avatar.update(dt, {
      swimming: player.swimming,
      submersion: player.submersion,
      onGround: player.onGround,
      speed: Math.hypot(player.velocity.x, player.velocity.z),
      sprinting: player.sprinting,
      flying: player.flying,
      yaw: player.yaw,
    });
  }

  function findGround() {
    for (let x = -60; x <= 60; x += 2) {
      for (let z = -60; z <= 60; z += 2) {
        for (let y = 44; y >= 26; y--) {
          const b = world.get(x, y, z);
          if (b !== AIR && b !== WATER_ID &&
              world.get(x, y + 1, z) === AIR && world.get(x, y + 2, z) === AIR) {
            return { x: x, y: y, z: z };
          }
        }
      }
    }
    return null;
  }

  function findWater() {
    for (let x = -70; x <= 70; x += 2) {
      for (let z = -70; z <= 70; z += 2) {
        let top = -1;
        for (let y = 48; y >= 26; y--) {
          if (world.get(x, y, z) === WATER_ID) { top = y; break; }
        }
        if (top < 0) continue;
        if (world.get(x, top + 1, z) !== AIR) continue;
        let b = top;
        while (b > 0 && world.get(x, b - 1, z) === WATER_ID) b--;
        const under = world.get(x, b - 1, z);
        if (under === AIR || under === WATER_ID) continue;
        if (top - b < 2) continue;
        return { x: x, z: z, top: top, surface: top + 1 };
      }
    }
    return null;
  }

  // ---------- 1. 第三人称游泳时，第一人称手臂必须隐藏 ----------
  {
    const w = findWater();
    const detail = [];
    if (!w) {
      detail.push({ pass: false, reason: "no water column found" });
    } else {
      place(w.x + 0.5, w.surface - 1.2, w.z + 0.5);
      for (let i = 0; i < 240; i++) player.update(1 / 60);
      const swimming = player.swimming;

      avatar.setMode("third");
      for (let i = 0; i < 240; i++) stepAvatar(1 / 60);
      const thirdVisible = avatar.viewArms.visible;

      avatar.setMode("first");
      for (let i = 0; i < 60; i++) stepAvatar(1 / 60);
      const firstVisible = avatar.viewArms.visible;

      detail.push({
        swimming,
        thirdPersonArmsVisible: thirdVisible,
        firstPersonArmsVisible: firstVisible,
        pass: swimming === true && thirdVisible === false && firstVisible === true,
      });
    }
    results.push({
      test: "First-person arms hidden in third person while swimming",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // ---------- 2. 往脚下一格放方块 → 玩家被顶起 ----------
  {
    const g = findGround();
    const detail = [];
    if (!g) {
      detail.push({ pass: false, reason: "no ground column found" });
    } else {
      interaction.selected = GRASS_ID;
      place(g.x + 0.5, g.y + 1, g.z + 0.5); // 站在 g.y 上，脚在 g.y+1
      interaction.hit = { x: g.x, y: g.y, z: g.z, nx: 0, ny: 1, nz: 0, id: world.get(g.x, g.y, g.z) };
      const before = player.position.y;
      const placed = interaction.placeBlock();
      const after = player.position.y;
      const blockAt = world.get(g.x, g.y + 1, g.z);

      detail.push({
        before: before,
        after: after,
        placed: placed,
        lifted: after - before,
        blockPlacedAtFeet: blockAt === GRASS_ID,
        pass: placed === true && after === g.y + 2 && blockAt === GRASS_ID,
      });

      // 清理：恢复原地形
      world.set(g.x, g.y + 1, g.z, AIR);
      interaction.hit = null;
    }
    results.push({
      test: "Placing a block at the feet lifts the player onto it",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // ---------- 3. 身体/头部位置放方块仍被拒绝 ----------
  {
    const g = findGround();
    const detail = [];
    if (!g) {
      detail.push({ pass: false, reason: "no ground column found" });
    } else {
      interaction.selected = GRASS_ID;
      place(g.x + 0.5, g.y + 1, g.z + 0.5);
      // 放到「脚上一格」（躯干高度），应被拒绝
      interaction.hit = { x: g.x, y: g.y + 1, z: g.z, nx: 0, ny: 1, nz: 0, id: AIR };
      const placed = interaction.placeBlock();
      const blockAt = world.get(g.x, g.y + 2, g.z);
      detail.push({
        placed: placed,
        blockAtBodyStillAir: blockAt === AIR,
        pass: placed === false && blockAt === AIR,
      });
      interaction.hit = null;
    }
    results.push({
      test: "Placing a block into the body (not feet) is still rejected",
      detail,
      pass: detail.every((d) => d.pass),
    });
  }

  // 还原
  interaction.hit = null;
  avatar.setMode("first");

  const failed = results.filter((r) => !r.pass);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
})()
`;
