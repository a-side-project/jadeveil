/**
 * 体素光照引擎 —— 天空光 + 方块光，逐格洪泛（flood fill），烘焙进网格顶点。
 *
 * 这是体素游戏照明的标准做法（Minecraft 的光照模型）：
 *   · 每格存两个 0..15 的光照等级：高 4 位天空光、低 4 位方块光（灯笼、火把、发光块）
 *   · 光从光源出发，每走一格衰减一级；不透明方块完全挡光，水 / 树叶额外衰减
 *   · 天空光从天顶垂直灌下时不衰减，拐进屋檐 / 门洞后才逐格变暗
 *   · 网格生成时每个顶点取周围四格的平均值（平滑光照），光影过渡柔和、没有硬边
 *
 * 取代的是旧方案「8 盏实时点光源按离玩家的距离轮流分配给 196 盏灯笼」：
 * 那种做法的灯光没有阴影会穿墙照进屋里，名额在灯笼之间换手时整片区域瞬间亮灭（实测每秒约 1.5 次跳变），
 * 而且每盏点光源都要在每个像素上算一遍。烘焙光照不穿墙、没有数量上限、每帧零开销。
 *
 * 编辑世界（挖 / 放方块、插火把）时做增量更新：先按「移除洪泛」把受影响的光清掉，
 * 再从边界重新扩散 —— 只触及光照半径（15 格）内的格子，并把光照变化过的区块标脏重建网格。
 */
import { BLOCKS } from "./blocks.js";
import { CH, CW, VoxelWorld } from "./voxelWorld.js";

const MAX = 15;

// 每种方块的透光代价与发光等级（按 id 查表，热路径里不做对象访问）
const ATTEN = new Uint8Array(256); // 0 = 完全挡光；其余 = 进入该格要扣的等级
const EMIT = new Uint8Array(256);
BLOCKS.forEach((b, id) => {
  if (!b) return;
  if (b.opaque && id !== 0) ATTEN[id] = 0;
  else if (b.liquid) ATTEN[id] = 2;
  else if (b.cutout && b.solid) ATTEN[id] = 2; // 树叶 / 石狮：比空气更暗一点
  else ATTEN[id] = 1;
  if (b.light) EMIT[id] = b.model === "torch" ? 14 : MAX;
});
ATTEN[0] = 1;

export function emissionOf(id) { return EMIT[id]; }

// 世界坐标打包成一个整数，放进 Int32 环形队列（x、z ∈ [-512, 511]，y ∈ [0, 255]）
const pack = (x, y, z) => ((x + 512) | ((z + 512) << 10) | (y << 20));
const unX = (p) => (p & 1023) - 512;
const unZ = (p) => ((p >> 10) & 1023) - 512;
const unY = (p) => (p >>> 20) & 255;

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
const DOWN = 5;

class Queue {
  constructor(n = 1 << 16) { this.a = new Int32Array(n); this.h = 0; this.t = 0; }
  get size() { return this.t - this.h; }
  push(v) {
    if (this.t >= this.a.length) {
      if (this.h > 0) { this.a.copyWithin(0, this.h, this.t); this.t -= this.h; this.h = 0; }
      if (this.t >= this.a.length) { const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    }
    this.a[this.t++] = v;
  }
  shift() { return this.a[this.h++]; }
  clear() { this.h = this.t = 0; }
}

export class LightEngine {
  constructor(world) {
    this.world = world;
    this.data = new Map(); // 区块键 → Uint8Array（高 4 位天空光、低 4 位方块光）
    this.q = new Queue();
    this.rq = new Queue(); // 移除洪泛用
    this.rqLevel = new Uint8Array(1 << 16);
    this.changed = new Set(); // 本次更新里光照变化过的区块（需要重建网格）
  }

  /* ---------------- 存取 ---------------- */
  _chunk(x, z, create) {
    const k = VoxelWorld.key(x >> 4, z >> 4);
    let c = this.data.get(k);
    if (!c && create) {
      if (!this.world.chunks.has(k)) return null;
      c = new Uint8Array(CW * CH * CW);
      this.data.set(k, c);
    }
    return c;
  }

  /** 天空光 0..15（世界之外 / 高于世界顶的地方视为露天）。 */
  sky(x, y, z) {
    if (y >= CH) return MAX;
    if (y < 0) return 0;
    const c = this._chunk(x, z, false);
    if (!c) return MAX;
    return c[(y * CW + (z & 15)) * CW + (x & 15)] >> 4;
  }

  /** 打包值（高 4 位天空光、低 4 位方块光）：网格生成的热路径一次查表拿两个通道。 */
  raw(x, y, z) {
    if (y >= CH) return MAX << 4;
    if (y < 0) return 0;
    const c = this._chunk(x, z, false);
    if (!c) return MAX << 4;
    return c[(y * CW + (z & 15)) * CW + (x & 15)];
  }

  /** 方块光 0..15。 */
  block(x, y, z) {
    if (y < 0 || y >= CH) return 0;
    const c = this._chunk(x, z, false);
    if (!c) return 0;
    return c[(y * CW + (z & 15)) * CW + (x & 15)] & 15;
  }

  _setSky(x, y, z, v) {
    const c = this._chunk(x, z, true);
    if (!c) return;
    const i = (y * CW + (z & 15)) * CW + (x & 15);
    c[i] = (c[i] & 15) | (v << 4);
    this._touch(x, z);
  }

  _setBlock(x, y, z, v) {
    const c = this._chunk(x, z, true);
    if (!c) return;
    const i = (y * CW + (z & 15)) * CW + (x & 15);
    c[i] = (c[i] & 0xf0) | v;
    this._touch(x, z);
  }

  /** 记下光照变化的区块；在区块边缘时邻区块的顶点也会采样到它。 */
  _touch(x, z) {
    if (!this._tracking) return;
    const cx = x >> 4, cz = z >> 4;
    this.changed.add(VoxelWorld.key(cx, cz));
    const lx = x & 15, lz = z & 15;
    if (lx === 0) this.changed.add(VoxelWorld.key(cx - 1, cz));
    if (lx === 15) this.changed.add(VoxelWorld.key(cx + 1, cz));
    if (lz === 0) this.changed.add(VoxelWorld.key(cx, cz - 1));
    if (lz === 15) this.changed.add(VoxelWorld.key(cx, cz + 1));
  }

  _id(x, y, z) { return this.world.get(x, y, z); }

  /**
   * 批量改动（读档重放上千格差量）时暂停增量更新，结束后整体重算一次 —— 比逐格增量快得多。
   * @returns 是否有改动（调用方据此把全部区块标脏）
   */
  batch(fn) {
    this.suspended = true;
    let n;
    try { n = fn(); } finally { this.suspended = false; }
    if (n) this.computeAll();
    return n;
  }

  /* ---------------- 全量计算（开局一次） ---------------- */
  computeAll() {
    const t0 = performance.now();
    const w = this.world;
    this._tracking = false;
    const q = this.q;
    q.clear();

    // 1) 天空光：每列从天顶往下灌，直到第一个不透明方块（水 / 树叶逐格衰减）
    const tops = new Map(); // 列 → 最高不透明方块 y（无则 -1），用于找横向扩散的种子
    for (const [k, chunk] of w.chunks) {
      const [cx, cz] = VoxelWorld.decode(k);
      const light = new Uint8Array(CW * CH * CW);
      this.data.set(k, light);
      for (let lz = 0; lz < CW; lz++) {
        for (let lx = 0; lx < CW; lx++) {
          let level = MAX;
          let top = -1;
          for (let y = CH - 1; y >= 0; y--) {
            const i = (y * CW + lz) * CW + lx;
            const a = ATTEN[chunk[i]];
            if (a === 0) { top = y; break; }
            if (a > 1) level = Math.max(0, level - (a - 1));
            light[i] = level << 4;
          }
          tops.set(((cx * CW + lx + 512) | ((cz * CW + lz + 512) << 10)), top);
        }
      }
    }
    const topAt = (x, z) => {
      const t = tops.get((x + 512) | ((z + 512) << 10));
      return t === undefined ? -1 : t;
    };

    // 2) 横向扩散的种子：露天格子里，邻列在这个高度被遮住的那些（屋檐下、门洞口、悬崖下）
    for (const [k] of w.chunks) {
      const [cx, cz] = VoxelWorld.decode(k);
      for (let lz = 0; lz < CW; lz++) {
        for (let lx = 0; lx < CW; lx++) {
          const x = cx * CW + lx, z = cz * CW + lz;
          const top = topAt(x, z);
          const hi = Math.max(topAt(x + 1, z), topAt(x - 1, z), topAt(x, z + 1), topAt(x, z - 1));
          for (let y = top + 1; y <= hi && y < CH; y++) {
            if (this.sky(x, y, z) > 1) q.push(pack(x, y, z));
          }
        }
      }
    }
    const skyCells = this._spread(true);

    // 3) 方块光：所有发光方块作为光源
    q.clear();
    for (const [k, chunk] of w.chunks) {
      const [cx, cz] = VoxelWorld.decode(k);
      const light = this.data.get(k);
      for (let i = 0; i < chunk.length; i++) {
        const e = EMIT[chunk[i]];
        if (!e) continue;
        light[i] = (light[i] & 0xf0) | e;
        const lx = i & 15, lz = (i >> 4) & 15, y = i >> 8;
        q.push(pack(cx * CW + lx, y, cz * CW + lz));
      }
    }
    const blockCells = this._spread(false);
    this._tracking = true;
    this.stats = { ms: Math.round(performance.now() - t0), skyCells, blockCells, chunks: w.chunks.size };
    return this.stats;
  }

  /**
   * 从队列里的格子向外扩散（BFS）。
   * 天空光有一条特例：等级 15 往正下方走不衰减（阳光直射下来），其余方向每格扣代价。
   */
  _spread(sky) {
    const q = this.q;
    let n = 0;
    while (q.size) {
      const p = q.shift();
      const x = unX(p), y = unY(p), z = unZ(p);
      const L = sky ? this.sky(x, y, z) : this.block(x, y, z);
      if (L <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const D = DIRS[d];
        const nx = x + D[0], ny = y + D[1], nz = z + D[2];
        if (ny < 0 || ny >= CH) continue;
        const a = ATTEN[this._id(nx, ny, nz)];
        if (a === 0) continue;
        // 阳光直射：等级 15 往正下方穿过空气不衰减（与 computeAll 的逐列灌注一致：水 / 树叶只扣 a - 1）
        const nl = sky && d === DOWN && L === MAX ? MAX - (a - 1) : L - a;
        if (nl <= 0) continue;
        if (sky) {
          if (this.sky(nx, ny, nz) >= nl) continue;
          this._setSky(nx, ny, nz, nl);
        } else {
          if (this.block(nx, ny, nz) >= nl) continue;
          this._setBlock(nx, ny, nz, nl);
        }
        q.push(pack(nx, ny, nz));
        n++;
      }
    }
    return n;
  }

  /**
   * 移除洪泛：把从 (x,y,z) 传出去的光清掉；遇到更亮（来自别的光源）的格子，
   * 把它放进重新扩散队列，之后由 _spread 把光补回被清空的区域。
   */
  _remove(sky, x, y, z) {
    const rq = this.rq, q = this.q;
    rq.clear();
    const get = sky ? (a, b, c) => this.sky(a, b, c) : (a, b, c) => this.block(a, b, c);
    const set = sky ? (a, b, c, v) => this._setSky(a, b, c, v) : (a, b, c, v) => this._setBlock(a, b, c, v);
    const levels = [];
    const L0 = get(x, y, z);
    if (!L0) return;
    set(x, y, z, 0);
    rq.push(pack(x, y, z));
    levels.push(L0);
    let li = 0;
    while (rq.size) {
      const p = rq.shift();
      const L = levels[li++];
      const px = unX(p), py = unY(p), pz = unZ(p);
      for (let d = 0; d < 6; d++) {
        const D = DIRS[d];
        const nx = px + D[0], ny = py + D[1], nz = pz + D[2];
        if (ny < 0 || ny >= CH) continue;
        const nl = get(nx, ny, nz);
        if (!nl) continue;
        // 比它暗的是它传出去的光（天空光往正下方的 15 也是它带下去的）→ 一起清掉
        const fromIt = nl < L || (sky && d === DOWN && L === MAX && nl === MAX);
        if (fromIt) {
          // 自身发光的格子保留光源等级，之后重新扩散
          const e = !sky ? EMIT[this._id(nx, ny, nz)] : 0;
          set(nx, ny, nz, e);
          if (e) q.push(pack(nx, ny, nz));
          rq.push(pack(nx, ny, nz));
          levels.push(nl);
        } else {
          q.push(pack(nx, ny, nz));
        }
      }
    }
  }

  /**
   * 一格方块从 prevId 变成 id 之后的增量重算。
   * @returns {Set<number>} 光照变化过的区块键
   */
  update(x, y, z, prevId, id) {
    this.changed = new Set();
    if (!this.data.size) return this.changed;
    const q = this.q;

    // ---- 方块光 ----
    q.clear();
    const wasEmit = EMIT[prevId], nowEmit = EMIT[id];
    if (wasEmit || ATTEN[id] === 0 || ATTEN[id] > ATTEN[prevId]) this._remove(false, x, y, z);
    if (nowEmit) {
      this._setBlock(x, y, z, Math.max(nowEmit, this.block(x, y, z)));
      q.push(pack(x, y, z));
    }
    if (ATTEN[id] !== 0) {
      // 变得透光（挖掉方块）：四周的光会流进来
      for (const D of DIRS) {
        const nx = x + D[0], ny = y + D[1], nz = z + D[2];
        if (ny >= 0 && ny < CH && this.block(nx, ny, nz) > 1) q.push(pack(nx, ny, nz));
      }
    }
    this._spread(false);

    // ---- 天空光 ----
    q.clear();
    if (ATTEN[id] === 0 || ATTEN[id] > ATTEN[prevId]) this._remove(true, x, y, z);
    if (ATTEN[id] !== 0) {
      for (const D of DIRS) {
        const nx = x + D[0], ny = y + D[1], nz = z + D[2];
        if (ny >= 0 && ny < CH && this.sky(nx, ny, nz) > 1) q.push(pack(nx, ny, nz));
      }
      if (y + 1 >= CH) { this._setSky(x, y, z, MAX); q.push(pack(x, y, z)); }
    }
    this._spread(true);
    return this.changed;
  }

  /**
   * 实体（玩家、居民、龙、假人）所在位置的光照：对周围 8 格做三线性插值，
   * 只计入透光的格子 —— 走路时亮度连续变化，不会一格一跳。
   * @returns {[number, number]} [天空光, 方块光]，0..1
   */
  sampleSmooth(px, py, pz, out = [0, 0]) {
    const fx = px - 0.5, fy = py - 0.5, fz = pz - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    let ws = 0, s = 0, b = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
      const x = x0 + dx, y = y0 + dy, z = z0 + dz;
      if (ATTEN[this._id(x, y, z)] === 0) continue;
      const wgt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      ws += wgt;
      s += this.sky(x, y, z) * wgt;
      b += this.block(x, y, z) * wgt;
    }
    if (ws < 1e-4) {
      const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
      out[0] = this.sky(cx, cy, cz) / MAX;
      out[1] = this.block(cx, cy, cz) / MAX;
      return out;
    }
    out[0] = s / ws / MAX;
    out[1] = b / ws / MAX;
    return out;
  }
}

export { ATTEN as LIGHT_ATTEN };
