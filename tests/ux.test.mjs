/**
 * 基础体验回归测试 —— 光照 / 阴影 / 画质 / 蹲下与疾跑 / 触屏移动 / 设置窗口与指针状态机 / 自动降档。
 *
 * 原则同 rpg.test.mjs：走真实路径（真的放灯笼、真的砌墙、真的按住 C 走到边缘），
 * 断言具体结果；每个用例自己清理现场（世界修改还原、设置恢复原值）。
 */
export const UX_TEST_SOURCE = `
(async () => {
  const P = window.__pandaria;
  if (!P) return { error: "window.__pandaria not ready" };
  const { world, player, edits, renderer, chunks, graphics, settingsUI } = P;
  const L = world.lighting;
  const BLOCKS = P.BLOCKS;
  const id = (name) => BLOCKS.findIndex((b) => b && b.name === name);
  const AIR = 0, LANTERN = id("lantern"), STONE = id("stone_bricks");
  const results = [];
  const run = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ test: name, detail, pass: !!detail.pass });
    } catch (err) {
      results.push({ test: name, detail: { error: String(err && err.stack || err) }, pass: false });
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 测试场地：高空里一块完全空着的区域（不会碰到主城与浮岛）
  function findSky() {
    for (let x = 120; x >= 40; x -= 8) for (let z = 120; z >= 40; z -= 8) {
      if (!world.hasChunk(x >> 4, z >> 4)) continue;
      let clear = true;
      for (let dx = -8; dx <= 8 && clear; dx++) for (let dz = -8; dz <= 8 && clear; dz++)
        for (let y = 116; y <= 142; y++) if (world.get(x + dx, y, z + dz) !== AIR) { clear = false; break; }
      if (clear) return { x, y: 128, z };
    }
    return null;
  }
  const touched = [];
  const put = (x, y, z, b) => { touched.push([x, y, z]); edits.set(x, y, z, b); };
  const cleanup = () => {
    for (let i = touched.length - 1; i >= 0; i--) {
      const [x, y, z] = touched[i];
      edits.set(x, y, z, AIR);
      edits.edits.delete(x + "," + y + "," + z);
    }
    touched.length = 0;
  };
  const step = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) player.update(dt); };
  const site = findSky();

  // 1. 灯笼的光被墙挡住：墙这一侧亮、墙另一侧为 0（旧的点光源会直接穿墙）
  await run("Lantern light is blocked by a wall (no light leaks through)", () => {
    if (!site) return { pass: false, reason: "no empty sky area" };
    const { x, y, z } = site;
    put(x, y, z, LANTERN);
    for (let yy = y - 6; yy <= y + 6; yy++) for (let zz = z - 6; zz <= z + 6; zz++) put(x + 3, yy, zz, STONE);
    const near = L.block(x + 1, y, z), front = L.block(x + 2, y, z), behind = L.block(x + 4, y, z);
    const pass = near === 14 && front === 13 && behind === 0;
    return { near, front, behind, pass };
  });

  // 2. 增量更新与整体重算结果完全一致（挖开墙后光漏过去，再整张图重算对比）
  await run("Incremental relight equals a full recompute after editing", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    edits.set(x + 3, y, z, AIR); // 墙上开个洞
    const leak = L.block(x + 4, y, z);
    const box = [];
    for (let dx = -4; dx <= 8; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++)
      box.push([L.block(x + dx, y + dy, z + dz), L.sky(x + dx, y + dy, z + dz)]);
    L.computeAll();
    let diff = 0, i = 0;
    for (let dx = -4; dx <= 8; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) {
      const [b, s] = box[i++];
      if (b !== L.block(x + dx, y + dy, z + dz) || s !== L.sky(x + dx, y + dy, z + dz)) diff++;
    }
    edits.set(x + 3, y, z, STONE);
    // 灯笼 15 → 隔 1 格 14 → 2 格 13 → 墙洞 12 → 洞后 11
    return { leakThroughHole: leak, cellsCompared: box.length, mismatches: diff, pass: leak === 11 && diff === 0 };
  });

  // 3. 拆掉灯笼 → 光完全消失（移除洪泛不留残光）
  await run("Removing a lantern removes all of its light", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    edits.set(x, y, z, AIR);
    let left = 0;
    for (let dx = -6; dx <= 2; dx++) for (let dy = -6; dy <= 6; dy++) for (let dz = -6; dz <= 6; dz++) left += L.block(x + dx, y + dy, z + dz);
    cleanup();
    return { residualLight: left, pass: left === 0 };
  });

  // 4. 场景里不再有实时点光源（灯笼 / 火把全部是烘焙光照）
  await run("No real-time point lights remain in the scene", () => {
    let n = 0;
    renderer.scene.traverse((o) => { if (o.isPointLight) n++; });
    return { pointLights: n, pass: n === 0 };
  });

  // 5. 阴影相机按纹素对齐：玩家挪动不到一个纹素时阴影贴图不动
  await run("Sun shadow camera snaps to shadow-map texels", () => {
    // 只有垂直于光线方向的平移会让阴影贴图相对世界滑动；沿光线方向的平移不影响阴影
    const T = player.position.clone();
    const lateral = (p, q) => {
      const d = p.clone().sub(q);
      return Math.hypot(d.dot(renderer._sunR), d.dot(renderer._sunU));
    };
    renderer.followSun(T);
    const a = renderer.sun.target.position.clone();
    renderer.followSun(T.clone().add({ x: 0.004, y: 0, z: 0.003 }));
    const b = renderer.sun.target.position.clone();
    renderer.followSun(T.clone().add({ x: 3.0, y: 0, z: 0 }));
    const c = renderer.sun.target.position.clone();
    renderer.followSun(player.position);
    const sc = renderer.sun.shadow.camera;
    const texel = (sc.right - sc.left) / renderer.sun.shadow.mapSize.x;
    const big = lateral(a, c);
    const onGrid = Math.abs(big / texel - Math.round(big / texel)) < 1e-3 || Math.abs(c.clone().sub(a).dot(renderer._sunR) / texel - Math.round(c.clone().sub(a).dot(renderer._sunR) / texel)) < 1e-3;
    return { tinyLateral: +lateral(a, b).toFixed(6), bigLateral: +big.toFixed(3), texel: +texel.toFixed(4), onGrid, pass: lateral(a, b) < 1e-6 && big > 1 && onGrid };
  });

  // 6. 画质档位真的关掉开销（不只是不显示）：LOW 关泛光 / 体积光 / 反射 / 阴影，分辨率 1x
  await run("LOW preset disables the expensive passes; switching back restores them", () => {
    const prev = graphics.mode, prevOv = { ...graphics.overrides };
    P.setQuality("low");
    const low = { bloom: renderer.bloomOn, rays: renderer.godraysOn, refl: renderer.reflectOn, shadows: renderer.renderer.shadowMap.enabled, pr: renderer.pixelRatio, vd: chunks.viewDistance };
    P.setQuality("ultra");
    const ultra = { bloom: renderer.bloomOn, rays: renderer.godraysOn, refl: renderer.reflectOn, shadows: renderer.renderer.shadowMap.enabled, vd: chunks.viewDistance };
    graphics.mode = prev; graphics.overrides = prevOv; P.setQuality(prev); graphics.overrides = prevOv;
    const pass = !low.bloom && !low.rays && !low.refl && !low.shadows && low.pr === 1 && low.vd === 4 && ultra.bloom && ultra.rays && ultra.refl && ultra.shadows && ultra.vd === 9;
    return { low, ultra, pass };
  });

  // 7. 自动降档：持续 30 FPS 降一档；被节流到 2 FPS（后台）不算慢
  await run("AUTO quality steps down after 8 s at 30 FPS but ignores a throttled tab", () => {
    const Gov = P.governor.constructor;
    const fake = (tier) => ({ mode: "auto", autoTier: tier, save() {} });
    const slow = fake("ultra"), throttled = fake("ultra");
    const g1 = new Gov(slow, () => {}); g1.focused = () => true; g1.settle = 0;
    for (let i = 0; i < 300; i++) g1.update(1 / 30, true); // 10 秒：两个慢窗口
    const g2 = new Gov(throttled, () => {}); g2.focused = () => true; g2.settle = 0;
    for (let i = 0; i < 20; i++) g2.update(0.5, true);
    return { slowTier: slow.autoTier, throttledTier: throttled.autoTier, pass: slow.autoTier === "high" && throttled.autoTier === "ultra" };
  });

  // 7b. 降档后能升回来：临时卡顿过去以后，20 秒都稳定 60 FPS 就升一档；不会超过检测出的档位；升上去又撑不住，下次多等一倍
  await run("AUTO quality recovers after a transient slowdown, capped at the detected tier", () => {
    const Gov = P.governor.constructor;
    const s = { mode: "auto", autoTier: "low", detected: { tier: "high" }, save() {} };
    const g = new Gov(s, () => {}); g.focused = () => true; g.settle = 0;
    const run60 = (sec) => { for (let i = 0; i < sec * 60; i++) g.update(1 / 60, true); };
    run60(19);
    const before = s.autoTier;            // 不到 20 秒：不升
    run60(5);
    const one = s.autoTier;               // low → medium
    g.settle = 0; run60(26);
    const two = s.autoTier;               // medium → high（= 检测档位）
    g.settle = 0; run60(30);
    const capped = s.autoTier;            // 不超过 high
    // 升上去又撑不住 → 降回来，下次要 40 秒
    s.autoTier = "medium"; g._justUpgraded = false; g.upgradeWindows = 5; g.fastWindows = 0; g.settle = 0;
    run60(24); const up = s.autoTier;     // → high
    g.settle = 0; for (let i = 0; i < 300; i++) g.update(1 / 30, true);
    const down = s.autoTier, waits = g.upgradeWindows;
    const pass = before === "low" && one === "medium" && two === "high" && capped === "high" && up === "high" && down === "medium" && waits === 10;
    return { before, one, two, capped, up, down, waits, pass };
  });

  // 8. 蹲下：按住 C 走到平台边缘不会掉下去；视线降低；碰撞箱变矮
  await run("Crouch: holding C at a ledge edge does not fall off", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    for (let dx = 0; dx <= 2; dx++) for (let dz = 0; dz <= 2; dz++) put(x + dx, y, z + dz, STONE);
    player.position.set(x + 1.5, y + 1, z + 1.5);
    player.velocity.set(0, 0, 0);
    player.flying = false; player.mount = null; player.onGround = true;
    player.yaw = player.targetYaw = -Math.PI / 2; // 面朝 +X
    player.keys.clear();
    player.crouchMode = "hold";
    player.keys.add("KeyC"); player.keys.add("KeyW");
    step(240);
    const crouchY = player.position.y, crouchX = player.position.x;
    const eyeDrop = +player._crouchEye.toFixed(2), bh = player.bh;
    player.keys.clear();
    step(10);
    const stood = !player.crouching && player.bh > 1.7;
    cleanup();
    const pass = Math.abs(crouchY - (y + 1)) < 1e-3 && crouchX > x + 2.5 && crouchX < x + 3.4 && eyeDrop > 0.3 && bh === 1.5 && stood;
    return { crouchX: +crouchX.toFixed(2), edgeAt: x + 3, y: +crouchY.toFixed(2), eyeDrop, bh, stood, pass };
  });

  // 9. 蹲下：第一人称相机真的降低（不只是改了个变量）
  await run("Crouch lowers the first-person camera by 0.35", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    put(x, y, z, STONE);
    const prevMode = player.mode;
    player.mode = "first";
    player.position.set(x + 0.5, y + 1, z + 0.5);
    player.velocity.set(0, 0, 0); player.onGround = true; player.flying = false;
    player.keys.clear();
    step(30);
    const standY = P.renderer.camera.position.y;
    player.keys.add("KeyC");
    step(30);
    const crouchY = P.renderer.camera.position.y;
    player.keys.clear();
    step(30);
    player.mode = prevMode;
    cleanup();
    const drop = standY - crouchY;
    return { standEye: +(standY - y - 1).toFixed(3), drop: +drop.toFixed(3), pass: Math.abs(drop - 0.35) < 0.01 };
  });

  // 10. 切换式疾跑：按一下 Shift 开始疾跑，停下来自动取消
  await run("Toggle sprint: one press starts sprinting, stopping cancels it", () => {
    const g = site;
    if (!g) return { pass: false, reason: "no site" };
    for (let dx = -6; dx <= 6; dx++) for (let dz = -1; dz <= 1; dz++) put(g.x + dx, g.y, g.z + dz, STONE);
    player.position.set(g.x - 5.5, g.y + 1, g.z + 0.5);
    player.velocity.set(0, 0, 0); player.onGround = true;
    player.yaw = player.targetYaw = -Math.PI / 2;
    player.keys.clear();
    const prevMode = player.sprintMode, prevLocked = player.touchEngaged, prevState = P.state.mode;
    player.sprintMode = "toggle"; player.touchEngaged = true;
    // 真实按键走输入路由：路由只在「游戏中」响应
    P.state.mode = "play";
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ShiftLeft" }));
    P.state.mode = prevState;
    player.keys.add("KeyW");
    step(20);
    const sprinting = player.sprinting;
    player.keys.delete("KeyW");
    step(40);
    const cancelled = !player.sprintToggled;
    player.sprintMode = prevMode; player.touchEngaged = prevLocked; player.keys.clear();
    cleanup();
    return { sprinting, cancelled, pass: sprinting && cancelled };
  });

  // 11. 触屏摇杆是模拟量：推一半走一半速度
  await run("Touch stick is analog: half push walks at half speed", () => {
    if (!site) return { pass: false, reason: "no site" };
    const { x, y, z } = site;
    for (let dx = -8; dx <= 8; dx++) for (let dz = -1; dz <= 1; dz++) put(x + dx, y, z + dz, STONE);
    player.position.set(x - 7.5, y + 1, z + 0.5);
    player.velocity.set(0, 0, 0); player.onGround = true;
    player.yaw = player.targetYaw = -Math.PI / 2;
    player.keys.clear();
    Object.assign(player.moveInput, { x: 0, y: 0.5, active: true, sprint: false });
    step(60);
    const half = Math.hypot(player.velocity.x, player.velocity.z);
    Object.assign(player.moveInput, { y: 1 });
    step(60);
    const full = Math.hypot(player.velocity.x, player.velocity.z);
    Object.assign(player.moveInput, { x: 0, y: 0, active: false });
    cleanup();
    return { half: +half.toFixed(2), full: +full.toFixed(2), pass: Math.abs(half - 2.5) < 0.15 && Math.abs(full - 5) < 0.15 };
  });

  // 12. 设置窗口：游戏中打开 → 状态 settings、指针释放；关闭后不会停在「游戏中但没有指针」
  await run("Settings from gameplay releases the pointer and never strands the player", async () => {
    const prev = P.state.mode;
    P.state.mode = "play";
    player.touchEngaged = P.touchMode;
    P.openSettings();
    const opened = { mode: P.state.mode, open: settingsUI.isOpen, engaged: player.engaged };
    settingsUI.close();
    await sleep(300);
    const after = { mode: P.state.mode, engaged: player.engaged, pauseShown: document.getElementById("pause").classList.contains("open") };
    // 关闭后要么回到游戏且在操控，要么（浏览器拒绝了无手势的指针锁定）进入暂停菜单
    const ok = (after.mode === "play" && after.engaged) || (after.mode === "paused" && after.pauseShown);
    P.menus.hidePause(); P.state.mode = prev;
    return { opened, after, pass: opened.mode === "settings" && opened.open && !opened.engaged && ok };
  });

  // 13. 还原默认：改乱以后一键回到出厂设置
  await run("RESTORE DEFAULTS resets graphics, controls and audio", () => {
    const keep = { mode: graphics.mode, ov: { ...graphics.overrides }, fov: graphics.fov, controls: { ...settingsUI.controls }, sfx: P.audio.settings.sfxVol };
    P.setQuality("low");
    graphics.setToggle("bloom", true);
    settingsUI.controls = { sens: 2.4, bob: false, crouch: "toggle", sprint: "toggle" };
    settingsUI._applyControls();
    P.audio.setSfxVol(0.2);
    settingsUI.restoreDefaults();
    const after = { mode: graphics.mode, ov: Object.keys(graphics.overrides).length, sens: settingsUI.controls.sens, bob: player.headBob,
      crouch: player.crouchMode, sprint: player.sprintMode, sfx: P.audio.settings.sfxVol, fov: player.baseFov };
    const pass = after.mode === "auto" && after.ov === 0 && after.sens === 1 && after.bob === true && after.crouch === (P.touchMode ? "toggle" : "hold") && after.sprint === "hold" && after.sfx === 1 && after.fov === 72;
    // 恢复测试前的设置
    graphics.overrides = keep.ov; graphics.fov = keep.fov; P.setQuality(keep.mode); graphics.overrides = keep.ov;
    settingsUI.controls = keep.controls; settingsUI._applyControls(); settingsUI._saveControls();
    P.audio.setSfxVol(keep.sfx);
    settingsUI.sync();
    return { after, pass };
  });

  // 还原
  cleanup();
  player.keys.clear();
  player.crouching = false; player.bh = 1.78; player._crouchEye = 0;
  player.spawnAt(world);

  const failed = results.filter((r) => !r.pass);
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
})()
`;
