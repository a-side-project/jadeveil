/**
 * 导航网格 + A* 寻路。
 *
 * 把世界按 2 格一单元栅格化，标记「可走 / 不可走」，供 NPC 寻路绕过墙与建筑。
 * 只用一次建图（世界生成后），寻路是纯栅格 A*，速度够 100+ NPC 低频重寻路。
 */
import { isSolid } from "./blocks.js";

/** 极小二叉堆，用于 A* 开放表。 */
class MinHeap {
  constructor() {
    this.a = []; // [f, idx]
  }
  get size() { return this.a.length; }
  push(f, idx) {
    const a = this.a;
    a.push([f, idx]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class NavGrid {
  constructor(world, { cellSize = 2, radius = 96 } = {}) {
    this.world = world;
    this.cellSize = cellSize;
    this.radius = radius;
    this.n = Math.ceil((radius * 2) / cellSize);
    this.walkable = new Uint8Array(this.n * this.n);
    this._build();
  }

  idx(i, j) { return j * this.n + i; }
  inBounds(i, j) { return i >= 0 && i < this.n && j >= 0 && j < this.n; }

  _center(i, j) {
    return {
      x: -this.radius + i * this.cellSize + this.cellSize / 2,
      z: -this.radius + j * this.cellSize + this.cellSize / 2,
    };
  }

  _cell(x, z) {
    return {
      i: Math.floor((x + this.radius) / this.cellSize),
      j: Math.floor((z + this.radius) / this.cellSize),
    };
  }

  _build() {
    const w = this.world;
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        const { x, z } = this._center(i, j);
        const gx = Math.round(x), gz = Math.round(z);
        const gy = w.groundHeight(gx, gz);
        let ok = false;
        // 只在「街道层」高度范围内可走：避免 NPC 把高墙/建筑顶/浮岛当成可走面。
        // 城市基准面 baseY=34，城墙约 12 格高（顶~46），浮岛更高。
        if (gy >= 24 && gy <= 44) {
          const bodyY = gy + 1;
          ok = !isSolid(w.get(gx, bodyY, gz)) && !isSolid(w.get(gx, bodyY + 1, gz));
        }
        this.walkable[this.idx(i, j)] = ok ? 1 : 0;
      }
    }
  }

  /** 某世界坐标是否可走（给 NPC 随机选目标用）。 */
  isWalkable(x, z) {
    const { i, j } = this._cell(x, z);
    return this.inBounds(i, j) && this.walkable[this.idx(i, j)] === 1;
  }

  /** 随机返回一个可走的世界坐标（用于漫游目标）。 */
  randomWalkable() {
    for (let tries = 0; tries < 200; tries++) {
      const i = (Math.random() * this.n) | 0;
      const j = (Math.random() * this.n) | 0;
      if (this.walkable[this.idx(i, j)] === 1) return this._center(i, j);
    }
    return { x: 0, z: 30 };
  }

  /**
   * A* 寻路。返回世界坐标路点数组（含终点），不可达返回 null。
   */
  findPath(sx, sz, tx, tz) {
    const s = this._cell(sx, sz);
    const t = this._cell(tx, tz);
    if (!this.inBounds(s.i, s.j) || !this.inBounds(t.i, t.j)) return null;
    const start = this.idx(s.i, s.j);
    const goal = this.idx(t.i, t.j);
    if (this.walkable[goal] !== 1) return null;

    const N = this.n * this.n;
    const g = new Float64Array(N).fill(Infinity);
    const f = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);

    const h = (i, j) => Math.abs(i - t.i) + Math.abs(j - t.j);

    g[start] = 0;
    f[start] = h(s.i, s.j);
    const open = new MinHeap();
    open.push(f[start], start);

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let found = false;

    while (open.size) {
      const [fc, cur] = open.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (fc > f[cur]) continue;

      const ci = cur % this.n, cj = (cur / this.n) | 0;
      for (const [di, dj] of dirs) {
        const ni = ci + di, nj = cj + dj;
        if (!this.inBounds(ni, nj)) continue;
        const nidx = this.idx(ni, nj);
        if (this.walkable[nidx] !== 1 || closed[nidx]) continue;
        const ng = g[cur] + 1;
        if (ng < g[nidx]) {
          g[nidx] = ng;
          f[nidx] = ng + h(ni, nj);
          came[nidx] = cur;
          open.push(f[nidx], nidx);
        }
      }
    }

    if (!found) return null;

    // 回溯
    const cells = [];
    let cur = goal;
    while (cur !== -1) {
      cells.push(cur);
      if (cur === start) break;
      cur = came[cur];
    }
    cells.reverse();

    // 简化：只保留拐点 + 终点
    const pts = [];
    for (let k = 0; k < cells.length; k++) {
      if (k === 0 || k === cells.length - 1) {
        const { x, z } = this._center(cells[k] % this.n, (cells[k] / this.n) | 0);
        pts.push([x, z]);
        continue;
      }
      const p = cells[k - 1] % this.n, pj = (cells[k - 1] / this.n) | 0;
      const c = cells[k] % this.n, cj = (cells[k] / this.n) | 0;
      const nx = cells[k + 1] % this.n, nj = (cells[k + 1] / this.n) | 0;
      // 若 p->c 与 c->n 方向一致，则 c 不是拐点
      if ((c - p === nx - c) && (cj - pj === nj - cj)) continue;
      const { x, z } = this._center(c, cj);
      pts.push([x, z]);
    }

    // 确保最后一个点是精确目标（世界坐标）
    pts[pts.length - 1] = [tx, tz];
    return pts;
  }
}
