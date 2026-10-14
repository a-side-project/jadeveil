/**
 * 纹理图集 —— 把逐像素绘制的 tile 拼进一张 CanvasTexture。
 *
 * 关键点（避免接缝 / 渗色）：
 *  1. 每个 tile 四周留 2px 边缘外扩（padding），UV 只取内部 32×32 区域；
 *  2. nearest 过滤 + 关闭 mipmap，杜绝相邻 tile 混色；
 *  3. 图集尺寸取 2 的幂，便于 GPU 处理。
 */
import * as THREE from "three";
import { Bitmap } from "./pixels.js";
import { NATURE_TILES } from "./tiles/nature.js";
import { BUILD_TILES } from "./tiles/build.js";

export const TILE = 64;
export const PAD = 2;
export const CELL = TILE + PAD * 2; // 68

const ALL_TILES = { ...NATURE_TILES, ...BUILD_TILES };

/**
 * 方块变体：同一材质生成多个随机变体，消除大面积重复感。
 * 变体通过不同的随机种子重绘同一贴图函数得到。
 */
export const VARIANT_COUNT = 4;
const VARIANT_BASE = [
  "grass_top", "grass_side", "dirt", "rock", "stone_dark", "moss_stone",
  "slate", "marble", "sand", "wall_red", "roof_gold", "roof_ink",
  "bamboo_stalk", "wood_beam", "gold_brick", "jade_block",
];

// 为每个基础贴图生成 N 个变体，命名为 name#0 .. name#(N-1)
for (const base of VARIANT_BASE) {
  const fn = ALL_TILES[base];
  if (!fn) continue;
  for (let v = 0; v < VARIANT_COUNT; v++) {
    ALL_TILES[`${base}#${v}`] = (b) => {
      // 用变体序号扰动随机种子，得到不同的细节分布
      const origSeed = b.seed.bind(b);
      b.seed = (n) => origSeed((n >>> 0) + v * 7919 + 104729);
      fn(b);
      b.seed = origSeed;
    };
  }
}

export const TILE_NAMES = Object.keys(ALL_TILES);

export class TextureAtlas {
  constructor() {
    this.cols = Math.ceil(Math.sqrt(TILE_NAMES.length));
    this.rows = Math.ceil(TILE_NAMES.length / this.cols);
    this.width = this.cols * CELL;
    this.height = this.rows * CELL;
    this.index = new Map();
    TILE_NAMES.forEach((name, i) => this.index.set(name, i));
    this.canvas = null;
    this.texture = null;
  }

  /** 返回 tile 在 [0,1] UV 空间中的最小/最大坐标。 */
  uvRect(name) {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`Unknown tile: ${name}`);
    const cx = i % this.cols;
    const cy = (i / this.cols) | 0;
    const x0 = (cx * CELL + PAD) / this.width;
    const y0 = (cy * CELL + PAD) / this.height;
    const w = TILE / this.width;
    const h = TILE / this.height;
    return { u0: x0, v0: y0, u1: x0 + w, v1: y0 + h };
  }

  build() {
    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.width, this.height);

    const img = ctx.createImageData(this.width, this.height);
    const W = this.width;

    const put = (x, y, si) => {
      if (x < 0 || y < 0 || x >= W || y >= this.height) return;
      const o = (y * W + x) * 4;
      img.data[o] = bmp.data[si];
      img.data[o + 1] = bmp.data[si + 1];
      img.data[o + 2] = bmp.data[si + 2];
      img.data[o + 3] = bmp.data[si + 3];
    };

    let bmp = null;
    TILE_NAMES.forEach((name, i) => {
      bmp = new Bitmap(TILE);
      ALL_TILES[name](bmp);

      const cx = i % this.cols;
      const cy = (i / this.cols) | 0;
      const ox = cx * CELL + PAD;
      const oy = cy * CELL + PAD;

      // 主体
      bmp.copyInto({ data: img.data, width: W }, ox, oy);

      // 边缘外扩：把最外圈像素复制到 padding 区，防止采样到透明或邻块
      for (let p = 1; p <= PAD; p++) {
        for (let k = 0; k < TILE; k++) {
          put(ox - p, oy + k, (k * TILE + 0) * 4);
          put(ox + TILE - 1 + p, oy + k, (k * TILE + TILE - 1) * 4);
          put(ox + k, oy - p, (0 * TILE + k) * 4);
          put(ox + k, oy + TILE - 1 + p, ((TILE - 1) * TILE + k) * 4);
        }
        put(ox - p, oy - p, 0);
        put(ox + TILE - 1 + p, oy - p, (TILE - 1) * 4);
        put(ox - p, oy + TILE - 1 + p, ((TILE - 1) * TILE) * 4);
        put(ox + TILE - 1 + p, oy + TILE - 1 + p, ((TILE - 1) * TILE + TILE - 1) * 4);
      }
    });

    ctx.putImageData(img, 0, 0);
    this.canvas = canvas;

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 1;
    tex.needsUpdate = true;
    this.texture = tex;
    return tex;
  }

  /** 生成单个 tile 的独立 canvas，供 UI 快捷栏图标使用。 */
  tileCanvas(name, size = 64) {
    const fn = ALL_TILES[name] || ALL_TILES[name.split("#")[0]];
    const bmp = new Bitmap(TILE);
    fn(bmp);
    const c = document.createElement("canvas");
    c.width = TILE;
    c.height = TILE;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(TILE, TILE);
    img.data.set(bmp.data);
    ctx.putImageData(img, 0, 0);
    if (size === TILE) return c;
    const out = document.createElement("canvas");
    out.width = size;
    out.height = size;
    const octx = out.getContext("2d");
    octx.imageSmoothingEnabled = false;
    octx.drawImage(c, 0, 0, size, size);
    return out;
  }
}
