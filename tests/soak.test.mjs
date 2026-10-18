/**
 * 长时间随机操作测试（soak）—— 用一个固定种子的「随机玩家」把游戏一帧一帧跑上几千帧：
 * 乱按移动 / 跳 / 疾跑 / 蹲、乱放技能、切模式、召龙下龙、放龙技能、开关背包、暂停又继续，
 * 每一帧检查一组不变量。任何一条被打破就记下第一次出现的帧号与现场。
 *
 *   finite      玩家位置、速度、朝向都是有限数（没有 NaN / Infinity）
 *   no-solid    玩家碰撞体不在实心方块里（含骑龙时的龙身）
 *   mount-dry   骑着龙时，龙身不在水里（坐骑的地形规则）
 *   pause-still 暂停 / 设置打开时，玩家与居民一动不动、时间不走
 *   hp-range    生命值在 0..20 之间；没死的时候 > 0
 *   state       游戏状态永远是已知的状态之一
 *   npc-wall    居民的身体不在墙里（每 60 帧抽查一次）
 *   no-errors   全程没有未捕获的异常
 *
 * 跑完把世界、背包、生命、模式全部还原（由 runSuite 统一还原世界差量）。
 */
export const SOAK_TEST_SOURCE = `
(async () => {
  const P = window.__pandaria;
  if (!P) return { error: "window.__pandaria not ready" };
  const { player, mount, skills, health, inventory, npcs, world, state } = P;
  const BLOCKS = P.BLOCKS;
  const FRAMES = Number(window.__soakFrames || 4200);
  const DT = 1 / 60;

  // 固定种子的伪随机数（mulberry32）：每次跑的操作序列完全一样，失败可复现
  let seed = 0x5eed1234;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[(rnd() * a.length) | 0];

  const keep = { inv: inventory.serialize(), hp: health.serialize(), mode: P.game.mode, skills: skills.serialize(), time: P.daynight.time, playing: P.daynight.playing, cam: player.mode };
  const errors0 = P.app.errors.length;
  const KNOWN = new Set(["title", "play", "paused", "inventory", "settings", "dead", "test"]);
  const violations = {};
  const fail = (rule, frame, detail) => { if (!violations[rule]) violations[rule] = { frame, detail }; };
  const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  const liquidAt = (x, y, z) => { const b = BLOCKS[world.get(Math.floor(x), Math.floor(y), Math.floor(z))]; return !!(b && b.liquid); };
  const bodyInLiquid = () => {
    const p = player.position, hw = player.hw;
    for (const dx of [-hw, hw]) for (const dz of [-hw, hw]) for (const dy of [0.1, player.bh * 0.5]) if (liquidAt(p.x + dx, p.y + dy, p.z + dz)) return true;
    return false;
  };

  // 从出生点开始，白天
  player.spawnAt(world);
  P.setTime(600);
  P.state.mode = "play";
  player.touchEngaged = true; // 自动化里拿不到指针锁定：用触屏的「正在操控」代替
  P.setGameMode("adventure", false);
  inventory.clear();
  for (const [id, n] of [["sword_jade", 1], ["torch", 64], ["block:stone_bricks", 64]]) inventory.add(id, n);

  const MOVE = ["KeyW", "KeyA", "KeyS", "KeyD"];
  let pausedAt = null, pauseFrames = 0;
  P.game.manualClock = true;
  try {
  const npcSnap = () => npcs.agents.slice(0, 20).map((a) => a.pos.x + "," + a.pos.z).join("|");

  for (let f = 0; f < FRAMES; f++) {
    // ---- 随机玩家：每 6 帧做一次决定 ----
    if (f % 6 === 0 && P.state.mode === "play") {
      const r = rnd();
      if (r < 0.30) { const k = pick(MOVE); player.keys.has(k) ? player.keys.delete(k) : player.keys.add(k); }
      else if (r < 0.36) player.keys.add("Space");
      else if (r < 0.40) player.keys.delete("Space");
      else if (r < 0.43) player.keys.has("ShiftLeft") ? player.keys.delete("ShiftLeft") : player.keys.add("ShiftLeft");
      else if (r < 0.46) player.keys.has("KeyC") ? player.keys.delete("KeyC") : player.keys.add("KeyC");
      else if (r < 0.56) { player.targetYaw += (rnd() - 0.5) * 2; player.targetPitch = Math.max(-1.2, Math.min(1.2, player.targetPitch + (rnd() - 0.5))); }
      else if (r < 0.66) { if (!mount.active) skills.use(pick(["slash", "slash", "lunge", "whirl", "mend", "evade", "crescent"])); }
      else if (r < 0.69) { if (!health.dead) mount.toggle(); }
      else if (r < 0.74) { if (mount.active) { const s = pick(["fireball", "dash", "roar", "breath"]); s === "breath" ? mount.setBreath(rnd() < 0.5) : mount.useSkill(s); } }
      else if (r < 0.76) { if (!mount.active) P.setGameMode(P.game.mode === "build" ? "adventure" : "build", false); }
      else if (r < 0.78) { if (P.game.mode === "build" && P.interaction.enabled) (rnd() < 0.5 ? P.interaction.primary() : P.interaction.secondary()); }
      else if (r < 0.79) { P.pauseGame(); pausedAt = { pos: player.position.clone(), npc: npcSnap(), time: P.daynight.time }; pauseFrames = 30 + ((rnd() * 60) | 0); }
      else if (r < 0.80) { P.openInventory(); }
    }
    // 暂停 / 背包一段时间后回到游戏
    if (P.state.mode === "paused" && --pauseFrames <= 0) { P.menus.hidePause(); P.state.mode = "play"; pausedAt = null; }
    if (P.state.mode === "inventory" && rnd() < 0.05) { P.invUI.hide(); P.state.mode = "play"; }
    if (P.state.mode === "dead") { player.respawn(); health.respawn(); P.state.mode = "play"; }

    P.tick(DT, { render: false });
    // 每 30 帧让出一次主线程（页面保持响应；时钟由本测试独占，不受影响）
    if (f % 30 === 29) await new Promise((r) => setTimeout(r, 0));

    // ---- 不变量 ----
    if (!KNOWN.has(P.state.mode)) fail("state", f, P.state.mode);
    if (!finite(player.position) || !finite(player.velocity) || !Number.isFinite(player.yaw) || !Number.isFinite(player.pitch)) fail("finite", f, player.position.toArray());
    if (player.collides(player.position.x, player.position.y, player.position.z)) fail("no-solid", f, { pos: player.position.toArray().map((n) => +n.toFixed(2)), mounted: mount.active, crouch: player.crouching });
    if (mount.active && bodyInLiquid()) fail("mount-dry", f, player.position.toArray().map((n) => +n.toFixed(2)));
    if (pausedAt && P.state.mode === "paused") {
      if (player.position.distanceTo(pausedAt.pos) > 1e-6 || npcSnap() !== pausedAt.npc || P.daynight.time !== pausedAt.time) fail("pause-still", f, { moved: +player.position.distanceTo(pausedAt.pos).toFixed(4) });
    }
    if (!(health.hp >= 0 && health.hp <= 20) || (!health.dead && health.hp <= 0)) fail("hp-range", f, health.hp);
    if (f % 60 === 0 && npcs.stats().inWall > 0) fail("npc-wall", f, npcs.stats().inWall);
    if (P.app.errors.length > errors0) fail("no-errors", f, P.app.errors.slice(errors0, errors0 + 3));
  }

  } catch (e) {
    fail("no-errors", -1, String(e && e.stack || e).slice(0, 400));
  } finally {
    P.game.manualClock = false;
  }

  // ---- 还原 ----
  if (mount.active) mount.dismiss();
  player.keys.clear();
  player.touchEngaged = false;
  P.menus.hidePause();
  P.invUI.hide();
  skills.cancel();
  inventory.load(keep.inv);
  health.load(keep.hp);
  skills.learned = new Set(keep.skills.learned); skills.practice = keep.skills.practice;
  P.setGameMode(keep.mode, false);
  P.daynight.time = keep.time; P.daynight.playing = keep.playing;
  player.mode = keep.cam;
  player.spawnAt(world);

  const rules = ["finite", "no-solid", "mount-dry", "pause-still", "hp-range", "state", "npc-wall", "no-errors"];
  const results = rules.map((r) => ({ test: "soak: " + r, detail: violations[r] || { ok: true, frames: FRAMES }, pass: !violations[r] }));
  const failed = results.filter((r) => !r.pass);
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
})()
`;
