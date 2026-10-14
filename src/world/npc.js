/**
 * NPC 系统 —— 熊猫人主城的居民。
 *
 *  · 体素人形：头 / 身 / 双臂 / 双腿 / 帽子，InstancedMesh 分部件渲染
 *  · 真实物理：重力 + 轴分离 AABB 碰撞，不穿墙、不悬空
 *  · 两类 NPC：
 *      - station：固定岗位（守卫站岗、商人守摊、武僧值守），驻留原地
 *      - roam：满城漫游，用 A* 导航网格寻路到随机目的地
 *  · 状态机：idle / travel / station / greet（玩家靠近时停下、转身、招手）
 */
import * as THREE from "three";
import { isSolid } from "./blocks.js";
import { renderText } from "../ui/pixelfont.js";

export const NPC_ROLES = {
  guard: { label: "GUARD", body: 0xc0392b, trim: 0xe8b44a, hat: 0x3a4a52, scale: 1.06, speed: 1.5 },
  merchant: { label: "MERCHANT", body: 0x4a9e8f, trim: 0xf6d99b, hat: 0x8c6a3f, scale: 0.98, speed: 1.2 },
  monk: { label: "MONK", body: 0xe8b44a, trim: 0xc0392b, hat: 0x8e2a20, scale: 1.0, speed: 1.0 },
  child: { label: "CHILD", body: 0x7fa650, trim: 0xffe08a, hat: 0x516d2c, scale: 0.72, speed: 1.9 },
  monk_fighter: { label: "MONK FIGHTER", body: 0x3a4a52, trim: 0x4a9e8f, hat: 0x232f35, scale: 1.04, speed: 1.6 },
  elder: { label: "ELDER", body: 0x6e7a80, trim: 0xded7c6, hat: 0x4a545a, scale: 0.96, speed: 0.85 },
};

const ROLE_KEYS = Object.keys(NPC_ROLES);

const GREETINGS = {
  guard: "HALT, TRAVELER",
  merchant: "FINE WARES!",
  monk: "PEACE BE WITH YOU",
  child: "HI HI!",
  monk_fighter: "GREETINGS",
  elder: "WELCOME, YOUNG ONE",
};

// 固定岗位（守卫站岗、商人守摊、武僧值守）—— 坐标取自已展平的街道/广场路点
// 确保落在地面而非山坡/屋顶上。
export const STATIONS = [
  { role: "guard", pos: [0, 84] },
  { role: "guard", pos: [-6, 84] },
  { role: "guard", pos: [6, 84] },
  { role: "merchant", pos: [26, 34] },
  { role: "merchant", pos: [26, 6] },
  { role: "merchant", pos: [-26, 34] },
  { role: "merchant", pos: [-26, 6] },
  { role: "elder", pos: [5, 20] },
  { role: "elder", pos: [-6, 16] },
  { role: "monk", pos: [11, 10] },
  { role: "monk", pos: [-11, 10] },
  { role: "monk_fighter", pos: [0, -28] },
  { role: "monk_fighter", pos: [9, -28] },
  { role: "monk_fighter", pos: [-9, -28] },
  { role: "monk", pos: [0, -36] },
  { role: "monk", pos: [12, -36] },
  { role: "monk", pos: [-12, -36] },
  { role: "guard", pos: [0, 60] },
];

const NPC_W = 0.30; // 半宽
const NPC_H = 1.70; // 身高
const GRAVITY = 24;
const MAX_FALL = 30;
const EPS = 1e-4;
const GREET_RANGE = 4.2;
const GREET_DURATION = 3.2;
const GREET_COOLDOWN = 8.0;

/** 单个 NPC 的运行时状态。 */
class Agent {
  constructor(id, role, opts, world) {
    this.id = id;
    this.role = role;
    this.def = NPC_ROLES[role];
    this.world = world;
    this.nav = opts.nav || null;
    this.mode = opts.mode || "roam"; // "station" | "roam"

    this.pos = new THREE.Vector3();
    this.vy = 0;
    this.onGround = true;
    this.yaw = Math.random() * Math.PI * 2;
    this.homeYaw = this.yaw;
    this.speed = this.def.speed * (0.85 + Math.random() * 0.3);

    this.state = "idle";
    this.stateTimer = 1 + Math.random() * 3;
    this.greetCooldown = 3 + Math.random() * 8;
    this.greeting = false;
    this.blocked = false;
    this.blockedTime = 0;
    this.path = null;
    this.pathIdx = 0;

    this.phase = Math.random() * Math.PI * 2;
    this.bob = 0;
    this.waveAmount = 0;

    if (this.mode === "station") {
      const [sx, sz] = opts.station;
      const gy = this._groundY(sx, sz);
      this.station = new THREE.Vector3(sx, gy, sz);
      this.pos.copy(this.station);
      this.state = "station";
      this.stateTimer = 2 + Math.random() * 5;
    } else {
      // roam：从随机可走点开始；若恰好卡在块里就重抽
      for (let tries = 0; tries < 20; tries++) {
        const start = this.nav ? this.nav.randomWalkable() : { x: 0, z: 30 };
        this.pos.set(start.x, this._groundY(start.x, start.z), start.z);
        if (!this.collides(this.pos.x, this.pos.y, this.pos.z)) break;
      }
    }
  }

  /* ---------------- 物理 ---------------- */

  collides(px, py, pz) {
    const w = NPC_W, h = NPC_H;
    const x0 = Math.floor(px - w + EPS), x1 = Math.floor(px + w - EPS);
    const y0 = Math.floor(py + EPS), y1 = Math.floor(py + h - EPS);
    const z0 = Math.floor(pz - w + EPS), z1 = Math.floor(pz + w - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (isSolid(this.world.get(x, y, z))) return true;
        }
      }
    }
    return false;
  }

  _anySolidAtY(yy) {
    const p = this.pos;
    const x0 = Math.floor(p.x - NPC_W + EPS), x1 = Math.floor(p.x + NPC_W - EPS);
    const z0 = Math.floor(p.z - NPC_W + EPS), z1 = Math.floor(p.z + NPC_W - EPS);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (isSolid(this.world.get(x, yy, z))) return true;
      }
    }
    return false;
  }

  _snapGround() {
    const p = this.pos;
    const start = Math.floor(p.y - EPS);
    for (let yy = start; yy >= start - 5; yy--) {
      if (this._anySolidAtY(yy)) { p.y = yy + 1; return true; }
    }
    return false;
  }

  _groundY(px, pz) {
    const g = this.world.groundHeight(Math.round(px), Math.round(pz));
    return g < 0 ? 34 : g + 1;
  }

  _move(dt, dirX, dirZ, speed) {
    const p = this.pos;
    this.blocked = false;
    const dx = dirX * speed * dt;
    const dz = dirZ * speed * dt;
    if (dx !== 0) {
      p.x += dx;
      if (this.collides(p.x, p.y, p.z)) { p.x -= dx; this.blocked = true; }
    }
    if (dz !== 0) {
      p.z += dz;
      if (this.collides(p.x, p.y, p.z)) { p.z -= dz; this.blocked = true; }
    }
    this.vy -= GRAVITY * dt;
    if (this.vy < -MAX_FALL) this.vy = -MAX_FALL;
    p.y += this.vy * dt;
    if (this.collides(p.x, p.y, p.z)) {
      p.y -= this.vy * dt;
      if (this.vy < 0) { this.onGround = true; this._snapGround(); }
      this.vy = 0;
    } else if (this.vy < 0) {
      this.onGround = false;
    }
  }

  /* ---------------- 行为 ---------------- */

  _turnToward(yaw, dt) {
    let d = yaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 6);
  }
  _face(x, z, dt) { this._turnToward(Math.atan2(x - this.pos.x, z - this.pos.z), dt); }

  _chooseDestination() {
    if (!this.nav) { this.state = "idle"; this.stateTimer = 2; return; }
    const dest = this.nav.randomWalkable();
    const d = Math.hypot(dest.x - this.pos.x, dest.z - this.pos.z);
    if (d < 12) { this.state = "idle"; this.stateTimer = 1 + Math.random() * 2; return; }
    const p = this.nav.findPath(this.pos.x, this.pos.z, dest.x, dest.z);
    if (p && p.length > 1) {
      this.path = p;
      this.pathIdx = 1;
      this.state = "travel";
    } else {
      this.state = "idle";
      this.stateTimer = 1 + Math.random() * 2;
    }
  }

  update(dt, playerPos) {
    this.greeting = false;
    this.greetCooldown = Math.max(0, this.greetCooldown - dt);

    // 玩家接近 → 打招呼（最高优先级）
    if (playerPos && this.state !== "greet") {
      const dx = playerPos.x - this.pos.x, dz = playerPos.z - this.pos.z;
      if (dx * dx + dz * dz < GREET_RANGE * GREET_RANGE && this.greetCooldown <= 0) {
        this.state = "greet";
        this.stateTimer = GREET_DURATION;
        this.greetCooldown = GREET_COOLDOWN;
      }
    }

    let moveDirX = 0, moveDirZ = 0, speed = 0;
    this.stateTimer -= dt;

    switch (this.state) {
      case "greet": {
        this.greeting = true;
        if (playerPos) this._face(playerPos.x, playerPos.z, dt);
        if (this.stateTimer <= 0) {
          this.state = this.mode === "station" ? "station" : "idle";
          this.stateTimer = 2 + Math.random() * 4;
        }
        break;
      }
      case "station": {
        if (this.stateTimer <= 0) {
          this.homeYaw += (Math.random() - 0.5) * 1.2;
          this.stateTimer = 2 + Math.random() * 5;
        }
        this._turnToward(this.homeYaw, dt);
        break;
      }
      case "idle": {
        if (this.stateTimer <= 0) this._chooseDestination();
        break;
      }
      case "travel": {
        if (!this.path || this.pathIdx >= this.path.length) {
          this.state = "idle";
          this.stateTimer = 1 + Math.random() * 3;
          break;
        }
        const wp = this.path[this.pathIdx];
        const toX = wp[0] - this.pos.x, toZ = wp[1] - this.pos.z;
        const dist = Math.hypot(toX, toZ);
        if (dist < 0.9) { this.pathIdx++; break; }
        moveDirX = toX / dist;
        moveDirZ = toZ / dist;
        speed = this.speed;
        this._face(wp[0], wp[1], dt);
        if (this.blocked) {
          this.blockedTime += dt;
          if (this.blockedTime > 1.2) { this._chooseDestination(); this.blockedTime = 0; }
        } else {
          this.blockedTime = 0;
        }
        break;
      }
    }

    if (speed > 0) this._move(dt, moveDirX, moveDirZ, speed);

    // 步态动画
    if (speed > 0) {
      this.phase += dt * speed * 4.2;
      this.bob = Math.abs(Math.sin(this.phase)) * 0.06;
    } else {
      this.bob *= 1 - Math.min(1, dt * 6);
      this.phase += dt * 0.8;
    }
    const wantWave = this.state === "greet" ? 1 : 0;
    this.waveAmount += (wantWave - this.waveAmount) * Math.min(1, dt * 5);
  }
}

export class NPCManager {
  constructor(world, scene, nav, stations, roamCount = 70) {
    this.world = world;
    this.scene = scene;
    this.agents = [];

    // 固定岗位 NPC
    stations.forEach((s, i) => {
      this.agents.push(new Agent(i, s.role, { mode: "station", station: s.pos, nav }, world));
    });
    // 漫游 NPC
    for (let i = 0; i < roamCount; i++) {
      const role = ROLE_KEYS[(stations.length + i) % ROLE_KEYS.length];
      this.agents.push(new Agent(stations.length + i, role, { mode: "roam", nav }, world));
    }

    this._buildMeshes();
    this._buildGreetingCanvases();
  }

  _buildMeshes() {
    const n = this.agents.length;
    const mk = (geo) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.02, vertexColors: false });
      const inst = new THREE.InstancedMesh(geo, mat, n);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      this.scene.add(inst);
      return inst;
    };
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.parts = {
      body: mk(box), head: mk(box), armL: mk(box), armR: mk(box),
      legL: mk(box), legR: mk(box), hat: mk(box),
    };
    for (const key of Object.keys(this.parts)) {
      this.parts[key].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    }
    this._applyColors();
    this._dummy = new THREE.Object3D();
  }

  _applyColors() {
    const c = new THREE.Color();
    this.agents.forEach((a, i) => {
      const d = a.def;
      const set = (key, hex) => { c.setHex(hex); this.parts[key].setColorAt(i, c); };
      set("body", d.body);
      set("head", 0xf2e6cf);
      set("armL", d.body);
      set("armR", d.body);
      set("legL", d.trim);
      set("legR", d.trim);
      set("hat", d.hat);
    });
    for (const key of Object.keys(this.parts)) {
      if (this.parts[key].instanceColor) this.parts[key].instanceColor.needsUpdate = true;
    }
  }

  /** 像素文字 + 深色圆角气泡底 + 金边，供屏幕空间覆盖层使用。 */
  _greetingCanvas(role) {
    const text = renderText(GREETINGS[role], { scale: 2, color: "#fff3d6", outline: "#3a2a10", tracking: 1 });
    const pad = 10;
    const cw = text.width + pad * 2;
    const ch = text.height + pad * 2;
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext("2d");
    const r = 8;
    ctx.fillStyle = "rgba(18, 14, 10, 0.85)";
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(cw, 0, cw, ch, r);
    ctx.arcTo(cw, ch, 0, ch, r);
    ctx.arcTo(0, ch, 0, 0, r);
    ctx.arcTo(0, 0, cw, 0, r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#e8b44a";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.drawImage(text, pad, pad);
    return c;
  }

  _buildGreetingCanvases() {
    this.greetCanvases = {};
    for (const role of ROLE_KEYS) {
      this.greetCanvases[role] = this._greetingCanvas(role);
    }
  }

  update(dt, playerPos) {
    const d = this._dummy;
    const n = this.agents.length;

    for (let i = 0; i < n; i++) {
      const a = this.agents[i];
      a.update(dt, playerPos);

      const s = a.def.scale;
      const px = a.pos.x;
      const py = a.pos.y + a.bob;
      const pz = a.pos.z;
      const swing = Math.sin(a.phase) * 0.55;
      const swing2 = Math.sin(a.phase + Math.PI) * 0.55;

      const place = (inst, ox, oy, oz, sx, sy, sz, rotX = 0, rotZ = 0) => {
        d.position.set(px, py, pz);
        d.rotation.set(0, a.yaw, 0);
        d.updateMatrix();
        const local = new THREE.Matrix4().compose(
          new THREE.Vector3(ox * s, oy * s, oz * s),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, rotZ)),
          new THREE.Vector3(sx * s, sy * s, sz * s),
        );
        d.matrix.multiply(local);
        inst.setMatrixAt(i, d.matrix);
      };

      place(this.parts.body, 0, 1.05, 0, 0.62, 0.78, 0.42);
      place(this.parts.head, 0, 1.62, 0, 0.46, 0.44, 0.44);
      place(this.parts.hat, 0, 1.86, 0, 0.5, 0.14, 0.48);
      const armWave = a.waveAmount * Math.sin(performance.now() * 0.008) * 0.9;
      place(this.parts.armL, -0.42, 1.05, 0, 0.2, 0.72, 0.2, swing, 0);
      place(this.parts.armR, 0.42, 1.05, 0, 0.2, 0.72, 0.2, swing2 - armWave, 0);
      place(this.parts.legL, -0.16, 0.34, 0, 0.22, 0.68, 0.22, swing2, 0);
      place(this.parts.legR, 0.16, 0.34, 0, 0.22, 0.68, 0.22, swing, 0);
    }

    for (const key of Object.keys(this.parts)) {
      this.parts[key].instanceMatrix.needsUpdate = true;
    }
  }

  stats() {
    const byState = {};
    const byRole = {};
    let station = 0, roam = 0;
    for (const a of this.agents) {
      byState[a.state] = (byState[a.state] || 0) + 1;
      byRole[a.role] = (byRole[a.role] || 0) + 1;
      if (a.mode === "station") station++;
      else roam++;
    }
    return { count: this.agents.length, station, roam, byState, byRole };
  }
}
