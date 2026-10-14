/**
 * NPC 系统 —— 熊猫人主城的居民。
 *
 *  · 体素风格人形：头 / 身 / 双臂 / 双腿，用 InstancedMesh 分部件渲染
 *  · 行走动画：腿部与手臂交替摆动（正弦驱动），身体轻微起伏
 *  · 路径巡逻：沿规划好的路径点行走，到达后转向下一个点
 *  · 状态机：巡逻 → 驻足 → 交谈 → 招手 → 回到巡逻
 *  · 碰撞：NPC 遵守地形高度，不会穿墙（沿路径采样地面高度）
 */
import * as THREE from "three";

export const NPC_ROLES = {
  guard: { label: "GUARD", body: 0xc0392b, trim: 0xe8b44a, hat: 0x3a4a52, scale: 1.06, speed: 1.5 },
  merchant: { label: "MERCHANT", body: 0x4a9e8f, trim: 0xf6d99b, hat: 0x8c6a3f, scale: 0.98, speed: 1.2 },
  monk: { label: "MONK", body: 0xe8b44a, trim: 0xc0392b, hat: 0x8e2a20, scale: 1.0, speed: 1.0 },
  child: { label: "CHILD", body: 0x7fa650, trim: 0xffe08a, hat: 0x516d2c, scale: 0.72, speed: 1.9 },
  monk_fighter: { label: "MONK FIGHTER", body: 0x3a4a52, trim: 0x4a9e8f, hat: 0x232f35, scale: 1.04, speed: 1.6 },
  elder: { label: "ELDER", body: 0x6e7a80, trim: 0xded7c6, hat: 0x4a545a, scale: 0.96, speed: 0.85 },
};

const ROLE_KEYS = Object.keys(NPC_ROLES);

/** 单个 NPC 的运行时状态。 */
class Agent {
  constructor(id, role, path, world) {
    this.id = id;
    this.role = role;
    this.def = NPC_ROLES[role];
    this.path = path;
    this.world = world;

    this.segIndex = 0;
    this.t = Math.random();
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = this.def.speed * (0.85 + Math.random() * 0.3);

    this.state = "patrol";
    this.stateTimer = 2 + Math.random() * 6;
    this.phase = Math.random() * Math.PI * 2; // 步态相位
    this.bob = 0;
    this.waveAmount = 0;

    this._placeOnPath();
  }

  _placeOnPath() {
    const pts = this.path.points;
    const a = pts[this.segIndex % pts.length];
    const b = pts[(this.segIndex + 1) % pts.length];
    const x = a[0] + (b[0] - a[0]) * this.t;
    const z = a[1] + (b[1] - a[1]) * this.t;
    const g = this.world.groundHeight(Math.round(x), Math.round(z));
    this.pos.set(x, (g < 0 ? 34 : g + 1), z);
    this.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  }

  update(dt) {
    this.stateTimer -= dt;

    // ---- 状态机 ----
    if (this.stateTimer <= 0) {
      const r = Math.random();
      if (this.state === "patrol") {
        this.state = r < 0.4 ? "idle" : r < 0.7 ? "talk" : "wave";
        this.stateTimer = 2 + Math.random() * 5;
      } else {
        this.state = "patrol";
        this.stateTimer = 6 + Math.random() * 12;
      }
    }

    const moving = this.state === "patrol";
    const speed = moving ? this.speed : 0;

    // ---- 沿路径前进 ----
    if (moving) {
      const pts = this.path.points;
      const a = pts[this.segIndex % pts.length];
      const b = pts[(this.segIndex + 1) % pts.length];
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      this.t += (speed * dt) / segLen;

      if (this.t >= 1) {
        this.t = 0;
        this.segIndex = (this.segIndex + 1) % pts.length;
      }

      const a2 = pts[this.segIndex % pts.length];
      const b2 = pts[(this.segIndex + 1) % pts.length];
      const x = a2[0] + (b2[0] - a2[0]) * this.t;
      const z = a2[1] + (b2[1] - a2[1]) * this.t;
      const g = this.world.groundHeight(Math.round(x), Math.round(z));
      const targetY = g < 0 ? 34 : g + 1;

      // 平滑贴地（避免台阶跳变）
      this.pos.x = x;
      this.pos.z = z;
      this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 8);

      // 朝向平滑转向
      const targetYaw = Math.atan2(b2[0] - a2[0], b2[1] - a2[1]);
      let d = targetYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 4);
    }

    // ---- 步态动画 ----
    if (moving) {
      this.phase += dt * this.speed * 3.4;
      this.bob = Math.abs(Math.sin(this.phase)) * 0.06;
    } else {
      this.bob *= 1 - Math.min(1, dt * 6);
      this.phase += dt * 0.8;
    }

    // 招手动画
    const wantWave = this.state === "wave" ? 1 : 0;
    this.waveAmount += (wantWave - this.waveAmount) * Math.min(1, dt * 5);
  }
}

export class NPCManager {
  constructor(world, scene, paths, count = 32) {
    this.world = world;
    this.scene = scene;
    this.agents = [];

    // 分配角色与路径
    for (let i = 0; i < count; i++) {
      const role = ROLE_KEYS[i % ROLE_KEYS.length];
      const path = paths[i % paths.length];
      this.agents.push(new Agent(i, role, path, world));
    }

    this._buildMeshes();
  }

  /** 用 InstancedMesh 分部件渲染：头 / 身 / 左臂 / 右臂 / 左腿 / 右腿。 */
  _buildMeshes() {
    const n = this.agents.length;
    const mk = (geo, color) => {
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: 0.02,
        vertexColors: false,
      });
      const inst = new THREE.InstancedMesh(geo, mat, n);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      this.scene.add(inst);
      return inst;
    };

    // 几何体（单位尺寸，靠矩阵缩放）
    const box = new THREE.BoxGeometry(1, 1, 1);
    const head = new THREE.BoxGeometry(1, 1, 1);

    this.parts = {
      body: mk(box, 0xffffff),
      head: mk(head, 0xffffff),
      armL: mk(box, 0xffffff),
      armR: mk(box, 0xffffff),
      legL: mk(box, 0xffffff),
      legR: mk(box, 0xffffff),
      hat: mk(box, 0xffffff),
    };

    // 每个部件用 instanceColor 区分角色配色
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
      const set = (key, hex) => {
        c.setHex(hex);
        this.parts[key].setColorAt(i, c);
      };
      set("body", d.body);
      set("head", 0xf2e6cf); // 熊猫人面部浅色
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

  update(dt) {
    const d = this._dummy;
    const n = this.agents.length;

    for (let i = 0; i < n; i++) {
      const a = this.agents[i];
      a.update(dt);

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

      // 身体
      place(this.parts.body, 0, 1.05, 0, 0.62, 0.78, 0.42);
      // 头
      place(this.parts.head, 0, 1.62, 0, 0.46, 0.44, 0.44);
      // 帽子
      place(this.parts.hat, 0, 1.86, 0, 0.5, 0.14, 0.48);
      // 手臂（前后摆动）
      const armWave = a.waveAmount * Math.sin(performance.now() * 0.008) * 0.9;
      place(this.parts.armL, -0.42, 1.05, 0, 0.2, 0.72, 0.2, swing, 0);
      place(this.parts.armR, 0.42, 1.05, 0, 0.2, 0.72, 0.2, swing2 - armWave, 0);
      // 腿（交替摆动）
      place(this.parts.legL, -0.16, 0.34, 0, 0.22, 0.68, 0.22, swing2, 0);
      place(this.parts.legR, 0.16, 0.34, 0, 0.22, 0.68, 0.22, swing, 0);
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
