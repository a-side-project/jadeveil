/**
 * 区块网格生成器 —— 把体素数据烘焙成 BufferGeometry。
 *
 * 特性：
 *  · 只生成暴露面（邻块不透明则剔除），大幅降低三角形数；
 *  · 逐顶点 AO（环境光遮蔽）：按经典 3 邻域算法计算 0..3 级遮蔽；
 *  · 面朝向明暗烘焙进顶点色，配合 AO 让体素不扁平；
 *  · 平滑光照：每个顶点取面外侧四格（与 AO 同一组格子）的天空光 / 方块光平均值，
 *    写入 aLight 属性（见 world/lighting.js），由着色器换算成明暗与灯光；
 *  · 发光方块写入 emissive 属性，供自定义着色器做自发光与泛光。
 */
import * as THREE from "three";
import { AIR, BLOCKS, FACE_LIGHT, isOpaque, isLiquid } from "./blocks.js";
import { CH, CW, VoxelWorld } from "./voxelWorld.js";
import { hash3i } from "../core/noise.js";
import { TILE_VARIANTS } from "./atlas.js";

/** 根据方块世界坐标选一个稳定的变体序号（变体数表来自 atlas.js，两边同源）。 */
function variantIndex(n, x, y, z) {
  return Math.floor(hash3i(x, y, z, 0x5eed) * n) % n;
}

// 六个面的法线与四个角点（逆时针，从面外侧看）
const FACES = [
  { // 0 +X 东
    dir: [1, 0, 0],
    corners: [
      [1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1],
    ],
    uAxis: [0, 0, -1], vAxis: [0, 1, 0],
  },
  { // 1 -X 西
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0],
    ],
    uAxis: [0, 0, 1], vAxis: [0, 1, 0],
  },
  { // 2 +Y 顶
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0],
    ],
    uAxis: [1, 0, 0], vAxis: [0, 0, -1],
  },
  { // 3 -Y 底
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
    ],
    uAxis: [1, 0, 0], vAxis: [0, 0, 1],
  },
  { // 4 +Z 南
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ],
    uAxis: [1, 0, 0], vAxis: [0, 1, 0],
  },
  { // 5 -Z 北
    dir: [0, 0, -1],
    corners: [
      [1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0],
    ],
    uAxis: [-1, 0, 0], vAxis: [0, 1, 0],
  },
];

/** 每个面四个角对应的 AO 采样偏移（side1, side2, corner）。 */
const AO_OFFSETS = [
  // 对每个角，给出相对方块的两个切向邻居 + 对角邻居
  [[0, -1, 0], [0, 0, -1], [0, -1, -1]],
  [[0, -1, 0], [0, 0, 1], [0, -1, 1]],
  [[0, 1, 0], [0, 0, 1], [0, 1, 1]],
  [[0, 1, 0], [0, 0, -1], [0, 1, -1]],
];

const AO_LEVELS = [0.42, 0.62, 0.82, 1.0];

/** 角点的综合亮度（AO × 光照），用来挑三角剖分的对角线。 */
function cornerBrightness(q) {
  return AO_LEVELS[q.ao] * (0.4 + 0.6 * Math.max(q.sky, q.block));
}

// 生成网格时的局部缓存：本区块 + 一圈 1 格宽的邻居（面剔除 / AO / 平滑光照最多只看 ±1 格）
const PW = CW + 2;

export class ChunkMesher {
  constructor(world, atlas) {
    this.world = world;
    this.atlas = atlas;
    this._rectCache = new Map(); // 贴图名 → 各变体的 UV 矩形（避免每个面拼字符串 + 查表 + 分配对象）
    this._ids = new Uint8Array(PW * PW * CH);
    this._light = new Uint8Array(PW * PW * CH);
    this._px = 0;
    this._pz = 0;
  }

  /**
   * 把本区块与四周一圈邻居的方块 id、光照拷进连续数组。
   * 网格生成要查几十万次邻格，每次都走 world.get（区块哈希表）是主要开销；
   * 换成按下标直接读数组后，单个区块的生成耗时降到原来的几分之一。
   */
  _fill(ox, oz) {
    const ids = this._ids, light = this._light, L = this.world.lighting;
    this._px = ox - 1;
    this._pz = oz - 1;
    ids.fill(0);
    light.fill(L ? 0 : 0xf0);
    for (let lz = 0; lz < PW; lz++) {
      for (let lx = 0; lx < PW; lx++) {
        const wx = this._px + lx, wz = this._pz + lz;
        const chunk = this.world.chunks.get(VoxelWorld.key(wx >> 4, wz >> 4));
        const lc = L ? L.data.get(VoxelWorld.key(wx >> 4, wz >> 4)) : null;
        const base = (lz * PW + lx) * CH;
        const cx = wx & 15, cz = wz & 15;
        if (!chunk) {
          // 世界之外：空气、露天
          for (let y = 0; y < CH; y++) light[base + y] = 0xf0;
          continue;
        }
        for (let y = 0; y < CH; y++) {
          const i = (y * CW + cz) * CW + cx;
          ids[base + y] = chunk[i];
          light[base + y] = lc ? lc[i] : 0xf0;
        }
      }
    }
  }

  /** 某张贴图所有变体的 UV 矩形（首次用到时从图集里取出并缓存）。 */
  _rects(tileName) {
    let r = this._rectCache.get(tileName);
    if (!r) {
      const n = TILE_VARIANTS[tileName];
      r = n ? Array.from({ length: n }, (_, v) => this.atlas.uvRect(`${tileName}#${v}`)) : [this.atlas.uvRect(tileName)];
      this._rectCache.set(tileName, r);
    }
    return r;
  }

  /** 局部缓存里的方块 id（坐标为世界坐标，必须在本区块 ±1 格内）。 */
  _id(x, y, z) {
    if (y < 0 || y >= CH) return AIR;
    return this._ids[((z - this._pz) * PW + (x - this._px)) * CH + y];
  }

  /** 局部缓存里的光照打包值（高 4 位天空光、低 4 位方块光）。 */
  _lt(x, y, z) {
    if (y >= CH) return 0xf0;
    if (y < 0) return 0;
    return this._light[((z - this._pz) * PW + (x - this._px)) * CH + y];
  }

  /**
   * 某个面某个角的 AO 等级（0 最暗，3 最亮）+ 平滑光照。
   * 光照取面外侧的四格（基准格、两个切向邻格、对角格）里透光格子的平均值，写进 out.sky / out.block（0..1）。
   */
  corner(x, y, z, faceIdx, cornerIdx, out) {
    const ao = this.aoLevel(x, y, z, faceIdx, cornerIdx);
    out.ao = ao;
    const c = this._cells;
    let n = 0, s = 0, b = 0;
    for (let i = 0; i < 4; i++) {
      const cx = c[i * 3], cy = c[i * 3 + 1], cz = c[i * 3 + 2];
      // 两个切向邻格都被挡住时，对角格在几何上不可见，不参与平均（与 AO 的判定一致）
      if (i === 3 && c[12] && c[13]) continue;
      if (i > 0 && c[11 + i]) continue; // 不透明格子（c[12..14]）本身没有光
      const v = this._lt(cx, cy, cz);
      s += v >> 4;
      b += v & 15;
      n++;
    }
    out.sky = n ? s / n / 15 : 0;
    out.block = n ? b / n / 15 : 0;
    return out;
  }

  /** 计算某个面某个角的 AO 等级（0 最暗，3 最亮）。 */
  aoLevel(x, y, z, faceIdx, cornerIdx) {
    const f = FACES[faceIdx];
    const d = f.dir;
    // 面外侧的基准点
    const bx = x + d[0];
    const by = y + d[1];
    const bz = z + d[2];

    // 该角在面平面内的两个切向方向
    const c = f.corners[cornerIdx];
    // 角相对方块中心的切向偏移（-1 或 +1）
    const su = c[0] * f.uAxis[0] + c[1] * f.uAxis[1] + c[2] * f.uAxis[2];
    const sv = c[0] * f.vAxis[0] + c[1] * f.vAxis[1] + c[2] * f.vAxis[2];
    const ux = su * 2 - 1;
    const vy = sv * 2 - 1;

    const s1x = bx + f.uAxis[0] * ux;
    const s1y = by + f.uAxis[1] * ux;
    const s1z = bz + f.uAxis[2] * ux;
    const s2x = bx + f.vAxis[0] * vy;
    const s2y = by + f.vAxis[1] * vy;
    const s2z = bz + f.vAxis[2] * vy;
    const cnx = s1x + f.vAxis[0] * vy;
    const cny = s1y + f.vAxis[1] * vy;
    const cnz = s1z + f.vAxis[2] * vy;

    const o1 = isOpaque(this._id(s1x, s1y, s1z)) ? 1 : 0;
    const o2 = isOpaque(this._id(s2x, s2y, s2z)) ? 1 : 0;
    const oc = isOpaque(this._id(cnx, cny, cnz)) ? 1 : 0;
    // 采样格子留给平滑光照（corner()）：基准格、切向 1、切向 2、对角，以及三者是否不透明
    const cl = this._cells || (this._cells = new Int32Array(15));
    cl[0] = bx; cl[1] = by; cl[2] = bz;
    cl[3] = s1x; cl[4] = s1y; cl[5] = s1z;
    cl[6] = s2x; cl[7] = s2y; cl[8] = s2z;
    cl[9] = cnx; cl[10] = cny; cl[11] = cnz;
    cl[12] = o1; cl[13] = o2; cl[14] = oc;

    if (o1 && o2) return 0;
    return 3 - (o1 + o2 + oc);
  }

  /** 该面是否需要生成。 */
  faceVisible(x, y, z, faceIdx, selfId) {
    const d = FACES[faceIdx].dir;
    const nx = x + d[0];
    const ny = y + d[1];
    const nz = z + d[2];
    const other = this._id(nx, ny, nz);
    if (other === AIR) return true;
    if (isOpaque(other)) return false;
    // 同种液体之间不生成面
    if (isLiquid(selfId) && isLiquid(other)) return false;
    // 非不透明方块（水/植物/灯笼）相邻时，只有类型不同才生成
    return other !== selfId;
  }

  /**
   * 生成一个区块的几何体。
   * @returns {{opaque: THREE.BufferGeometry|null, cutout: THREE.BufferGeometry|null, water: THREE.BufferGeometry|null}}
   */
  buildChunk(cx, cz) {
    const ox = cx * CW;
    const oz = cz * CW;

    const buckets = {
      opaque: { pos: [], norm: [], uv: [], col: [], emi: [], light: [], idx: [] },
      cutout: { pos: [], norm: [], uv: [], col: [], emi: [], light: [], idx: [] },
      water: { pos: [], norm: [], uv: [], col: [], emi: [], light: [], idx: [] },
    };
    const cs = [{}, {}, {}, {}];
    this._fill(ox, oz);

    for (let y = 0; y < CH; y++) {
      for (let z = 0; z < CW; z++) {
        for (let x = 0; x < CW; x++) {
          const id = this._id(ox + x, y, oz + z);
          if (id === AIR) continue;
          const def = BLOCKS[id];
          if (!def) continue;

          const bucket = def.liquid
            ? buckets.water
            : def.opaque
              ? buckets.opaque
              : buckets.cutout;

          for (let f = 0; f < 6; f++) {
            if (!this.faceVisible(ox + x, y, oz + z, f, id)) continue;
            const tileName = def.faces[f];
            if (!tileName) continue;
            const rects = this._rects(tileName);
            const uv = rects.length === 1 ? rects[0] : rects[variantIndex(rects.length, ox + x, y, oz + z)];
            const face = FACES[f];
            const base = bucket.pos.length / 3;
            const shade = FACE_LIGHT[f];
            const emi = def.emissive || 0;
            for (let k = 0; k < 4; k++) this.corner(ox + x, y, oz + z, f, k, cs[k]);

            for (let k = 0; k < 4; k++) {
              const c = face.corners[k];
              bucket.pos.push(ox + x + c[0], y + c[1], oz + z + c[2]);
              bucket.norm.push(face.dir[0], face.dir[1], face.dir[2]);

              // UV：角点顺序 0=左下 1=右下 2=右上 3=左上
              const uu = k === 1 || k === 2 ? uv.u1 : uv.u0;
              const vv = k === 2 || k === 3 ? uv.v1 : uv.v0;
              bucket.uv.push(uu, vv);

              const l = shade * AO_LEVELS[cs[k].ao];
              bucket.col.push(l, l, l);
              bucket.emi.push(emi);
              bucket.light.push(cs[k].sky, cs[k].block);
            }

            // 依据 AO + 光照选择三角剖分方向，避免出现“折痕”（光照渐变沿对角线插值时也一样）
            if (cornerBrightness(cs[0]) + cornerBrightness(cs[2]) > cornerBrightness(cs[1]) + cornerBrightness(cs[3])) {
              bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            } else {
              bucket.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
            }
          }
        }
      }
    }

    const out = {};
    for (const [name, b] of Object.entries(buckets)) {
      if (b.idx.length === 0) {
        out[name] = null;
        continue;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.norm, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      g.setAttribute("aEmissive", new THREE.Float32BufferAttribute(b.emi, 1));
      g.setAttribute("aLight", new THREE.Float32BufferAttribute(b.light, 2));
      g.setIndex(b.idx);
      g.computeBoundingSphere();
      out[name] = g;
    }
    return out;
  }
}
