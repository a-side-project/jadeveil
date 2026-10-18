/**
 * 人物技能 —— 没有职业、没有技能点：技能靠「学」，学会就能用。
 *
 * 冒险模式（默认）下技能栏取代快捷栏，数字键 1–5 + Q；骑龙时换成龙的技能栏。
 * 目前的技能来自初始武器玉剑（JADE BLADE）与几项通用技能：
 *
 *   1 JADE SLASH     三段连斩（左键也是它）：第三段横扫范围更大、伤害更高
 *   2 JADE LUNGE     突刺：向前冲出约 6 格，沿途命中的目标都会受伤
 *   3 WHIRLING BLADE 旋风斩：原地旋转三圈，周围目标受伤，割倒身边的花草
 *   4 JADE CRESCENT  玉月斩：向前飞出一道月牙剑气，贯穿目标，割断沿途花草
 *   5 JADE MEND      玉愈：4 秒内回复 8 点生命
 *   Q EVADE          闪避：向移动方向翻滚，期间免疫伤害
 *
 * 学习：除 JADE CRESCENT 以外开局就会；JADE CRESCENT 要「练」—— 用玉剑命中目标 20 次后领悟
 * （训练场的木桩正好用来练）。学会的技能与练习进度写进存档。
 */
import * as THREE from "three";
import { events } from "./events.js";
import { ID, isSolid } from "../world/blocks.js";

export const PLAYER_SKILLS = [
  { id: "slash", key: "1", label: "JADE SLASH", short: ["JADE", "SLASH"], cd: 0.42 },
  { id: "lunge", key: "2", label: "JADE LUNGE", short: ["JADE", "LUNGE"], cd: 6 },
  { id: "whirl", key: "3", label: "WHIRLING BLADE", short: ["WHIRL", "BLADE"], cd: 9 },
  { id: "crescent", key: "4", label: "JADE CRESCENT", short: ["JADE", "WAVE"], cd: 7, learn: { hits: 20 } },
  { id: "mend", key: "5", label: "JADE MEND", short: ["JADE", "MEND"], cd: 20 },
  { id: "evade", key: "Q", label: "EVADE", short: ["EVADE", "ROLL"], cd: 2.2 },
];

const SLASH = [
  { dmg: 7, len: 3.4, angle: 0.75, knock: 4 },
  { dmg: 7, len: 3.4, angle: 0.75, knock: 4 },
  { dmg: 12, len: 3.8, angle: 1.25, knock: 8 },
];
const LUNGE = { speed: 22, time: 0.28, dmg: 11, radius: 1.6 };
const WHIRL = { radius: 3.6, dmg: 6, ticks: 3, every: 0.2 };
const CRESCENT = { speed: 26, range: 20, dmg: 13, radius: 1.3 };
const MEND = { total: 8, time: 4 };
const EVADE = { speed: 15, time: 0.32, invuln: 0.45 };

// 会被剑气割断的植物（不会掉落：剑气割的是花草，不是在采集）
const CUTTABLE = new Set([ID.flower_red, ID.flower_yellow, ID.grass_tuft]);

const JADE = [0.45, 1.0, 0.82];
const JADE_LIT = [0.85, 1.0, 0.95];
const JADE_DEEP = [0.05, 0.35, 0.3];

export class PlayerSkills {
  /** @param {object} deps { player, avatar, health, combat, fx, world, edits, camera, audio } */
  constructor(deps) {
    Object.assign(this, deps);
    this.cooldowns = Object.fromEntries(PLAYER_SKILLS.map((s) => [s.id, 0]));
    this.learned = new Set(PLAYER_SKILLS.filter((s) => !s.learn).map((s) => s.id));
    this.practice = 0; // 玉剑命中次数（学 JADE CRESCENT）
    this._combo = 0;
    this._comboT = 0;
    this._lungeT = 0;
    this._lungeHit = new Set();
    this._whirl = null;
    this._mend = null;
    this._evadeT = 0;
    this.projectiles = [];
    this._v = new THREE.Vector3();

    // 练习只认 JADE SLASH 的命中（每一刀算一次）；旋风斩一次打三下、一群目标各算一次的话，
    // 「练 20 刀」会被几下技能刷完
    events.on("entity:hit", ({ source }) => {
      if (source !== "blade") return;
      if (this.learned.has("crescent")) return;
      this.practice++;
      if (this.practice >= PLAYER_SKILLS.find((s) => s.id === "crescent").learn.hits) this.learn("crescent");
    });
  }

  get list() { return PLAYER_SKILLS; }

  def(id) { return PLAYER_SKILLS.find((s) => s.id === id); }

  learn(id) {
    if (this.learned.has(id)) return;
    this.learned.add(id);
    events.emit("skill:learned", { id, label: this.def(id).label });
  }

  /** 还没学会的技能的学习进度（界面显示用）：{ have, need } 或 null。 */
  progress(id) {
    const d = this.def(id);
    if (!d.learn || this.learned.has(id)) return null;
    return { have: Math.min(this.practice, d.learn.hits), need: d.learn.hits };
  }

  ready(id) {
    return this.learned.has(id) && this.cooldowns[id] <= 0;
  }

  /** 释放技能；返回是否成功（失败时给出提示）。 */
  use(id) {
    const d = this.def(id);
    if (!d) return false;
    if (!this.learned.has(id)) {
      const p = this.progress(id);
      events.emit("ui:toast", p ? `NOT LEARNED YET - BLADE HITS ${p.have}/${p.need}` : "NOT LEARNED YET");
      return false;
    }
    if (this.cooldowns[id] > 0) {
      if (id !== "slash") events.emit("ui:toast", "SKILL NOT READY");
      return false;
    }
    this.cooldowns[id] = d.cd;
    this[`cast_${id}`]();
    events.emit("skill:use", { id });
    return true;
  }

  /* ---------------- 工具 ---------------- */

  _eye() {
    const p = this.player.position;
    return this._v.set(p.x, p.y + this.player.eyeH * 0.82, p.z).clone();
  }

  /** 水平朝向（技能大多按角色朝向，不受俯仰影响）。 */
  _forward() {
    const y = this.player.yaw;
    return new THREE.Vector3(-Math.sin(y), 0, -Math.cos(y));
  }

  _aim() {
    return this.camera.getWorldDirection(new THREE.Vector3()).normalize();
  }

  /** source：普攻 "blade"（计入练习），其余技能 "jade-skill"。 */
  _hit(e, dmg, dir, knock, crit = false, source = "jade-skill") {
    return this.combat.hit(e, crit ? dmg * 1.5 : dmg, { dir, knockback: knock, crit, source });
  }

  /** 割断半径内的花草（剑气 / 旋风斩的场景细节）。 */
  _cutPlants(c, r) {
    if (!this.terrainDamage?.()) return;
    const R = Math.ceil(r);
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) for (let dy = -1; dy <= 1; dy++) {
      if (dx * dx + dz * dz > r * r) continue;
      const x = Math.floor(c.x) + dx, y = Math.floor(c.y) + dy, z = Math.floor(c.z) + dz;
      const id = this.world.get(x, y, z);
      if (!CUTTABLE.has(id)) continue;
      this.edits.set(x, y, z, 0);
      this.fx.burst(x + 0.5, y + 0.3, z + 0.5, 10, { speed: 2.5, life: 0.8, size: 0.12, size1: 0.04, color: [0.5, 0.75, 0.3], color1: [0.3, 0.45, 0.15], drag: 2, lift: -4 });
    }
  }

  /* ---------------- 技能 ---------------- */

  /** 三段连斩：1.1 秒内连续出手才接得上下一段。 */
  cast_slash() {
    this._combo = this._comboT > 0 ? (this._combo + 1) % 3 : 0;
    this._comboT = 1.1;
    const s = SLASH[this._combo];
    this.avatar.swing();
    const o = this._eye(), dir = this._aim();
    // 下落中出手 = 暴击（与原来的近战规则一致）
    const crit = !this.player.onGround && this.player.velocity.y < -1;
    let any = false;
    for (const { e } of this.combat.inCone(o, dir, s.len, s.angle)) {
      if (this._blocked(o, e)) continue;
      this._hit(e, s.dmg, new THREE.Vector3(dir.x, 0, dir.z).normalize(), s.knock, crit, "blade");
      any = true;
    }
    // 刀光：玉色弧线粒子
    const f = this._forward(), right = new THREE.Vector3(f.z, 0, -f.x);
    const n = this._combo === 2 ? 22 : 14;
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * (this._combo === 2 ? 2.4 : 1.6) * (this._combo === 1 ? -1 : 1);
      const r = 1.6;
      const x = o.x + (f.x * Math.cos(a) + right.x * Math.sin(a)) * r;
      const z = o.z + (f.z * Math.cos(a) + right.z * Math.sin(a)) * r;
      this.fx.emit({ x, y: o.y - 0.3 + a * 0.08, z, vx: f.x, vy: 0.2, vz: f.z, life: 0.28, size: 0.16, size1: 0.02, color: JADE_LIT, color1: JADE, drag: 4 });
    }
    this.audio?.swordSwing();
    return any;
  }

  /** 挡在目标前面的实心方块（不能隔墙砍）。 */
  _blocked(o, e) {
    const c = this.combat.center(e, new THREE.Vector3());
    const d = c.clone().sub(o);
    const len = d.length();
    d.normalize();
    for (let t = 0.5; t < len - 0.3; t += 0.4) {
      if (isSolid(this.world.get(Math.floor(o.x + d.x * t), Math.floor(o.y + d.y * t), Math.floor(o.z + d.z * t)))) return true;
    }
    return false;
  }

  cast_lunge() {
    this._lungeT = LUNGE.time;
    this._lungeDir = this._forward();
    this.player.forcedMove = { x: this._lungeDir.x * LUNGE.speed, z: this._lungeDir.z * LUNGE.speed };
    this._lungeHit.clear();
    this.avatar.swing();
    this.audio?.dash?.();
  }

  cast_whirl() {
    this._whirl = { t: 0, ticks: 0 };
    this.avatar.swing();
    this.audio?.swordSwing();
  }

  cast_crescent() {
    const o = this._eye(), dir = this._aim();
    this.projectiles.push({ pos: o.clone().addScaledVector(dir, 0.8), dir, dist: 0, hit: new Set() });
    this.avatar.swing();
    this.audio?.swordSwing();
  }

  cast_mend() {
    this._mend = { t: 0, given: 0 };
    const p = this.player.position;
    this.fx.ring(p.x, p.y + 0.2, p.z, 40, { speed: 4, life: 0.9, size: 0.2, size1: 0.04, color: JADE_LIT, color1: JADE, drag: 2 });
    this.audio?.pickup?.();
  }

  cast_evade() {
    // 朝移动方向翻滚；没有移动输入时向后撤
    const p = this.player;
    let dir = new THREE.Vector3(p.velocity.x, 0, p.velocity.z);
    if (dir.lengthSq() < 0.5) dir = this._forward().negate();
    this._evadeDir = dir.normalize();
    this._evadeT = EVADE.time;
    this.player.forcedMove = { x: this._evadeDir.x * EVADE.speed, z: this._evadeDir.z * EVADE.speed };
    this.health._invuln = Math.max(this.health._invuln, EVADE.invuln);
    const q = p.position;
    this.fx.burst(q.x, q.y + 0.4, q.z, 18, { speed: 3, life: 0.5, size: 0.18, size1: 0.03, color: JADE, color1: JADE_DEEP, drag: 3 });
  }

  /* ---------------- 每帧 ---------------- */

  update(dt) {
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this._comboT = Math.max(0, this._comboT - dt);
    const p = this.player;

    // 突刺：持续给水平速度，沿途命中
    if (this._lungeT > 0) {
      this._lungeT -= dt;
      const c = this._v.set(p.position.x, p.position.y + 1, p.position.z);
      for (const { e } of this.combat.inSphere(c, LUNGE.radius)) {
        if (this._lungeHit.has(e)) continue;
        this._lungeHit.add(e);
        this._hit(e, LUNGE.dmg, this._lungeDir, 9);
      }
      this.fx.emit({ x: c.x, y: c.y, z: c.z, vx: 0, vy: 0, vz: 0, life: 0.35, size: 0.3, size1: 0.02, color: JADE, color1: JADE_DEEP, drag: 3 });
      if (this._lungeT <= 0) this._endForced(0.3);
    }

    // 闪避
    if (this._evadeT > 0) {
      this._evadeT -= dt;
      if (this._evadeT <= 0) this._endForced(0.25);
    }

    // 旋风斩：0.6 秒三次伤害，周身一圈玉色刀光
    if (this._whirl) {
      const w = this._whirl;
      w.t += dt;
      const c = new THREE.Vector3(p.position.x, p.position.y + 0.9, p.position.z);
      const a = w.t * 22;
      for (let k = 0; k < 4; k++) {
        const ang = a + (k * Math.PI) / 2;
        this.fx.emit({ x: c.x + Math.cos(ang) * 2.4, y: c.y, z: c.z + Math.sin(ang) * 2.4, vx: 0, vy: 0.3, vz: 0, life: 0.3, size: 0.2, size1: 0.02, color: JADE_LIT, color1: JADE, drag: 3 });
      }
      if (w.t >= w.ticks * WHIRL.every && w.ticks < WHIRL.ticks) {
        w.ticks++;
        if (w.ticks % 2) this.avatar.swing();
        for (const { e } of this.combat.inSphere(c, WHIRL.radius)) {
          const dir = new THREE.Vector3(e.pos.x - c.x, 0, e.pos.z - c.z).normalize();
          this._hit(e, WHIRL.dmg, dir, 5);
        }
        this._cutPlants(new THREE.Vector3(p.position.x, p.position.y, p.position.z), WHIRL.radius);
      }
      if (w.ticks >= WHIRL.ticks && w.t > WHIRL.ticks * WHIRL.every) this._whirl = null;
    }

    // 玉愈：逐秒回血
    if (this._mend) {
      const m = this._mend;
      m.t += dt;
      const should = Math.min(MEND.total, Math.floor((m.t / MEND.time) * MEND.total));
      if (should > m.given) { this.health.heal(should - m.given); m.given = should; }
      if (Math.random() < 0.5) {
        const q = p.position;
        this.fx.emit({ x: q.x + (Math.random() - 0.5) * 0.8, y: q.y + Math.random() * 1.6, z: q.z + (Math.random() - 0.5) * 0.8, vx: 0, vy: 1.2, vz: 0, life: 0.9, size: 0.12, size1: 0.02, color: JADE_LIT, color1: JADE, drag: 1 });
      }
      if (m.t >= MEND.time) this._mend = null;
    }

    // 剑气投射物
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      const steps = Math.max(1, Math.ceil((CRESCENT.speed * dt) / 0.4));
      let dead = false;
      for (let k = 0; k < steps && !dead; k++) {
        pr.pos.addScaledVector(pr.dir, (CRESCENT.speed * dt) / steps);
        pr.dist += (CRESCENT.speed * dt) / steps;
        // 撞墙就停，这一步不再结算伤害（旧版先判撞墙、后照样结算 —— 能隔着一格墙砍到人）
        if (isSolid(this.world.get(Math.floor(pr.pos.x), Math.floor(pr.pos.y), Math.floor(pr.pos.z)))) { dead = true; break; }
        for (const { e } of this.combat.inSphere(pr.pos, CRESCENT.radius)) {
          if (pr.hit.has(e)) continue;
          pr.hit.add(e);
          this._hit(e, CRESCENT.dmg, pr.dir, 6);
        }
        this._cutPlants(pr.pos, 0.9);
        if (pr.dist > CRESCENT.range) dead = true;
      }
      // 月牙形：沿垂直于方向的弧线排一排粒子
      const right = new THREE.Vector3(pr.dir.z, 0, -pr.dir.x).normalize();
      for (let k = -4; k <= 4; k++) {
        const bow = (1 - (k * k) / 16) * 0.5;
        this.fx.emit({
          x: pr.pos.x + right.x * k * 0.22 - pr.dir.x * bow, y: pr.pos.y + Math.abs(k) * 0.02, z: pr.pos.z + right.z * k * 0.22 - pr.dir.z * bow,
          vx: 0, vy: 0, vz: 0, life: 0.18, size: 0.18, size1: 0.03, color: JADE_LIT, color1: JADE, drag: 2,
        });
      }
      if (dead) {
        this.fx.burst(pr.pos.x, pr.pos.y, pr.pos.z, 26, { speed: 4, life: 0.5, size: 0.16, size1: 0.02, color: JADE_LIT, color1: JADE_DEEP, drag: 3 });
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** 新游戏：回到开局时会的技能。 */
  reset() {
    this.learned = new Set(PLAYER_SKILLS.filter((s) => !s.learn).map((s) => s.id));
    this.practice = 0;
    for (const k in this.cooldowns) this.cooldowns[k] = 0;
    this.cancel();
  }

  /** 中断一切进行中的效果（死亡、读档、新游戏）：突刺 / 闪避 / 旋风斩 / 玉愈 / 剑气 / 连斩。 */
  cancel() {
    this._lungeT = 0;
    this._evadeT = 0;
    this._whirl = null;
    this._mend = null;
    this._combo = 0;
    this._comboT = 0;
    this.projectiles.length = 0;
    this.player.forcedMove = null;
  }

  _endForced(keep) {
    const p = this.player;
    p.forcedMove = null;
    p.velocity.x *= keep;
    p.velocity.z *= keep;
  }

  serialize() {
    return { learned: [...this.learned], practice: this.practice };
  }

  /** 读档：已学技能 = 默认技能 + 存档里记的（替换，而不是叠加到当前局 —— 否则读一个旧档，当前局学会的技能还在）。 */
  load(d) {
    if (!d) return;
    this.learned = new Set(PLAYER_SKILLS.filter((s) => !s.learn).map((s) => s.id));
    if (Array.isArray(d.learned)) for (const id of d.learned) if (this.def(id)) this.learned.add(id);
    this.practice = Number.isFinite(d.practice) ? d.practice : 0;
  }
}
