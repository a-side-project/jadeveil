/**
 * 方块物理 —— 水会流、沙会落、花草没了根会倒。
 *
 * 按 Minecraft 的规则逐「刻」推进（每 0.25 秒一刻，与 MC 水的流速一致）：
 *
 *   水   水源（等级 0）与流动水（1..7，越远越浅）
 *        · 先往下：下面是空气 / 能被冲掉的花草就往下流，下落的水满格（等级 1）
 *        · 下不去才往四周铺开，每格等级 +1，到 7 停止
 *        · 某格的等级 = 能流到它的邻居里最小的（等级 + 1）；没有邻居供水就逐刻干涸
 *        · 两个水源夹着的格子（下面是实心或水源）会变成新水源 —— 挖个坑贴着湖，水会把坑填平
 *   沙   下面变成空气或水就往下掉：每刻一格，看得见下落（与水一样先算后写）
 *   花草 脚下的支撑没了就倒（掉落成物品），被水冲到也会倒
 *
 * 只处理「被唤醒」的格子：任何方块变化（world:edit）都会唤醒它和六个邻居，
 * 世界里静止的水不消耗任何计算。所有写入走 WorldEdits —— 会进存档，也会通知光照、导航、火把。
 */
import { ID, BLOCKS, isSolid, waterLevel, waterId } from "./blocks.js";
import { CH } from "./voxelWorld.js";

export const TICK = 0.25;
// 每刻最多处理的格子：瀑布落到远处地面会铺开一大片，预算太小时上游的格子会排不上队（实测 600 会饿死上游）
const MAX_PER_TICK = 5000;
const MAX_LEVEL = 7;

const H = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 被水冲掉 / 失去支撑会倒的植物
const PLANTS = new Set([ID.flower_red, ID.flower_yellow, ID.grass_tuft]);
// 掉下来的方块（沙）
const FALLING = new Set([ID.sand]);

const key = (x, y, z) => `${x},${y},${z}`;

export class BlockPhysics {
  /** @param {object} o { world, edits, drops, onFlowSound } */
  constructor(o) {
    Object.assign(this, o);
    this.pending = new Map(); // key → [x, y, z]（下一刻要检查的格子）
    this._t = 0;
    this.stats = { ticks: 0, changes: 0 };
  }

  /** 唤醒一格及其邻居（方块变化时调用）。 */
  wake(x, y, z) {
    this._add(x, y, z);
    this._add(x, y + 1, z);
    this._add(x, y - 1, z);
    for (const [dx, dz] of H) this._add(x + dx, y, z + dz);
  }

  _add(x, y, z) {
    if (y < 0 || y >= CH) return;
    const k = key(x, y, z);
    if (!this.pending.has(k)) this.pending.set(k, [x, y, z]);
  }

  get idle() {
    return this.pending.size === 0;
  }

  update(dt) {
    this._t += dt;
    if (this._t < TICK) return;
    this._t = 0;
    this.tick();
  }

  /** 推进一刻：先算出所有变化，再统一写入（同一刻内的计算互不影响，与 MC 一致）。 */
  tick() {
    if (!this.pending.size) return 0;
    const cells = [];
    for (const [k, c] of this.pending) {
      cells.push(c);
      this.pending.delete(k);
      if (cells.length >= MAX_PER_TICK) break;
    }
    const writes = new Map();
    for (const [x, y, z] of cells) {
      const next = this._evaluate(x, y, z);
      if (next === null) continue;
      if (Array.isArray(next)) { for (const m of next) writes.set(key(m[0], m[1], m[2]), m); continue; } // 一次移动（沙）：两格同时写
      writes.set(key(x, y, z), [x, y, z, next]);
    }
    let n = 0;
    for (const [x, y, z, id] of writes.values()) {
      const prev = this.world.get(x, y, z);
      if (prev === id) continue;
      // 被水冲掉 / 失去支撑的植物掉落成物品
      if (PLANTS.has(prev) && this.drops) this.drops.spawn(`block:${BLOCKS[prev].name}`, 1, x + 0.5, y + 0.4, z + 0.5);
      this.edits.set(x, y, z, id);
      n++;
    }
    this.stats.ticks++;
    this.stats.changes += n;
    return n;
  }

  /** 这一格下一刻应该变成什么；不变返回 null。 */
  _evaluate(x, y, z) {
    const w = this.world;
    const id = w.get(x, y, z);

    // ---- 沙：下面空了就往下掉（这一格变空气，下一格由下面那一格的判定接住） ----
    if (FALLING.has(id)) {
      const below = w.get(x, y - 1, z);
      if (y > 0 && (below === 0 || waterLevel(below) >= 0 || PLANTS.has(below))) return [[x, y, z, 0], [x, y - 1, z, id]];
      return null;
    }

    // ---- 花草：脚下不是实心方块就倒 ----
    if (PLANTS.has(id)) {
      if (!isSolid(w.get(x, y - 1, z))) return 0;
      // 被水冲到：旁边或上面的水能流到这里
      const lvl = this._wantWater(x, y, z);
      if (lvl >= 0) return waterId(lvl);
      return null;
    }

    const cur = waterLevel(id);
    // 只有空气、流动水能变化（水源永远不变，实心方块挡水）
    if (id !== 0 && cur < 0) return null;
    if (cur === 0) return null;

    const want = this._wantWater(x, y, z);
    if (want < 0) return id === 0 ? null : 0; // 没有水供应：干涸
    const wantId = waterId(want);
    return wantId === id ? null : wantId;
  }

  /** 这一格应有的水等级：-1 = 不该有水。 */
  _wantWater(x, y, z) {
    const w = this.world;
    // 上面有水：直接灌下来（下落的水是满的，等级 1）
    if (waterLevel(w.get(x, y + 1, z)) >= 0) return 1;
    let best = 99, sources = 0;
    for (const [dx, dz] of H) {
      const nl = waterLevel(w.get(x + dx, y, z + dz));
      if (nl < 0) continue;
      if (nl === 0) sources++;
      // 邻居只有「落稳了」才往旁边铺：下面是实心方块或水源；下面是空气 / 流动水说明它还在往下灌
      const under = w.get(x + dx, y - 1, z + dz);
      if (!isSolid(under) && waterLevel(under) !== 0) continue;
      if (nl + 1 <= MAX_LEVEL) best = Math.min(best, nl + 1);
    }
    // 无限水源：两个水源夹住、脚下稳固
    const below = w.get(x, y - 1, z);
    if (sources >= 2 && (isSolid(below) || waterLevel(below) === 0)) return 0;
    return best === 99 ? -1 : best;
  }

  /**
   * 水流方向（推动泡在流水里的玩家）：指向等级更高（更浅）的邻居，水源 / 静水为 0。
   * @returns {{x:number, z:number}}
   */
  flowAt(x, y, z, out = { x: 0, z: 0 }) {
    out.x = 0; out.z = 0;
    const me = waterLevel(this.world.get(x, y, z));
    if (me <= 0) return out;
    for (const [dx, dz] of H) {
      const nl = waterLevel(this.world.get(x + dx, y, z + dz));
      if (nl < 0) {
        // 旁边是空气且往下能流：水往那边冲
        if (!isSolid(this.world.get(x + dx, y, z + dz)) && !isSolid(this.world.get(x + dx, y - 1, z + dz))) { out.x += dx * 2; out.z += dz * 2; }
        continue;
      }
      const d = nl - me;
      out.x += dx * d;
      out.z += dz * d;
    }
    const l = Math.hypot(out.x, out.z);
    if (l > 1e-4) { out.x /= l; out.z /= l; }
    return out;
  }
}
