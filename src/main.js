/**
 * 潘达利亚 · 体素 —— 入口
 * 组装：纹理图集 → 世界生成 → 区块网格 → 玩家 → 光照/昼夜 → 后处理 → HUD
 */
import * as THREE from "three";
import { TextureAtlas } from "./world/atlas.js";
import { WorldGenerator, CITY } from "./world/generator.js";
import { ChunkManager } from "./world/chunkManager.js";
import { Renderer } from "./core/renderer.js";
import { Sky } from "./core/sky.js";
import { DayNight } from "./core/daynight.js";
import { Player, CAMERA_LABELS } from "./player/controller.js";
import { Interaction } from "./player/interaction.js";
import { HUD } from "./ui/hud.js";
import { NPCManager } from "./world/npc.js";
import { CITY_PLAN } from "./world/cityPlan.js";
import { PetalField, SmokeField, LanternSway, MistLayers, SkyLanterns } from "./core/particles.js";
import { COLLISION_TEST_SOURCE } from "../tests/collision.test.mjs";
import { ISLAND_ACCESS_TEST_SOURCE } from "../tests/island-access.test.mjs";
import { BLOCKS } from "./world/blocks.js";
import { installPixelUI } from "./ui/pixelui.js";
import { attachPixelText } from "./ui/pixelfont.js";
import { WORLDGUARD_TEST_SOURCE } from "../tests/worldguard.test.mjs";

// 像素风界面必须在任何内容渲染前装好（含加载页）
installPixelUI();

const canvas = document.createElement("canvas");
canvas.id = "scene";
document.body.insertBefore(canvas, document.getElementById("hud"));

const app = {
  ready: false,
  errors: [],
};

window.addEventListener("error", (e) => app.errors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => app.errors.push(String(e.reason)));

/* ---------------- 启动流程 ---------------- */
async function boot() {
  const renderer = new Renderer(canvas);
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

  // 2. 世界生成
  const gen = new WorldGenerator(20261014);
  const world = gen.generate();
  hud0.set(0.55, "RAISING THE CITY...");
  await frame();

  // 3. 天空与昼夜
  const sky = new Sky(renderer.scene);
  const daynight = new DayNight();
  daynight.sample(daynight.time);
  renderer.setSunDir(daynight.state.sunDir);
  renderer.applyDayNight(daynight.state, sky);
  // 平面反射：水面高度用荷花池水面（城台顶面）
  renderer.initReflection(CITY.baseY + 1);

  // 4. 区块网格
  const chunks = new ChunkManager(world, atlas, renderer, {
    viewDistance: 7,
    budgetPerFrame: 3,
  });

  // 5. 玩家
  const player = new Player(world, renderer.camera, canvas);
  player.spawnAt(world);

  // 6. 交互
  const interaction = new Interaction(world, renderer.camera, player, renderer.scene);
  // 7. HUD
  const hud = new HUD(atlas, player, daynight, interaction, world);
  player.onLockChange = (locked) => {
    hud.setLocked(locked);
    hud.setPaused(!locked);
  };

  // 设置面板回调
  hud.onQuality = (level) => {
    const p = window.__pandaria.setQuality(level);
    return p;
  };
  hud.onShadow = (on) => {
    renderer.renderer.shadowMap.enabled = on;
    renderer.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
  };
  hud.onBloom = (on) => {
    renderer.bloom.enabled = on;
  };

  // 暂停菜单点击继续
  document.getElementById("pause").addEventListener("click", () => {
    canvas.requestPointerLock();
  });

  // 7.5 灯笼光核：在每个灯笼位置放一个高亮自发光小球，
  //     给 bloom 一个明确的溢光源（体素本身受贴图限制，亮度不够）
  const glowCore = (() => {
    const geo = new THREE.SphereGeometry(0.34, 10, 8);
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
    renderer.scene.add(inst);
    return { mesh: inst, mat, count: positions.length, positions };
  })();

  // 7.6 NPC：熊猫人主城的居民（巡逻 / 驻足 / 交谈 / 招手）
  const npcs = new NPCManager(world, renderer.scene, CITY_PLAN.npcPaths, 32);

  // 7.7 环境粒子：飘落花瓣 / 竹叶 + 香炉烟雾 + 灯笼摇摆
  const petals = new PetalField(renderer.scene, 900, { range: 28 });
  const smokeSources = [];
  for (const lm of gen.landmarks) {
    if (lm.type === "lantern" && smokeSources.length < 14) {
      smokeSources.push([lm.pos[0] + 0.5, lm.pos[1] + 1.2, lm.pos[2] + 0.5]);
    }
  }
  const smoke = new SmokeField(renderer.scene, smokeSources, 22);
  const lanternSway = new LanternSway(glowCore.mesh, glowCore.positions);
  // 分层雾带：大气透视的纵深来源
  const mist = new MistLayers(renderer.scene, [38, 46, 56, 70]);
  // 孔明灯：夜间升空的暖色光点
  const skyLanterns = new SkyLanterns(renderer.scene, 120, { baseY: 36, rise: 74, range: 130 });

  // 虚空重生反馈：淡出 → 重生 → 淡入 + 提示
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
  };
  interaction.onBlocked = (msg) => hud.showItemName(msg);

  // 开场遮罩点击进入（先放一段 cinematic 巡游，再交还给玩家）
  document.getElementById("overlay").addEventListener("click", () => {
    if (cinematic.active) return;
    startCinematic();
    setTimeout(() => canvas.requestPointerLock(), 300);
  });

  // 快捷键
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyV") {
      const m = player.cycleMode();
      hud.showItemName(CAMERA_LABELS[m]);
      hud.setLocked(player.locked);
    }
    if (e.code === "KeyF") {
      player.flying = !player.flying;
      player.velocity.set(0, 0, 0);
      hud.showItemName(player.flying ? "FLY MODE" : "WALK MODE");
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

  /* ---------------- 主循环 ---------------- */
  const clock = new THREE.Clock();
  let fpsAcc = 0;
  let fpsFrames = 0;
  let fps = 60;
  let elapsed = 0;
  let frameCount = 0;
  const sunTarget = new THREE.Vector3();

  /* ---------------- 开场 cinematic 巡游镜头 ---------------- */
  // 从高空缓推入城：大幅提升第一印象的震撼度
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

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1);
    elapsed += dt;

    // 昼夜
    const st = daynight.update(dt);
    renderer.setSunDir(st.sunDir);
    renderer.applyDayNight(st, sky);

    // 玩家
    player.update(dt);

    // 区块流式加载
    chunks.update(player.position);
    chunks.processDirty(2);

    // 区块加载进度提示
    if ((frameCount % 15) === 0) hud.setChunkProgress(chunks.queue.length);

    // 距离剔除（每 6 帧一次，降低开销）
    if ((frameCount++ % 6) === 0) chunks.cull(player.position);

    // 太阳阴影相机跟随
    sunTarget.set(player.position.x, player.position.y, player.position.z);
    renderer.followSun(sunTarget);

    // 灯笼点光源池：取最近的若干盏（数量预算，避免性能崩掉）
    const near = chunks.collectLanterns(gen.landmarks, player.position, 40);
    const nightBoost = 0.25 + st.night * 3.4 + st.warm * 0.5;
    for (let i = 0; i < renderer.lanternLights.length; i++) {
      const l = renderer.lanternLights[i];
      const item = near[i];
      if (!item) {
        l.intensity = 0;
        continue;
      }
      l.position.set(item.pos[0] + 0.5, item.pos[1] + 0.5, item.pos[2] + 0.5);
      const falloff = 1 - Math.min(1, Math.sqrt(item.d2) / 40);
      l.intensity = nightBoost * (0.5 + falloff * 1.6) * 22;
    }

    // 光核亮度随昼夜：白天几乎不可见，入夜拉满
    glowCore.mat.opacity = 0.10 + st.night * 0.90 + st.warm * 0.25;
    glowCore.mat.color.setRGB(
      1.0,
      0.72 + st.night * 0.14,
      0.42 + st.night * 0.10,
    );

    // 交互高亮
    interaction.update();

    // 天空跟随
    sky.update(renderer.camera, elapsed);

    // 水面波动
    renderer.tick(elapsed);

    // 水下氛围（雾色/雾距/曝光），必须在 applyDayNight 之后、render 之前
    renderer.updateWaterView(dt);

    // NPC 更新
    npcs.update(dt);

    // 环境粒子
    petals.update(elapsed, player.position);
    smoke.update(elapsed);
    lanternSway.update(elapsed);
    mist.update(elapsed, renderer.camera, st.night);
    skyLanterns.update(elapsed, player.position, st.night);

    // 开场 cinematic 巡游镜头
    if (cinematic.active) updateCinematic(dt);

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
  }

  loop();

  // 暴露给自动化测试 / 截图脚本
  window.__pandaria = {
    app,
    renderer,
    world,
    gen,
    chunks,
    player,
    daynight,
    interaction,
    hud,
    atlas,
    sky,
    npcs,
    petals,
    smoke,
    BLOCKS,
    setTime(t) {
      daynight.time = t;
      daynight.playing = false;
      daynight.sample(t);
      renderer.setSunDir(daynight.state.sunDir);
      renderer.applyDayNight(daynight.state, sky);
    },
    teleport(x, y, z, yaw, pitch) {
      player.position.set(x, y, z);
      player.velocity.set(0, 0, 0);
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
    setQuality(level) {
      const p = chunks.setQuality(level);
      const shadow = level === "low" ? 1024 : level === "medium" ? 1536 : 2048;
      renderer.sun.shadow.mapSize.set(shadow, shadow);
      if (renderer.sun.shadow.map) {
        renderer.sun.shadow.map.dispose();
        renderer.sun.shadow.map = null;
      }
      renderer.bloom.enabled = level !== "low";
      return p;
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
      };
    },
    /** 运行碰撞自动化测试（返回结构化结果）。 */
    runCollisionTests() {
      // eslint-disable-next-line no-eval
      return eval(COLLISION_TEST_SOURCE);
    },
    /** 运行浮岛可达性验收测试。 */
    runIslandAccessTests() {
      // eslint-disable-next-line no-eval
      return eval(ISLAND_ACCESS_TEST_SOURCE);
    },
    /** 运行世界底/虚空保护测试。 */
    runWorldGuardTests() {
      // eslint-disable-next-line no-eval
      return eval(WORLDGUARD_TEST_SOURCE);
    },
  };
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
