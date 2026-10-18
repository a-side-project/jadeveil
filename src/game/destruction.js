/**
 * 地形破坏 —— 技能打在世界上要留下痕迹。
 *
 *   explode  末影火球：炸出一个边缘参差的坑，碎块按方块本身的颜色飞溅，少量方块掉落成物品
 *   burn     龙息：烧掉花草与树叶（余烬飘起），不伤建筑
 *
 * 所有改动走 WorldEdits（进存档、通知火把 / 导航 / 方块物理），光照用 relightOpened 一次批量更新。
 * 设置里可以关闭（SETTINGS → CONTROLS → TERRAIN DAMAGE）；关闭后技能只造成伤害，不改地形。
 */
import { BLOCKS, ID, isUnbreakable } from "../world/blocks.js";
import { dropForBlock } from "./items.js";
import { TILE_VARIANTS } from "../world/atlas.js";
import { events } from "./events.js";

const FLAMMABLE = new Set([ID.flower_red, ID.flower_yellow, ID.grass_tuft, ID.bamboo_leaf, ID.pine_leaf, ID.lotus_flower]);
const DROP_CHANCE = 0.12; // 炸掉的方块里有多少会掉落（全掉的话一发火球满地都是）
const STORE = "jadeveil.terrain.v1";

export class Destruction {
  /** @param {object} o { world, edits, drops, fx（发光粒子：余烬）, debris（不发光粒子：碎块）, atlas } */
  constructor(o) {
    Object.assign(this, o);
    this._colors = new Map();
    this.enabled = true;
    try { if (localStorage.getItem(STORE) === "0") this.enabled = false; } catch { /* 无存储 */ }
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem(STORE, on ? "1" : "0"); } catch { /* 无存储 */ }
  }

  /** 方块的代表色（顶面贴图的平均色，0..1）：碎块颜色和方块本身一致。 */
  colorOf(id) {
    let c = this._colors.get(id);
    if (c) return c;
    c = [0.6, 0.6, 0.6];
    const b = BLOCKS[id];
    const tile = b && (b.faces[2] || b.faces[0]);
    const canvas = this.atlas?.canvas;
    if (tile && canvas) {
      try {
        const name = TILE_VARIANTS[tile] ? `${tile}#0` : tile;
        const r = this.atlas.uvRect(name);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const x = Math.floor(r.u0 * canvas.width), w = Math.max(1, Math.floor((r.u1 - r.u0) * canvas.width));
        // 图集纹理 flipY：uv 的 v 从下往上
        const y = Math.floor((1 - r.v1) * canvas.height), h = Math.max(1, Math.floor((r.v1 - r.v0) * canvas.height));
        const d = ctx.getImageData(x, y, w, h).data;
        let R = 0, G = 0, B = 0, n = 0;
        for (let i = 0; i < d.length; i += 16) { if (d[i + 3] < 128) continue; R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
        if (n) c = [R / n / 255, G / n / 255, B / n / 255];
      } catch { /* 图集不可读：用默认灰 */ }
    }
    this._colors.set(id, c);
    return c;
  }

  _debris(x, y, z, id, n = 6) {
    const c = this.colorOf(id);
    const dark = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55];
    for (let i = 0; i < n; i++) {
      (this.debris || this.fx).emit({
        x: x + Math.random(), y: y + Math.random(), z: z + Math.random(),
        vx: (Math.random() - 0.5) * 9, vy: 3 + Math.random() * 7, vz: (Math.random() - 0.5) * 9,
        life: 0.9 + Math.random() * 0.6, size: 0.22, size1: 0.12, color: c, color1: dark, drag: 0.6, gravity: 18,
      });
    }
  }

  /**
   * 批量改成空气：先写世界（光照暂停），再一次性重算光照。
   * 期间连带发生的变化（支撑没了掉下来的火把、灯笼）也一并纳入重算 —— 旧版只重算炸掉的格子，
   * 墙上的火把被联动拆掉后，它的光还留在原地。
   */
  _clear(cells) {
    if (!cells.length) return;
    const L = this.world.lighting;
    const all = [];
    const off = events.on("world:edit", ({ x, y, z, prev }) => all.push([x, y, z, prev]));
    if (L) L.suspended = true;
    try {
      for (const [x, y, z] of cells) this.edits.set(x, y, z, 0);
    } finally {
      if (L) L.suspended = false;
      off();
    }
    if (L) for (const k of L.relightOpened(all)) this.world.lightDirty.add(k);
  }

  /**
   * 爆炸：半径 r 内的方块（边缘带随机，坑不是完美的球），基岩与液体不受影响。
   * @returns {number} 炸掉的方块数
   */
  explode(c, r) {
    if (!this.enabled) return 0;
    const cells = [];
    const R = Math.ceil(r + 1);
    const cx = Math.floor(c.x), cy = Math.floor(c.y), cz = Math.floor(c.z);
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
      const d = Math.hypot(dx, dy, dz);
      if (d > r * (0.75 + Math.random() * 0.4)) continue;
      const x = cx + dx, y = cy + dy, z = cz + dz;
      const id = this.world.get(x, y, z);
      if (!id || isUnbreakable(id)) continue;
      const b = BLOCKS[id];
      if (!b || b.liquid || b.model === "torch") continue; // 火把由 world:edit 联动处理（支撑没了自己掉）
      cells.push([x, y, z, id]);
    }
    for (const [x, y, z, id] of cells) {
      this._debris(x, y, z, id, cells.length > 40 ? 3 : 6);
      if (this.drops && Math.random() < DROP_CHANCE) {
        const drop = dropForBlock(id);
        if (drop) this.drops.spawn(drop, 1, x + 0.5, y + 0.5, z + 0.5);
      }
    }
    this._clear(cells);
    return cells.length;
  }

  /** 龙息灼烧：半径 r 内的花草与树叶化成余烬。 */
  burn(c, r) {
    if (!this.enabled) return 0;
    const cells = [];
    const R = Math.ceil(r);
    const cx = Math.floor(c.x), cy = Math.floor(c.y), cz = Math.floor(c.z);
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      const x = cx + dx, y = cy + dy, z = cz + dz;
      const id = this.world.get(x, y, z);
      if (!FLAMMABLE.has(id)) continue;
      cells.push([x, y, z, id]);
    }
    for (const [x, y, z] of cells) {
      for (let i = 0; i < 3; i++) {
        this.fx.emit({
          x: x + Math.random(), y: y + Math.random(), z: z + Math.random(),
          vx: (Math.random() - 0.5) * 0.8, vy: 1.2 + Math.random() * 1.4, vz: (Math.random() - 0.5) * 0.8,
          life: 1.1, size: 0.14, size1: 0.02, color: [1.0, 0.55, 0.85], color1: [0.25, 0.05, 0.3], drag: 0.8,
        });
      }
    }
    this._clear(cells);
    return cells.length;
  }
}
