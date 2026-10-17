/**
 * NPC 系统 —— 主城居民。
 *
 * 外观：与玩家（杰杰）同一套 Minecraft 人形骨架 + 64×64 皮肤。
 *   10 种职业皮肤竖排成一张图集，6 个部件 × 2 层 = 12 个 InstancedMesh，
 *   每个实例用 aRole 属性在着色器里偏移 UV 选皮肤 —— 140 个 NPC 也只有 12 个 draw call。
 *
 * 移动（这次从根上保证「不穿墙、不下水、不悬空」）：
 *   · 寻路在逐格导航网格上做（navgrid.js），路径已按身体半径校验过
 *   · 每一步位移都要过 nav.bodyFits()：身体半径内任一点落在墙 / 水 / 断崖上，这一步就不走
 *     （先整体试，再按轴分别试 —— 贴墙滑行），推挤与避让也只是速度，同样要过这道检查
 *   · 高度不靠物理积分，直接贴导航面（上下台阶做平滑），不存在下落 / 浮空 / 沉底
 *   · 卡住检测：2 秒内几乎没有前进就重新寻路，连续失败换目的地
 *
 * 行为（轻量效用 AI）：
 *   · 职业决定去处：守卫巡城门、商人守摊吆喝、武僧往返殿前与广场、居民在兴趣点间闲逛
 *   · 到达兴趣点后驻足张望；同一处遇到别的闲人就停下来聊天（互相面对、比手势、冒气泡）
 *   · 玩家靠近：转头看你、停下打招呼；你撞过来会侧身让开
 *   · 玩家骑龙飞过：抬头看、有人惊呼
 *   · 入夜：多数人聚到灯笼长街
 */
import * as THREE from "three";
import { PARTS, partGeometry, paintRoleSkin, PX } from "../player/skin.js";
import { renderText } from "../ui/pixelfont.js";
import { isSolid, isLiquid } from "./blocks.js";

/* ------------------------------------------------------------------ */
/* 职业                                                                 */
/* ------------------------------------------------------------------ */

const SKIN = { skin: "#e9b98f", skinDark: "#d39f76", eye: "#2b2b33", mouth: "#b07060" };

export const NPC_ROLES = {
  guard: {
    label: "GUARD", scale: 1.04, speed: 1.6,
    colors: { ...SKIN, hair: "#2b2220", hat: "#3a4a52", hatTrim: "#e8b44a", robe: "#b5352a", belt: "#e8b44a", trim: "#e8b44a", pants: "#3a2a24", boots: "#1e1a18" },
  },
  merchant: {
    label: "MERCHANT", scale: 1.0, speed: 1.2,
    colors: { ...SKIN, hair: "#3d2a1d", hat: "#8c6a3f", hatTrim: "#5a4224", robe: "#3f8f80", belt: "#f6d99b", trim: "#f6d99b", pants: "#4a3a2c", boots: "#2a2018" },
  },
  monk: {
    label: "MONK", scale: 1.0, speed: 1.05,
    colors: { ...SKIN, hair: "#e2b791", robe: "#e0a83a", belt: "#a8321f", trim: "#a8321f", pants: "#c08a2a", boots: "#5a3a1e" },
  },
  monk_fighter: {
    label: "WARRIOR MONK", scale: 1.05, speed: 1.6,
    colors: { ...SKIN, hair: "#1d1a19", hat: "#232f35", robe: "#34434b", belt: "#4a9e8f", trim: "#4a9e8f", pants: "#232f35", boots: "#151a1d" },
  },
  child: {
    label: "CHILD", scale: 0.74, speed: 2.0,
    colors: { ...SKIN, hair: "#4a3020", robe: "#7fa650", belt: "#ffe08a", trim: "#ffe08a", pants: "#516d2c", boots: "#3a2a1a" },
  },
  elder: {
    label: "ELDER", scale: 0.96, speed: 0.85,
    colors: { ...SKIN, hair: "#dcdcd8", hat: "#4a545a", robe: "#6e7a80", belt: "#ded7c6", trim: "#ded7c6", pants: "#4a545a", boots: "#2a2e31" },
  },
  farmer: {
    label: "FARMER", scale: 1.0, speed: 1.3,
    colors: { ...SKIN, skin: "#d9a173", skinDark: "#c08a5e", hair: "#3a2a1a", hat: "#d8c27a", hatTrim: "#a8904a", robe: "#6b8aa8", belt: "#4a3a2a", trim: "#d8c27a", pants: "#4a5a6a", boots: "#3a2a1a" },
  },
  scholar: {
    label: "SCHOLAR", scale: 1.0, speed: 1.1,
    colors: { ...SKIN, hair: "#1b1716", hat: "#1b1716", robe: "#e9e1cf", belt: "#3a4a52", trim: "#3a4a52", pants: "#c9c0ab", boots: "#2a2a2a" },
  },
  lady: {
    label: "LADY", scale: 0.98, speed: 1.15,
    colors: { ...SKIN, hair: "#1f1715", robe: "#c95a7a", belt: "#ffe08a", trim: "#f7bccd", pants: "#a8475f", boots: "#5a2a3a", hat: "#1f1715", hatTrim: "#e8b44a" },
  },
  fisher: {
    label: "FISHER", scale: 1.02, speed: 1.25,
    colors: { ...SKIN, skin: "#d29a6c", skinDark: "#b98258", hair: "#2a201a", hat: "#c9a75e", hatTrim: "#8f7438", robe: "#3e6f8c", belt: "#c9a75e", trim: "#c9a75e", pants: "#2f4f62", boots: "#222" },
  },
};
const ROLE_KEYS = Object.keys(NPC_ROLES);

const GREETINGS = {
  guard: ["HALT, TRAVELER", "KEEP THE PEACE", "THE GATE IS SAFE"],
  merchant: ["FINE WARES!", "TAKE A LOOK!", "GOOD PRICES TODAY"],
  monk: ["PEACE BE WITH YOU", "BREATHE, FRIEND"],
  monk_fighter: ["GREETINGS", "STRIKE TRUE", "TRAIN WITH US"],
  child: ["HI HI!", "WANNA PLAY?", "COOL HOODIE!"],
  elder: ["WELCOME, YOUNG ONE", "MIND THE MIST"],
  farmer: ["GOOD HARVEST!", "HELLO THERE"],
  scholar: ["WELL MET", "HAVE YOU READ?"],
  lady: ["WHAT A LOVELY DAY", "HELLO, JJ"],
  fisher: ["FISH ARE BITING", "AHOY!"],
};
const CALLOUTS = ["FRESH TEA!", "SILK AND JADE!", "HOT NOODLES!", "LANTERNS, TWO COIN!", "PEACHES! SWEET PEACHES!"];
const CHATTER = [
  "DID YOU SEE THE DRAGON?", "THE TEA IS FINE TODAY", "LANTERNS TONIGHT!", "THE MISTS ARE THICK",
  "MY KNEES ACHE", "HA HA HA!", "TRULY?", "I HEARD A RUMOR...", "SO CHEAP!", "THE POND IS CALM",
  "BUSY DAY", "THE TOWER IS SO TALL", "MIND THE STEPS", "HAVE YOU EATEN?",
];
const DRAGON_SHOUTS = ["A DRAGON!", "LOOK UP!", "WOW!", "SO BIG!"];

/* ------------------------------------------------------------------ */
/* 地点                                                                 */
/* ------------------------------------------------------------------ */

/** 兴趣点（x, z）与偏好它的职业。坐标会被吸附到导航网格上最近的可走格。 */
const POIS = [
  { name: "gate", at: [0, 92], roles: ["guard", "farmer", "fisher"] },
  { name: "avenue_s", at: [0, 70], roles: ["farmer", "lady", "child", "scholar"] },
  { name: "avenue_n", at: [0, 44], roles: ["lady", "child", "elder", "scholar"] },
  { name: "east_market", at: [24, 34], roles: ["merchant", "lady", "farmer", "child"] },
  { name: "east_market2", at: [24, 6], roles: ["merchant", "elder", "farmer"] },
  { name: "west_market", at: [-24, 34], roles: ["merchant", "lady", "fisher", "child"] },
  { name: "west_market2", at: [-24, 6], roles: ["merchant", "scholar", "fisher"] },
  { name: "plaza_e", at: [20, 10], roles: ["elder", "child", "lady", "fisher"] },
  { name: "plaza_w", at: [-20, 10], roles: ["elder", "scholar", "fisher"] },
  { name: "plaza_s", at: [0, 28], roles: ["child", "lady", "monk", "farmer"] },
  { name: "forecourt", at: [0, -28], roles: ["monk", "monk_fighter", "scholar", "elder"] },
  { name: "forecourt_e", at: [12, -32], roles: ["monk_fighter", "monk"] },
  { name: "forecourt_w", at: [-12, -32], roles: ["monk_fighter", "monk"] },
];

/** 固定岗位：守卫守城门、商人守摊、武僧在殿前操练。 */
export const STATIONS = [
  { role: "guard", pos: [-6, 96], yaw: 0 }, { role: "guard", pos: [6, 96], yaw: 0 },
  { role: "guard", pos: [-4, 60], yaw: Math.PI / 2 }, { role: "guard", pos: [4, -22], yaw: 0 },
  { role: "merchant", pos: [24, 40], yaw: -Math.PI / 2 }, { role: "merchant", pos: [24, 28], yaw: -Math.PI / 2 },
  { role: "merchant", pos: [24, 10], yaw: -Math.PI / 2 }, { role: "merchant", pos: [-24, 40], yaw: Math.PI / 2 },
  { role: "merchant", pos: [-24, 28], yaw: Math.PI / 2 }, { role: "merchant", pos: [-24, 10], yaw: Math.PI / 2 },
  { role: "monk_fighter", pos: [-6, -30], yaw: 0 }, { role: "monk_fighter", pos: [0, -30], yaw: 0 },
  { role: "monk_fighter", pos: [6, -30], yaw: 0 }, { role: "monk", pos: [0, -36], yaw: Math.PI },
  { role: "elder", pos: [8, 22], yaw: 0 }, { role: "elder", pos: [-8, 22], yaw: 0 },
];

const GREET_RANGE = 4.0;
const GREET_COOLDOWN = 14;
const LOOK_RANGE = 9;
const BODY_R = 0.42; // 与渲染宽度一致的身体半径（MC 人形肩宽 8px ≈ 0.45）
const SEP_R = 0.95; // 相互避让距离
const MAX_PATHS_PER_FRAME = 2; // 每帧最多 2 次 A*（单次 ~1ms），避免寻路尖峰掉帧

const lerp = (a, b, k) => a + (b - a) * k;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const wrapPi = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/* ------------------------------------------------------------------ */
/* 单个居民                                                             */
/* ------------------------------------------------------------------ */

class Agent {
  constructor(id, role, nav, opts) {
    this.id = id;
    this.role = role;
    this.roleIndex = ROLE_KEYS.indexOf(role);
    this.def = NPC_ROLES[role];
    this.nav = nav;
    this.mode = opts.station ? "station" : "roam";
    this.pos = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = this.def.speed * (0.85 + Math.random() * 0.3);
    this.vel = new THREE.Vector2();
    this.state = "idle";
    this.timer = Math.random() * 3;
    this.path = null;
    this.pathIdx = 0;
    this.dest = null;
    this.poi = null;
    this.needPath = false;
    this.fails = 0;
    this.progressT = 0;
    this.progressRef = new THREE.Vector2();
    this.partner = null;
    this.greetCd = Math.random() * 6;
    this.say = null; // { text, t }
    // 动画
    this.phase = Math.random() * 10;
    this.walk = 0; // 步态强度 0..1
    this.wave = 0;
    this.gesture = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.lookTarget = null;

    if (opts.station) {
      const s = nav.nearestWalkable(opts.station[0], opts.station[1], 10, nav.mainComp);
      const p = s || nav.randomWalkable();
      this.station = { x: p.x, z: p.z, yaw: opts.yaw ?? 0 };
      this.pos.set(p.x, nav.supportHeight(p.x, p.z), p.z);
      this.yaw = this.station.yaw;
      this.state = "station";
    } else {
      const p = nav.randomWalkable(nav.mainComp) || { x: 0, z: 30 };
      this.pos.set(p.x, nav.supportHeight(p.x, p.z), p.z);
    }
  }

  speak(text, dur = 2.6) {
    this.say = { text, t: dur };
  }

  /** 选下一个去处：按职业偏好挑兴趣点，夜里偏向灯笼长街。 */
  chooseDestination(night) {
    const nav = this.nav;
    let target = null;
    if (night > 0.6 && Math.random() < 0.6) {
      target = pick([[0, 70], [0, 56], [0, 44], [3, 62], [-3, 50]]);
    } else if (Math.random() < 0.8) {
      const liked = POIS.filter((p) => p.roles.includes(this.role));
      const poi = pick(liked.length ? liked : POIS);
      this.poi = poi.name;
      target = [poi.at[0] + (Math.random() - 0.5) * 6, poi.at[1] + (Math.random() - 0.5) * 6];
    }
    const p = target ? nav.nearestWalkable(target[0], target[1], 8, nav.componentAt(this.pos.x, this.pos.z)) : nav.randomWalkable(nav.componentAt(this.pos.x, this.pos.z));
    if (!p) return false;
    this.dest = p;
    this.needPath = true;
    this.state = "travel";
    return true;
  }

  /**
   * 尝试位移：整体 → 按轴分别（贴墙滑行）。每个候选位置都必须 bodyFits，
   * 且与当前所在格的高差 ≤ 1 —— 这是不穿墙 / 不下水 / 不掉崖的唯一出口。
   */
  tryMove(dx, dz) {
    const nav = this.nav;
    const x = this.pos.x, z = this.pos.z;
    const h0 = nav.heightAt(x, z);
    const ok = (nx, nz) => {
      if (!nav.bodyFits(nx, nz, BODY_R)) return false;
      return Math.abs(nav.heightAt(nx, nz) - h0) <= 1;
    };
    if (ok(x + dx, z + dz)) { this.pos.x += dx; this.pos.z += dz; return true; }
    if (dx !== 0 && ok(x + dx, z)) { this.pos.x += dx; return false; }
    if (dz !== 0 && ok(x, z + dz)) { this.pos.z += dz; return false; }
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 管理器                                                               */
/* ------------------------------------------------------------------ */

export class NPCManager {
  constructor(world, scene, nav, stations = STATIONS, roamCount = 124) {
    this.world = world;
    this.scene = scene;
    this.nav = nav;
    this.agents = [];
    this.night = 0;
    this.playerMounted = false;
    this._pathQueue = [];

    stations.forEach((s, i) => this.agents.push(new Agent(i, s.role, nav, { station: s.pos, yaw: s.yaw })));
    // 漫游者：职业按主城人口比例分配
    const mix = ["farmer", "lady", "child", "elder", "scholar", "fisher", "monk", "merchant", "child", "lady", "farmer", "monk_fighter"];
    for (let i = 0; i < roamCount; i++) {
      this.agents.push(new Agent(stations.length + i, mix[i % mix.length], nav, {}));
    }

    this._buildMeshes();
    this._buildBubbles();
    this._m = {
      root: new THREE.Matrix4(), part: new THREE.Matrix4(), tmp: new THREE.Matrix4(),
      q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), s: new THREE.Vector3(),
    };
  }

  /* ---------------- 渲染：皮肤图集 + 实例化部件 ---------------- */
  _buildMeshes() {
    const R = ROLE_KEYS.length;
    const atlas = document.createElement("canvas");
    atlas.width = 64;
    atlas.height = 64 * R;
    const ctx = atlas.getContext("2d");
    ROLE_KEYS.forEach((k, i) => ctx.drawImage(paintRoleSkin(NPC_ROLES[k], 31 + i * 7), 0, i * 64));
    const tex = new THREE.CanvasTexture(atlas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;

    // 着色器补丁：把单张皮肤的 UV 映射到图集里第 aRole 张
    // （canvas 纹理 flipY：第 r 张占 v ∈ [1-(r+1)/R, 1-r/R]）
    const patch = (mat) => {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uRoles = { value: R };
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float aRole;\nuniform float uRoles;")
          .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.y = (vMapUv.y + (uRoles - 1.0 - aRole)) / uRoles;\n#endif");
      };
      mat.customProgramCacheKey = () => "npc-role-atlas";
      return mat;
    };
    const base = patch(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    const over = patch(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, alphaTest: 0.5, side: THREE.DoubleSide }));

    const n = this.agents.length;
    const roleAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.agents.forEach((a, i) => (roleAttr.array[i] = a.roleIndex));
    this.parts = {};
    for (const name of Object.keys(PARTS)) {
      for (const layer of ["base", "over"]) {
        const geo = partGeometry(name, layer).clone();
        geo.setAttribute("aRole", roleAttr);
        const m = new THREE.InstancedMesh(geo, layer === "base" ? base : over, n);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.castShadow = layer === "base";
        m.receiveShadow = true;
        m.frustumCulled = false;
        this.scene.add(m);
        this.parts[`${name}:${layer}`] = m;
      }
    }
  }

  /* ---------------- 气泡 ---------------- */
  _buildBubbles() {
    this.bubbleLayer = document.createElement("div");
    this.bubbleLayer.id = "npc-bubbles";
    // 层级低于 HUD（#hud z-index 10）：气泡永远不会盖住血条和技能栏
    this.bubbleLayer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9;overflow:hidden;";
    document.body.appendChild(this.bubbleLayer);
    this._bubbleCache = new Map();
    this._bubbleEls = [];
    for (let i = 0; i < 8; i++) {
      const holder = document.createElement("div");
      holder.style.cssText = "position:absolute;display:none;image-rendering:pixelated;";
      this.bubbleLayer.appendChild(holder);
      this._bubbleEls.push({ holder, text: null });
    }
  }

  _bubble(text) {
    let c = this._bubbleCache.get(text);
    if (c) return c;
    const t = renderText(text, { scale: 2, color: "#fff3d6", outline: "#3a2a10", tracking: 1 });
    const pad = 9;
    c = document.createElement("canvas");
    c.width = t.width + pad * 2;
    c.height = t.height + pad * 2 + 6;
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height - 6;
    ctx.fillStyle = "rgba(18,14,10,0.88)";
    ctx.fillRect(2, 0, w - 4, h);
    ctx.fillRect(0, 2, w, h - 4);
    ctx.fillStyle = "#e8b44a";
    ctx.fillRect(2, 0, w - 4, 2); ctx.fillRect(2, h - 2, w - 4, 2);
    ctx.fillRect(0, 2, 2, h - 4); ctx.fillRect(w - 2, 2, 2, h - 4);
    // 像素小尾巴
    ctx.fillStyle = "rgba(18,14,10,0.88)";
    ctx.fillRect(w / 2 - 4, h, 8, 2); ctx.fillRect(w / 2 - 2, h + 2, 4, 2);
    ctx.drawImage(t, pad, pad);
    this._bubbleCache.set(text, c);
    return c;
  }

  /* ---------------- 每帧 ---------------- */

  /**
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   * @param {object} ctx { camera, night, mounted }
   */
  update(dt, playerPos, ctx = {}) {
    this.night = ctx.night ?? this.night;
    this.playerMounted = !!ctx.mounted;
    this.nav.maintain();

    // 空间哈希：避让只看邻近格
    const grid = new Map();
    const key = (x, z) => (Math.floor(x / 2) * 4096 + Math.floor(z / 2)) | 0;
    for (const a of this.agents) {
      const k = key(a.pos.x, a.pos.z);
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(a);
    }

    // 寻路预算：每帧最多 N 次 A*
    let budget = MAX_PATHS_PER_FRAME;
    for (const a of this.agents) {
      if (a.needPath && budget > 0) {
        budget--;
        a.needPath = false;
        const p = this.nav.findPath(a.pos.x, a.pos.z, a.dest.x, a.dest.z);
        if (p && p.length >= 2) {
          a.path = p;
          a.pathIdx = 1;
          a.fails = 0;
          a.progressT = 0;
          a.progressRef.set(a.pos.x, a.pos.z);
        } else {
          a.path = null;
          a.state = "idle";
          a.timer = 1 + Math.random() * 2;
        }
      }
    }

    for (const a of this.agents) {
      const far = Math.hypot(a.pos.x - playerPos.x, a.pos.z - playerPos.z) > 90;
      // 远处的居民降频更新（每 4 帧一次，步长补偿）
      if (far && (a.id + (this._frame | 0)) % 4 !== 0) continue;
      this._think(a, far ? dt * 4 : dt, playerPos, grid, key);
    }
    this._frame = (this._frame | 0) + 1;

    this._render();
    if (ctx.camera) this._renderBubbles(ctx.camera, playerPos);
  }

  _think(a, dt, playerPos, grid, key) {
    const nav = this.nav;
    a.timer -= dt;
    a.greetCd = Math.max(0, a.greetCd - dt);
    if (a.say) { a.say.t -= dt; if (a.say.t <= 0) a.say = null; }

    const dxp = playerPos.x - a.pos.x, dzp = playerPos.z - a.pos.z;
    const dyp = playerPos.y - a.pos.y;
    const dp = Math.hypot(dxp, dzp);

    // ---- 感知：玩家 ----
    a.lookTarget = null;
    if (dp < LOOK_RANGE && Math.abs(dyp) < 4) a.lookTarget = playerPos;
    if (this.playerMounted && dp < 26 && dyp > 3) {
      a.lookTarget = playerPos; // 抬头看龙
      if (a.greetCd <= 0 && Math.random() < 0.004) {
        a.speak(pick(DRAGON_SHOUTS), 2);
        a.greetCd = 10;
        if (a.role === "child") a.wave = 1;
      }
    }
    if (a.state !== "greet" && a.state !== "talk" && dp < GREET_RANGE && Math.abs(dyp) < 2.5 && a.greetCd <= 0 && !this.playerMounted) {
      a.state = "greet";
      a.timer = 2.8;
      a.greetCd = GREET_COOLDOWN;
      a.speak(pick(GREETINGS[a.role]), 2.6);
    }

    // ---- 状态机 ----
    let want = 0; // 期望速度
    let dirX = 0, dirZ = 0;
    switch (a.state) {
      case "greet": {
        a.wave = 1;
        this._face(a, playerPos.x, playerPos.z, dt, 7);
        if (a.timer <= 0) { a.state = a.mode === "station" ? "station" : "idle"; a.timer = 1 + Math.random() * 3; }
        break;
      }
      case "talk": {
        const p = a.partner;
        if (!p || p.partner !== a || a.timer <= 0) {
          a.state = a.mode === "station" ? "station" : "idle";
          a.timer = 1 + Math.random() * 2;
          if (p && p.partner === a) p.partner = null;
          a.partner = null;
          break;
        }
        this._face(a, p.pos.x, p.pos.z, dt, 5);
        a.gesture = 0.5 + Math.sin(performance.now() * 0.004 + a.id) * 0.5;
        if (!a.say && Math.random() < dt * 0.35) a.speak(pick(CHATTER), 2.4);
        break;
      }
      case "station": {
        const s = a.station;
        const d = Math.hypot(s.x - a.pos.x, s.z - a.pos.z);
        if (d > 0.6) {
          // 被推离岗位：走回去（短距离直接走，远了寻路）
          if (d > 6 && !a.path) { a.dest = { x: s.x, z: s.z }; a.needPath = true; }
          dirX = (s.x - a.pos.x) / d; dirZ = (s.z - a.pos.z) / d; want = a.speed * 0.6;
        } else {
          this._turn(a, s.yaw + Math.sin(performance.now() * 0.0004 + a.id) * 0.5, dt, 2);
        }
        if (a.role === "merchant" && a.timer <= 0) {
          a.timer = 8 + Math.random() * 10;
          if (Math.hypot(dxp, dzp) < 24) a.speak(pick(CALLOUTS), 2.4);
        }
        if (a.role === "monk_fighter") a.gesture = Math.max(0, Math.sin(performance.now() * 0.003 + a.id * 2)); // 殿前操练
        break;
      }
      case "idle": {
        // 驻足：张望；附近有同样闲着的人就聊几句
        if (a.timer <= 0) {
          const buddy = this._findBuddy(a, grid, key);
          if (buddy && Math.random() < 0.55) {
            a.state = buddy.state = "talk";
            a.partner = buddy;
            buddy.partner = a;
            a.timer = buddy.timer = 5 + Math.random() * 5;
          } else if (!a.chooseDestination(this.night)) {
            a.timer = 2;
          }
        } else if (Math.random() < dt * 0.3) {
          a.targetYaw = a.yaw + (Math.random() - 0.5) * 2;
        }
        if (a.targetYaw !== undefined) this._turn(a, a.targetYaw, dt, 2);
        break;
      }
      case "travel": {
        if (!a.path) {
          if (!a.needPath) { a.state = "idle"; a.timer = 1; }
          break;
        }
        const wp = a.path[a.pathIdx];
        const tx = wp[0] - a.pos.x, tz = wp[1] - a.pos.z;
        const d = Math.hypot(tx, tz);
        if (d < 0.45) {
          a.pathIdx++;
          if (a.pathIdx >= a.path.length) {
            a.path = null;
            a.state = "idle";
            a.timer = 3 + Math.random() * 7;
          }
          break;
        }
        dirX = tx / d; dirZ = tz / d;
        want = a.speed * (this.night > 0.6 ? 0.8 : 1);
        // 卡住检测：2 秒没前进 0.4 格 → 重新寻路；连续 3 次 → 换目的地
        a.progressT += dt;
        if (a.progressT > 2) {
          const moved = Math.hypot(a.pos.x - a.progressRef.x, a.pos.z - a.progressRef.y);
          a.progressT = 0;
          a.progressRef.set(a.pos.x, a.pos.z);
          if (moved < 0.4) {
            a.fails++;
            a.path = null;
            if (a.fails >= 3) { a.state = "idle"; a.timer = 2 + Math.random() * 2; a.fails = 0; } else a.needPath = true;
          }
        }
        break;
      }
    }

    // ---- 避让：其他居民 + 玩家（只产生速度，不直接改位置）----
    let sx = 0, sz = 0;
    const k0x = Math.floor(a.pos.x / 2), k0z = Math.floor(a.pos.z / 2);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const l = grid.get(((k0x + ox) * 4096 + (k0z + oz)) | 0);
      if (!l) continue;
      for (const b of l) {
        if (b === a) continue;
        const ddx = a.pos.x - b.pos.x, ddz = a.pos.z - b.pos.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < SEP_R * SEP_R && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const f = (SEP_R - d) / SEP_R;
          sx += (ddx / d) * f * 2.2;
          sz += (ddz / d) * f * 2.2;
        }
      }
    }
    if (dp < 1.1 && Math.abs(dyp) < 2) {
      const f = (1.1 - dp) / 1.1;
      sx -= (dxp / Math.max(dp, 0.01)) * f * 3.5;
      sz -= (dzp / Math.max(dp, 0.01)) * f * 3.5;
    }

    const vx = dirX * want + sx;
    const vz = dirZ * want + sz;
    a.vel.set(damp(a.vel.x, vx, 8, dt), damp(a.vel.y, vz, 8, dt));
    const spd = a.vel.length();
    if (spd > 0.02) {
      a.tryMove(a.vel.x * dt, a.vel.y * dt);
      if (want > 0) this._face(a, a.pos.x + dirX, a.pos.z + dirZ, dt, 6);
    }

    // ---- 安全网：若脚下已不可走（玩家刚在这里挖坑 / 放了水），就近挪到可走格 ----
    if (!nav.bodyFits(a.pos.x, a.pos.z, BODY_R * 0.6)) {
      const p = nav.nearestWalkable(a.pos.x, a.pos.z, 10);
      if (p) { a.pos.x = p.x; a.pos.z = p.z; a.path = null; a.needPath = !!a.dest; }
    }

    // ---- 高度：贴导航面，台阶平滑过渡 ----
    const h = nav.supportHeight(a.pos.x, a.pos.z, BODY_R);
    if (h >= 0) a.pos.y = Math.abs(h - a.pos.y) > 2 ? h : (h > a.pos.y ? h : damp(a.pos.y, h, 14, dt));

    // ---- 动画量 ----
    const moving = spd > 0.25;
    a.walk = damp(a.walk, moving ? Math.min(1, spd / 1.4) : 0, 8, dt);
    a.phase += dt * spd * 3.6;
    a.wave = Math.max(0, a.wave - dt * 0.5);
    if (a.state !== "talk" && a.role !== "monk_fighter") a.gesture = damp(a.gesture, 0, 4, dt);
    // 头部看向目标（相对身体的偏航，限制 ±70°）
    let hy = 0, hp = 0;
    if (a.lookTarget) {
      const lx = a.lookTarget.x - a.pos.x, lz = a.lookTarget.z - a.pos.z;
      hy = Math.max(-1.2, Math.min(1.2, wrapPi(Math.atan2(-lx, -lz) - a.yaw)));
      const ly = a.lookTarget.y + 1.5 - (a.pos.y + 1.6 * a.def.scale);
      hp = Math.max(-0.5, Math.min(0.8, Math.atan2(ly, Math.hypot(lx, lz))));
    }
    a.headYaw = damp(a.headYaw, hy, 6, dt);
    a.headPitch = damp(a.headPitch, hp, 6, dt);
  }

  _findBuddy(a, grid, key) {
    const l = grid.get(key(a.pos.x, a.pos.z));
    if (!l) return null;
    for (const b of l) {
      if (b === a || b.state !== "idle" || b.partner) continue;
      if (Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) < 3) return b;
    }
    return null;
  }

  /** 朝向：模型面朝 -Z，yaw 使前方 = (-sin yaw, -cos yaw)。 */
  _face(a, x, z, dt, rate) {
    this._turn(a, Math.atan2(-(x - a.pos.x), -(z - a.pos.z)), dt, rate);
  }

  _turn(a, yaw, dt, rate) {
    a.yaw += wrapPi(yaw - a.yaw) * (1 - Math.exp(-rate * dt));
  }

  _render() {
    const M = this._m;
    const set = (name, i, mat) => {
      this.parts[`${name}:base`].setMatrixAt(i, mat);
      this.parts[`${name}:over`].setMatrixAt(i, mat);
    };
    // 部件矩阵 = 根(位置·朝向·缩放) × 枢轴(位置·旋转) × 网格偏移
    const compose = (pivot, rot, offY, out) => {
      M.e.set(rot[0], rot[1], rot[2], "YXZ");
      M.q.setFromEuler(M.e);
      M.tmp.compose(M.v.set(pivot[0], pivot[1], pivot[2]), M.q, M.s.set(1, 1, 1));
      out.multiplyMatrices(M.root, M.tmp);
      out.multiply(M.part.makeTranslation(0, offY, 0));
      return out;
    };
    const out = new THREE.Matrix4();
    this.agents.forEach((a, i) => {
      const s = a.def.scale;
      M.q.setFromAxisAngle(M.v.set(0, 1, 0), a.yaw);
      M.root.compose(a.pos, M.q, M.s.set(s, s, s));
      const hip = 12 * PX;
      const bob = Math.abs(Math.sin(a.phase)) * 0.03 * a.walk;
      const swing = Math.sin(a.phase) * 0.7 * a.walk;
      // 躯干
      set("body", i, compose([0, hip + 6 * PX + bob, 0], [0, 0, 0], 0, out));
      // 头：看向目标
      set("head", i, compose([0, hip + 12 * PX + bob, 0], [a.headPitch, a.headYaw, 0], 4 * PX, out));
      // 手臂：走路摆臂；聊天比划；打招呼挥手（右臂高举左右摆）
      // 旋转约定：手臂沿 -Y 下垂、模型面朝 -Z，绕 X 正转 = 向前抬
      const waveArm = a.wave > 0.05 ? 2.6 + Math.sin(performance.now() * 0.012) * 0.25 : 0;
      const talkArm = a.gesture * 0.9;
      set("armL", i, compose([-6 * PX, hip + 10 * PX + bob, 0], [swing + talkArm * 0.5, 0, 0.05], -4 * PX, out));
      set("armR", i, compose([6 * PX, hip + 10 * PX + bob, 0], [a.wave > 0.05 ? waveArm : -swing + talkArm, 0, a.wave > 0.05 ? -0.3 : -0.05], -4 * PX, out));
      // 腿
      set("legL", i, compose([-2 * PX, hip + bob, 0], [-swing, 0, 0], -6 * PX, out));
      set("legR", i, compose([2 * PX, hip + bob, 0], [swing, 0, 0], -6 * PX, out));
    });
    for (const m of Object.values(this.parts)) m.instanceMatrix.needsUpdate = true;
  }

  /** 屏幕空间气泡：只画离玩家最近的几位正在说话的居民。 */
  _renderBubbles(camera, playerPos) {
    const talking = this.agents
      .filter((a) => a.say)
      .map((a) => ({ a, d: Math.hypot(a.pos.x - playerPos.x, a.pos.z - playerPos.z) }))
      .filter((o) => o.d < 28)
      .sort((x, y) => x.d - y.d)
      .slice(0, this._bubbleEls.length);
    const v = new THREE.Vector3();
    this._bubbleEls.forEach((slot, k) => {
      const o = talking[k];
      if (!o) { slot.holder.style.display = "none"; return; }
      const a = o.a;
      v.set(a.pos.x, a.pos.y + 2.25 * a.def.scale, a.pos.z).project(camera);
      if (v.z > 1) { slot.holder.style.display = "none"; return; }
      const c = this._bubble(a.say.text);
      if (slot.text !== a.say.text) {
        slot.text = a.say.text;
        slot.holder.innerHTML = "";
        slot.holder.appendChild(c);
      }
      const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      slot.holder.style.left = `${Math.round(sx - c.width / 2)}px`;
      slot.holder.style.top = `${Math.round(sy - c.height)}px`;
      slot.holder.style.opacity = String(Math.min(1, a.say.t * 2) * Math.max(0.35, 1 - o.d / 30));
      slot.holder.style.display = "block";
    });
  }

  /**
   * 统计（验收用）：
   *   inWall  躯干或头部（脚踝以上）与实心方块相交 —— 上台阶时脚尖踩进台阶格不算
   *   inWater 脚或躯干在液体里
   *   offNav  站在导航网格不可走的格子上
   */
  stats() {
    const byState = {}, byRole = {};
    let inWall = 0, inWater = 0, offNav = 0;
    const w = this.world;
    for (const a of this.agents) {
      byState[a.state] = (byState[a.state] || 0) + 1;
      byRole[a.role] = (byRole[a.role] || 0) + 1;
      const fx = Math.floor(a.pos.x), fz = Math.floor(a.pos.z);
      const torso = Math.floor(a.pos.y + 0.9), head = Math.floor(a.pos.y + 1.6 * a.def.scale);
      for (const [dx, dz] of [[0, 0], [BODY_R, 0], [-BODY_R, 0], [0, BODY_R], [0, -BODY_R]]) {
        const x = Math.floor(a.pos.x + dx), z = Math.floor(a.pos.z + dz);
        if (isSolid(w.get(x, torso, z)) || isSolid(w.get(x, head, z))) { inWall++; break; }
      }
      const fy = Math.floor(a.pos.y + 0.05);
      if (isLiquid(w.get(fx, fy, fz)) || isLiquid(w.get(fx, fy + 1, fz))) inWater++;
      if (!this.nav.isWalkable(a.pos.x, a.pos.z)) offNav++;
    }
    return { count: this.agents.length, byState, byRole, inWall, inWater, offNav };
  }
}

