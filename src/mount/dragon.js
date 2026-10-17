/**
 * 末影龙坐骑 —— 召唤 / 骑乘 / 飞行姿态 / 四个技能。
 *
 * 职责划分：
 *   · 位置与碰撞仍由 Player 控制器负责（骑乘时换成龙的碰撞体与飞行参数）
 *   · 这里负责：模型姿态（偏航、俯仰、随转向滚转）、骑手落座、技能、特效、能量
 *
 * 技能（激战 2 式技能栏，骑乘时数字键 1–4，鼠标左/右键是 1/2 的快捷方式）：
 *   1 DRAGON BREATH  按住持续吐息：锥形范围持续伤害，命中地面留下徘徊的龙息残云
 *   2 ENDER FIREBALL 末影火球：命中方块或目标时爆炸，范围伤害 + 残云
 *   3 VOID DASH      虚空冲刺：沿视线方向爆发加速，拖出紫色尾迹
 *   4 DRAGON ROAR    龙吼：冲击波环，范围伤害与击退，镜头震动
 * 能量 100，持续回复；吐息按秒消耗，其余按次消耗并有冷却。
 */
import * as THREE from "three";
import { DragonModel, DRAGON_SCALE } from "./dragonModel.js";
import { isSolid } from "../world/blocks.js";
import { events } from "../game/events.js";
import { BLOOM_SCENE } from "../core/renderer.js";

// ---- 坐骑物理 ----
const MOUNT_HW = 1.1; // 龙的碰撞体半宽
const MOUNT_H = 3.0; // 龙的碰撞体高
const MOUNT_EYE = 3.1; // 骑手眼高（相对碰撞体底面）
const ROOT_Y = 1.6; // 模型原点相对碰撞体底面的高度
const MOUNT_FLY = { accel: 34, max: 22, maxFast: 40 };
const THIRD_DIST = 14.5;

// ---- 能量与技能 ----
export const ENERGY_MAX = 100;
const ENERGY_REGEN = 14; // 每秒

export const DRAGON_SKILLS = [
  { id: "breath", slot: 1, label: "DRAGON BREATH", hint: "HOLD 1 / LMB", costPerSec: 26, cd: 0 },
  { id: "fireball", slot: 2, label: "ENDER FIREBALL", hint: "2 / RMB", cost: 25, cd: 1.2 },
  { id: "dash", slot: 3, label: "VOID DASH", hint: "3", cost: 20, cd: 2.5 },
  { id: "roar", slot: 4, label: "DRAGON ROAR", hint: "4", cost: 35, cd: 8 },
];

const BREATH = { len: 14, angle: 0.36, dps: 16, rate: 150 };
const FIREBALL = { speed: 34, range: 70, radius: 3.6, damage: 22 };
const ROAR = { radius: 12, damage: 12, knock: 10 };

// 末影紫：亮核 → 深紫
const C_HOT = [1.0, 0.62, 1.0];
const C_MID = [0.86, 0.32, 1.0];
const C_DEEP = [0.30, 0.04, 0.55];

const lerp = (a, b, k) => a + (b - a) * k;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const wrapPi = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class DragonMount {
  constructor({ scene, player, avatar, world, combat, fx, audio, camera }) {
    this.scene = scene;
    this.player = player;
    this.avatar = avatar;
    this.world = world;
    this.combat = combat;
    this.fx = fx;
    this.audio = audio;
    this.camera = camera;

    this.model = new DragonModel();
    this.model.root.visible = false;
    scene.add(this.model.root);

    this.active = false; // 是否在骑乘
    this.energy = ENERGY_MAX;
    this.cooldowns = { breath: 0, fireball: 0, dash: 0, roar: 0 };
    this.breathing = false;
    this.yaw = 0;
    this.pitch = 0;
    this.bank = 0;
    this._yawRate = 0;
    this._appear = 0; // 召唤/离场动画 0..1
    this._leaving = 0; // 离场计时
    this._jaw = 0;
    this._dashT = 0;
    this._breathTick = 0;
    this._zoneTick = 0;
    this._lastFlap = 0;
    this.projectiles = [];

    // 火球本体：发光方块（原版末影火球是一团紫色发光体）
    this._ballGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    this._ballMat = new THREE.MeshBasicMaterial({ color: 0xd57bff, toneMapped: false });
    this._ballMat.color.multiplyScalar(2.4);

    this._v = new THREE.Vector3();
    this._mouth = new THREE.Vector3();
    this._aim = new THREE.Vector3();
  }

  get skills() { return DRAGON_SKILLS; }

  /* ================= 召唤 / 离场 ================= */

  toggle() {
    return this.active ? this.dismiss() : this.summon();
  }

  summon() {
    const p = this.player;
    if (this.active) return true;
    // 先确认龙的碰撞体放得下（室内 / 檐下召不出来）；放不下就尝试往上抬 1~3 格
    const prev = { hw: p.hw, bh: p.bh };
    p.hw = MOUNT_HW;
    p.bh = MOUNT_H;
    let lift = -1;
    for (let dy = 0; dy <= 3; dy++) {
      if (!p.collides(p.position.x, p.position.y + dy, p.position.z)) { lift = dy; break; }
    }
    if (lift < 0) {
      p.hw = prev.hw;
      p.bh = prev.bh;
      events.emit("ui:toast", "NOT ENOUGH ROOM TO SUMMON");
      return false;
    }
    p.position.y += lift;
    p.eyeH = MOUNT_EYE;
    p.flyTuning = MOUNT_FLY;
    p.thirdDist = THIRD_DIST;
    p.flying = true;
    p.mount = this;
    p.velocity.y = Math.max(p.velocity.y, 6);
    if (p.mode === "first") p.mode = "third"; // 召唤时切到第三人称：一眼看到龙

    this.active = true;
    this._leaving = 0;
    this._appear = 0;
    this.yaw = p.yaw;
    this.model.root.visible = true;
    this.model.root.scale.setScalar(0.01);
    this._place();

    const r = this.model.root.position;
    // 召唤特效：紫色爆发 + 冲击环（克制：要看得见龙，而不是一团白光）
    this.fx.burst(r.x, r.y, r.z, 110, { speed: 9, life: 1.1, size: 0.22, size1: 0.04, color: C_MID, color1: C_DEEP, drag: 1.6, jitter: 3 });
    this.fx.ring(p.position.x, p.position.y + 0.2, p.position.z, 64, { speed: 14, life: 0.8, size: 0.3, size1: 0.06, color: C_MID, color1: C_DEEP, drag: 2.2 });
    this.audio?.summon();
    events.emit("mount:summon", this);
    return true;
  }

  dismiss() {
    const p = this.player;
    if (!this.active) return false;
    this.active = false;
    this.breathing = false;
    p.mount = null;
    p.hw = 0.32;
    p.bh = 1.78;
    p.eyeH = 1.62;
    p.flyTuning = p._defaultFly || (p._defaultFly = { accel: 26, max: 16, maxFast: 34 });
    p.thirdDist = 5.2;
    p.flying = false;
    // 从空中下龙：龙把骑手轻轻放下 —— 这一次落地不计摔落伤害
    p.safeFall = true;
    p.velocity.multiplyScalar(0.3);
    this._leaving = 1.4;
    this._leaveVel = new THREE.Vector3(-Math.sin(this.yaw), 0.6, -Math.cos(this.yaw)).multiplyScalar(18);
    const r = this.model.root.position;
    this.fx.burst(r.x, r.y, r.z, 160, { speed: 7, life: 1.1, size: 0.3, size1: 0.05, color: C_MID, color1: C_DEEP, drag: 1.6, jitter: 2 });
    this.audio?.dismiss();
    events.emit("mount:dismiss", this);
    return true;
  }

  /* ================= 技能 ================= */

  canUse(id) {
    const s = DRAGON_SKILLS.find((k) => k.id === id);
    if (!s || !this.active) return false;
    if (this.cooldowns[id] > 0) return false;
    return this.energy >= (s.cost ?? 5);
  }

  /** 释放一次性技能（吐息走 setBreath）。返回是否成功。 */
  useSkill(id) {
    if (id === "breath") {
      this.setBreath(!this.breathing);
      return true;
    }
    if (!this.canUse(id)) {
      if (this.active) events.emit("ui:toast", this.cooldowns[id] > 0 ? "SKILL NOT READY" : "NOT ENOUGH ENERGY");
      return false;
    }
    const s = DRAGON_SKILLS.find((k) => k.id === id);
    this.energy -= s.cost;
    this.cooldowns[id] = s.cd;
    if (id === "fireball") this._fireball();
    else if (id === "dash") this._dash();
    else if (id === "roar") this._roar();
    events.emit("mount:skill", { id });
    return true;
  }

  setBreath(on) {
    if (on && (!this.active || this.energy < 5)) return;
    this.breathing = on;
  }

  /** 准星方向（相机视线）。 */
  _aimDir(out) {
    return this.camera.getWorldDirection(out).normalize();
  }

  _fireball() {
    this.model.mouthWorld(this._mouth);
    const dir = this._aimDir(new THREE.Vector3());
    const mesh = new THREE.Mesh(this._ballGeo, this._ballMat);
    mesh.position.copy(this._mouth);
    mesh.layers.enable(BLOOM_SCENE);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      pos: this._mouth.clone(),
      vel: dir.multiplyScalar(FIREBALL.speed).add(this.player.velocity.clone().multiplyScalar(0.5)),
      dist: 0,
    });
    this._jaw = 1;
    this.audio?.fireball();
  }

  _explode(pos) {
    const fx = this.fx;
    fx.burst(pos.x, pos.y, pos.z, 220, { speed: 11, life: 1.2, size: 0.55, size1: 0.08, color: C_HOT, color1: C_DEEP, drag: 2.2 });
    fx.burst(pos.x, pos.y, pos.z, 70, { speed: 3, life: 2.2, size: 1.3, size1: 0.3, color: C_MID, color1: C_DEEP, drag: 1, lift: 1.2 });
    fx.ring(pos.x, pos.y + 0.3, pos.z, 80, { speed: 15, life: 0.8, size: 0.5, size1: 0.12, color: C_HOT, color1: C_DEEP, drag: 2.6 });
    for (const { e, d } of this.combat.inSphere(pos, FIREBALL.radius)) {
      const k = 1 - Math.min(1, d / FIREBALL.radius) * 0.6;
      const dir = new THREE.Vector3(e.pos.x - pos.x, 0, e.pos.z - pos.z).normalize();
      this.combat.hit(e, FIREBALL.damage * k, { dir, knockback: 8, source: "fireball" });
    }
    // 残云落在地面：从爆点向下找第一个实心方块
    const ground = pos.clone();
    for (let i = 0; i < 12 && !isSolid(this.world.get(Math.floor(ground.x), Math.floor(ground.y - 0.5), Math.floor(ground.z))); i++) ground.y -= 1;
    this.combat.addZone(ground, 3.4, 10, 5, "dragon");
    this.player.shake = Math.max(this.player.shake || 0, 0.55);
    this.audio?.explosion();
  }

  _dash() {
    const dir = this._aimDir(new THREE.Vector3());
    this.player.velocity.addScaledVector(dir, 38);
    this._dashT = 0.45;
    this.audio?.dash();
  }

  _roar() {
    const p = this.player.position;
    const c = new THREE.Vector3(p.x, p.y + 1, p.z);
    this.fx.ring(c.x, c.y, c.z, 160, { speed: 22, life: 0.9, size: 0.7, size1: 0.15, color: C_HOT, color1: C_DEEP, drag: 1.6 });
    this.fx.ring(c.x, c.y + 1.5, c.z, 120, { speed: 16, life: 1.0, size: 0.5, size1: 0.1, color: C_MID, color1: C_DEEP, drag: 1.4 });
    for (const { e } of this.combat.inSphere(c, ROAR.radius)) {
      const dir = new THREE.Vector3(e.pos.x - c.x, 0, e.pos.z - c.z).normalize();
      this.combat.hit(e, ROAR.damage, { dir, knockback: ROAR.knock, source: "roar" });
    }
    this._jaw = 1.6;
    this.player.shake = Math.max(this.player.shake || 0, 0.9);
    this.audio?.roar();
  }

  /** 沿方向步进找第一个实心方块（吐息落点）。 */
  _rayBlock(o, d, max) {
    for (let t = 1; t <= max; t += 0.5) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (isSolid(this.world.get(Math.floor(x), Math.floor(y), Math.floor(z)))) {
        return new THREE.Vector3(x - d.x * 0.5, y - d.y * 0.5, z - d.z * 0.5);
      }
    }
    return null;
  }

  /* ================= 每帧 ================= */

  /** 把模型放到碰撞体上：原点在碰撞体底面上方 ROOT_Y，姿态 = 偏航 + 俯仰 + 滚转。 */
  _place() {
    const p = this.player.position;
    const r = this.model.root;
    r.position.set(p.x, p.y + ROOT_Y, p.z);
    r.rotation.set(this.pitch, this.yaw, this.bank, "YXZ");
  }

  update(dt) {
    const fx = this.fx;
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);

    this._updateProjectiles(dt);
    this._updateZonesFx(dt);

    // ---- 离场：龙载着余速飞走、缩小消失 ----
    if (!this.active) {
      if (this._leaving > 0) {
        this._leaving -= dt;
        const r = this.model.root;
        r.position.addScaledVector(this._leaveVel, dt);
        r.scale.setScalar(Math.max(0.01, this._leaving / 1.4));
        this.model.update(dt, { flapRate: 1.1 });
        if (Math.random() < 0.6) fx.emit({ x: r.position.x, y: r.position.y, z: r.position.z, vx: 0, vy: 1, vz: 0, life: 0.8, size: 0.4, size1: 0.05, color: C_MID, color1: C_DEEP });
        if (this._leaving <= 0) r.visible = false;
      }
      return;
    }

    const pl = this.player;
    const v = pl.velocity;
    const horiz = Math.hypot(v.x, v.z);

    // ---- 能量 ----
    if (this.breathing) {
      this.energy -= DRAGON_SKILLS[0].costPerSec * dt;
      if (this.energy <= 0) {
        this.energy = 0;
        this.breathing = false;
      }
    } else {
      this.energy = Math.min(ENERGY_MAX, this.energy + ENERGY_REGEN * dt);
    }

    // ---- 姿态：龙头追随视线偏航，转向时向内滚转；俯仰跟随爬升/俯冲 ----
    const prevYaw = this.yaw;
    this.yaw += wrapPi(pl.yaw - this.yaw) * (1 - Math.exp(-3.2 * dt));
    this._yawRate = damp(this._yawRate, wrapPi(this.yaw - prevYaw) / Math.max(dt, 1e-4), 6, dt);
    this.bank = damp(this.bank, Math.max(-0.65, Math.min(0.65, this._yawRate * 0.42)), 5, dt);
    const climb = Math.atan2(v.y, Math.max(4, horiz));
    this.pitch = damp(this.pitch, Math.max(-0.6, Math.min(0.5, climb * 0.7)), 4, dt);

    // 召唤出场：0.6 秒从小到大弹出
    this._appear = Math.min(1, this._appear + dt / 0.6);
    const a = this._appear;
    const pop = a < 1 ? 1 - Math.pow(1 - a, 3) * Math.cos(a * 7) : 1;
    this.model.root.scale.setScalar(Math.max(0.01, pop));
    this._place();

    // ---- 扇翼节奏：悬停慢扇、爬升快扇、高速平飞/俯冲滑翔 ----
    const speed = v.length();
    const climbing = v.y > 2;
    const glide = Math.max(0, Math.min(1, (horiz - 14) / 14)) * (climbing ? 0.2 : 1) * (v.y < -4 ? 1 : 0.85);
    const flapRate = climbing ? 0.95 : 0.55 + Math.min(0.3, speed * 0.01);
    this._jaw = Math.max(0, this._jaw - dt * 1.5);
    const aim = this._aimDir(this._aim);
    this.model.update(dt, {
      flapRate,
      glide,
      jawOpen: this.breathing ? 1 : Math.min(1, this._jaw),
      turn: Math.max(-1, Math.min(1, this._yawRate * 0.6)),
      headPitch: Math.max(-1, Math.min(1, (Math.asin(aim.y) - this.pitch) * 1.4)),
    });
    // 扇翼声：每个下扇周期一次
    const flapIdx = Math.floor(this.model.flap);
    if (flapIdx !== this._lastFlap) {
      this._lastFlap = flapIdx;
      if (glide < 0.6) this.audio?.wingFlap();
    }

    // ---- 骑手落座 ----
    const seat = this.model.seat.getWorldPosition(this._v);
    this.avatar.group.position.copy(seat);
    this.avatar.group.rotation.y = this.yaw;

    // ---- 光效：末影龙周身的紫色微光 + 高速时翼尖尾迹 ----
    const r = this.model.root.position;
    if (Math.random() < 0.5) {
      fx.emit({
        x: r.x + (Math.random() - 0.5) * 3 * DRAGON_SCALE * 2, y: r.y - 0.5 + (Math.random() - 0.5), z: r.z + (Math.random() - 0.5) * 3,
        vx: (Math.random() - 0.5) * 0.6, vy: 0.6 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.6,
        life: 1.4, size: 0.18, size1: 0.02, color: C_MID, color1: C_DEEP, drag: 0.8,
      });
    }
    if (horiz > 12 || this._dashT > 0) {
      for (const w of this.model.wings) {
        const tip = w.tip.localToWorld(this._v.set(w.s * 56 * DRAGON_SCALE / 16, 0, 0.5));
        fx.emit({ x: tip.x, y: tip.y, z: tip.z, vx: 0, vy: 0, vz: 0, life: 0.5, size: 0.28, size1: 0.02, color: C_MID, color1: C_DEEP, drag: 3 });
      }
    }
    if (this._dashT > 0) {
      this._dashT -= dt;
      fx.burst(r.x, r.y, r.z, 8, { speed: 2, life: 0.6, size: 0.6, size1: 0.05, color: C_HOT, color1: C_DEEP, drag: 2, jitter: 2.5 });
    }

    // ---- 吐息 ----
    if (this.breathing) this._updateBreath(dt);
  }

  _updateBreath(dt) {
    const fx = this.fx;
    const mouth = this.model.mouthWorld(this._mouth);
    const dir = this._aimDir(new THREE.Vector3());
    const pv = this.player.velocity;
    const n = Math.ceil(BREATH.rate * dt);
    for (let i = 0; i < n; i++) {
      const s = 16 + Math.random() * 8;
      const spread = 3.2;
      fx.emit({
        x: mouth.x, y: mouth.y, z: mouth.z,
        vx: dir.x * s + (Math.random() - 0.5) * spread + pv.x,
        vy: dir.y * s + (Math.random() - 0.5) * spread + pv.y,
        vz: dir.z * s + (Math.random() - 0.5) * spread + pv.z,
        life: 0.85 + Math.random() * 0.3,
        size: 0.25, size1: 1.5,
        color: Math.random() < 0.3 ? C_HOT : C_MID, color1: C_DEEP,
        drag: 1.4,
      });
    }
    // 伤害：每 0.2 秒结算一次锥形范围
    this._breathTick -= dt;
    if (this._breathTick <= 0) {
      this._breathTick = 0.2;
      for (const { e } of this.combat.inCone(mouth, dir, BREATH.len, BREATH.angle)) {
        this.combat.hit(e, BREATH.dps * 0.2, { dir, knockback: 0.6, source: "breath" });
      }
      this.audio?.breathPuff();
    }
    // 命中地面：每 0.5 秒留下一团徘徊残云
    this._zoneTick -= dt;
    if (this._zoneTick <= 0) {
      this._zoneTick = 0.5;
      const hit = this._rayBlock(mouth, dir, BREATH.len + 2);
      if (hit) this.combat.addZone(hit, 2.4, 6, 3, "dragon");
    }
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      // 子步进：火球每帧可能飞过 1 格以上，必须逐段检查，否则会穿墙
      const steps = Math.max(1, Math.ceil((pr.vel.length() * dt) / 0.4));
      let boom = false;
      for (let k = 0; k < steps && !boom; k++) {
        pr.pos.addScaledVector(pr.vel, dt / steps);
        pr.dist += (pr.vel.length() * dt) / steps;
        if (isSolid(this.world.get(Math.floor(pr.pos.x), Math.floor(pr.pos.y), Math.floor(pr.pos.z)))) boom = true;
        else if (this.combat.inSphere(pr.pos, 0.8).length) boom = true;
        else if (pr.dist > FIREBALL.range) boom = true;
      }
      pr.mesh.position.copy(pr.pos);
      pr.mesh.rotation.x += dt * 6;
      pr.mesh.rotation.y += dt * 4;
      // 尾迹
      for (let k = 0; k < 5; k++) {
        this.fx.emit({
          x: pr.pos.x + (Math.random() - 0.5) * 0.5, y: pr.pos.y + (Math.random() - 0.5) * 0.5, z: pr.pos.z + (Math.random() - 0.5) * 0.5,
          vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), vz: (Math.random() - 0.5),
          life: 0.7, size: 0.5, size1: 0.05, color: C_HOT, color1: C_DEEP, drag: 2,
        });
      }
      if (boom) {
        this._explode(pr.pos);
        this.scene.remove(pr.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** 龙息残云的视觉：每片残云在地面圆盘内持续冒出缓慢升腾的紫雾。 */
  _updateZonesFx(dt) {
    for (const z of this.combat.zones) {
      if (z.source !== "dragon") continue;
      const fade = Math.min(1, z.life / 1.2);
      const n = Math.ceil(28 * dt * z.radius * fade);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * z.radius;
        this.fx.emit({
          x: z.pos.x + Math.cos(a) * rr, y: z.pos.y + 0.1, z: z.pos.z + Math.sin(a) * rr,
          vx: 0, vy: 0.5 + Math.random() * 0.6, vz: 0,
          life: 1.2, size: 0.45, size1: 0.9, color: C_MID, color1: C_DEEP, drag: 0.6,
        });
      }
    }
  }

  serialize() {
    return { active: this.active, energy: Math.round(this.energy) };
  }
}
