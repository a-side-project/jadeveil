/**
 * 战斗层 —— 可受伤实体的注册表、范围查询、伤害结算。
 *
 * 任何可被攻击的东西（训练假人、将来的怪物）实现 Damageable 接口并注册：
 *   pos: Vector3（脚底）   radius / height：圆柱形受击体
 *   hp / maxHp / alive     takeDamage(amount, { dir, knockback, source })
 *
 * 武器、龙息、火球都只和这里打交道，不认识具体的实体类型。
 * 结算后派发 "entity:hit" / "entity:death"，伤害数字、受击音效各自订阅。
 */
import * as THREE from "three";
import { events } from "./events.js";

const _v = new THREE.Vector3();

export class Combat {
  constructor() {
    this.entities = new Set();
    /** 持续伤害区域（龙息残云）：{ pos, radius, dps, life, source } */
    this.zones = [];
  }

  register(e) { this.entities.add(e); }
  unregister(e) { this.entities.delete(e); }

  /** 对单个实体结算一次伤害。 */
  hit(e, amount, opts = {}) {
    if (!e.alive || amount <= 0) return 0;
    const dealt = e.takeDamage(amount, opts);
    events.emit("entity:hit", { entity: e, amount: dealt, crit: !!opts.crit, source: opts.source });
    if (!e.alive) events.emit("entity:death", { entity: e, source: opts.source });
    return dealt;
  }

  /** 圆柱受击体中心（腰部）。 */
  center(e, out = _v) {
    return out.set(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z);
  }

  /** 球形范围：返回 [{ e, d }]，d 为到受击体表面的距离。 */
  inSphere(c, r) {
    const out = [];
    for (const e of this.entities) {
      if (!e.alive) continue;
      const dx = e.pos.x - c.x, dz = e.pos.z - c.z;
      const dy = Math.max(e.pos.y - c.y, 0, c.y - (e.pos.y + e.height));
      const d = Math.max(0, Math.hypot(dx, dz) - e.radius);
      const dist = Math.hypot(d, dy);
      if (dist <= r) out.push({ e, d: dist });
    }
    return out;
  }

  /** 锥形范围（吐息）：origin 起、沿单位向量 dir，长 len、半角 angle。 */
  inCone(origin, dir, len, angle) {
    const out = [];
    const cos = Math.cos(angle);
    for (const e of this.entities) {
      if (!e.alive) continue;
      const c = this.center(e, this._coneTmp || (this._coneTmp = new THREE.Vector3()));
      const to = c.sub(origin);
      const d = to.length();
      if (d > len + e.radius || d < 1e-4) continue;
      // 受击体有半径：用「方向夹角 - 半径对应的张角」放宽判定
      const widen = Math.atan2(e.radius + e.height * 0.3, d);
      if (to.dot(dir) / d >= Math.cos(Math.min(Math.PI, Math.acos(cos) + widen))) out.push({ e, d });
    }
    return out;
  }

  /**
   * 射线拾取最近实体（近战命中判定）。圆柱近似：先投到水平面求最近距离，再检查高度。
   * 返回 { e, t } 或 null。
   */
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const e of this.entities) {
      if (!e.alive) continue;
      // 沿射线按 0.1 步检查是否进入圆柱（实体很少，足够快也足够稳）
      for (let t = 0; t <= maxDist; t += 0.1) {
        const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
        if (y < e.pos.y || y > e.pos.y + e.height) continue;
        if (Math.hypot(x - e.pos.x, z - e.pos.z) <= e.radius) {
          if (!best || t < best.t) best = { e, t };
          break;
        }
      }
    }
    return best;
  }

  /** 放置一片持续伤害的龙息残云。 */
  addZone(pos, radius, dps, life, source) {
    this.zones.push({ pos: pos.clone(), radius, dps, life, maxLife: life, source, tick: 0 });
  }

  update(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life -= dt;
      if (z.life <= 0) {
        this.zones.splice(i, 1);
        continue;
      }
      // 每 0.5 秒跳一次伤害（伤害数字才读得清）
      z.tick -= dt;
      if (z.tick <= 0) {
        z.tick = 0.5;
        for (const { e } of this.inSphere(z.pos, z.radius)) {
          this.hit(e, z.dps * 0.5, { source: z.source, dot: true });
        }
      }
    }
    for (const e of this.entities) e.update?.(dt);
  }
}
