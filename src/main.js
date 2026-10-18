/**
 * JADEVEIL —— 入口
 *
 * 组装顺序：纹理图集 → 世界生成 → 导航网格 → 天空昼夜 → 区块网格 → 玩家 / 化身 / 交互
 *          → 游戏系统（背包、生命、战斗、掉落、火把、坐骑、存档）→ 界面 → 主循环
 *
 * 游戏状态机（state.mode）：
 *   title     标题页（世界已在背后加载好；选择继续 / 新游戏 / 读文件）
 *   play      游戏中（键鼠：指针锁定；触屏：触屏操作层接管屏幕）
 *   paused    暂停菜单（ESC / MENU 按钮；指针释放）
 *   inventory 背包界面（E / BAG 按钮）
 *   settings  从游戏中打开的设置窗口（O）；关闭后回到游戏。从标题 / 暂停打开时不改变状态
 *   dead      死亡界面
 *
 * 任何界面打开时指针一定是释放的（看得到光标）；回到 play 时重新锁定。
 */
import * as THREE from "three";
import { TextureAtlas } from "./world/atlas.js";
import { WorldGenerator, CITY } from "./world/generator.js";
import { ChunkManager } from "./world/chunkManager.js";
import { Renderer, BLOOM_SCENE, GODRAY_SKY } from "./core/renderer.js";
import { Sky } from "./core/sky.js";
import { DayNight } from "./core/daynight.js";
import { Player, CAMERA_LABELS } from "./player/controller.js";
import { Avatar } from "./player/avatar.js";
import { Interaction } from "./player/interaction.js";
import { HUD } from "./ui/hud.js";
import { NPCManager, STATIONS } from "./world/npc.js";
import { NavGrid } from "./world/navgrid.js";
import { PetalField, SmokeField, LanternSway, MistLayers, SkyLanterns, WaterMotes } from "./core/particles.js";
import { COLLISION_TEST_SOURCE } from "../tests/collision.test.mjs";
import { ISLAND_ACCESS_TEST_SOURCE } from "../tests/island-access.test.mjs";
import { BLOCKS, isSolid } from "./world/blocks.js";
import { installPixelUI } from "./ui/pixelui.js";
import { attachPixelText } from "./ui/pixelfont.js";
import { WORLDGUARD_TEST_SOURCE } from "../tests/worldguard.test.mjs";
import { WATER_TEST_SOURCE } from "../tests/water.test.mjs";
import { QUALITY_TEST_SOURCE } from "../tests/quality.test.mjs";
import { RPG_TEST_SOURCE } from "../tests/rpg.test.mjs";
import { NPC_TEST_SOURCE } from "../tests/npc.test.mjs";
import { UX_TEST_SOURCE } from "../tests/ux.test.mjs";
import { AudioManager } from "./audio/audioManager.js";
import { events } from "./game/events.js";
import { Inventory } from "./game/inventory.js";
import { ITEMS, STARTER_KIT, dropForBlock } from "./game/items.js";
import { PlayerHealth } from "./game/health.js";
import { Combat } from "./game/combat.js";
import { DropManager } from "./game/drops.js";
import { TorchManager, isTorch } from "./game/torches.js";
import { WorldEdits } from "./game/worldEdits.js";
import { TrainingDummy } from "./game/dummy.js";
import { SaveManager } from "./game/save.js";
import { FXParticles } from "./fx/fxParticles.js";
import { DragonMount } from "./mount/dragon.js";
import { RpgHud } from "./ui/rpgHud.js";
import { InventoryUI } from "./ui/inventoryUI.js";
import { Menus } from "./ui/menus.js";
import { installUIScale } from "./ui/uiScale.js";
import { buildTrainingYard, YARD } from "./world/trainingYard.js";
import { installPWA, pwa } from "./game/pwa.js";
import { GraphicsSettings, AutoGovernor, detectTier } from "./core/quality.js";
import { SettingsUI } from "./ui/settings.js";
import { TouchControls, detectTouch } from "./ui/touchControls.js";
import { installRotateGuard } from "./ui/rotateGuard.js";
import { Fullscreen } from "./ui/fullscreen.js";
import { LightEngine } from "./world/lighting.js";
import { makeLit, EntityLightProbe } from "./core/entityLight.js";

// 触屏模式必须最先确定：界面缩放下限、操作说明、竖屏提示都依赖它
const touchMode = detectTouch();
document.body.classList.toggle("touch", touchMode);
// 像素风界面必须在任何内容渲染前装好（含加载页）
installPixelUI();
installUIScale();
installPWA();
// 竖屏提示：从加载页开始就生效
const rotateGuard = installRotateGuard(touchMode);

const canvas = document.createElement("canvas");
canvas.id = "scene";
document.body.insertBefore(canvas, document.getElementById("hud"));

const app = {
  ready: false,
  errors: [],
};

window.addEventListener("error", (e) => app.errors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => app.errors.push(String(e.reason)));

const SEED = 20261014;

/* ---------------- 启动流程 ---------------- */
async function boot() {
  const renderer = new Renderer(canvas);
  // 画质：设备分级给出 AUTO 起点，玩家的选择记在本地
  const graphics = new GraphicsSettings(detectTier(renderer.renderer.getContext()));
  const hud0 = {
    bar: document.getElementById("loadbar"),
    msg: document.getElementById("loadmsg"),
    set(p, m) {
      this.bar.style.width = `${Math.round(p * 100)}%`;
      if (m) this.msg.textContent = m;
    },
  };

  hud0.set(0.05, "PAINTING PIXEL TEXTURES...");
  await frame();

  // 1. 纹理图集
  const atlas = new TextureAtlas();
  atlas.build();
  renderer.setAtlas(atlas.texture);
  // PBR 附加通道：法线 + 粗糙度（性价比高于单纯提分辨率）
  atlas.buildPBR();
  renderer.setPBR({ normalTex: atlas.normalTexture, roughTex: atlas.roughnessTexture });
  hud0.set(0.2, "SHAPING THE TERRAIN...");
  await frame();

  // 2. 世界生成（固定种子：存档只记差量，读档时在同一个世界上重放）
  const gen = new WorldGenerator(SEED);
  const world = gen.generate();
  // 训练场：生成阶段确定性写入（不属于玩家编辑，不进存档差量）
  const yard = buildTrainingYard(world);
  hud0.set(0.45, "LIGHTING THE LANTERNS...");
  await frame();
  // 体素光照：天空光 + 灯笼 / 火把的方块光，整张地图洪泛一次；之后的编辑由 world.set 增量更新
  const lighting = new LightEngine(world);
  lighting.computeAll();
  world.lighting = lighting;
  hud0.set(0.5, "MAPPING THE STREETS...");
  await frame();
  // NPC 导航网格（逐格高度场 + A*）
  const nav = new NavGrid(world);
  hud0.set(0.58, "RAISING THE CITY...");
  await frame();

  // 3. 天空与昼夜
  const sky = new Sky(renderer.scene);
  // 天空穹顶标记在体积光遮罩层：遮罩里只有它是亮的，其余几何体全黑，
  // 于是光束只会来自「被建筑遮挡的天空」，不会被灯笼/金瓦/龙眼复制出残影。
  sky.mesh.layers.enable(GODRAY_SKY);
  const daynight = new DayNight();
  daynight.sample(daynight.time);
  renderer.setSunDir(daynight.state.lightDir);
  renderer.applyDayNight(daynight.state, sky);
  // 平面反射：水面高度用荷花池水面（城台顶面）
  renderer.initReflection(CITY.baseY + 1);
  renderer.applyQuality(graphics.profile);

  // 4. 区块网格
  const chunks = new ChunkManager(world, atlas, renderer, {
    viewDistance: graphics.profile.viewDistance,
    cullDistance: graphics.profile.cullDistance,
    budgetPerFrame: 3,
  });
  renderer.isWaterVisible = () => chunks.anyWaterVisible(renderer.camera);

  // 5. 玩家与化身（杰杰）
  const player = new Player(world, renderer.camera, canvas);
  player.touchMode = touchMode;
  player.spawnAt(world);
  const avatar = new Avatar(atlas);
  renderer.scene.add(avatar.group);
  // 第一人称视模型挂在相机下，因此相机必须在场景图里
  renderer.camera.add(avatar.viewArms);
  renderer.scene.add(renderer.camera);
  avatar.setMode(player.mode);
  avatar.placeTo(player.position);
  // 化身（含第一人称手臂，共用材质）吃烘焙光照：进屋变暗、灯笼下变亮
  const avatarLight = new EntityLightProbe(lighting, [
    makeLit(avatar.materials.base, renderer.lightUniforms),
    makeLit(avatar.materials.over, renderer.lightUniforms),
  ]);

  // 6. 游戏系统
  const fx = new FXParticles(renderer.scene);
  fx.setViewportHeight(window.innerHeight);
  window.addEventListener("resize", () => fx.setViewportHeight(window.innerHeight));
  const combat = new Combat();
  const edits = new WorldEdits(world);
  const inventory = new Inventory();
  const health = new PlayerHealth();
  const drops = new DropManager(renderer.scene, world, atlas);
  const torches = new TorchManager(renderer.scene, world, fx);
  const audio = new AudioManager();

  const interaction = new Interaction(world, renderer.camera, player, renderer.scene);
  Object.assign(interaction, { edits, inventory, drops, combat, avatar });

  const mount = new DragonMount({
    scene: renderer.scene, player, avatar, world, combat, fx, audio, camera: renderer.camera,
  });

  // 训练场的火把与假人（假人同时在导航网格上标为障碍，居民会绕开）
  for (const [x, y, z] of yard.torches) torches.onBlockChange(x, y, z, world.get(x, y, z));
  const dummies = [];
  const dummyLights = [];
  for (const [x, z] of yard.dummies) {
    const d = new TrainingDummy(renderer.scene, x, YARD.floorY + 1, z, 0);
    combat.register(d);
    nav.blockArea(x, z, 0.6);
    dummies.push(d);
    dummyLights.push(new EntityLightProbe(lighting, [
      makeLit(d.mats.base, renderer.lightUniforms),
      makeLit(d.mats.over, renderer.lightUniforms),
    ]));
  }
  // 末影龙：本体与翼膜两种材质（眼睛是自发光，不受环境光影响）
  const dragonLight = new EntityLightProbe(lighting, [
    makeLit(mount.model.mat, renderer.lightUniforms),
    makeLit(mount.model.matMembrane, renderer.lightUniforms),
  ]);

  // 7. 界面
  const hud = new HUD(atlas, player, daynight, interaction, world);
  hud.audio = audio;
  hud.inventory = inventory;
  hud.mount = mount;
  const rpgHud = new RpgHud({ atlas, inventory, health, mount, combat, camera: renderer.camera, player });
  const invUI = new InventoryUI({
    inventory,
    hud: rpgHud,
    onClose: () => {
      if (state.mode === "inventory") {
        state.mode = "play";
        lockPointer();
      }
    },
    dropAtPlayer: (id, count) => drops.spawn(id, count, player.position.x, player.position.y + 1.2, player.position.z),
  });
  events.on("inventory:change", () => invUI.refresh());

  // 首次用户手势后启动音频（浏览器自动播放策略）
  const beginAudio = () => {
    audio.begin();
    window.removeEventListener("pointerdown", beginAudio);
    window.removeEventListener("keydown", beginAudio);
  };
  window.addEventListener("pointerdown", beginAudio);
  window.addEventListener("keydown", beginAudio);

  /* ---------------- 系统联动（事件） ---------------- */

  // 世界编辑 → 火把外观、NPC 导航；支撑方块被挖掉时火把掉落
  events.on("world:edit", ({ x, y, z, id, prev }) => {
    torches.onBlockChange(x, y, z, id);
    nav.onWorldEdit(x, z);
    if (isSolid(prev) && !isSolid(id)) {
      for (const [tx, ty, tz] of torches.detachAround(x, y, z)) {
        edits.set(tx, ty, tz, 0);
        drops.spawn("torch", 1, tx + 0.5, ty + 0.4, tz + 0.5);
      }
    }
  });

  // 手持物：背包选中格 → 交互可放置的方块 + 化身手里的模型
  const syncHeld = () => {
    const def = inventory.selectedItem;
    interaction.selected = def && def.kind === "block" ? def.blockId : null;
    avatar.setHeldItem(def);
  };
  events.on("inventory:change", syncHeld);
  events.on("inventory:select", syncHeld);

  events.on("item:pickup", () => audio.pickup());
  events.on("entity:hit", ({ crit, source }) => {
    if (source === "melee") audio.hitEntity(crit);
  });
  events.on("player:damage", ({ amount }) => {
    audio.hurt();
    player.shake = Math.max(player.shake, Math.min(0.6, amount * 0.08));
  });
  events.on("player:death", () => {
    audio.death();
    if (mount.active) mount.dismiss();
    state.mode = "dead";
    releasePointer();
  });
  events.on("ui:toast", (text) => {
    hud.showItemName(text);
    audio.blocked();
  });

  // 玩家音频与伤害钩子
  player.onJump = () => audio.jump();
  player.onLand = (fall) => {
    audio.land(fall);
    health.onLand(fall, player);
  };
  player.onFootstep = (surface, running) => audio.footstep(surface, running);
  player.onSplash = (kind) => {
    if (kind === "enter" || kind === "exit") audio.splash(kind);
    else if (kind === "dive") audio.bubble();
  };
  player.onSwimStroke = () => audio.swimStroke();
  interaction.onBreak = (id) => audio.breakBlock(BLOCKS[id] ? BLOCKS[id].name : "");
  interaction.onPlace = (id) => audio.placeBlock(BLOCKS[id] ? BLOCKS[id].name : "");
  interaction.onSwing = () => audio.swordSwing();
  interaction.onAttack = () => audio.swordSwing();
  interaction.onBlocked = (msg) => {
    hud.showItemName(msg);
    audio.blocked();
  };

  // 掉出世界：控制器已经把人放回安全点（避免无限下坠），这里判定死亡
  const voidFade = document.getElementById("voidfade");
  let voidMsgApi = null;
  player.onRespawn = () => {
    if (!voidMsgApi) {
      voidMsgApi = attachPixelText(document.getElementById("voidmsg"), {
        color: "#ffe08a", scale: 3, tracking: 1, initial: "",
      });
    }
    voidMsgApi.set("RETURNED FROM THE VOID");
    voidFade.classList.add("on");
    setTimeout(() => voidFade.classList.remove("on"), 420);
    if (state.mode === "play") health.kill("void");
  };

  /* ---------------- 状态机与菜单 ---------------- */
  const state = { mode: "title", playTime: 0 };

  const save = new SaveManager(() => ({
    seed: SEED,
    playTime: Math.round(state.playTime),
    player: {
      pos: player.position.toArray().map((n) => +n.toFixed(3)),
      yaw: +player.yaw.toFixed(4),
      pitch: +player.pitch.toFixed(4),
      mode: CAMERA_LABELS[player.mode] ? player.mode : "first",
    },
    health: health.serialize(),
    inventory: inventory.serialize(),
    time: Math.round(daynight.time),
    world: edits.serialize(),
    drops: drops.serialize(),
  }));

  function applySave(d) {
    edits.load(d.world);
    inventory.load(d.inventory);
    health.load(d.health);
    if (d.player && Array.isArray(d.player.pos)) {
      const [x, y, z] = d.player.pos;
      player.position.set(x, y, z);
      player.velocity.set(0, 0, 0);
      player.yaw = player.targetYaw = d.player.yaw || 0;
      player.pitch = player.targetPitch = d.player.pitch || 0;
      player.mode = d.player.mode || "first";
      avatar.setMode(player.mode);
      player.resetFall();
      // 存档点若已被挖空 / 卡在方块里，回到安全出生点
      if (player.collides(x, y, z)) player.spawnAt(world);
    }
    if (Number.isFinite(d.time)) daynight.time = d.time;
    drops.load(d.drops);
    state.playTime = d.playTime || 0;
    chunks.update(player.position, true);
  }

  function startPlay(cinematicIntro) {
    menus.hideTitle();
    state.mode = "play";
    save.enabled = true;
    syncHeld();
    // 进游戏默认全屏（在 NEW GAME / CONTINUE 的点击里调用，满足浏览器的手势要求）
    if (fullscreen.auto) fullscreen.enter();
    lockPointer();
    if (cinematicIntro) startCinematic();
  }

  const menus = new Menus({
    click: () => audio.uiClick(),
    onContinue: async () => {
      try {
        const d = await save.load();
        if (!d) return;
        applySave(d);
        startPlay(false);
      } catch (err) {
        menus.titleMessage(`LOAD FAILED: ${String(err.message || err).toUpperCase()}`);
      }
    },
    onNewGame: async () => {
      await save.wipe();
      inventory.clear();
      for (const [id, n] of STARTER_KIT) inventory.add(id, n);
      inventory.select(0);
      player.spawnAt(world);
      startPlay(true);
      save.save();
    },
    onLoadFile: async () => {
      try {
        await save.importFile();
      } catch (err) {
        const msg = `LOAD FAILED: ${String(err.message || err).toUpperCase()}`;
        if (state.mode === "title") menus.titleMessage(msg);
        else menus.pauseMessage(msg, "#ff7a6a");
      }
    },
    onResume: () => lockPointer(),
    onSave: async () => {
      const ok = await save.save();
      menus.pauseMessage(ok ? "GAME SAVED" : "SAVE FAILED", ok ? "#6fc0ae" : "#ff7a6a");
    },
    onExport: async () => {
      const ok = await save.exportFile();
      menus.pauseMessage(ok ? "SAVE FILE DOWNLOADED" : "NOTHING TO EXPORT", ok ? "#6fc0ae" : "#ff7a6a");
    },
    onSettings: () => openSettings(),
    onControls: () => openSettings("controls"),
    onFullscreen: () => fullscreen.toggle(),
    onInstall: () => pwa.install(),
    onQuitTitle: async () => {
      // 重载回标题：世界差量必须重放在干净的生成世界上，重载最稳
      await save.save();
      save.enabled = false;
      location.reload();
    },
  });
  pwa.onChange((st) => menus.setInstallState(st));
  save.onSaved = () => {
    if (state.mode === "play") hud.showItemName("GAME SAVED");
  };

  rpgHud.onRespawn = () => {
    player.respawn();
    health.respawn();
    state.mode = "play";
    lockPointer();
  };
  rpgHud.onTitle = async () => {
    player.respawn();
    health.respawn();
    await save.save();
    save.enabled = false;
    location.reload();
  };

  /* ---------------- 指针与界面焦点 ---------------- */

  /**
   * 回到操控角色：键鼠请求指针锁定；触屏直接接管屏幕。
   * 没有用户手势时浏览器会拒绝锁定（自动化、ESC 关掉窗口后立刻重锁）——
   * 这时不能停在「游戏中但没有指针」的死状态，退回暂停菜单让玩家点 RESUME。
   */
  function lockPointer() {
    if (touchMode) {
      player.touchEngaged = true;
      hud.setLocked(true);
      if (state.mode === "paused") state.mode = "play";
      menus.hidePause();
      return;
    }
    try {
      const r = canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => lockFailed());
    } catch {
      lockFailed();
    }
  }

  /** 释放指针（打开任何界面之前调用），光标随之出现。 */
  function releasePointer() {
    if (touchMode) {
      player.touchEngaged = false;
      hud.setLocked(false);
    } else if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  function lockFailed() {
    if (state.mode === "play" && !player.engaged) pauseGame();
  }
  document.addEventListener("pointerlockerror", lockFailed);

  function pauseGame() {
    state.mode = "paused";
    releasePointer();
    menus.showPause();
    save.save();
  }

  player.onLockChange = (locked) => {
    hud.setLocked(locked);
    if (locked) {
      menus.hidePause();
      if (state.mode === "paused") state.mode = "play";
    } else if (state.mode === "play") {
      pauseGame();
    }
  };
  // 画面点击：只在暂停时重新锁定指针（标题页、背包、设置、死亡界面不抢指针）
  canvas.addEventListener("click", () => {
    if (state.mode === "paused" && !touchMode) lockPointer();
  });

  /* ---------------- 设置窗口 ---------------- */
  function applyGraphics(p) {
    renderer.applyQuality(p);
    chunks.setQuality(p);
    petals.setDensity(p.particles);
    skyLanterns.setDensity(p.particles);
    waterMotes.setDensity(p.particles);
    governor.reset(3);
  }

  const fullscreen = new Fullscreen();
  const settingsUI = new SettingsUI({
    graphics,
    player,
    audio,
    fullscreen,
    touch: touchMode,
    click: () => audio.uiClick(),
    onGraphics: (p) => applyGraphics(p),
  });

  /** 从游戏中打开：先释放指针（看得到光标），关闭后回到游戏；从标题 / 暂停打开则原地返回。 */
  function openSettings(page) {
    if (settingsUI.isOpen) return;
    if (state.mode === "play") {
      state.mode = "settings";
      releasePointer();
    }
    settingsUI.open(page);
  }
  settingsUI.onClose = () => {
    if (state.mode === "settings") {
      state.mode = "play";
      lockPointer();
    }
  };

  // AUTO 画质：帧率持续偏低时降一档，并告诉玩家可以在设置里自己调
  const governor = new AutoGovernor(graphics, (tier, fps) => {
    applyGraphics(graphics.profile);
    settingsUI.sync();
    const msg = `RUNNING AT ${fps} FPS - GRAPHICS LOWERED TO ${tier.toUpperCase()}`;
    hud.showItemName(msg);
    if (state.mode === "title") menus.titleMessage(`${msg}  (SETTINGS > GRAPHICS)`, "#6fc0ae");
  });

  // 7.5 灯笼光核：在每个灯笼位置放一个高亮自发光小球，
  //     给 bloom 一个明确的溢光源（体素本身受贴图限制，亮度不够）
  const glowCore = (() => {
    const geo = new THREE.SphereGeometry(0.26, 10, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd08a,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      fog: false,
    });
    const positions = [];
    for (const lm of gen.landmarks) {
      if (lm.type !== "lantern") continue;
      positions.push([lm.pos[0] + 0.5, lm.pos[1] + 0.5, lm.pos[2] + 0.5]);
    }
    const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, positions.length));
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.frustumCulled = false;
    inst.renderOrder = 3;
    const dummy = new THREE.Object3D();
    positions.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.count = positions.length;
    inst.instanceMatrix.needsUpdate = true;
    inst.layers.enable(BLOOM_SCENE); // 灯笼光核：参与选择性泛光
    renderer.scene.add(inst);
    return { mesh: inst, mat, count: positions.length, positions };
  })();

  // 7.6 主城居民
  const npcs = new NPCManager(world, renderer.scene, nav, STATIONS, 124);
  npcs.enableLighting(lighting, renderer.lightUniforms, makeLit);

  // 7.7 环境粒子：飘落花瓣 / 竹叶 + 香炉烟雾 + 灯笼摇摆
  const petals = new PetalField(renderer.scene, 900, { range: 28, world });
  const smokeSources = [];
  for (const lm of gen.landmarks) {
    if (lm.type === "lantern" && smokeSources.length < 14) {
      smokeSources.push([lm.pos[0] + 0.5, lm.pos[1] + 1.2, lm.pos[2] + 0.5]);
    }
  }
  const smoke = new SmokeField(renderer.scene, smokeSources, 22);
  const lanternSway = new LanternSway(glowCore.mesh, glowCore.positions);
  const mist = new MistLayers(renderer.scene, [38, 46, 56, 70]);
  const skyLanterns = new SkyLanterns(renderer.scene, 120, { baseY: 36, rise: 74, range: 130 });
  skyLanterns.points.layers.enable(BLOOM_SCENE);
  const waterMotes = new WaterMotes(renderer.scene, 700, 13);
  applyGraphics(graphics.profile);

  /* ---------------- 输入 ---------------- */
  const skillByDigit = { Digit1: "breath", Digit2: "fireball", Digit3: "dash", Digit4: "roar" };
  function openInventory() {
    if (state.mode !== "play" || mount.active) return;
    state.mode = "inventory";
    releasePointer();
    invUI.show();
  }

  window.addEventListener("keydown", (e) => {
    // 设置窗口打开时：ESC / O 关闭，其余按键不进游戏
    if (settingsUI.isOpen) {
      if (e.code === "Escape" || e.code === "KeyO") settingsUI.close();
      return;
    }
    if (e.code === "KeyO" && (state.mode === "play" || state.mode === "paused" || state.mode === "title")) {
      openSettings();
      return;
    }
    if (e.code === "KeyE" && (state.mode === "play" || state.mode === "inventory")) {
      if (state.mode === "play") openInventory();
      else invUI.close();
      return;
    }
    if (e.code === "Escape" && state.mode === "inventory") {
      invUI.close();
      return;
    }
    // 全屏时 ESC 由游戏接管（键盘锁）：轻按暂停，不会把玩家踢出全屏
    if (e.code === "Escape" && state.mode === "play") {
      pauseGame();
      return;
    }
    if (state.mode !== "play") return;
    if (e.repeat) return;
    if (e.code === "KeyF") {
      if (!health.dead) mount.toggle();
      return;
    }
    if (mount.active && skillByDigit[e.code]) {
      const id = skillByDigit[e.code];
      if (id === "breath") mount.setBreath(true);
      else mount.useSkill(id);
      return;
    }
    if (e.code === "KeyV") {
      const m = player.cycleMode();
      hud.showItemName(CAMERA_LABELS[m]);
      hud.setLocked(player.locked);
    }
    if (e.code === "KeyB") {
      player.headBob = !player.headBob;
      hud.showItemName(player.headBob ? "HEAD BOB ON" : "HEAD BOB OFF");
    }
    if (e.code === "KeyT") {
      daynight.speed = daynight.speed >= 40 ? 1 : daynight.speed * 4;
      hud.showItemName(`TIME SPEED x${daynight.speed}`);
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Digit1" && mount.active) mount.setBreath(false);
  });
  // 骑乘时鼠标：左键按住吐息、右键末影火球
  canvas.addEventListener("mousedown", (e) => {
    if (state.mode !== "play" || !player.locked || !mount.active) return;
    if (e.button === 0) mount.setBreath(true);
    else if (e.button === 2) mount.useSkill("fireball");
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0 && mount.active) mount.setBreath(false);
  });

  // 触屏操作层（手机 / 平板）
  const touch = touchMode
    ? new TouchControls({
      player,
      interaction,
      mount,
      skillEls: rpgHud.skillEls,
      click: () => audio.uiClick(),
      onPause: () => { if (state.mode === "play") pauseGame(); },
      onInventory: () => openInventory(),
      onMount: () => { if (!health.dead) mount.toggle(); },
      onCamera: () => {
        const m = player.cycleMode();
        hud.showItemName(CAMERA_LABELS[m]);
        hud.setLocked(player.engaged);
      },
    })
    : null;
  if (touchMode) rpgHud.setTouchMode(true);
  // 游戏中转成竖屏：自动暂停（竖屏提示盖住画面时不能让角色继续挨打 / 下坠）
  rotateGuard.onPortrait = () => { if (state.mode === "play") pauseGame(); };

  // 预生成玩家周围区块
  // 注意：每轮必须让出主线程，否则长时间阻塞会让浏览器判定页面无响应。
  hud0.set(0.7, "BUILDING CHUNKS...");
  await frame();
  chunks.update(player.position, true);
  const totalQueued = Math.max(1, chunks.queue.length);
  let guard = 0;
  while (chunks.queue.length && guard < 600) {
    chunks.processDirty(2);
    guard++;
    const done = totalQueued - chunks.queue.length;
    hud0.set(0.7 + Math.min(0.28, (done / totalQueued) * 0.28), "BUILDING CHUNKS...");
    await frame();
  }
  hud0.set(1, "READY");
  await frame();
  hud.hideLoading();

  /* ---------------- 开场 cinematic 巡游镜头 ---------------- */
  // 从高空缓推入城：新游戏的第一印象
  const CINE_KEY = [
    { t: 0.0, pos: [0, 178, 268], look: [0, 90, -70] },
    { t: 0.35, pos: [46, 132, 178], look: [0, 82, -60] },
    { t: 0.68, pos: [22, 86, 128], look: [0, 62, -70] },
    { t: 1.0, pos: [0, 48, 96], look: [0, 42, -60] },
  ];
  const cinematic = { active: false, t: 0, dur: 7.5 };
  const _cp = new THREE.Vector3();
  const _cl = new THREE.Vector3();

  function sampleCine(u, outPos, outLook) {
    let i = 0;
    while (i < CINE_KEY.length - 2 && CINE_KEY[i + 1].t <= u) i++;
    const a = CINE_KEY[i], b = CINE_KEY[i + 1];
    const f = Math.max(0, Math.min(1, (u - a.t) / (b.t - a.t || 1)));
    const s = f * f * (3 - 2 * f);
    outPos.set(
      a.pos[0] + (b.pos[0] - a.pos[0]) * s,
      a.pos[1] + (b.pos[1] - a.pos[1]) * s,
      a.pos[2] + (b.pos[2] - a.pos[2]) * s,
    );
    outLook.set(
      a.look[0] + (b.look[0] - a.look[0]) * s,
      a.look[1] + (b.look[1] - a.look[1]) * s,
      a.look[2] + (b.look[2] - a.look[2]) * s,
    );
  }

  function updateCinematic(dt) {
    cinematic.t += dt / cinematic.dur;
    const u = Math.min(1, cinematic.t);
    sampleCine(u, _cp, _cl);
    renderer.camera.position.copy(_cp);
    renderer.camera.lookAt(_cl);
    renderer.camera.fov = 62;
    renderer.camera.updateProjectionMatrix();
    if (u >= 1) cinematic.active = false;
  }

  function startCinematic() {
    cinematic.active = true;
    cinematic.t = 0;
  }

  /* ---------------- 主循环 ---------------- */
  const clock = new THREE.Clock();
  let fpsAcc = 0;
  let fpsFrames = 0;
  let fps = 60;
  let elapsed = 0;
  let frameCount = 0;
  const sunTarget = new THREE.Vector3();
  const _push = new THREE.Vector3();
  const _probe = new THREE.Vector3();

  function loop() {
    requestAnimationFrame(loop);
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.1);
    elapsed += dt;
    const playing = state.mode === "play";

    // 昼夜
    const st = daynight.update(dt);
    renderer.setSunDir(st.lightDir);
    renderer.applyDayNight(st, sky);

    // 死亡 / 菜单中：不接受移动输入
    if (!playing) player.keys.clear();
    interaction.enabled = playing && !mount.active && !health.dead;

    // 玩家
    player.update(dt);

    // 玩家与假人的碰撞：圆柱推开（假人不是方块，不在体素碰撞里）
    for (const d of dummies) {
      const dx = player.position.x - d.pos.x, dz = player.position.z - d.pos.z;
      const r = d.radius + player.hw;
      const dist = Math.hypot(dx, dz);
      if (dist < r && dist > 1e-4 && player.position.y < d.pos.y + d.height && player.position.y + player.bh > d.pos.y) {
        _push.set(dx / dist, 0, dz / dist).multiplyScalar(r - dist);
        if (!player.collides(player.position.x + _push.x, player.position.y, player.position.z + _push.z)) {
          player.position.add(_push);
        }
      }
    }

    // 坐骑（骑乘时负责化身落座；离场动画、火球、残云在未骑乘时也要继续）
    mount.update(dt);

    // 化身：姿势由状态驱动
    if (player.mode !== "debug") avatar.setMode(player.mode);
    const debugShot = player.mode === "debug";
    if (!mount.active) {
      avatar.placeTo(player.position);
      avatar.group.rotation.z = 0;
    }
    avatar.update(dt, {
      swimming: player.swimming,
      submersion: player.submersion,
      onGround: player.onGround,
      speed: Math.hypot(player.velocity.x, player.velocity.z),
      sprinting: player.sprinting,
      crouching: player.crouching,
      riding: mount.active,
      rideBank: mount.bank,
      yaw: mount.active ? mount.yaw : player.yaw,
      pitch: player.pitch,
    });

    // 游戏系统
    if (playing || state.mode === "inventory") {
      health.update(dt, player);
      state.playTime += dt;
    }
    combat.update(dt);
    drops.update(dt, player, inventory);
    torches.update(dt, player.position);
    save.update(dt);

    // 区块流式加载
    chunks.update(player.position);
    chunks.processDirty(2);
    if ((frameCount % 15) === 0) hud.setChunkProgress(chunks.queue.length);
    // 距离剔除（每 6 帧一次，降低开销）
    if ((frameCount++ % 6) === 0) chunks.cull(player.position);

    // 太阳阴影相机跟随
    sunTarget.set(player.position.x, player.position.y, player.position.z);
    renderer.followSun(sunTarget);

    // 实体光照：玩家 / 龙 / 假人按所在位置采样烘焙光照（灯笼、火把的光都在体素光照里，不再有实时点光源）
    _probe.set(player.position.x, player.position.y + player.eyeH * 0.8, player.position.z);
    avatarLight.update(_probe, dt);
    if (mount.model.root.visible) dragonLight.update(mount.model.root.position, dt);
    for (let i = 0; i < dummies.length; i++) {
      const d = dummies[i];
      _probe.set(d.pos.x, d.pos.y + 1.2, d.pos.z);
      dummyLights[i].update(_probe, dt);
    }

    // 光核亮度随昼夜：白天几乎不可见，入夜拉满
    glowCore.mat.opacity = 0.04 + st.night * 0.36 + st.warm * 0.1;
    glowCore.mat.color.setRGB(1.0, 0.72 + st.night * 0.14, 0.42 + st.night * 0.10);

    // 交互高亮 + 攻击冷却
    interaction.update(dt);

    // 天空跟随 / 水面
    sky.update(renderer.camera, elapsed);
    renderer.tick(elapsed);
    // 水下氛围（雾色/雾距/曝光），必须在 applyDayNight 之后、render 之前
    renderer.updateWaterView(dt);

    // 音频：水下滤波
    audio.update(dt, st.night, player.headUnderwater);

    // 居民
    npcs.update(dt, player.position, { camera: renderer.camera, night: st.night, mounted: mount.active });

    // 环境粒子与特效
    // 不受光照的粒子（花瓣、香烟）跟着昼夜变暗：夜里只剩微光，不会满屏发亮
    const dim = 0.22 + 0.78 * (1 - st.night) + st.warm * 0.1;
    petals.uniforms.uBright.value = dim;
    petals.uniforms.uPx.value = renderer.pixelRatio * window.innerHeight / 900;
    smoke.uniforms.uBright.value = dim;
    petals.update(elapsed, player.position, dt);
    smoke.update(elapsed);
    lanternSway.update(elapsed);
    mist.update(elapsed, renderer.camera, st.night);
    skyLanterns.update(elapsed, player.position, st.night);
    waterMotes.update(elapsed, renderer.camera, renderer.underwaterBlend);
    fx.update(dt);

    // 固定机位（截图 / 验收）不显示第一人称视模型
    if (debugShot) avatar.viewArms.visible = false;
    // 标题页：HUD 与第一人称视模型都不显示
    document.body.classList.toggle("in-title", state.mode === "title");
    if (state.mode === "title") avatar.viewArms.visible = false;

    // 开场 cinematic 巡游镜头；标题页时镜头在高空缓慢环绕主城
    if (cinematic.active) updateCinematic(dt);
    else if (state.mode === "title") {
      const a = elapsed * 0.045;
      renderer.camera.position.set(Math.sin(a) * 150, 108, Math.cos(a) * 150 - 10);
      renderer.camera.lookAt(0, 52, -14);
      renderer.camera.fov = 58;
      renderer.camera.updateProjectionMatrix();
    }

    // 渲染
    renderer.updateSunScreen();
    renderer.render();

    // 统计
    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc >= 0.5) {
      fps = Math.round(fpsFrames / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }
    hud.update(dt, {
      fps,
      chunks: chunks.loadedChunks,
      tris: chunks.triangles,
    });
    rpgHud.update(dt);
    touch?.update(playing);
    settingsUI.update(fps);
    governor.update(rawDt, state.mode === "play" || state.mode === "title");
  }

  loop();

  // 暴露给自动化测试 / 截图脚本
  window.__pandaria = {
    app,
    state,
    renderer,
    world,
    gen,
    nav,
    chunks,
    player,
    avatar,
    audio,
    daynight,
    interaction,
    hud,
    rpgHud,
    invUI,
    menus,
    atlas,
    sky,
    npcs,
    petals,
    smoke,
    fx,
    combat,
    edits,
    inventory,
    health,
    drops,
    torches,
    mount,
    dummies,
    save,
    events,
    graphics,
    governor,
    settingsUI,
    touch,
    touchMode,
    fullscreen,
    openSettings,
    BLOCKS,
    ITEMS,
    dropForBlock,
    isTorch,
    /** 无指针锁定地进入游戏（自动化验收用：跳过标题页，起始物品与新游戏一致） */
    quickStart() {
      inventory.clear();
      for (const [id, n] of STARTER_KIT) inventory.add(id, n);
      inventory.select(0);
      menus.hideTitle();
      state.mode = "play";
      syncHeld();
      // 触屏：直接由触屏层接管（键鼠这里不请求指针锁定 —— 没有手势会被拒绝并进入暂停）
      if (touchMode) lockPointer();
      return true;
    },
    applySave,
    setTime(t) {
      daynight.time = t;
      daynight.playing = false;
      daynight.sample(t);
      renderer.setSunDir(daynight.state.lightDir);
      renderer.applyDayNight(daynight.state, sky);
    },
    teleport(x, y, z, yaw, pitch) {
      player.position.set(x, y, z);
      player.velocity.set(0, 0, 0);
      player.resetFall();
      if (yaw !== undefined) {
        player.yaw = yaw;
        player.targetYaw = yaw;
      }
      if (pitch !== undefined) {
        player.pitch = pitch;
        player.targetPitch = pitch;
      }
      chunks.update(player.position, true);
    },
    setMode(m) {
      player.mode = m;
      avatar.setMode(m);
    },
    /** 截图/验收机位：相机固定到 pos 看向 look，控制器不再接管；showBody 决定是否显示化身全身。 */
    debugCamera(pos, look, showBody = true) {
      cinematic.active = false;
      player.mode = "debug";
      avatar.setMode(showBody ? "third" : "first");
      renderer.camera.position.set(pos[0], pos[1], pos[2]);
      renderer.camera.lookAt(look[0], look[1], look[2]);
    },
    /** 重放开场巡游镜头。 */
    playCinematic: () => startCinematic(),
    /** 全城最佳俯瞰机位（浮岛高度，朝主殿与通天塔）。 */
    heroView() {
      cinematic.active = false;
      player.flying = true;
      player.position.set(-14, 142, 62);
      player.velocity.set(0, 0, 0);
      player.yaw = Math.PI + 0.18;
      player.targetYaw = player.yaw;
      player.pitch = -0.30;
      player.targetPitch = player.pitch;
      chunks.update(player.position, true);
    },
    /** 切换画质档位（"auto" | "low" | "medium" | "high" | "ultra"），返回生效的配置。 */
    setQuality(level) {
      graphics.setMode(level);
      applyGraphics(graphics.profile);
      settingsUI.sync();
      return graphics.profile;
    },
    hideHud(v) {
      document.getElementById("hud").style.display = v ? "none" : "";
      document.getElementById("overlay").classList.add("hidden");
    },
    stats() {
      return {
        fps,
        chunks: chunks.loadedChunks,
        tris: chunks.triangles,
        pos: player.position.toArray().map((n) => +n.toFixed(1)),
        errors: app.errors,
        info: renderer.renderer.info.render,
        npcs: npcs.stats(),
        mode: state.mode,
        hp: health.hp,
        mounted: mount.active,
        edits: edits.count,
        torches: torches.map.size,
        drops: drops.drops.length,
        particles: fx.alive,
      };
    },
    /** 运行碰撞自动化测试（返回结构化结果）。 */
    runCollisionTests: () => runSuite(COLLISION_TEST_SOURCE),
    /** 运行浮岛可达性验收测试。 */
    runIslandAccessTests: () => runSuite(ISLAND_ACCESS_TEST_SOURCE),
    /** 运行世界底/虚空保护测试。 */
    runWorldGuardTests: () => runSuite(WORLDGUARD_TEST_SOURCE),
    /** 运行水体 / 游泳测试。 */
    runWaterTests: () => runSuite(WATER_TEST_SOURCE),
    /** 运行交互 / 化身质量回归测试。 */
    runQualityTests: () => runSuite(QUALITY_TEST_SOURCE),
    /** 运行 RPG 系统测试（生命 / 背包 / 掉落 / 火把 / 战斗 / 坐骑 / 存档）。 */
    runRpgTests: () => runSuite(RPG_TEST_SOURCE),
    /** 运行居民导航与行为测试。 */
    runNpcTests: () => runSuite(NPC_TEST_SOURCE),
    /** 运行基础体验测试（光照 / 阴影 / 画质 / 蹲下疾跑 / 触屏 / 设置窗口 / 自动降档）。 */
    runUxTests: () => runSuite(UX_TEST_SOURCE),
  };

  /**
   * 测试运行器：每个套件在干净的「测试态」里跑 —— 不触发死亡流程、交互可用、未骑乘、满血；
   * 结束后恢复原状态。（碰撞测试会故意让玩家掉出世界，不能因此把后续套件锁在死亡界面里。）
   */
  function runSuite(src) {
    const prev = { mode: state.mode, pos: player.position.clone(), yaw: player.yaw, pitch: player.pitch, cam: player.mode };
    if (mount.active) mount.dismiss();
    state.mode = "test";
    if (health.dead) health.respawn();
    interaction.enabled = true;
    const restore = () => {
      if (health.dead) health.respawn();
      document.getElementById("death")?.classList.remove("open");
      state.mode = prev.mode === "dead" ? "play" : prev.mode;
      player.position.copy(prev.pos);
      player.velocity.set(0, 0, 0);
      player.yaw = player.targetYaw = prev.yaw;
      player.pitch = player.targetPitch = prev.pitch;
      player.mode = prev.cam;
      player.flying = false;
      chunks.update(player.position, true);
    };
    let res;
    try {
      // eslint-disable-next-line no-eval
      res = eval(src);
    } catch (err) {
      restore();
      throw err;
    }
    // 异步套件（浮岛可达性）要等它跑完再恢复
    if (res && typeof res.then === "function") return res.finally(restore);
    restore();
    return res;
  }

  // 标题页：导入存档后的重载直接进入游戏；否则显示菜单
  if (SaveManager.consumeAutoload()) {
    try {
      const d = await save.load();
      if (d) {
        applySave(d);
        menus.hideTitle();
        state.mode = "paused";
        save.enabled = true;
        syncHeld();
        menus.showPause();
        menus.pauseMessage("SAVE FILE LOADED - CLICK RESUME", "#6fc0ae");
      }
    } catch (err) {
      menus.showTitle(await save.peek());
      menus.titleMessage(`LOAD FAILED: ${String(err.message || err).toUpperCase()}`);
    }
  } else {
    menus.showTitle(await save.peek());
  }
  app.ready = true;
}

function frame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

boot().catch((err) => {
  app.errors.push(String(err && err.stack ? err.stack : err));
  const msg = document.getElementById("loadmsg");
  if (msg) msg.textContent = "BOOT FAILED: " + err;
  console.error(err);
});
