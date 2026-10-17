/**
 * 品牌资产生成器 —— 一份 32×32 像素 logo 数据生成全部图标、字标与分享图。
 *
 *   node scripts/brand.mjs            # 生成全部产物
 *   node scripts/brand.mjs --preview  # 额外输出 8 倍放大的预览图到 docs/assets/brand/
 *
 * 产物（全部由同一份像素数据派生，像素级一致）：
 *   favicon.ico（16/32/48）· favicon.svg · apple-touch-icon.png（180）
 *   icons/icon-192.png · icons/icon-512.png · icons/icon-maskable-512.png
 *   og-image.png（1200×630 社交分享卡）
 *   docs/assets/brand/logo.svg · wordmark.svg · lockup.svg（README 页头）
 *
 * 零依赖：PNG / ICO 编码器就在本文件里（zlib 是 Node 内置），不引入图形库。
 * 字标使用游戏内同一套 5×7 像素字体（src/ui/pixelfont.js）。
 */
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GLYPHS, GLYPH_W, GLYPH_H } from "../src/ui/pixelfont.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW = process.argv.includes("--preview");

/* ------------------------------------------------------------------ */
/* 色板（与游戏 palette.js 同源）                                        */
/* ------------------------------------------------------------------ */

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255, 255];
const C = {
  ink: hex(0x0b1014), ink2: hex(0x111a20), ink3: hex(0x18252c),
  jadeDeep: hex(0x2f6b60), jade: hex(0x4a9e8f), jadeLit: hex(0x6fc0ae), jadeHot: hex(0x9fdfd0),
  gold: hex(0xe8b44a), goldLit: hex(0xffe08a), goldDeep: hex(0xa8731f), goldHot: hex(0xfff3cf),
  crimson: hex(0xc0392b), crimsonDeep: hex(0x8e2a20), crimsonLit: hex(0xd95a48),
  lantern: hex(0xffc86a), marble: hex(0xded7c6), marbleDeep: hex(0xb3aa96),
  shadow: hex(0x05070a),
};

/* ------------------------------------------------------------------ */
/* Logo：32×32                                                         */
/* ------------------------------------------------------------------ */

const N = 32;

/**
 * 构图：墨色圆角底上一座金瓦朱身的三重檐楼阁 —— 轮廓优先，16px 也认得出。
 *   · 三层檐逐级放宽（半宽 6 / 9 / 12），每层檐角两级上翘
 *   · 右上一轮青玉满月（JADE），底部一道断续的玉色薄雾（VEIL）
 *   · 灯窗是暖色像素：夜里亮灯的主城
 */
function logoPixels({ tile = true } = {}) {
  const px = Array.from({ length: N * N }, () => [0, 0, 0, 0]);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    px[y * N + x] = c;
  };
  const hline = (x0, x1, y, c) => { for (let x = x0; x <= x1; x++) set(x, y, c); };

  // --- 底板：圆角方块，上亮下暗三段 ---
  if (tile) {
    const cut = (x, y) => {
      const dx = Math.min(x, N - 1 - x), dy = Math.min(y, N - 1 - y);
      return (dx === 0 && dy < 3) || (dy === 0 && dx < 3) || (dx === 1 && dy === 1);
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!cut(x, y)) set(x, y, y < 10 ? C.ink3 : y < 21 ? C.ink2 : C.ink);
    }
  }

  // --- 圆月：右上角留白处一轮青玉满月（左上受光），与檐角保持 1 格间距 ---
  for (let y = 0; y < 10; y++) for (let x = 20; x < N - 1; x++) {
    const dx = x + 0.5 - 26.5, dy = y + 0.5 - 5;
    const d = Math.hypot(dx, dy);
    if (d > 2.9) continue;
    const lit = -dx - dy;
    set(x, y, lit > 1.6 ? C.jadeHot : lit > -1.2 ? C.jadeLit : C.jade);
  }

  // --- 楼阁 ---
  /**
   * 一层屋檐。ridge = 瓦脊所在行，hw = 半宽。
   *   ridge     瓦脊高光（略窄）
   *   ridge+1   瓦面
   *   ridge+2   檐口阴影
   *   檐角：在两端向上翘两级（ridge 行再外扩 1 格，ridge-1 行再外扩 1 格为最亮的檐尖）
   */
  const roof = (ridge, hw) => {
    const x0 = 16 - hw, x1 = 15 + hw;
    hline(x0 + 2, x1 - 2, ridge, C.goldLit);
    hline(x0, x1, ridge + 1, C.gold);
    hline(x0 + 1, x1 - 1, ridge + 2, C.goldDeep);
    set(x0 - 1, ridge, C.gold); set(x1 + 1, ridge, C.gold);
    set(x0 - 2, ridge - 1, C.goldHot); set(x1 + 2, ridge - 1, C.goldHot);
  };
  /** 一层屋身：朱红墙，两端立柱暗红，檐下一行阴影；可选灯窗与门洞。 */
  const body = (y0, y1, hw, { windows = [], door = 0 } = {}) => {
    const x0 = 16 - hw, x1 = 15 + hw;
    for (let y = y0; y <= y1; y++) {
      hline(x0, x1, y, C.crimson);
      set(x0, y, C.crimsonDeep); set(x1, y, C.crimsonDeep);
    }
    hline(x0, x1, y0, C.crimsonDeep);
    for (const wx of windows) { set(16 - wx - 1, y0 + 1, C.lantern); set(15 + wx + 1, y0 + 1, C.lantern); }
    if (door) {
      for (let y = y1 - door + 1; y <= y1; y++) hline(15 - (door > 2 ? 1 : 0), 16 + (door > 2 ? 1 : 0), y, C.shadow);
    }
  };

  // 宝顶
  set(15, 2, C.goldHot); set(16, 2, C.goldHot);
  set(15, 3, C.gold); set(16, 3, C.gold);
  set(15, 4, C.goldDeep); set(16, 4, C.goldDeep);
  // 顶层
  roof(5, 6);
  body(8, 9, 3, { windows: [1] });
  // 中层
  roof(10, 9);
  body(13, 15, 5, { windows: [2], door: 2 });
  // 底层
  roof(16, 12);
  body(19, 22, 8, { windows: [4, 6], door: 3 });
  // 台基：汉白玉两级
  hline(6, 25, 23, C.marble);
  hline(5, 26, 24, C.marbleDeep);

  // --- 雾：两行断续的玉色薄雾横过台基前方 ---
  for (let x = 2; x <= 29; x++) {
    if (x % 5 !== 2) set(x, 26, x % 3 ? C.jadeLit : C.jade);
    if ((x + 2) % 6 !== 0 && x > 4 && x < 27) set(x, 27, C.jade);
    if (x % 4 === 1 && x > 7 && x < 24) set(x, 28, C.jadeDeep);
  }
  return px;
}

/* ------------------------------------------------------------------ */
/* 位图工具                                                             */
/* ------------------------------------------------------------------ */

class Bitmap {
  constructor(w, h, bg = [0, 0, 0, 0]) {
    this.w = w; this.h = h;
    this.data = new Uint8Array(w * h * 4);
    if (bg[3]) for (let i = 0; i < w * h; i++) this.data.set(bg, i * 4);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c[3]) return;
    const i = (y * this.w + x) * 4;
    const a = c[3] / 255;
    for (let k = 0; k < 3; k++) this.data[i + k] = Math.round(c[k] * a + this.data[i + k] * (1 - a));
    this.data[i + 3] = Math.max(this.data[i + 3], c[3]);
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }
  /** 把一份 N×N 像素画以整数倍 k 贴到 (ox, oy)。 */
  blit(pixels, size, k, ox, oy) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const c = pixels[y * size + x];
      if (c[3]) this.rect(ox + x * k, oy + y * k, k, k, c);
    }
  }
}

/* ---------- PNG ---------- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(bmp) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(bmp.w, 0); ihdr.writeUInt32BE(bmp.h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((bmp.w * 4 + 1) * bmp.h);
  for (let y = 0; y < bmp.h; y++) {
    raw[y * (bmp.w * 4 + 1)] = 0;
    Buffer.from(bmp.data.buffer, y * bmp.w * 4, bmp.w * 4).copy(raw, y * (bmp.w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- ICO（内嵌 PNG 条目，现代浏览器与系统均支持）---------- */
function encodeICO(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  const dir = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    offset += buf.length;
    dir.push(e);
  }
  return Buffer.concat([head, ...dir, ...pngs.map((p) => p.buf)]);
}

/* ---------- SVG（按行合并同色游程，crispEdges 保证像素锐利）---------- */
const rgb = (c) => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
function pixelsToRects(pixels, w, h, ox = 0, oy = 0, k = 1) {
  const out = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const c = pixels[y * w + x];
      if (!c || !c[3]) { x++; continue; }
      let run = 1;
      while (x + run < w) {
        const d = pixels[y * w + x + run];
        if (!d || d[3] !== c[3] || d[0] !== c[0] || d[1] !== c[1] || d[2] !== c[2]) break;
        run++;
      }
      out.push(`<rect x="${ox + x * k}" y="${oy + y * k}" width="${run * k}" height="${k}" fill="${rgb(c)}"/>`);
      x += run;
    }
  }
  return out.join("");
}

/* ------------------------------------------------------------------ */
/* 字标：游戏内同一套 5×7 像素字体，金色 + 深金描边 + 墨色投影           */
/* ------------------------------------------------------------------ */

function wordPixels(text, { tracking = 1, fill = C.gold, light = C.goldLit, outline = C.goldDeep, shadow = C.shadow } = {}) {
  const s = text.toUpperCase();
  const w0 = s.length * (GLYPH_W + tracking) - tracking;
  const pad = 2; // 描边 1 + 投影 1
  const w = w0 + pad * 2, h = GLYPH_H + pad * 2 + 1;
  const px = Array.from({ length: w * h }, () => null);
  const ink = Array.from({ length: w * h }, () => false);
  const at = (x, y) => y * w + x;
  for (let i = 0; i < s.length; i++) {
    const g = GLYPHS[s[i]] || GLYPHS[" "];
    for (let y = 0; y < GLYPH_H; y++) for (let x = 0; x < GLYPH_W; x++) {
      if (g[y][x] === "1") ink[at(pad + i * (GLYPH_W + tracking) + x, pad + y)] = true;
    }
  }
  // 投影（右下 1 格）→ 描边（四邻）→ 字身（上半亮、下半金）
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (ink[at(x, y)] && x + 1 < w && y + 1 < h) px[at(x + 1, y + 1)] = shadow;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (ink[at(x, y)]) continue;
    const n = (dx, dy) => ink[at(x + dx, y + dy)] === true;
    if (n(1, 0) || n(-1, 0) || n(0, 1) || n(0, -1)) px[at(x, y)] = outline;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (ink[at(x, y)]) px[at(x, y)] = y - pad < 3 ? light : fill;
  }
  return { px, w, h };
}

/* ------------------------------------------------------------------ */
/* 产物                                                                */
/* ------------------------------------------------------------------ */

async function out(rel, data) {
  const p = join(ROOT, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data);
  console.log(`  ${rel}  (${(data.length / 1024).toFixed(1)} KB)`);
}

const logo = logoPixels();
/** logo 实际用到的颜色（小尺寸重采样时吸附用）。 */
const PALETTE = [...new Map(logo.filter((c) => c[3]).map((c) => [c.join(","), c])).values()];

/**
 * 把 N×N 像素画重采样到 size×size：
 *   size 是 N 的整数倍 → 最近邻放大（像素锐利）
 *   否则（16 / 48 等）→ 面积平均（缩小时不丢细节、不错位裁切）
 */
function resample(pixels, size) {
  const bmp = new Bitmap(size, size);
  if (size % N === 0) {
    bmp.blit(pixels, N, size / N, 0, 0);
    return bmp;
  }
  const r = N / size;
  for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) {
    const x0 = tx * r, x1 = x0 + r, y0 = ty * r, y1 = y0 + r;
    const acc = [0, 0, 0, 0];
    let area = 0;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
      const w = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
      const c = pixels[sy * N + sx];
      const a = (c[3] / 255) * w;
      acc[0] += c[0] * a; acc[1] += c[1] * a; acc[2] += c[2] * a; acc[3] += a;
      area += w;
    }
    // 覆盖不足一半的格子留透明；其余把平均色吸附回色板里最近的颜色 ——
    // 缩小后仍是硬边、同色系的像素画，而不是发糊的过渡色
    if (acc[3] / area >= 0.5) {
      const avg = [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]];
      let best = PALETTE[0], bd = Infinity;
      for (const c of PALETTE) {
        const d = (c[0] - avg[0]) ** 2 * 0.3 + (c[1] - avg[1]) ** 2 * 0.59 + (c[2] - avg[2]) ** 2 * 0.11;
        if (d < bd) { bd = d; best = c; }
      }
      const i = (ty * size + tx) * 4;
      bmp.data.set([best[0], best[1], best[2], 255], i);
    }
  }
  return bmp;
}

/** 标准图标（带圆角底板）。 */
function iconPNG(size) {
  return encodePNG(resample(logo, size));
}

/** 预览：把小尺寸图标按整数倍放大（核对 16 / 32 / 48 的可读性）。 */
function previewPNG(size, k) {
  const small = resample(logo, size);
  const bmp = new Bitmap(size * k, size * k);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    bmp.rect(x * k, y * k, k, k, [small.data[i], small.data[i + 1], small.data[i + 2], small.data[i + 3]]);
  }
  return encodePNG(bmp);
}

/** 可裁切图标（maskable）：满版墨色底，logo 收在 80% 安全区内。 */
function maskablePNG(size) {
  const bmp = new Bitmap(size, size, C.ink2);
  const inner = logoPixels({ tile: false });
  const k = Math.floor((size * 0.72) / N);
  const o = Math.floor((size - N * k) / 2);
  bmp.blit(inner, N, k, o, o + Math.round(k * 0.5));
  return encodePNG(bmp);
}

/** apple-touch-icon：iOS 会自己裁圆角，给满版底 + 略小的 logo。 */
function applePNG(size = 180) {
  const bmp = new Bitmap(size, size, C.ink2);
  const inner = logoPixels({ tile: false });
  const k = Math.floor((size * 0.84) / N);
  const o = Math.floor((size - N * k) / 2);
  bmp.blit(inner, N, k, o, o + 2);
  return encodePNG(bmp);
}

/** 1200×630 分享卡：墨色底 + 像素星点 + 左 logo 右字标 + 标语。 */
function ogPNG() {
  const W = 1200, H = 630;
  const bmp = new Bitmap(W, H, C.ink);
  // 竖向三段底色 + 稀疏像素星点（确定性伪随机）
  bmp.rect(0, 0, W, 210, C.ink3);
  bmp.rect(0, 210, W, 210, C.ink2);
  let s = 1234567;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rnd() * W / 6) * 6, y = Math.floor(rnd() * H * 0.55 / 6) * 6;
    bmp.rect(x, y, 6, 6, rnd() < 0.2 ? C.jadeLit : C.jadeDeep);
  }
  // 底部雾带
  for (let x = 0; x < W; x += 12) {
    if (((x / 12) % 7) !== 3) bmp.rect(x, H - 96, 12, 12, C.jadeDeep);
    if (((x / 12) % 5) !== 1) bmp.rect(x, H - 72, 12, 12, C.jade);
  }
  // logo（12 倍）+ 字标（14 倍）+ 标语（4 倍）
  // 分享卡里的楼阁不带底板，直接悬在夜空里
  const k = 12;
  bmp.blit(logoPixels({ tile: false }), N, k, 110, (H - N * k) / 2 - 20);
  const wm = wordPixels("JADEVEIL");
  const wx = 110 + N * k + 64;
  const avail = W - wx - 90;
  const wk = Math.floor(avail / wm.w); // 字标按可用宽度取整数倍，永不出画
  const wy = Math.round(H / 2 - (wm.h * wk) / 2 - 40);
  for (let y = 0; y < wm.h; y++) for (let x = 0; x < wm.w; x++) {
    const c = wm.px[y * wm.w + x];
    if (c) bmp.rect(wx + x * wk, wy + y * wk, wk, wk, c);
  }
  const tag = wordPixels("A VOXEL REALM OF MIST AND JADE", { fill: C.jadeLit, light: C.jadeHot, outline: C.ink, shadow: C.ink });
  const tk = Math.max(2, Math.floor(avail / tag.w));
  for (let y = 0; y < tag.h; y++) for (let x = 0; x < tag.w; x++) {
    const c = tag.px[y * tag.w + x];
    if (c) bmp.rect(wx + 4 + x * tk, wy + wm.h * wk + 34 + y * tk, tk, tk, c);
  }
  return encodePNG(bmp);
}

function logoSVG(size = 256) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="${size}" height="${size}" shape-rendering="crispEdges">` +
    `<title>JADEVEIL</title>${pixelsToRects(logo, N, N)}</svg>\n`;
}

function wordmarkSVG(scale = 10) {
  const wm = wordPixels("JADEVEIL");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wm.w} ${wm.h}" width="${wm.w * scale}" height="${wm.h * scale}" shape-rendering="crispEdges">` +
    `<title>JADEVEIL</title>${pixelsToRects(wm.px, wm.w, wm.h)}</svg>\n`;
}

/**
 * README 页头横版组合：logo + 像素大字 + 标语，透明底（GitHub 明暗主题都可读）。
 * 单位格 = 1 个 logo 像素；字标按 2 倍、标语按 0.5 倍排在 logo 右侧。
 */
function lockupSVG() {
  const wm = wordPixels("JADEVEIL");
  const tag = wordPixels("A VOXEL REALM OF MIST AND JADE", { fill: C.jade, light: C.jadeLit, outline: [0, 0, 0, 0], shadow: [0, 0, 0, 0] });
  const gap = 6;
  const wk = 2; // 字标每个像素 = 2 个 logo 像素
  const tk = 0.5;
  const W = N + gap + wm.w * wk;
  // 字标 + 标语整体在 logo 高度内竖向居中
  const block = wm.h * wk + 1.5 + tag.h * tk;
  const wy = Math.max(0, (N - block) / 2);
  const ty = wy + wm.h * wk + 1.5;
  const H = Math.max(N, ty + tag.h * tk);
  const body =
    pixelsToRects(logo, N, N) +
    pixelsToRects(wm.px, wm.w, wm.h, N + gap, wy, wk) +
    pixelsToRects(tag.px, tag.w, tag.h, N + gap + 1, ty, tk);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 10}" height="${H * 10}" shape-rendering="crispEdges">` +
    `<title>JADEVEIL — A voxel realm of mist and jade</title>${body}</svg>\n`;
}

console.log("brand assets:");
await out("favicon.ico", encodeICO([16, 32, 48].map((size) => ({ size, buf: iconPNG(size) }))));
await out("favicon.svg", logoSVG(32));
await out("apple-touch-icon.png", applePNG(180));
await out("icons/icon-192.png", iconPNG(192));
await out("icons/icon-512.png", iconPNG(512));
await out("icons/icon-maskable-512.png", maskablePNG(512));
await out("og-image.png", ogPNG());
await out("docs/assets/brand/logo.svg", logoSVG(256));
await out("docs/assets/brand/wordmark.svg", wordmarkSVG(10));
await out("docs/assets/brand/lockup.svg", lockupSVG());
if (PREVIEW) {
  await out("docs/assets/brand/preview-logo-256.png", iconPNG(256));
  for (const size of [16, 32, 48]) await out(`docs/assets/brand/preview-${size}.png`, previewPNG(size, Math.floor(192 / size)));
}
