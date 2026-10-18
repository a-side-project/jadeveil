/**
 * RPG 系统回归测试 —— 生命 / 背包 / 掉落拾取 / 建造消耗 / 火把 / 近战 / 坐骑技能 / 存档。
 *
 * 原则（吸取之前碰撞测试的教训）：
 *   · 走真实路径：真的从高处落下、真的潜水憋气、真的挖方块再走过去捡，而不是直接改数值
 *   · 行为断言：断言具体结果（扣了几点血、背包多了几个、方块 id 是什么），不用「不超过某值」
 *   · 每个用例自己清理现场（世界修改走 edits 还原、背包与血量恢复）
 */
export const RPG_TEST_SOURCE = `
(() => {
  const P = window.__pandaria;
  if (!P) return { error: "window.__pandaria not ready" };
  const { world, player, health, inventory, interaction, drops, torches, combat, mount, edits, dummies, camera } = { ...P, camera: P.renderer.camera };
  const BLOCKS = P.BLOCKS;
  const id = (name) => BLOCKS.findIndex((b) => b && b.name === name);
  const AIR = 0, WATER = id("water");
  const results = [];
  const run = (name, fn) => {
    try {
      const detail = fn();
      results.push({ test: name, detail, pass: !!detail.pass });
    } catch (err) {
      results.push({ test: name, detail: { error: String(err && err.stack || err) }, pass: false });
    }
  };
  const snapshotInv = inventory.serialize();
  const snapshotHp = health.serialize();
  const prevMode = P.state.mode;
  P.state.mode = "test";
  // 建造相关的用例（放置、消耗、火把）属于建造模式
  const prevGameMode = P.game.mode;
  P.setGameMode("build", false);

  function reset(x, y, z) {
    player.position.set(x, y, z);
    player.velocity.set(0, 0, 0);
    player.flying = false;
    player.keys.clear();
    player.safeFall = false;
    player._peakY = y;
    player.onGround = false;
    health.respawn();
    health._invuln = 0;
  }
  function findGround() {
    for (let x = 4; x <= 60; x += 3) for (let z = 40; z <= 80; z += 3) {
      for (let y = 44; y >= 30; y--) {
        const b = world.get(x, y, z);
        if (BLOCKS[b].solid && BLOCKS[b].opaque && world.get(x, y + 1, z) === AIR && world.get(x, y + 2, z) === AIR) {
          let clear = true;
          for (let k = 1; k <= 16; k++) if (world.get(x, y + k, z) !== AIR) { clear = false; break; }
          if (clear) return { x, y, z };
        }
      }
    }
    return null;
  }
  function findDeepWater() {
    for (let x = -70; x <= 70; x += 2) for (let z = -70; z <= 70; z += 2) {
      let top = -1;
      for (let y = 48; y >= 20; y--) if (world.get(x, y, z) === WATER) { top = y; break; }
      if (top < 0 || world.get(x, top + 1, z) !== AIR) continue;
      let b = top;
      while (b > 0 && world.get(x, b - 1, z) === WATER) b--;
      if (top - b >= 3) return { x, z, top, bottom: b };
    }
    return null;
  }
  const step = (n, dt = 1 / 60, extra) => {
    for (let i = 0; i < n; i++) {
      player.update(dt);
      health.update(dt, player);
      if (extra) extra(dt);
    }
  };

  // 1. 摔落伤害：从地面上方 10 格自由落体 → 扣 10 - 3 = 7 点
  run("Fall damage = blocks fallen - 3 (10-block fall costs 7 HP)", () => {
    const g = findGround();
    if (!g) return { pass: false, reason: "no ground" };
    reset(g.x + 0.5, g.y + 1 + 10, g.z + 0.5);
    let i = 0;
    while (!player.onGround && i++ < 600) step(1);
    return { landedY: +player.position.y.toFixed(2), hp: health.hp, expected: 13, pass: player.onGround && health.hp === 13 };
  });

  // 2. 从龙背上被放下：这一次落地不计摔落伤害
  run("Dismount safe-fall: 10-block drop after dismount costs 0 HP", () => {
    const g = findGround();
    reset(g.x + 0.5, g.y + 1 + 10, g.z + 0.5);
    player.safeFall = true;
    let i = 0;
    while (!player.onGround && i++ < 600) step(1);
    return { hp: health.hp, safeFallCleared: player.safeFall === false, pass: health.hp === 20 && player.safeFall === false };
  });

  // 2b. 回归：从高空瞬移（读档 / 重生 / 传送）到地面不算坠落
  run("Teleporting from high altitude to the ground costs 0 HP", () => {
    const g = findGround();
    reset(g.x + 0.5, 140, g.z + 0.5);
    player.flying = true;
    step(5);
    player.flying = false;
    P.teleport(g.x + 0.5, g.y + 1.2, g.z + 0.5);
    let i = 0;
    while (!player.onGround && i++ < 300) step(1);
    return { hp: health.hp, pass: player.onGround && health.hp === 20 };
  });

  // 3. 溺水：按住下潜 13 秒 → 氧气耗尽、开始掉血
  run("Drowning: holding a dive for 13 s empties air and costs HP", () => {
    const w = findDeepWater();
    if (!w) return { pass: false, reason: "no deep water" };
    reset(w.x + 0.5, w.bottom + 0.1, w.z + 0.5);
    player.keys.add("KeyC");
    step(13 * 30, 1 / 30);
    player.keys.clear();
    const r = { air: +health.air.toFixed(2), hp: health.hp, headUnderwater: player.headUnderwater, pass: health.air === 0 && health.hp <= 18 && health.hp >= 12 };
    return r;
  });

  // 4. 背包：堆叠上限、溢出、序列化往返
  run("Inventory stacks to 64, overflows into new slots, survives save round-trip", () => {
    inventory.clear();
    const left = inventory.add("block:oak_planks", 150);
    const stacks = inventory.slots.filter((s) => s && s.id === "block:oak_planks").map((s) => s.count);
    inventory.add("sword_jade", 1);
    const data = JSON.parse(JSON.stringify(inventory.serialize()));
    inventory.clear();
    inventory.load(data);
    const after = inventory.count("block:oak_planks");
    return { left, stacks, afterLoad: after, sword: inventory.count("sword_jade"), pass: left === 0 && stacks.join() === "64,64,22" && after === 150 && inventory.count("sword_jade") === 1 };
  });

  // 5. 挖方块 → 弹出掉落物 → 走过去自动拾取 → 背包 +1
  run("Breaking a block drops an item that is picked up into the inventory", () => {
    const g = findGround();
    inventory.clear();
    reset(g.x + 0.5, g.y + 1, g.z + 0.5);
    const target = { x: g.x + 2, y: g.y, z: g.z };
    const blockId = world.get(target.x, target.y, target.z);
    const dropId = P.dropForBlock(blockId);
    interaction.hit = { ...target, nx: 0, ny: 1, nz: 0, id: blockId, distance: 2 };
    const before = drops.drops.length;
    const broke = interaction.breakBlock();
    const spawned = drops.drops.length - before;
    // 等 0.6 秒让它落地，再走到旁边
    for (let i = 0; i < 36; i++) drops.update(1 / 60, player, inventory);
    player.position.set(target.x + 0.5, target.y + 0.0, target.z + 0.5);
    for (let i = 0; i < 90; i++) drops.update(1 / 60, player, inventory);
    const got = inventory.count(dropId);
    edits.set(target.x, target.y, target.z, blockId);
    interaction.hit = null;
    return { broke, dropId, spawned, picked: got, pass: broke && spawned === 1 && got === 1 };
  });

  // 6. 建造消耗：放一个方块，背包少一个
  run("Placing a block consumes exactly one from the selected stack", () => {
    const g = findGround();
    inventory.clear();
    inventory.add("block:grey_brick", 10);
    inventory.select(0);
    P.events.emit("inventory:select", inventory);
    interaction.creative = false;
    reset(g.x + 0.5, g.y + 1, g.z + 0.5);
    const tx = g.x + 2;
    interaction.hit = { x: tx, y: g.y, z: g.z, nx: 0, ny: 1, nz: 0, id: world.get(tx, g.y, g.z), distance: 2 };
    const ok = interaction.secondary();
    const placed = world.get(tx, g.y + 1, g.z) === id("grey_brick");
    const left = inventory.count("block:grey_brick");
    edits.set(tx, g.y + 1, g.z, AIR);
    interaction.hit = null;
    return { ok, placed, left, pass: ok && placed && left === 9 };
  });

  // 6b. 回归：放下一组里的「最后一块」—— 扣背包会清空选中项，之前会因此放下空气
  run("Placing the LAST block of a stack still places the block (not air)", () => {
    const g = findGround();
    inventory.clear();
    inventory.add("block:cherry_planks", 1);
    inventory.select(0);
    P.events.emit("inventory:select", inventory);
    interaction.creative = false;
    reset(g.x + 0.5, g.y + 1, g.z + 0.5);
    const tx = g.x + 2;
    interaction.hit = { x: tx, y: g.y, z: g.z, nx: 0, ny: 1, nz: 0, id: world.get(tx, g.y, g.z), distance: 2 };
    const ok = interaction.secondary();
    const got = BLOCKS[world.get(tx, g.y + 1, g.z)].name;
    const left = inventory.count("block:cherry_planks");
    edits.set(tx, g.y + 1, g.z, AIR);
    interaction.hit = null;
    return { ok, placedBlock: got, left, pass: ok && got === "cherry_planks" && left === 0 };
  });

  // 6c. 手持武器时右键不会放方块，也不会扣掉武器
  run("Right-click while holding a sword places nothing and keeps the sword", () => {
    const g = findGround();
    inventory.clear();
    inventory.add("sword_jade", 1);
    inventory.select(0);
    P.events.emit("inventory:select", inventory);
    interaction.selected = id("stone_bricks"); // 即使残留了可放置方块 id 也不能放
    reset(g.x + 0.5, g.y + 1, g.z + 0.5);
    const tx = g.x + 2;
    interaction.hit = { x: tx, y: g.y, z: g.z, nx: 0, ny: 1, nz: 0, id: world.get(tx, g.y, g.z), distance: 2 };
    const ok = interaction.secondary();
    const above = world.get(tx, g.y + 1, g.z);
    interaction.hit = null;
    return { ok, above, sword: inventory.count("sword_jade"), pass: ok === false && above === AIR && inventory.count("sword_jade") === 1 };
  });

  // 7. 火把：顶面插地面火把、侧面插墙面火把；挖掉支撑方块火把掉落
  run("Torches: floor + wall placement, and a torch drops when its support is removed", () => {
    const g = findGround();
    inventory.clear();
    inventory.add("torch", 5);
    inventory.select(0);
    P.events.emit("inventory:select", inventory);
    reset(g.x + 0.5, g.y + 1, g.z + 0.5);
    const sx = g.x + 3;
    // 先放一块支撑石，再在它顶上 / 侧面插火把
    edits.set(sx, g.y + 1, g.z, id("stone_bricks"));
    interaction.hit = { x: sx, y: g.y + 1, z: g.z, nx: 0, ny: 1, nz: 0, id: id("stone_bricks"), distance: 3 };
    const floorOk = interaction.secondary();
    const floorId = world.get(sx, g.y + 2, g.z);
    interaction.hit = { x: sx, y: g.y + 1, z: g.z, nx: -1, ny: 0, nz: 0, id: id("stone_bricks"), distance: 3 };
    const wallOk = interaction.secondary();
    const wallId = world.get(sx - 1, g.y + 1, g.z);
    const tracked = torches.map.size;
    const torchesBefore = drops.drops.filter((d) => d.id === "torch").length;
    // 挖掉支撑
    edits.set(sx, g.y + 1, g.z, AIR);
    const floorGone = world.get(sx, g.y + 2, g.z) === AIR;
    const wallGone = world.get(sx - 1, g.y + 1, g.z) === AIR;
    const dropped = drops.drops.filter((d) => d.id === "torch").length - torchesBefore;
    interaction.hit = null;
    return {
      floorOk, floorBlock: BLOCKS[floorId].name, wallOk, wallBlock: BLOCKS[wallId].name, tracked,
      floorGone, wallGone, dropped, torchesLeft: inventory.count("torch"),
      pass: floorOk && BLOCKS[floorId].name === "torch" && wallOk && BLOCKS[wallId].name === "torch_wall_e" &&
        floorGone && wallGone && dropped === 2 && inventory.count("torch") === 3,
    };
  });

  // 8. 近战：对准训练假人挥玉剑 → 扣 9 点；冷却内连砍只有 25%
  run("Melee: jade blade deals 9 to a training dummy, 25% while on cooldown", () => {
    const d = dummies[0];
    if (!d) return { pass: false, reason: "no dummy" };
    d.hp = d.maxHp; d.alive = true;
    inventory.clear();
    inventory.add("sword_jade", 1);
    inventory.select(0);
    P.events.emit("inventory:select", inventory);
    reset(d.pos.x, d.pos.y, d.pos.z + 2.4);
    player.onGround = true;
    camera.position.set(d.pos.x, d.pos.y + 1.6, d.pos.z + 2.4);
    camera.lookAt(d.pos.x, d.pos.y + 1.1, d.pos.z);
    camera.updateMatrixWorld(true);
    interaction.hit = null;
    interaction._attackCd = 0;
    interaction.primary();
    const after1 = d.hp;
    interaction.hit = null;
    interaction.primary();
    const after2 = d.hp;
    const r = { first: d.maxHp - after1, second: +(after1 - after2).toFixed(2), pass: d.maxHp - after1 === 9 && Math.abs(after1 - after2 - 2.25) < 1e-6 };
    d.hp = d.maxHp;
    return r;
  });

  // 9. 坐骑：召唤 → 碰撞体变成龙的尺寸；火球命中假人有范围伤害；下龙后恢复并置 safeFall
  run("Ender dragon: summon swaps collider, fireball damages a dummy, dismount restores player", () => {
    const d = dummies[1] || dummies[0];
    d.hp = d.maxHp; d.alive = true;
    reset(d.pos.x, d.pos.y + 6, d.pos.z + 12);
    const ok = mount.summon();
    const hw = player.hw, bh = player.bh, flying = player.flying;
    mount.energy = 100;
    mount.cooldowns.fireball = 0;
    camera.position.set(d.pos.x, d.pos.y + 6 + 3.1, d.pos.z + 12);
    camera.lookAt(d.pos.x, d.pos.y + 1, d.pos.z);
    camera.updateMatrixWorld(true);
    // 让模型先落位（嘴的位置依赖模型姿态）
    mount.update(1 / 60);
    const fired = mount.useSkill("fireball");
    for (let i = 0; i < 90; i++) { mount.update(1 / 60); combat.update(1 / 60); }
    const dmg = d.maxHp - d.hp;
    mount.dismiss();
    const r = {
      summoned: ok, hw, bh, flying, fired, fireballDamage: +dmg.toFixed(1),
      afterHw: player.hw, afterBh: player.bh, safeFall: player.safeFall,
      pass: ok && hw === 1.1 && bh === 3.0 && flying && fired && dmg > 8 && player.hw === 0.32 && player.bh === 1.78 && player.safeFall === true,
    };
    player.safeFall = false;
    d.hp = d.maxHp;
    combat.zones.length = 0;
    return r;
  });

  // 10. 存档：世界差量按「方块名 + 调色板」序列化，重放后方块回来；整个存档体积是 KB 级
  run("Save: world edits replay by block name, full save is a few KB", () => {
    const g = findGround();
    const x = g.x + 4, y = g.y + 1, z = g.z;
    edits.set(x, y, z, id("jade_floor"));
    const ser = JSON.parse(JSON.stringify(edits.serialize()));
    world.set(x, y, z, AIR); // 模拟「干净的新世界」
    const before = world.get(x, y, z);
    edits.load(ser);
    const after = world.get(x, y, z);
    const size = JSON.stringify(P.save.collect()).length;
    edits.set(x, y, z, AIR);
    return { before, after: BLOCKS[after].name, bytes: size, pass: before === AIR && BLOCKS[after].name === "jade_floor" && size < 60000 };
  });

  // 还原
  inventory.load(snapshotInv);
  health.load(snapshotHp);
  health.dead = false;
  P.state.mode = prevMode;
  P.setGameMode(prevGameMode, false);
  interaction.hit = null;
  player.keys.clear();
  player.spawnAt(world);

  const failed = results.filter((r) => !r.pass);
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
})()
`;
