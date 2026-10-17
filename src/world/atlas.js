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
import { CRAFT_TILES, CRAFT_TILE_NAMES, CRAFT_VARIANTS } from "./tiles/craft.js";

export const TILE = 64;
export const PAD = 2;
export const CELL = TILE + PAD * 2; // 68

const ALL_TILES = { ...NATURE_TILES, ...BUILD_TILES, ...CRAFT_TILES };

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

/**
 * 每种贴图的变体数：老素材 4 张，建造素材 CRAFT_VARIANTS 张。
 * mesher 按这张表挑变体，两边共用同一个来源，不会对不上。
 */
export const TILE_VARIANTS = {};
for (const base of VARIANT_BASE) TILE_VARIANTS[base] = VARIANT_COUNT;
for (const base of CRAFT_TILE_NAMES) TILE_VARIANTS[base] = CRAFT_VARIANTS;

// 为每个基础贴图生成 N 个变体，命名为 name#0 .. name#(N-1)
for (const [base, count] of Object.entries(TILE_VARIANTS)) {
  const fn = ALL_TILES[base];
  if (!fn) continue;
  for (let v = 0; v < count; v++) {
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

  /**
   * 生成 PBR 附加贴图：法线图 + 粗糙度图。
   *
   * 技术判断：单纯把 64×64 提到 128×128，像素信息翻倍但观感提升有限；
   * 而增加法线/粗糙度通道能让「平面方块」产生凹凸与材质差异，
   * 性价比远高于提分辨率。因此先做通道，再考虑分辨率。
   *
   * 法线图：从颜色亮度当高度场，Sobel 求梯度 → 切线空间法线
   * 粗糙度图：按材质语义给不同粗糙度（琉璃瓦极光滑 → 石材粗糙）
   */
  buildPBR() {
    const W = this.width;
    const H = this.height;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    const src = ctx.getImageData(0, 0, W, H).data;

    // ---- 高度场（亮度，带轻微模糊去噪） ----
    const lum = new Float32Array(W * H);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      lum[i] = (src[p] * 0.299 + src[p + 1] * 0.587 + src[p + 2] * 0.114) / 255;
    }
    const blur = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            s += lum[yy * W + xx]; n++;
          }
        }
        blur[y * W + x] = s / n;
      }
    }

    // ---- 法线图（Sobel） ----
    const nrm = ctx.createImageData(W, H);
    const STRENGTH = 2.6;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const gx =
          -blur[Math.max(0, y - 1) * W + Math.max(0, x - 1)] +
          blur[Math.max(0, y - 1) * W + Math.min(W - 1, x + 1)] +
          -2 * blur[y * W + Math.max(0, x - 1)] +
          2 * blur[y * W + Math.min(W - 1, x + 1)] +
          -blur[Math.min(H - 1, y + 1) * W + Math.max(0, x - 1)] +
          blur[Math.min(H - 1, y + 1) * W + Math.min(W - 1, x + 1)];
        const gy =
          -blur[Math.max(0, y - 1) * W + Math.max(0, x - 1)] +
          -2 * blur[Math.max(0, y - 1) * W + x] +
          -blur[Math.max(0, y - 1) * W + Math.min(W - 1, x + 1)] +
          blur[Math.min(H - 1, y + 1) * W + Math.max(0, x - 1)] +
          2 * blur[Math.min(H - 1, y + 1) * W + x] +
          blur[Math.min(H - 1, y + 1) * W + Math.min(W - 1, x + 1)];

        let nx = -gx * STRENGTH;
        let ny = -gy * STRENGTH;
        let nz = 1.0;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;

        const o = (y * W + x) * 4;
        nrm.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
        nrm.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        nrm.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        nrm.data[o + 3] = 255;
      }
    }
    const nrmCanvas = document.createElement("canvas");
    nrmCanvas.width = W; nrmCanvas.height = H;
    nrmCanvas.getContext("2d").putImageData(nrm, 0, 0);
    const normalTex = new THREE.CanvasTexture(nrmCanvas);
    normalTex.magFilter = THREE.NearestFilter;
    normalTex.minFilter = THREE.NearestFilter;
    normalTex.generateMipmaps = false;
    normalTex.colorSpace = THREE.NoColorSpace;   // 数据贴图

    // ---- 粗糙度图：按材质语义 ----
    const roughOf = (name) => {
      if (/roof_gold|roof_blue|roof_green|gold_brick|glow|archway_plaque/.test(name)) return 0.20; // 琉璃：光滑
      if (/lacquer/.test(name)) return 0.26;                                 // 黑漆：漆面高光
      if (/copper/.test(name)) return 0.38;                                  // 铜板：金属微亮
      if (/planks|lattice|thatch|straw|carpet/.test(name)) return 0.7;       // 木板/织物
      if (/brick|cobble|pebble|carved|plaster|terracotta/.test(name)) return 0.9; // 砖石墙面
      if (/jade/.test(name)) return 0.32;                                    // 玉：半光泽
      if (/marble|railing/.test(name)) return 0.48;                          // 汉白玉：微亮
      if (/water/.test(name)) return 0.06;                                   // 水：镜面
      if (/wall_|pillar|beam_|crimson/.test(name)) return 0.86;              // 朱墙：漫反射
      if (/wood|bamboo_stalk/.test(name)) return 0.66;                       // 木/竹：中等
      if (/slate|rock|stone|moss|sand|dirt|grass/.test(name)) return 0.94;   // 石土：粗糙
      return 0.80;
    };

    const rgh = ctx.createImageData(W, H);
    rgh.data.fill(255);
    for (const [name, i] of this.index) {
      const base = name.split("#")[0];
      const rv = Math.round(roughOf(base) * 255);
      const cx = i % this.cols;
      const cy = (i / this.cols) | 0;
      const ox = cx * CELL, oy = cy * CELL;
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          // 加一点像素噪声，避免整块死平
          const n = ((x * 7 + y * 13) % 5) - 2;
          const v = Math.max(0, Math.min(255, rv + n * 2));
          const o = ((oy + y) * W + (ox + x)) * 4;
          rgh.data[o] = v; rgh.data[o + 1] = v; rgh.data[o + 2] = v; rgh.data[o + 3] = 255;
        }
      }
    }
    const rghCanvas = document.createElement("canvas");
    rghCanvas.width = W; rghCanvas.height = H;
    rghCanvas.getContext("2d").putImageData(rgh, 0, 0);
    const roughTex = new THREE.CanvasTexture(rghCanvas);
    roughTex.magFilter = THREE.NearestFilter;
    roughTex.minFilter = THREE.NearestFilter;
    roughTex.generateMipmaps = false;
    roughTex.colorSpace = THREE.NoColorSpace;

    this.normalTexture = normalTex;
    this.roughnessTexture = roughTex;
    return { normalTex, roughTex };
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
