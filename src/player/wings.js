/**
 * 飞行灵翼 —— 潘达利亚琉璃金 / 青玉 / 朱红配色的像素风羽翼。
 *
 * 设计要点：
 *  · 巨大：翼展 5.8 格（≈ 3.3 × 熊猫人身高），常量 WING_SPAN 一处可调
 *  · 像素风：贴图全部用 Canvas 逐像素程序化绘制（离线，无外部图片），
 *    含羽层分层、根→尖渐变、以及发光符文
 *  · 接入法线/粗糙度体系：normalMap 由高度场求差分得到，roughnessMap 区分
 *    羽片与羽轴
 *  · 发光：emissiveMap 只留符文亮起，材质 layers 打开泛光层，
 *    于是符文会参与选择性泛光（金瓦/灯笼同一套）
 *  · 扇动：1.25 Hz、大摆幅；绕 Z 轴扇动（翅膀沿 X 伸出，绕 X 旋转只会
 *    自转、翼尖几乎不动 —— 这是上一版「看着不扇」的根因）
 */
import * as THREE from "three";
import { BLOOM_SCENE } from "../core/renderer.js";

/* ---------------- 量化常量 ---------------- */

/** 熊猫人身体总高（格）：髋 0.72 + 躯干到头顶 1.06。 */
export const AVATAR_HEIGHT = 1.78;
/** 翼展（格，翼尖到翼尖）。≥ 5 且 ≈ 3.3 × 身高。 */
export const WING_SPAN = 5.8;
/** 单侧翼展（从身体中线到翼尖）。 */
export const WING_HALF = WING_SPAN / 2;
/** 扇动频率（Hz）。验收要求 1–1.5 Hz。 */
export const FLAP_HZ = 1.25;
/** 扇动幅度（弧度，单边 ±）。 */
export const FLAP_AMP = 0.72;
/** 静止时翅膀上翘的底角（弧度）。 */
export const WING_BASE_PITCH = 0.40;

const TAU = Math.PI * 2;

/* ---------------- 配色 ---------------- */

const C_JADE_ROOT = "#3f8f74"; // 翼根：青玉（深）
const C_JADE_LIT = "#7fd6ae"; // 青玉高光
const C_GOLD_DEEP = "#8a6320"; // 琉璃金暗部
const C_GOLD = "#ffd479"; // 琉璃金
const C_GOLD_HOT = "#fff3c4"; // 金字高光
const C_VERMILION = "#b8402f"; // 朱红（翼尖）
const C_VERMILION_LIT = "#e8613f";
const C_QUILL = "#5a4626"; // 羽轴
const C_OUTLINE = "#2a2016"; // 像素描边
const C_RUNE = "#bff2ff"; // 符文（发光）
const C_RUNE_CORE = "#ffffff";

const SIZE = 128; // 贴图边长（像素风，低分辨率才像素）

const px = (ctx, x, y, w, h, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

/**
 * 高度场（0..1）：羽片凸起、羽片缝隙下凹。
 * 用于生成法线贴图，让羽层有真实的层叠起伏。
 */
function buildHeight(size) {
  const h = new Float32Array(size * size).fill(0.30);
  // u = 沿弦向（0 前缘 → 1 后缘），v = 沿展向（0 翼根 → 1 翼尖）
  // 三排羽片，越靠后缘越短、越靠翼尖越窄
  const rows = [
    { v0: 0.0, v1: 0.34, u0: 0.06, u1: 0.62, step: 0.30, lift: 0.62 },
    { v0: 0.30, v1: 0.66, u0: 0.05, u1: 0.80, step: 0.26, lift: 0.48 },
    { v0: 0.62, v1: 1.0, u0: 0.04, u1: 0.92, step: 0.22, lift: 0.34 },
  ];
  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      let best = 0.18;
      for (const r of rows) {
        if (v < r.v0 || v > r.v1) continue;
        const tv = (v - r.v0) / Math.max(1e-6, r.v1 - r.v0);
        // 羽片沿展向重复，叶片中部最鼓
        const leaf = Math.abs(((u * (1 / r.step)) % 1) - 0.5) * 2;
        const domed = Math.cos(leaf * Math.PI * 0.5);
        const span = 1 - Math.abs(tv - 0.5) * 2;
        const shape = Math.max(0, domed * span);
        const e = Math.min(1, Math.max(0, (u - r.u0) / Math.max(1e-6, r.u1 - r.u0)));
        const a = Math.min(1, e / 0.25) * (1 - Math.max(0, (e - 0.85) / 0.15));
        best = Math.max(best, 0.30 + r.lift * shape * Math.max(0, Math.min(1, a)));
      }
      // 前缘羽轴
      if (u < 0.05) best = Math.max(best, 0.85);
      h[y * size + x] = best;
    }
  }
  return h;
}

/**
 * 造一套程序化像素贴图。
 * @returns {{map:THREE.CanvasTexture, normalMap:THREE.CanvasTexture,
 *            roughnessMap:THREE.CanvasTexture, emissiveMap:THREE.CanvasTexture}}
 */
export function makeWingMaps(size = SIZE) {
  const height = buildHeight(size);

  /* ---- 1. 颜色贴图：渐变 + 羽层 + 描边 ---- */
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");

  // 根→尖渐变：青玉 → 琉璃金 → 朱红
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0.0, C_JADE_ROOT);
  grad.addColorStop(0.34, C_JADE_LIT);
  grad.addColorStop(0.5, C_GOLD);
  grad.addColorStop(0.74, C_GOLD_HOT);
  grad.addColorStop(1.0, C_VERMILION);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // 后缘压暗，做出羽尖收拢感
  const edge = ctx.createLinearGradient(0, 0, size, 0);
  edge.addColorStop(0.0, "rgba(42,32,22,0.55)");
  edge.addColorStop(0.18, "rgba(42,32,22,0.0)");
  edge.addColorStop(0.84, "rgba(184,64,47,0.0)");
  edge.addColorStop(1.0, "rgba(42,32,22,0.62)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);

  // 用高度场给羽片描边（像素硬边，不抗锯齿）
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hv = height[i];
      // 高度骤变处画描边
      const hx = height[y * size + Math.min(size - 1, x + 1)];
      const hy = height[Math.min(size - 1, y + 1) * size + x];
      const grad2 = Math.abs(hx - hv) + Math.abs(hy - hv);
      const o = i * 4;
      if (grad2 > 0.055) {
        d[o] = 0x2a; d[o + 1] = 0x20; d[o + 2] = 0x16; // 描边
      } else if (hv > 0.62) {
        // 羽片脊部提亮
        d[o] = Math.min(255, d[o] + 26);
        d[o + 1] = Math.min(255, d[o + 1] + 22);
        d[o + 2] = Math.min(255, d[o + 2] + 12);
      }
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  /* ---- 2. 符文：像素块拼的古朴纹样（同时写入 emissive）---- */
  const e = document.createElement("canvas");
  e.width = e.height = size;
  const ec = e.getContext("2d");
  ec.fillStyle = "#000000";
  ec.fillRect(0, 0, size, size);

  // 符文的「笔画」用 8 像素网格，硬边
  const cell = 8;
  const runes = [
    // [列, 行, 笔画列表(单位格)]
    { x: 3, y: 2, strokes: [[0, 0, 3, 1], [1, 1, 1, 3], [0, 4, 3, 1], [2, 1, 1, 3]] },
    { x: 9, y: 3, strokes: [[0, 0, 1, 4], [1, 0, 2, 1], [2, 1, 1, 2], [0, 3, 3, 1]] },
    { x: 5, y: 9, strokes: [[0, 0, 3, 1], [0, 1, 1, 3], [2, 1, 1, 3], [0, 4, 3, 1]] },
    { x: 11, y: 8, strokes: [[0, 0, 2, 1], [0, 1, 1, 3], [1, 3, 2, 1]] },
  ];
  const drawRune = (g, x0, y0, strokes, color) => {
    g.fillStyle = color;
    for (const [sx, sy, sw, sh] of strokes) {
      g.fillRect((x0 + sx) * cell, (y0 + sy) * cell, sw * cell, sh * cell);
    }
  };
  for (const r of runes) {
    drawRune(ec, r.x, r.y, r.strokes, C_RUNE);
    // 内芯更亮，形成「发光纹路」
    for (const [sx, sy, sw, sh] of r.strokes) {
      if (sw > 1 || sh > 1) {
        ec.fillStyle = C_RUNE_CORE;
        ec.fillRect((r.x + sx) * cell + 2, (r.y + sy) * cell + 2, sw * cell - 4, sh * cell - 4);
      }
    }
  }

  // 前缘羽轴也发光（琉璃金的芯）
  ec.fillStyle = C_GOLD_HOT;
  ec.fillRect(0, 0, Math.round(size * 0.035), size);

  /* ---- 3. 粗糙度贴图：羽片光滑、描边粗糙 ---- */
  const rc = document.createElement("canvas");
  rc.width = rc.height = size;
  const rctx = rc.getContext("2d");
  const rimg = rctx.createImageData(size, size);
  const rd = rimg.data;
  for (let i = 0; i < size * size; i++) {
    const hv = height[i];
    // 高度高 → 更光滑（羽面反光）；缝隙 → 更粗糙
    const r = Math.round(THREE.MathUtils.lerp(96, 44, hv));
    rd[i * 4] = rd[i * 4 + 1] = rd[i * 4 + 2] = r;
    rd[i * 4 + 3] = 255;
  }
  // 描边处更粗糙
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hx = height[y * size + Math.min(size - 1, x + 1)];
      const hy = height[Math.min(size - 1, y + 1) * size + x];
      if (Math.abs(hx - height[i]) + Math.abs(hy - height[i]) > 0.055) {
        rd[i * 4] = rd[i * 4 + 1] = rd[i * 4 + 2] = 190;
      }
    }
  }
  rctx.putImageData(rimg, 0, 0);

  /* ---- 4. 法线贴图：由高度场差分 ---- */
  const nc = document.createElement("canvas");
  nc.width = nc.height = size;
  const nctx = nc.getContext("2d");
  const nimg = nctx.createImageData(size, size);
  const nd = nimg.data;
  const strength = 5.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = height[y * size + Math.max(0, x - 1)];
      const xp = height[y * size + Math.min(size - 1, x + 1)];
      const ym = height[Math.max(0, y - 1) * size + x];
      const yp = height[Math.min(size - 1, y + 1) * size + x];
      let nx = (xm - xp) * strength;
      let ny = (ym - yp) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const o = (y * size + x) * 4;
      nd[o] = Math.round((nx * 0.5 + 0.5) * 255);
      nd[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nd[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      nd[o + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  const tex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.NearestFilter; // 像素风：最近邻，不糊
    t.minFilter = THREE.NearestMipmapNearestFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  return {
    map: tex(c, true),
    normalMap: tex(nc, false),
    roughnessMap: tex(rc, false),
    emissiveMap: tex(e, true),
  };
}

/* ---------------- 几何 ---------------- */

/**
 * 扇动角（弧度）。用时间驱动，便于验收时按时间采样测频率。
 * @param {number} t 秒
 */
export function flapAngle(t) {
  return WING_BASE_PITCH + Math.sin(t * FLAP_HZ * TAU) * FLAP_AMP;
}

/**
 * 造一对灵翼。
 * @returns {{group:THREE.Group, pivots:THREE.Group[], meshes:THREE.Mesh[],
 *            materials:object, setVisible(v:boolean):void, update(t:number):void}}
 */
export function createWings() {
  const maps = makeWingMaps();

  // 主羽面：像素贴图 + 法线 + 粗糙度 + 自发光
  const wingMat = new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    emissiveMap: maps.emissiveMap,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 1.7,
    metalness: 0.38,
    roughness: 1.0, // 实际粗糙度由 roughnessMap 逐像素调制
    normalScale: new THREE.Vector2(1.15, 1.15),
  });

  // 前缘羽轴：琉璃金自发光
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0x6b4c18,
    emissive: new THREE.Color(0xffd479),
    emissiveIntensity: 2.3,
    metalness: 0.62,
    roughness: 0.30,
  });

  // 符文条：青玉/符文青自发光（比金色更冷，做出对比）
  const runeMat = new THREE.MeshStandardMaterial({
    color: 0x243832,
    emissive: new THREE.Color(0xbff2ff),
    emissiveIntensity: 3.2,
    metalness: 0.55,
    roughness: 0.28,
  });

  const group = new THREE.Group();
  group.name = "wings";
  const pivots = [];
  const meshes = [];

  const L = WING_HALF - 0.30; // 单侧羽面长度（2.60）

  const box = (w, h, d, material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.castShadow = true;
    m.layers.enable(BLOOM_SCENE); // 接入选择性泛光
    meshes.push(m);
    return m;
  };

  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.30, 0.62, 0.05); // 肩胛（body 局部坐标）
    pivot.rotation.y = s * 0.12; // 轻微后掠
    group.add(pivot);
    pivots.push(pivot);

    // 主羽面：从肩胛沿 X 伸到翼尖（0.30 + 2.60 = 2.90 = WING_HALF）
    const plate = box(L, 0.10, 1.05, wingMat);
    plate.position.set((s * L) / 2, 0, 0);
    pivot.add(plate);

    // 三排羽片：后缘逐层收短，形成「羽层分层」
    const rows = [
      { len: 0.64, z: 0.54, t: 0.07, dy: -0.015, off: 0.56 },
      { len: 0.47, z: 0.68, t: 0.06, dy: -0.035, off: 0.46 },
      { len: 0.30, z: 0.78, t: 0.05, dy: -0.055, off: 0.34 },
    ];
    for (const r of rows) {
      const f = box(L * r.len, r.t, 0.26, wingMat);
      f.position.set(s * L * r.off, r.dy, r.z);
      pivot.add(f);
    }

    // 前缘羽轴（金）+ 符文条（青）
    const bone = box(L, 0.14, 0.13, goldMat);
    bone.position.set((s * L) / 2, 0.02, -0.46);
    pivot.add(bone);

    const strip = box(L * 0.44, 0.13, 0.06, runeMat);
    strip.position.set(s * L * 0.36, 0.055, 0.05);
    pivot.add(strip);

    // 翼尖符文块（最外侧，保证翼尖也发光）
    const tip = box(0.16, 0.14, 0.34, runeMat);
    tip.position.set(s * (L - 0.02), 0.0, -0.06);
    pivot.add(tip);
  }

  return {
    group,
    pivots,
    meshes,
    materials: { wingMat, goldMat, runeMat, maps },
    setVisible(v) {
      for (const p of pivots) p.visible = v;
    },
    /**
     * 扇动：绕 Z 轴（翅膀沿 X 伸出，绕 Z 旋转翼尖才真正上下运动；
     * 旧版用 rotation.x，对沿 X 伸出的翅膀只会自转，翼尖几乎不动）。
     */
    update(t) {
      const a = flapAngle(t);
      pivots[0].rotation.z = -a; // 左翼（-X 侧）取负才能上扬
      pivots[1].rotation.z = a;
      // 羽面自身轻微扭转，让扇动更有「羽毛鼓风」的味道
      const twist = Math.cos(t * FLAP_HZ * TAU) * 0.16;
      pivots[0].rotation.x = twist;
      pivots[1].rotation.x = -twist;
    },
  };
}
