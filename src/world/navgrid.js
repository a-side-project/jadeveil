/**
 * NPC 导航网格 —— 逐格（1×1）精度的高度场导航 + A*。
 *
 * 旧版的根本缺陷（NPC 反复穿墙 / 下水 / 撞墙的来源）：
 *   1. 2×2 格一单元、只采样中心一列 —— 另外三列是墙或水完全看不到
 *   2. 相邻单元之间不检查高度差 —— 一格高的墙、两格深的坑都被当成通路
 *   3. 没有连通性 —— 随机目的地常常根本走不到，NPC 只能在墙前打转
 *
 * 新版：
 *   · 每一列记录「街道层可站立面」的高度 h（脚下实心不透明、脚和头两格可通行、无液体）
 *   · 连通规则：相邻格高差 ≤ 1；斜向移动要求两个正交邻格都可走（不切墙角）
 *   · 连通分量：随机目的地只在同一分量里选，保证一定可达
 *   · 墙边代价：贴墙的格子寻路代价更高 → 路径自然走在街道中间，身体不贴墙
 *   · 路径平滑：拉直线前检查「身体半径内每个采样点」都落在可走格上
 *   · 动态更新：玩家改方块时只重算受影响的几列
 */
import { isSolid, isLiquid, isOpaque } from "./blocks.js";

const STREET_MIN = 26; // 街道层可站立面的高度范围（城台 baseY = 34）
const STREET_MAX = 46;
const WALL_COST = 2.5; // 贴墙格的额外代价
const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** 身体采样点（单位圆上的 8 个点 + 中心），乘以身体半径使用。 */
const SAMPLES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  clear() { this.k.length = 0; this.v.length = 0; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p];
      i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; }
        if (r < n && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m];
        i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export class NavGrid {
  constructor(world, { radius = 100 } = {}) {
    this.world = world;
    this.radius = radius;
    this.n = radius * 2;
    const N = this.n * this.n;
    this.h = new Int16Array(N).fill(-1); // 可站立面（脚底）高度，-1 = 不可走
    this.clear = new Uint8Array(N); // 可站立面之上连续可通行的格数（2..4）
    this.wall = new Uint8Array(N); // 贴墙程度 0..8
    this.comp = new Int32Array(N).fill(-1); // 连通分量 id
    this.compSize = [];
    this.mainComp = -1;
    // A* 工作区：一次分配，用代数戳避免每次清零
    this._g = new Float32Array(N);
    this._came = new Int32Array(N);
    this._stamp = new Uint32Array(N);
    this._closed = new Uint32Array(N);
    this._gen = 0;
    this._heap = new MinHeap();
    this._compDirty = false;
    this.blocked = new Set(); // 非方块障碍占用的格（重算列时保持不可走）
    this.version = 0; // 任何格子变化都 +1（让「格能否容身」缓存失效）

    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) this._evalColumn(i, j);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) this._evalWall(i, j);
    this._buildComponents();
  }

  /* ---------------- 坐标 ---------------- */
  idx(i, j) { return j * this.n + i; }
  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.n && j < this.n; }
  cellOf(x, z) { return [Math.floor(x) + this.radius, Math.floor(z) + this.radius]; }
  centerOf(i, j) { return [i - this.radius + 0.5, j - this.radius + 0.5]; }

  /* ---------------- 建图 ---------------- */
  _passable(x, y, z) {
    const id = this.world.get(x, y, z);
    return !isSolid(id) && !isLiquid(id);
  }

  /** 一列的街道层可站立面：自下而上找第一个「实心不透明地面 + 两格净空 + 无液体」。 */
  _evalColumn(i, j) {
    const x = i - this.radius, z = j - this.radius;
    const w = this.world;
    let h = -1;
    for (let y = STREET_MIN; y <= STREET_MAX; y++) {
      const floor = w.get(x, y - 1, z);
      if (!isSolid(floor) || !isOpaque(floor) || isLiquid(floor)) continue;
      if (!this._passable(x, y, z) || !this._passable(x, y + 1, z)) continue;
      // 水边保护：脚下这一层四周任何一格是液体都不算可走（避免沿岸一脚踩进水里）
      let wet = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (isLiquid(w.get(x + dx, y - 1, z + dz)) || isLiquid(w.get(x + dx, y, z + dz))) { wet = true; break; }
      }
      if (wet) continue;
      h = y;
      break;
    }
    const k = this.idx(i, j);
    this.h[k] = this.blocked.has(k) ? -1 : h;
    // 净空：可站立面往上数连续可通行格（最多数到 4）。站到台阶上时要靠它保证头顶不进方块
    let c = 0;
    if (h >= 0) while (c < 4 && this._passable(x, h + c, z)) c++;
    this.clear[k] = c;
  }

  /** 两格之间能否直接走（高差 ≤ 1）。 */
  _step(a, b) {
    const ha = this.h[a], hb = this.h[b];
    return ha >= 0 && hb >= 0 && Math.abs(ha - hb) <= 1;
  }

  _evalWall(i, j) {
    const a = this.idx(i, j);
    if (this.h[a] < 0) { this.wall[a] = 0; return; }
    let w = 0;
    for (const [di, dj] of DIRS) {
      const ni = i + di, nj = j + dj;
      if (!this.inBounds(ni, nj) || !this._step(a, this.idx(ni, nj))) w++;
    }
    this.wall[a] = w;
  }

  _buildComponents() {
    this.comp.fill(-1);
    this.compSize = [];
    const n = this.n;
    const queue = new Int32Array(n * n);
    let id = 0;
    for (let s = 0; s < n * n; s++) {
      if (this.h[s] < 0 || this.comp[s] >= 0) continue;
      let qh = 0, qt = 0;
      queue[qt++] = s;
      this.comp[s] = id;
      let size = 0;
      while (qh < qt) {
        const c = queue[qh++];
        size++;
        const ci = c % n, cj = (c / n) | 0;
        for (let d = 0; d < 4; d++) {
          const ni = ci + DIRS[d][0], nj = cj + DIRS[d][1];
          if (!this.inBounds(ni, nj)) continue;
          const nb = this.idx(ni, nj);
          if (this.comp[nb] >= 0 || !this._step(c, nb)) continue;
          this.comp[nb] = id;
          queue[qt++] = nb;
        }
      }
      this.compSize.push(size);
      id++;
    }
    let best = -1, bs = 0;
    this.compSize.forEach((s, k) => { if (s > bs) { bs = s; best = k; } });
    this.mainComp = best;
    this._compDirty = false;
  }

  /** 世界被修改后：重算该格附近的列与贴墙度，连通分量延迟重建。 */
  onWorldEdit(x, z) {
    const [ci, cj] = this.cellOf(x, z);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (this.inBounds(ci + di, cj + dj)) this._evalColumn(ci + di, cj + dj);
    }
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      if (this.inBounds(ci + di, cj + dj)) this._evalWall(ci + di, cj + dj);
    }
    this._compDirty = true;
    this.version = (this.version || 0) + 1;
  }

  /** 把一个半径 r 的圆形区域标为不可走（训练假人等非方块障碍物）。 */
  blockArea(x, z, r = 0.8) {
    const [ci, cj] = this.cellOf(x, z);
    const R = Math.ceil(r) + 1;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const [cx, cz] = this.centerOf(ci + di, cj + dj);
      if (this.inBounds(ci + di, cj + dj) && Math.hypot(cx - x, cz - z) <= r + 0.5) {
        const k = this.idx(ci + di, cj + dj);
        this.blocked.add(k);
        this.h[k] = -1;
      }
    }
    for (let dj = -R - 1; dj <= R + 1; dj++) for (let di = -R - 1; di <= R + 1; di++) {
      if (this.inBounds(ci + di, cj + dj)) this._evalWall(ci + di, cj + dj);
    }
    this._compDirty = true;
    this.version = (this.version || 0) + 1;
  }

  /** 格中心能否容下身体（带缓存：随版本号失效）。 */
  _fits(k) {
    if (this._fitVer !== this.version) {
      this._fitVer = this.version;
      this._fitCache = new Int8Array(this.n * this.n);
    }
    let v = this._fitCache[k];
    if (v === 0) {
      const [x, z] = this.centerOf(k % this.n, (k / this.n) | 0);
      v = this.bodyFits(x, z) ? 1 : -1;
      this._fitCache[k] = v;
    }
    return v === 1;
  }

  /** 从格 k 沿方向 d8 走一步时，跨格中点能否容下身体（缓存，随版本号失效）。 */
  _edgeFits(k, ci, cj, d8) {
    if (this._edgeVer !== this.version) {
      this._edgeVer = this.version;
      this._edgeCache = new Int8Array(this.n * this.n * 8);
    }
    const e = k * 8 + d8;
    let v = this._edgeCache[e];
    if (v === 0) {
      const [mx, mz] = this.centerOf(ci, cj);
      v = this.bodyFits(mx + DIRS[d8][0] * 0.5, mz + DIRS[d8][1] * 0.5) ? 1 : -1;
      this._edgeCache[e] = v;
    }
    return v === 1;
  }

  /** 每帧调用：有改动时（低频）重建连通分量。 */
  maintain() {
    if (this._compDirty) this._buildComponents();
  }

  /* ---------------- 查询 ---------------- */

  /** 世界坐标所在格的可站立高度（-1 = 不可走）。 */
  heightAt(x, z) {
    const [i, j] = this.cellOf(x, z);
    return this.inBounds(i, j) ? this.h[this.idx(i, j)] : -1;
  }

  isWalkable(x, z) {
    return this.heightAt(x, z) >= 0;
  }

  componentAt(x, z) {
    const [i, j] = this.cellOf(x, z);
    return this.inBounds(i, j) ? this.comp[this.idx(i, j)] : -1;
  }

  /**
   * 「身体」是否完全在可走区域里：以 (x,z) 为中心、半径 r 的 5 个采样点
   * 都在可走格上，且相对中心格的高差 ≤ 1。这条是 NPC 永不进墙 / 进水的硬保证。
   */
  bodyFits(x, z, r = 0.42) {
    // 身体站在脚下各采样点可站立面的最高处 H（见 supportHeight）。
    // 每个采样点所在列必须：可走、比 H 低不超过 1 格、并且在 H 之上还留有 2 格净空 ——
    // 这样无论站在平地还是半个身子踩上台阶，躯干和头部都不可能与任何方块相交。
    let H = -1;
    for (let s = 0; s < 9; s++) {
      const [dx, dz] = SAMPLES[s];
      const hh = this.heightAt(x + dx * r, z + dz * r);
      if (hh < 0) return false;
      if (hh > H) H = hh;
    }
    for (let s = 0; s < 9; s++) {
      const [dx, dz] = SAMPLES[s];
      const [i, j] = this.cellOf(x + dx * r, z + dz * r);
      const k = this.idx(i, j);
      const drop = H - this.h[k];
      if (drop > 1 || this.clear[k] < drop + 2) return false;
    }
    return true;
  }

  /**
   * 身体站立高度：身体半径内各采样点可站立面的最高值（与 MC 一样，半个身子踩上台阶就站到台阶上），
   * 这样上下台阶时腿和躯干不会插进台阶方块里。
   */
  supportHeight(x, z, r = 0.42) {
    let h = -1;
    for (const [dx, dz] of SAMPLES) {
      const hh = this.heightAt(x + dx * r, z + dz * r);
      if (hh > h) h = hh;
    }
    return h;
  }

  /** 离 (x,z) 最近的可走格中心（同一分量优先），找不到返回 null。 */
  nearestWalkable(x, z, maxR = 12, comp = -1) {
    const [ci, cj] = this.cellOf(x, z);
    for (let r = 0; r <= maxR; r++) {
      let best = null, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (!this.inBounds(i, j)) continue;
        const k = this.idx(i, j);
        if (this.h[k] < 0 || (comp >= 0 && this.comp[k] !== comp) || this.wall[k] > 3) continue;
        const c = this.centerOf(i, j);
        if (!this.bodyFits(c[0], c[1])) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = c; }
      }
      if (best) return { x: best[0], z: best[1] };
    }
    return null;
  }

  /** 在给定分量里随机挑一个「不贴墙」的可走点。 */
  randomWalkable(comp = this.mainComp, rnd = Math.random) {
    for (let t = 0; t < 400; t++) {
      const i = (rnd() * this.n) | 0, j = (rnd() * this.n) | 0;
      const k = this.idx(i, j);
      if (this.h[k] >= 0 && this.comp[k] === comp && this.wall[k] <= 1) {
        const [x, z] = this.centerOf(i, j);
        if (this.bodyFits(x, z)) return { x, z };
      }
    }
    return null;
  }

  /**
   * A*（8 邻接、八方向距离启发、贴墙代价）。返回平滑后的世界坐标路点 [[x,z],...]，不可达返回 null。
   */
  findPath(sx, sz, tx, tz, maxIter = 12000) {
    const [si, sj] = this.cellOf(sx, sz);
    const [ti, tj] = this.cellOf(tx, tz);
    if (!this.inBounds(si, sj) || !this.inBounds(ti, tj)) return null;
    const start = this.idx(si, sj), goal = this.idx(ti, tj);
    if (this.h[start] < 0 || this.h[goal] < 0) return null;
    if (this.comp[start] !== this.comp[goal]) return null;

    const gen = ++this._gen;
    const g = this._g, came = this._came, stamp = this._stamp, closed = this._closed;
    const heap = this._heap;
    heap.clear();
    const hfun = (i, j) => {
      const dx = Math.abs(i - ti), dy = Math.abs(j - tj);
      return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
    };
    stamp[start] = gen;
    g[start] = 0;
    came[start] = -1;
    heap.push(hfun(si, sj), start);
    let found = false, iter = 0;
    const n = this.n;

    while (heap.size && iter++ < maxIter) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) { found = true; break; }
      const ci = cur % n, cj = (cur / n) | 0;
      for (let d8 = 0; d8 < 8; d8++) {
        const [di, dj, cost] = DIRS[d8];
        const ni = ci + di, nj = cj + dj;
        if (!this.inBounds(ni, nj)) continue;
        const nb = this.idx(ni, nj);
        if (closed[nb] === gen || !this._step(cur, nb)) continue;
        // 目标格中心必须容得下身体（低矮树冠 / 屋檐下净空不足的格子不走）
        if (!this._fits(nb)) continue;
        // 斜向：两个正交邻格都必须可走，且四格两两高差 ≤ 1（不切墙角、不斜跨高低差）
        if (di !== 0 && dj !== 0) {
          const o1 = this.idx(ci + di, cj), o2 = this.idx(ci, cj + dj);
          if (!this._step(cur, o1) || !this._step(cur, o2) || !this._step(nb, o1) || !this._step(nb, o2) || !this._step(o1, o2)) continue;
        }
        // 跨格的中点也要容得下身体（跨高低差时，抬高后的净空必须够）—— 结果按边缓存
        if (!this._edgeFits(cur, ci, cj, d8)) continue;
        const ng = g[cur] + cost * (1 + (this.wall[nb] > 0 ? WALL_COST * (this.wall[nb] / 8) : 0));
        if (stamp[nb] !== gen || ng < g[nb]) {
          stamp[nb] = gen;
          g[nb] = ng;
          came[nb] = cur;
          heap.push(ng + hfun(ni, nj), nb);
        }
      }
    }
    if (!found) return null;

    const cells = [];
    for (let c = goal; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    return this._smooth(cells);
  }

  /** 两点之间的直线是否「身体可通过」（每 0.25 格采样一次 bodyFits，且高差连续）。 */
  clearLine(ax, az, bx, bz, r = 0.42) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / 0.25));
    let prevH = this.heightAt(ax, az);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (!this.bodyFits(x, z, r)) return false;
      const h = this.heightAt(x, z);
      if (Math.abs(h - prevH) > 1) return false;
      prevH = h;
    }
    return true;
  }

  /** 拉直线平滑：从当前点出发，尽量连到最远的可直达格。 */
  _smooth(cells) {
    const pts = cells.map((c) => this.centerOf(c % this.n, (c / this.n) | 0));
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.clearLine(pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--;
      out.push(pts[b]);
      a = b;
    }
    return out;
  }
}
