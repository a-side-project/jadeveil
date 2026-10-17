/**
 * Minecraft 标准人形模型 + 64×64 皮肤。
 *
 * 皮肤布局与 Minecraft Java 1.8+ 完全一致（头/身/四肢各有底层与外层），
 * 所以任何标准 MC 皮肤 png 都能直接套用；角色本身只是一张图。
 *
 * 比例：32 像素高（腿 12 / 身 12 / 头 8），1 像素 = PX 世界单位，
 * 总高与玩家碰撞盒一致（1.78 格）。外层比底层每边膨胀 0.25~0.5 像素，
 * 兜帽、袖子才有 MC 那种「第二层」的立体感。
 *
 * 坐标约定：角色面朝 -Z，+X 是角色的右手边。
 */
import * as THREE from "three";

export const SKIN_W = 64;
export const SKIN_H = 64;
export const PX = 1.78 / 32;

/* ------------------------------------------------------------------ */
/* 盒子 UV（Minecraft box UV 展开）                                      */
/* ------------------------------------------------------------------ */

/**
 * 按 MC 的 box UV 规则生成一个盒子几何：
 *   顶 (u+d, v)、底 (u+d+w, v)，尺寸 w×d
 *   右 (u, v+d)、前 (u+d, v+d)、左 (u+d+w, v+d)、后 (u+2d+w, v+d)，高 h
 * w/h/d、u/v 都是皮肤像素；inflate 为每边膨胀的像素数。
 */
export function skinBox(w, h, d, u, v, inflate = 0, texW = SKIN_W, texH = SKIN_H, unit = PX) {
  const hx = (w / 2 + inflate) * unit;
  const hy = (h / 2 + inflate) * unit;
  const hz = (d / 2 + inflate) * unit;
  const pos = [];
  const norm = [];
  const uv = [];
  const idx = [];

  // 每个面：[BL, BR, TR, TL]（从面外看），法线，贴图矩形 [u0, v0, u1, v1]（像素）
  const faces = [
    // 前 -Z：从前方看，画面左侧是角色右手（+X）
    [[[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], [0, 0, -1], [u + d, v + d, u + d + w, v + d + h]],
    // 后 +Z
    [[[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], [0, 0, 1], [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h]],
    // 右 +X
    [[[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], [1, 0, 0], [u, v + d, u + d, v + d + h]],
    // 左 -X
    [[[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], [-1, 0, 0], [u + d + w, v + d, u + 2 * d + w, v + d + h]],
    // 顶 +Y：画面下沿接前脸上沿
    [[[hx, hy, -hz], [-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz]], [0, 1, 0], [u + d, v + d, u + d + w, v]],
    // 底 -Y
    [[[hx, -hy, hz], [-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz]], [0, -1, 0], [u + d + w, v, u + d + 2 * w, v + d]],
  ];

  for (const [corners, n, r] of faces) {
    const base = pos.length / 3;
    const [u0, v0, u1, v1] = r;
    // BL=(u0,v1) BR=(u1,v1) TR=(u1,v0) TL=(u0,v0)；canvas 纹理 flipY，所以 V = 1 - v/texH
    const uvs = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
    for (let k = 0; k < 4; k++) {
      pos.push(...corners[k]);
      norm.push(...n);
      uv.push(uvs[k][0] / texW, 1 - uvs[k][1] / texH);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/* ------------------------------------------------------------------ */
/* 皮肤绘制工具                                                          */
/* ------------------------------------------------------------------ */

const hash = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** 带逐像素明暗抖动的画笔 —— MC 皮肤那种「布料颗粒感」。 */
class SkinPainter {
  constructor(seed = 7) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = SKIN_W;
    this.canvas.height = SKIN_H;
    this.ctx = this.canvas.getContext("2d");
    this.seed = seed;
  }

  px(x, y, hex, jitter = 0.05) {
    // 直接在 sRGB 空间解析十六进制并抖动（皮肤 canvas 本身就是 sRGB 图像）
    const n = parseInt(hex.slice(1), 16);
    const k = 1 + (hash(x, y, this.seed) - 0.5) * 2 * jitter;
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    this.ctx.fillStyle = `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
    this.ctx.fillRect(x, y, 1, 1);
  }

  rect(x, y, w, h, hex, jitter) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, hex, jitter);
  }

  /** 按 8 行字符图逐像素画一个面。legend: 字符 → 颜色（"." 透明）。 */
  map(x, y, rows, legend, jitter) {
    rows.forEach((row, j) => {
      [...row].forEach((ch, i) => {
        if (ch === "." || ch === " ") return;
        const hex = legend[ch];
        if (hex) this.px(x + i, y + j, hex, jitter);
      });
    });
  }

  /** 画一整个盒子的 6 个面为同一种填充（按 box UV 区域）。 */
  boxFill(u, v, w, h, d, hex, jitter) {
    this.rect(u + d, v, w, d, hex, jitter); // 顶
    this.rect(u + d + w, v, w, d, hex, jitter); // 底
    this.rect(u, v + d, 2 * d + 2 * w, h, hex, jitter); // 四个侧面
  }
}

/* ------------------------------------------------------------------ */
/* 杰杰（JJ）                                                            */
/* ------------------------------------------------------------------ */

const JJ = {
  H: "#5b3a24", h: "#714a2f", K: "#432a18", // 发色：主 / 亮 / 暗
  S: "#f0b98d", s: "#dd9f74", // 肤色 / 暗部
  W: "#f6f6f4", w: "#d9d9d6", // 白衬衫
  E: "#ffffff", B: "#3f8fe8", b: "#2a62c4", // 眼白 / 瞳 / 瞳暗
  M: "#c4785f", // 嘴
  R: "#d8392d", r: "#a92820", L: "#ec4e3c", // 红卫衣：主 / 暗 / 亮
  T: "#f2f2f2", t: "#262626", // 抽绳 / 绳头
  P: "#2b2c31", p: "#3d3f47", // 裤子
  V: "#7445e0", O: "#3348d6", Y: "#ffffff", // 鞋：紫 / 蓝鞋底 / 白
  X: "#1d1d20", // 袖口
};

/**
 * 杰杰的皮肤：红色连帽卫衣（兜帽戴在头上）、棕色刘海、蓝眼睛、
 * 白内衬 + 两根白抽绳、深灰裤、紫白蓝的鞋。
 */
export function paintJJSkin() {
  const p = new SkinPainter(11);

  /* ---------- 头：底层 (0,0) 8×8×8 ---------- */
  p.boxFill(0, 0, 8, 8, 8, JJ.H, 0.07);
  // 脸 (8,8)
  p.map(8, 8, [
    "HHHHHHHH",
    "HHhHHHhH",
    "HKHHHKHH",
    "HSSHSSSH",
    "SEBSSBES",
    "SSSssSSS",
    "SSSMMSSS",
    "SSSSSSSS",
  ], JJ, 0.035);
  // 右侧 (0,8)：u 越大越靠前；后半是头发，前三列是鬓角下的脸颊
  p.map(0, 8, [
    "HHHHHHHH",
    "HHHHHHhH",
    "HHHHHHHH",
    "HHHHHHHH",
    "HHHHHSSS",
    "HHHHHSSS",
    "HHHHSSSS",
    "HHHHSSSS",
  ], JJ, 0.05);
  // 左侧 (16,8)：u 越大越靠后
  p.map(16, 8, [
    "HHHHHHHH",
    "HhHHHHHH",
    "HHHHHHHH",
    "HHHHHHHH",
    "SSSHHHHH",
    "SSSHHHHH",
    "SSSSHHHH",
    "SSSSHHHH",
  ], JJ, 0.05);
  // 下巴 (16,0)
  p.rect(16, 0, 8, 8, JJ.s, 0.03);

  /* ---------- 头：外层兜帽 (32,0) ---------- */
  // 后 (56,8)：整块红兜帽，中间一块亮红
  p.map(56, 8, [
    "rRRRRRRr",
    "RRRRRRRR",
    "RRLLLLRR",
    "RRLLLLRR",
    "RRLLLLRR",
    "RRRRRRRR",
    "RRRRRRRR",
    "rrrrrrrr",
  ], JJ, 0.05);
  // 顶 (40,0)：后 6 行是兜帽，前 2 行露出刘海
  p.map(40, 0, [
    "rRRRRRRr",
    "RRRRRRRR",
    "RRLLLLRR",
    "RRLLLLRR",
    "RRRRRRRR",
    "rRRRRRRr",
    "........",
    "........",
  ], JJ, 0.05);
  // 右侧 (32,8)：u 越大越靠前 —— 兜帽包住后 5 列，前 3 列露脸
  p.map(32, 8, [
    "RRRRRr..",
    "RRRRRr..",
    "RRRRRr..",
    "RRRRRr..",
    "RRRRr...",
    "RRRRr...",
    "RRRRr...",
    "rrrrr...",
  ], JJ, 0.05);
  // 左侧 (48,8)：u 越大越靠后
  p.map(48, 8, [
    "..rRRRRR",
    "..rRRRRR",
    "..rRRRRR",
    "..rRRRRR",
    "...rRRRR",
    "...rRRRR",
    "...rRRRR",
    "...rrrrr",
  ], JJ, 0.05);

  /* ---------- 身体 (16,16) 8×12×4 ---------- */
  p.boxFill(16, 16, 8, 12, 4, JJ.R, 0.06);
  // 前 (20,20)
  p.map(20, 20, [
    "rRRWWRRr",
    "RRTWWTRR",
    "RRTWWTRR",
    "RRTWWTRR",
    "RRTWwTRR",
    "RRtWWtRR",
    "RRRWWRRR",
    "RRRWwRRR",
    "RRRWWRRR",
    "RRRWWRRR",
    "RRRWWRRR",
    "rrrrrrrr",
  ], JJ, 0.045);
  // 后 (32,20)：背后是垂下的兜帽
  p.map(32, 20, [
    "rRRRRRRr",
    "RLLLLLLR",
    "RLLLLLLR",
    "RLLLLLLR",
    "RRLLLLRR",
    "RRRLLRRR",
    "RRRRRRRR",
    "RRRRRRRR",
    "RRRRRRRR",
    "RRRRRRRR",
    "RRRRRRRR",
    "rrrrrrrr",
  ], JJ, 0.045);

  /* ---------- 手臂：右 (40,16)、左 (32,48)，4×12×4 ---------- */
  const arm = (u, v) => {
    p.boxFill(u, v, 4, 12, 4, JJ.R, 0.06);
    // 四个侧面：第 9 行暗红过渡、第 10 行黑袖口、末两行是手
    for (let i = 0; i < 16; i++) {
      p.px(u + i, v + 4 + 8, JJ.r, 0.04);
      p.px(u + i, v + 4 + 9, JJ.X, 0.04);
      p.px(u + i, v + 4 + 10, JJ.S, 0.03);
      p.px(u + i, v + 4 + 11, JJ.s, 0.03);
    }
    p.rect(u + 8, v, 4, 4, JJ.s, 0.03); // 手底
  };
  arm(40, 16);
  arm(32, 48);

  /* ---------- 腿：右 (0,16)、左 (16,48)，4×12×4 ---------- */
  const leg = (u, v) => {
    p.boxFill(u, v, 4, 12, 4, JJ.P, 0.06);
    // 前脸 (u+4, v+4) 加一道浅灰褶
    for (let j = 0; j < 9; j++) p.px(u + 4 + 1, v + 4 + j, JJ.p, 0.04);
    // 鞋：第 9 行紫、第 10 行白（两侧紫）、第 11 行蓝底
    for (let i = 0; i < 16; i++) {
      p.px(u + i, v + 4 + 9, JJ.V, 0.04);
      p.px(u + i, v + 4 + 10, i % 4 === 0 || i % 4 === 3 ? JJ.V : JJ.Y, 0.03);
      p.px(u + i, v + 4 + 11, JJ.O, 0.04);
    }
    p.rect(u + 8, v, 4, 4, JJ.O, 0.04); // 鞋底
  };
  leg(0, 16);
  leg(16, 48);

  return p.canvas;
}

/* ------------------------------------------------------------------ */
/* NPC 职业皮肤（同一套布局，按职业配色）                                  */
/* ------------------------------------------------------------------ */

/**
 * 主城居民皮肤：长袍 + 腰带 + 帽子/发髻，按职业配色。
 * 与杰杰共用同一套 MC 布局与模型，风格统一。
 */
export function paintRoleSkin(def, seed = 3) {
  const p = new SkinPainter(seed);
  const C = def.colors;
  // 头
  p.boxFill(0, 0, 8, 8, 8, C.hair, 0.06);
  p.map(8, 8, [
    "hhhhhhhh",
    "hhhhhhhh",
    "hSSSSSSh",
    "SSSSSSSS",
    "SEKSSKES",
    "SSSssSSS",
    "SSSMMSSS",
    "SSSSSSSS",
  ], { h: C.hair, S: C.skin, s: C.skinDark, E: "#ffffff", K: C.eye, M: C.mouth }, 0.035);
  p.rect(0, 8 + 4, 3, 4, C.skin, 0.03);
  p.rect(5, 8 + 4, 3, 4, C.skin, 0.03);
  p.rect(16, 8 + 4, 3, 4, C.skin, 0.03);
  p.rect(16, 0, 8, 8, C.skinDark, 0.03);
  // 帽子外层：顶 + 四周一圈帽檐
  if (C.hat) {
    p.rect(40, 0, 8, 8, C.hat, 0.05);
    p.rect(32, 8, 32, 2, C.hat, 0.05);
    if (C.hatTrim) p.rect(32, 10, 32, 1, C.hatTrim, 0.04);
  }
  // 身体：长袍 + 腰带 + 领口镶边
  p.boxFill(16, 16, 8, 12, 4, C.robe, 0.06);
  p.rect(16, 20 + 6, 24, 1, C.belt, 0.04);
  p.rect(20, 20, 8, 1, C.trim, 0.04);
  for (let j = 1; j < 6; j++) p.px(23, 20 + j, C.trim, 0.04), p.px(24, 20 + j, C.trim, 0.04);
  // 手臂：袍袖 + 手
  for (const [u, v] of [[40, 16], [32, 48]]) {
    p.boxFill(u, v, 4, 12, 4, C.robe, 0.06);
    p.rect(u, v + 4 + 9, 16, 1, C.trim, 0.04);
    p.rect(u, v + 4 + 10, 16, 2, C.skin, 0.03);
    p.rect(u + 8, v, 4, 4, C.skinDark, 0.03);
  }
  // 腿：袍摆 + 裤 + 靴
  for (const [u, v] of [[0, 16], [16, 48]]) {
    p.boxFill(u, v, 4, 12, 4, C.pants, 0.06);
    p.rect(u, v + 4, 16, 4, C.robe, 0.06);
    p.rect(u, v + 4 + 10, 16, 2, C.boots, 0.04);
    p.rect(u + 8, v, 4, 4, C.boots, 0.04);
  }
  return p.canvas;
}

/** 皮肤 canvas → 贴图（最近邻、sRGB，像素一个不糊）。 */
export function skinTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/* 人形骨架                                                              */
/* ------------------------------------------------------------------ */

/** 部件定义：[w, h, d, 底层 uv, 外层 uv, 外层膨胀] */
export const PARTS = {
  head: [8, 8, 8, [0, 0], [32, 0], 0.5],
  body: [8, 12, 4, [16, 16], [16, 32], 0.25],
  armR: [4, 12, 4, [40, 16], [40, 32], 0.25],
  armL: [4, 12, 4, [32, 48], [48, 48], 0.25],
  legR: [4, 12, 4, [0, 16], [0, 32], 0.25],
  legL: [4, 12, 4, [16, 48], [0, 48], 0.25],
};

/** 共享几何缓存：所有人形（玩家、NPC）共用同一份盒子几何。 */
const _geoCache = new Map();
export function partGeometry(name, layer) {
  const key = `${name}:${layer}`;
  let g = _geoCache.get(key);
  if (!g) {
    const [w, h, d, base, over, inflate] = PARTS[name];
    const [u, v] = layer === "base" ? base : over;
    g = skinBox(w, h, d, u, v, layer === "base" ? 0 : inflate);
    _geoCache.set(key, g);
  }
  return g;
}

export function skinMaterials(texture) {
  return {
    base: new THREE.MeshStandardMaterial({ map: texture, roughness: 0.82, metalness: 0.0 }),
    // 外层：透明像素直接丢弃（alphaTest），不走半透明排序，阴影也正确
    over: new THREE.MeshStandardMaterial({ map: texture, roughness: 0.86, metalness: 0.0, alphaTest: 0.5, side: THREE.DoubleSide }),
  };
}

/**
 * 搭一个 MC 人形骨架。
 *
 *   group（脚底原点）
 *     └ body（髋部 pivot，y = 12px）—— 游泳放平 / 骑乘前倾都绕这里转
 *         ├ torso（中心 +6px）
 *         ├ head（颈部 pivot +12px，头中心再 +4px）
 *         ├ arms[0] = 左臂、arms[1] = 右臂（肩 pivot +10px、x = ∓6px）
 *         └ legs[0] = 左腿、legs[1] = 右腿（髋 pivot、x = ∓2px）
 */
export function buildHumanoid(materials) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 12 * PX;
  group.add(body);

  const mesh = (name, layer, parent, y = 0) => {
    const m = new THREE.Mesh(partGeometry(name, layer), layer === "base" ? materials.base : materials.over);
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  const torso = new THREE.Group();
  torso.position.y = 6 * PX;
  body.add(torso);
  mesh("body", "base", torso);
  mesh("body", "over", torso);

  const head = new THREE.Group();
  head.position.y = 12 * PX;
  body.add(head);
  mesh("head", "base", head, 4 * PX);
  mesh("head", "over", head, 4 * PX);

  const arms = [];
  for (const [name, s] of [["armL", -1], ["armR", 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 6 * PX, 10 * PX, 0);
    body.add(pivot);
    mesh(name, "base", pivot, -4 * PX);
    mesh(name, "over", pivot, -4 * PX);
    arms.push(pivot);
  }

  const legs = [];
  for (const [name, s] of [["legL", -1], ["legR", 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 2 * PX, 0, 0);
    body.add(pivot);
    mesh(name, "base", pivot, -6 * PX);
    mesh(name, "over", pivot, -6 * PX);
    legs.push(pivot);
  }

  return { group, body, torso, head, arms, legs };
}
