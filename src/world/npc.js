/**
 * NPC 系统 —— 熊猫人主城的居民。
 *
 *  · 体素人形：头 / 身 / 双臂 / 双腿 / 帽子，InstancedMesh 分部件渲染
 *  · 真实物理：重力 + 轴分离 AABB 碰撞，不穿墙、不悬空、可下台阶
 *  · 有限状态机：patrol（沿路径）→ idle（驻足）→ wander（游荡）→ greet（打招呼）
 *  · 打招呼：玩家靠近时停下、转身面向玩家、招手并弹出像素气泡
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

// 物理 / 行为参数
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
  constructor(id, role, path, world) {
    this.id = id;
    this.role = role;
    this.def = NPC_ROLES[role];
    this.path = path;
    this.world = world;

    this.pos = new THREE.Vector3();
    this.vy = 0;
    this.onGround = true;
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = this.def.speed * (0.85 + Math.random() * 0.3);

    this.wpIndex = 0; // 当前巡逻路点
    this.state = "patrol";
    this.stateTimer = 2 + Math.random() * 6;
    this.greetCooldown = 4 + Math.random() * 8; // 初始错峰，避免一开场全围上来
    this.greeting = false;
    this.blocked = false;
    this.blockedTime = 0;

    this.phase = Math.random() * Math.PI * 2;
    this.bob = 0;
    this.waveAmount = 0;
    this.wanderTarget = new THREE.Vector3();

    this._placeOnPath();
  }

  /* ---------------- 物理 ---------------- */

  /** 与玩家一致的 AABB 判定：脚底恰好落在整数高度时不会误判陷入地面。 */
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

  /** 精确贴地：从脚下向下找第一个实心块，把脚底对齐到其顶面。 */
  _snapGround() {
    const p = this.pos;
    const start = Math.floor(p.y - EPS);
    for (let yy = start; yy >= start - 5; yy--) {
      if (this._anySolidAtY(yy)) {
        p.y = yy + 1;
        return true;
      }
    }
    return false;
  }

  _groundY(px, pz) {
    const g = this.world.groundHeight(Math.round(px), Math.round(pz));
    return g < 0 ? 34 : g + 1;
  }

  _placeOnPath() {
    const p0 = this.path.points[this.wpIndex % this.path.points.length];
    this.pos.set(p0[0], this._groundY(p0[0], p0[1]), p0[1]);
    this.vy = 0;
    this.onGround = true;
  }

  /**
   * 移动并解算碰撞：水平轴分离（撞墙停该轴，可贴墙滑动），垂直走重力。
   */
  _move(dt, dirX, dirZ, speed) {
    const p = this.pos;
    this.blocked = false;

    // 水平：先 X 后 Z，各自独立，撞墙回退该轴
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

    // 垂直：重力
    this.vy -= GRAVITY * dt;
    if (this.vy < -MAX_FALL) this.vy = -MAX_FALL;
    p.y += this.vy * dt;

    if (this.collides(p.x, p.y, p.z)) {
      // 撞到块：回退并分落地 / 撞顶
      p.y -= this.vy * dt;
      if (this.vy < 0) {
        this.onGround = true;
        this._snapGround();
      }
      this.vy = 0;
    } else if (this.vy < 0) {
      // 下方悬空（走下台阶/悬崖）→ 转为下落
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

  _face(x, z, dt) {
    this._turnToward(Math.atan2(x - this.pos.x, z - this.pos.z), dt);
  }

  _pickWander() {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 4;
    this.wanderTarget.set(
      this.pos.x + Math.cos(a) * r,
      0,
      this.pos.z + Math.sin(a) * r,
    );
  }

  _setState(state, duration) {
    this.state = state;
    this.stateTimer = duration;
  }

  update(dt, playerPos) {
    this.greeting = false;
    this.greetCooldown = Math.max(0, this.greetCooldown - dt);

    // 玩家接近 → 打招呼（最高优先级，打断其它状态）
    if (playerPos && this.state !== "greet") {
      const dx = playerPos.x - this.pos.x;
      const dz = playerPos.z - this.pos.z;
      if (dx * dx + dz * dz < GREET_RANGE * GREET_RANGE && this.greetCooldown <= 0) {
        this._setState("greet", GREET_DURATION);
        this.greetCooldown = GREET_COOLDOWN;
      }
    }

    let moveDirX = 0, moveDirZ = 0, speed = 0;
    this.stateTimer -= dt;

    switch (this.state) {
      case "greet": {
        this.greeting = true;
        if (playerPos) this._face(playerPos.x, playerPos.z, dt);
        if (this.stateTimer <= 0) this._setState("patrol", 5 + Math.random() * 8);
        break;
      }
      case "patrol": {
        const pts = this.path.points;
        const wp = pts[this.wpIndex % pts.length];
        const toX = wp[0] - this.pos.x;
        const toZ = wp[1] - this.pos.z;
        const dist = Math.hypot(toX, toZ);
        if (dist < 0.7) {
          this.wpIndex = (this.wpIndex + 1) % pts.length;
          break;
        }
        moveDirX = toX / dist;
        moveDirZ = toZ / dist;
        speed = this.speed;
        this._face(wp[0], wp[1], dt);
        if (this.stateTimer <= 0) {
          const r = Math.random();
          if (r < 0.35) this._setState("idle", 2 + Math.random() * 4);
          else if (r < 0.6) { this._setState("wander", 3 + Math.random() * 4); this._pickWander(); }
          else this._setState("patrol", 5 + Math.random() * 8);
        }
        break;
      }
      case "idle": {
        if (this.stateTimer <= 0) this._setState("patrol", 5 + Math.random() * 8);
        break;
      }
      case "wander": {
        const toX = this.wanderTarget.x - this.pos.x;
        const toZ = this.wanderTarget.z - this.pos.z;
        const dist = Math.hypot(toX, toZ);
        if (dist < 0.8 || this.stateTimer <= 0) {
          if (this.stateTimer <= 0) this._setState("patrol", 4 + Math.random() * 8);
          else this._pickWander();
          break;
        }
        moveDirX = toX / dist;
        moveDirZ = toZ / dist;
        speed = this.speed * 0.6;
        this._face(this.wanderTarget.x, this.wanderTarget.z, dt);
        break;
      }
    }

    if (speed > 0) this._move(dt, moveDirX, moveDirZ, speed);

    // 撞墙太久 → 换目标，防止卡死在墙角
    if (this.blocked) this.blockedTime += dt;
    else this.blockedTime = 0;
    if (this.blockedTime > 1.5 && this.state === "wander") {
      this._pickWander();
      this.blockedTime = 0;
    }

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
  constructor(world, scene, paths, count = 32) {
    this.world = world;
    this.scene = scene;
    this.agents = [];

    for (let i = 0; i < count; i++) {
      const role = ROLE_KEYS[i % ROLE_KEYS.length];
      const path = paths[i % paths.length];
      this.agents.push(new Agent(i, role, path, world));
    }

    this._buildMeshes();
    this._buildGreetingSprites();
  }

  /** 用 InstancedMesh 分部件渲染：头 / 身 / 左臂 / 右臂 / 左腿 / 右腿 / 帽子。 */
  _buildMeshes() {
    const n = this.agents.length;
    const mk = (geo, color) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, vertexColors: false });
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
      body: mk(box, 0xffffff),
      head: mk(box, 0xffffff),
      armL: mk(box, 0xffffff),
      armR: mk(box, 0xffffff),
      legL: mk(box, 0xffffff),
      legR: mk(box, 0xffffff),
      hat: mk(box, 0xffffff),
    };

    for (const key of Object.keys(this.parts)) {
      const inst = this.parts[key];
      inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
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

  /** 把像素文字包进一个深色圆角气泡底 + 金边，做成可读的对话气泡。 */
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

  /** 每个角色预渲染一条像素字气泡，做成 Sprite，NPC 打招呼时显示。 */
  _buildGreetingSprites() {
    this.greetAspect = {};
    this.greetTextures = {};
    for (const role of ROLE_KEYS) {
      const canvas = this._greetingCanvas(role);
      this.greetAspect[role] = canvas.width / canvas.height;
      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.greetTextures[role] = tex;
    }
    this.sprites = this.agents.map((a) => {
      const mat = new THREE.SpriteMaterial({ map: this.greetTextures[a.role], transparent: true, depthWrite: false, depthTest: true });
      const sp = new THREE.Sprite(mat);
      const h = 0.34;
      sp.scale.set(h * this.greetAspect[a.role], h, 1);
      sp.visible = false;
      sp.renderOrder = 10;
      this.scene.add(sp);
      return sp;
    });
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

      const sp = this.sprites[i];
      sp.visible = a.greeting;
      if (a.greeting) sp.position.set(px, py + 2.35 * s, pz);
    }

    for (const key of Object.keys(this.parts)) {
      this.parts[key].instanceMatrix.needsUpdate = true;
    }
  }

  /** 统计各状态 NPC 数量（用于调试与报告）。 */
  stats() {
    const byState = {};
    const byRole = {};
    for (const a of this.agents) {
      byState[a.state] = (byState[a.state] || 0) + 1;
      byRole[a.role] = (byRole[a.role] || 0) + 1;
    }
    return { count: this.agents.length, byState, byRole };
  }
}
