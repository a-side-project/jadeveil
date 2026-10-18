/**
 * 世界与技能回归测试 —— 水流 / 沙落 / 花草倒伏 / 火球炸坑 / 龙息烧草 / 人物技能 / 冒险与建造模式 / 触屏按钮可点。
 *
 * 同样走真实路径：真的挖掉堤坝看水怎么流、真的放火球、真的拿玉剑砍木桩 20 次学技能，
 * 断言具体结果（第 d 格的水等级是 d、坑里有几格空气、假人掉了多少血）。
 */
export const WORLD_TEST_SOURCE = `
(async () => {
  const P = window.__pandaria;
  if (!P) return { error: "window.__pandaria not ready" };
  const { world, edits, physics, destruction, skills, player, health, combat, dummies } = P;
  const BLOCKS = P.BLOCKS;
  const id = (name) => BLOCKS.findIndex((b) => b && b.name === name);
  const AIR = 0, WATER = id("water"), STONE = id("stone_bricks"), SAND = id("sand"), FLOWER = id("flower_red"), LEAF = id("pine_leaf"), BEDROCK = id("bedrock");
  const lvl = (b) => (BLOCKS[b] && BLOCKS[b].liquid ? BLOCKS[b].flow : -1);
  const results = [];
  const run = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ test: name, detail, pass: !!detail.pass });
    } catch (err) {
      results.push({ test: name, detail: { error: String(err && err.stack || err) }, pass: false });
    }
  };
  const settle = (max = 80) => { let n = 0; while (!physics.idle && n++ < max) physics.tick(); return n; };

  function findSky() {
    for (let x = 120; x >= 40; x -= 8) for (let z = 120; z >= 40; z -= 8) {
      if (!world.hasChunk(x >> 4, z >> 4)) continue;
      let clear = true;
      for (let dx = -10; dx <= 10 && clear; dx++) for (let dz = -10; dz <= 10 && clear; dz++)
        for (let y = 112; y <= 140; y++) if (world.get(x + dx, y, z + dz) !== AIR) { clear = false; break; }
      if (clear) return { x, y: 126, z };
    }
    return null;
  }
  // 记录测试期间每一格的「原始状态」（第一次被改之前的方块与存档差量），结束时原样还原 ——
  // 水流、沙落、爆炸会波及测试没有直接碰过的格子（瀑布可以一路流到下面的地面）
  const original = new Map();
  const unhook = P.events.on("world:edit", ({ x, y, z, prev }) => {
    const k = x + "," + y + "," + z;
    if (!original.has(k)) original.set(k, { prev, edit: edits.edits.has(k) ? edits.edits.get(k) : undefined });
  });
  const touched = new Set();
  const put = (x, y, z, b) => { touched.add(x + "," + y + "," + z); edits.set(x, y, z, b); };
  const cleanup = () => {
    physics.pending.clear();
    const L = world.lighting;
    L.suspended = true;
    for (const [k, o] of original) {
      const [x, y, z] = k.split(",").map(Number);
      world.set(x, y, z, o.prev);
      if (o.edit === undefined) edits.edits.delete(k); else edits.edits.set(k, o.edit);
    }
    L.suspended = false;
    if (original.size) { L.computeAll(); world.markAllDirty(); }
    original.clear();
    physics.pending.clear();
    touched.clear();
  };
  const site = findSky();
  const prevTerrain = destruction.enabled;
  destruction.enabled = true;

  // 1. 水沿平地铺开：离水源第 d 格的等级正好是 d，7 格以外没有水
  await run("Water spreads one level per block and stops after 7", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    for (let dx = 0; dx <= 10; dx++) for (let dz = -1; dz <= 1; dz++) put(x + dx, y, z + dz, STONE);
    for (let dx = 0; dx <= 10; dx++) { put(x + dx, y + 1, z - 1, STONE); put(x + dx, y + 1, z + 1, STONE); }
    put(x, y + 1, z, WATER);
    const ticks = settle();
    const levels = [];
    for (let dx = 0; dx <= 9; dx++) levels.push(lvl(world.get(x + dx, y + 1, z)));
    cleanup();
    const pass = levels.slice(0, 8).every((v, d) => v === d) && levels[8] === -1 && levels[9] === -1;
    return { levels, ticks, pass };
  });

  // 2. 挖开堤坝：水从缺口灌下去、在下面铺开
  await run("Breaking a dam lets water pour down and spread below", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) put(x + dx, y, z + dz, STONE); // 下层地面
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(x + dx, y + 3, z + dz + 5, STONE); // 上层平台
    put(x, y + 4, z + 5, WATER); // 平台上的水源
    put(x, y + 4, z + 4, STONE); // 堤坝
    settle();
    const before = lvl(world.get(x, y + 4, z + 4));
    edits.set(x, y + 4, z + 4, AIR); // 挖掉堤坝
    settle();
    const edge = lvl(world.get(x, y + 4, z + 4));
    const fall = [lvl(world.get(x, y + 3, z + 3)), lvl(world.get(x, y + 2, z + 3)), lvl(world.get(x, y + 1, z + 3))];
    const pool = lvl(world.get(x, y + 1, z + 1));
    cleanup();
    const pass = before === -1 && edge === 1 && fall.every((v) => v === 1) && pool >= 2 && pool <= 4;
    return { before, edge, fall, pool, pass };
  });

  // 3. 拿走水源：流动的水逐刻干涸，不留积水
  await run("Removing the source dries up all flowing water", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) put(x + dx, y, z + dz, STONE);
    put(x, y + 1, z, WATER);
    settle();
    let wet = 0;
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) if (lvl(world.get(x + dx, y + 1, z + dz)) >= 0) wet++;
    edits.set(x, y + 1, z, AIR);
    const ticks = settle(200);
    let left = 0;
    for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) if (lvl(world.get(x + dx, y + 1, z + dz)) >= 0) left++;
    cleanup();
    return { wetBefore: wet, leftAfter: left, ticks, pass: wet > 50 && left === 0 };
  });

  // 4. 无限水源：两个水源之间的空格变成新的水源
  await run("Two sources make an infinite source between them", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    for (let dx = -1; dx <= 3; dx++) for (let dz = -1; dz <= 1; dz++) { put(x + dx, y, z + dz, STONE); if (dz) put(x + dx, y + 1, z + dz, STONE); }
    put(x - 1, y + 1, z, STONE); put(x + 3, y + 1, z, STONE);
    put(x, y + 1, z, WATER); put(x + 2, y + 1, z, WATER);
    settle();
    const mid = lvl(world.get(x + 1, y + 1, z));
    cleanup();
    return { middleLevel: mid, pass: mid === 0 };
  });

  // 5. 沙：下面挖空就掉下去，落在最近的实心方块上
  await run("Sand falls to the next solid block when undermined", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    put(x, y, z, STONE);
    put(x, y + 4, z, STONE);
    put(x, y + 5, z, SAND);
    settle();
    const held = world.get(x, y + 5, z) === SAND;
    edits.set(x, y + 4, z, AIR);
    settle();
    const landed = world.get(x, y + 1, z) === SAND && world.get(x, y + 5, z) === AIR;
    touched.add(x + "," + (y + 1) + "," + z);
    cleanup();
    return { heldWhileSupported: held, landedOnFloor: landed, pass: held && landed };
  });

  // 6. 花：脚下的方块被挖掉就倒，掉落成物品
  await run("A flower pops off and drops when its ground is removed", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    put(x, y - 3, z, STONE);
    put(x, y, z, STONE);
    put(x, y + 1, z, FLOWER);
    const d0 = P.drops.drops.length;
    edits.set(x, y, z, AIR);
    settle();
    const gone = world.get(x, y + 1, z) === AIR;
    const dropped = P.drops.drops.length - d0;
    cleanup();
    while (P.drops.drops.length > d0) P.drops._remove(P.drops.drops.length - 1);
    return { gone, dropped, pass: gone && dropped === 1 };
  });

  // 7. 火球炸坑：实心块被炸开、基岩不受影响、坑底被天光照亮
  await run("Fireball explosion carves a lit crater but never bedrock", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 0; dy++) for (let dz = -4; dz <= 4; dz++) put(x + dx, y + dy, z + dz, dy === -4 ? BEDROCK : STONE);
    const d0 = P.drops.drops.length;
    const n = destruction.explode({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 2.6);
    const centerAir = world.get(x, y, z) === AIR && world.get(x, y - 1, z) === AIR;
    let bedrock = 0;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) if (world.get(x + dx, y - 4, z + dz) === BEDROCK) bedrock++;
    const sky = world.lighting.sky(x, y - 1, z);
    cleanup();
    while (P.drops.drops.length > d0) P.drops._remove(P.drops.drops.length - 1);
    return { destroyed: n, centerAir, bedrockLeft: bedrock, craterSkyLight: sky, pass: n >= 25 && n <= 110 && centerAir && bedrock === 81 && sky >= 13 };
  });

  // 8. 龙息：烧掉树叶和花，石头不受影响
  await run("Dragon breath burns leaves and flowers but not stone", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    put(x, y, z, LEAF); put(x + 1, y, z, STONE); put(x, y + 1, z, FLOWER);
    const n = destruction.burn({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 1.8);
    const r = { leaf: world.get(x, y, z) === AIR, flower: world.get(x, y + 1, z) === AIR, stone: world.get(x + 1, y, z) === STONE };
    cleanup();
    return { burned: n, ...r, pass: r.leaf && r.flower && r.stone };
  });

  // 9. 关闭地形破坏后火球不再炸坑
  await run("TERRAIN DAMAGE off: explosions leave the terrain intact", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    put(x, y, z, STONE);
    destruction.enabled = false;
    const n = destruction.explode({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 2.6);
    destruction.enabled = true;
    const intact = world.get(x, y, z) === STONE;
    cleanup();
    return { destroyed: n, intact, pass: n === 0 && intact };
  });

  // 准备木桩：站到第一个假人面前
  const dummy = dummies[0];
  const faceDummy = () => {
    const d = dummy.pos;
    player.position.set(d.x, d.y, d.z + 2.2);
    player.velocity.set(0, 0, 0);
    player.yaw = player.targetYaw = 0; // 面朝 -Z
    player.pitch = player.targetPitch = -0.15;
    player.onGround = true;
    player.flying = false;
    player.mode = "first";
    player.updateCamera(0.016);
    P.renderer.camera.updateMatrixWorld();
  };
  const resetDummy = () => { dummy.alive = true; dummy.hp = dummy.maxHp; dummy._down = 0; };
  const cool = () => { for (const k in skills.cooldowns) skills.cooldowns[k] = 0; };

  // 10. 三段连斩：第三刀伤害更高；冷却未到不出刀
  await run("JADE SLASH: 3-hit combo, third hit is the heavy one, cooldown gates it", () => {
    faceDummy(); resetDummy(); cool();
    const dmg = [];
    for (let i = 0; i < 3; i++) {
      const hp = dummy.hp;
      skills.cooldowns.slash = 0;
      skills.use("slash");
      dmg.push(+(hp - dummy.hp).toFixed(2));
    }
    const hp = dummy.hp;
    const blocked = skills.use("slash") === false && dummy.hp === hp; // 冷却中
    resetDummy();
    return { dmg, blockedByCooldown: blocked, pass: dmg[0] === 7 && dmg[1] === 7 && dmg[2] === 12 && blocked };
  });

  // 11. 学技能：用玉剑命中 20 次后学会 JADE CRESCENT
  await run("JADE CRESCENT is learned after 20 blade hits", () => {
    faceDummy(); resetDummy(); cool();
    const keep = skills.serialize();
    skills.learned.delete("crescent"); skills.practice = 0;
    const lockedFirst = skills.use("crescent") === false;
    for (let i = 0; i < 20; i++) { skills.cooldowns.slash = 0; skills._comboT = 0; resetDummy(); skills.use("slash"); }
    const learned = skills.learned.has("crescent");
    cool();
    const fired = skills.use("crescent");
    skills.load(keep);
    skills.projectiles.length = 0;
    resetDummy();
    return { lockedFirst, practice: Math.min(20, skills.practice), learned, fired, pass: lockedFirst && learned && fired };
  });

  // 12. 突刺：真的往前冲出 5 格以上
  await run("JADE LUNGE dashes forward at least 5 blocks", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    for (let dz = -12; dz <= 2; dz++) for (let dx = -1; dx <= 1; dx++) put(x + dx, y, z + dz, STONE);
    player.position.set(x + 0.5, y + 1, z + 0.5);
    player.velocity.set(0, 0, 0); player.onGround = true; player.flying = false;
    player.yaw = player.targetYaw = 0;
    cool();
    const z0 = player.position.z;
    skills.use("lunge");
    for (let i = 0; i < 60; i++) { skills.update(1 / 60); player.update(1 / 60); }
    const moved = z0 - player.position.z;
    cleanup();
    return { moved: +moved.toFixed(2), pass: moved > 5 && moved < 9 };
  });

  // 13. 玉愈：4 秒回 8 点；闪避：期间免疫伤害
  await run("JADE MEND heals 8 over 4 s; EVADE grants i-frames", () => {
    cool();
    health.hp = 6; health._invuln = 0;
    skills.use("mend");
    for (let i = 0; i < 260; i++) skills.update(1 / 60);
    const healed = health.hp - 6;
    health._invuln = 0;
    skills.use("evade");
    const taken = health.damage(5, "test");
    health.respawn(); health._invuln = 0;
    return { healed, damageDuringEvade: taken, pass: healed === 8 && taken === 0 };
  });

  // 14. 模式：冒险模式左键不挖方块；建造模式可以
  await run("Adventure mode never breaks blocks; build mode does", async () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    put(x, y, z - 2, STONE);
    player.position.set(x + 0.5, y + 0, z + 0.5);
    player.yaw = player.targetYaw = 0; player.pitch = player.targetPitch = -0.35;
    player.mode = "first"; player.updateCamera(0.016); P.renderer.camera.updateMatrixWorld();
    const prev = P.game.mode, prevState = P.state.mode;
    // 直接推进一帧（主循环每帧按模式决定能不能挖）：不靠 setTimeout 等浏览器跑帧 —— 帧率低时 150ms 内可能一帧都没跑
    const frame = async () => P.tick(1 / 60, { render: false });
    P.state.mode = "play";
    P.setGameMode("adventure", false);
    await frame();
    const enabledAdv = P.interaction.enabled === false;
    P.setGameMode("build", false);
    await frame();
    const enabledBuild = P.interaction.enabled === true;
    P.interaction.hit = null;
    const broke = P.interaction.primary();
    const gone = world.get(x, y, z - 2) === AIR;
    P.setGameMode(prev, false);
    P.state.mode = prevState;
    cleanup();
    return { adventureDisablesBreak: enabledAdv, buildEnablesBreak: enabledBuild, buildBroke: !!broke && gone, pass: enabledAdv && enabledBuild && !!broke && gone };
  });

  destruction.enabled = prevTerrain;
  cleanup();
  unhook();
  player.spawnAt(world);
  const failed = results.filter((r) => !r.pass);
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
})()
`;
