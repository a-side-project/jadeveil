/**
 * 建造素材贴图 —— 玩家用来盖房子的一整套中式建材。
 *
 * 「随机」做在两层：
 *   1. 贴图内部：每块砖、每条木板、每颗卵石单独取色、单独决定裂纹 / 木节 / 缺角，
 *      而不是一张图平铺同一种砖；
 *   2. 方块之间：图集为每种建材生成 CRAFT_VARIANTS 张变体（换随机种子重画），
 *      网格按世界坐标哈希挑变体 —— 一整面墙不会出现两块一样的格子。
 *
 * 所有随机都走 b.rnd()（由 b.seed 播种），变体机制才能通过换种子得到不同的图。
 */
import { P } from "../palette.js";
import { hex, mix, lighten, darken } from "../pixels.js";
import { grain, microGrain, bevel } from "./nature.js";

const S = 64;

/** 每种建材的变体数（比老素材的 4 张更多，铺大面积更不重复）。 */
export const CRAFT_VARIANTS = 6;

const jitter = (b, c, amt) => {
  const n = (b.rnd() * 2 - 1) * amt;
  return [c[0] * (1 + n), c[1] * (1 + n), c[2] * (1 + n * 0.9)];
};

/* ------------------------------------------------------------------ */
/* 通用画法                                                              */
/* ------------------------------------------------------------------ */

/**
 * 木板：横向长条，每条板独立色调、错缝、木纹波动、随机木节与钉眼。
 */
function planks(b, base, deep, lit, { rows = 4, knot = 0.55, nails = true } = {}) {
  const h = S / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = r * h;
    const tone = jitter(b, base, 0.08);
    const seam = Math.floor(b.rnd() * S); // 板缝错开
    const phase = b.rnd() * 10;
    const freq = 0.25 + b.rnd() * 0.2;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = 0; x < S; x++) {
        const wave = Math.sin(x * freq + phase + Math.sin(y * 0.7) * 1.4) * 0.5 + 0.5;
        const c = mix(tone, lighten(tone, 0.12), wave * 0.6);
        b.set(x, y, c);
      }
    }
    // 上缘高光、下缘板缝
    b.hline(0, y0, S, darken(deep, 0.15));
    b.hline(0, y0 + 1, S, mix(lit, tone, 0.4));
    b.hline(0, y0 + h - 1, S, mix(deep, tone, 0.3));
    // 竖向接缝
    b.vline(seam, y0 + 1, h - 2, darken(deep, 0.1));
    b.vline((seam + 1) % S, y0 + 1, h - 2, mix(lit, tone, 0.5));
    // 木节：深色椭圆 + 一圈年轮
    if (b.rnd() < knot) {
      const kx = Math.floor(b.rnd() * (S - 8)) + 4;
      const ky = y0 + 3 + Math.floor(b.rnd() * (h - 6));
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = (dx * dx) / 16 + (dy * dy) / 4;
          if (d < 1) b.set(kx + dx, ky + dy, d < 0.35 ? darken(deep, 0.3) : mix(deep, tone, 0.45));
        }
      }
    }
    // 钉眼：板两端各一对
    if (nails) {
      for (const nx of [3, S - 4]) {
        if (b.rnd() < 0.8) {
          b.set(nx, y0 + 3, P.ink4);
          b.set(nx, y0 + h - 4, P.ink4);
        }
      }
    }
  }
  grain(b, 0.035, 0.7);
  bevel(b, 0.08, 0.12);
}

/**
 * 不规则砖墙：每排砖宽随机、每块砖独立色调，随机缺角与细裂纹。
 */
function brickWall(b, base, mortar, { rows = 8, minW = 12, maxW = 22, crack = 0.18, tones = 0.1, chip = 0.25 } = {}) {
  b.fill(mortar);
  const h = S / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = Math.round(r * h);
    const y1 = Math.round((r + 1) * h);
    let x = -Math.floor(b.rnd() * maxW);
    while (x < S) {
      const w = minW + Math.floor(b.rnd() * (maxW - minW + 1));
      const tone = jitter(b, base, tones);
      for (let yy = y0 + 1; yy < y1; yy++) {
        for (let xx = x + 1; xx < x + w; xx++) {
          if (xx < 0 || xx >= S) continue;
          // 砖面：上亮下暗 + 细颗粒
          const t = (yy - y0) / Math.max(1, y1 - y0);
          let c = mix(lighten(tone, 0.1), darken(tone, 0.12), t);
          c = jitter(b, c, 0.04);
          b.set(xx, yy, c);
        }
      }
      // 缺角
      if (b.rnd() < chip) {
        const cx = b.rnd() < 0.5 ? x + 1 : x + w - 1;
        const cy = b.rnd() < 0.5 ? y0 + 1 : y1 - 1;
        b.set(cx, cy, mortar);
        b.set(cx + (cx === x + 1 ? 1 : -1), cy, mortar);
      }
      // 细裂纹：一条折线
      if (b.rnd() < crack) {
        let cx = x + 2 + Math.floor(b.rnd() * Math.max(1, w - 4));
        for (let yy = y0 + 1; yy < y1; yy++) {
          if (cx > 0 && cx < S) b.set(cx, yy, darken(tone, 0.35));
          cx += b.rnd() < 0.5 ? -1 : 1;
        }
      }
      x += w;
    }
  }
  microGrain(b, 0.02, 0.5);
  bevel(b, 0.08, 0.12);
}

/**
 * 卵石 / 乱石：随机撒点做 Voronoi，每颗石头独立色调 + 自身的高光暗面。
 */
function cobbles(b, base, gap, { count = 22, tones = 0.16, moss = 0 } = {}) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    pts.push({ x: b.rnd() * S, y: b.rnd() * S, c: jitter(b, base, tones) });
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9, best = null;
      for (const p of pts) {
        // 环绕平铺：最近点按周期取，保证贴图无缝
        const dx = Math.min(Math.abs(x - p.x), S - Math.abs(x - p.x));
        const dy = Math.min(Math.abs(y - p.y), S - Math.abs(y - p.y));
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      if (edge < 1.6) {
        b.set(x, y, gap);
      } else {
        // 石面球形明暗：离石心越近越亮
        const k = Math.max(0, 1 - Math.sqrt(d1) / 9);
        let c = mix(darken(best.c, 0.16), lighten(best.c, 0.14), k);
        if (moss > 0 && edge < 3.2 && b.rnd() < moss) c = mix(c, P.moss, 0.7);
        b.set(x, y, c);
      }
    }
  }
  grain(b, 0.03, 0.6);
}

/** 筒瓦（彩色琉璃）：复用 build.js 的瓦形思路，但每排瓦色随机深浅。 */
function rowTiles(b, base, deep, lit, rows = 4) {
  const rowH = S / rows;
  const colW = 16;
  for (let r = 0; r < rows; r++) {
    const tone = jitter(b, base, 0.07);
    for (let y = r * rowH; y < (r + 1) * rowH; y++) {
      const t = (y % rowH) / rowH;
      const shade = 0.62 + 0.55 * Math.sin(t * Math.PI);
      for (let x = 0; x < S; x++) {
        const curve = 0.86 + 0.3 * Math.sin(((x % colW) / colW) * Math.PI);
        b.set(x, y, mix(deep, tone, Math.min(1, shade * curve)));
      }
    }
    b.hline(0, Math.round(r * rowH), S, deep);
    const hy = Math.round(r * rowH + rowH * 0.45);
    for (let x = 0; x < S; x++) if ((x % colW) > 2 && (x % colW) < colW - 2) b.set(x, hy, mix(lit, tone, 0.3));
    // 偶尔一片瓦颜色略旧（随机）
    if (b.rnd() < 0.5) {
      const cx = Math.floor(b.rnd() * (S / colW)) * colW;
      for (let y = r * rowH + 1; y < (r + 1) * rowH; y++) {
        for (let x = cx; x < cx + colW; x++) {
          const c = b.get(x, y);
          b.set(x, y, mix([c[0], c[1], c[2]], darken(deep, 0.1), 0.18));
        }
      }
    }
  }
  grain(b, 0.03, 0.6);
}

/** 窗棂：木框 + 冰裂 / 方格棂条 + 宣纸。 */
function lattice(b, frame, paper, { pattern = "grid" } = {}) {
  b.fill(paper);
  // 宣纸纤维
  for (let i = 0; i < 260; i++) {
    const x = (b.rnd() * S) | 0, y = (b.rnd() * S) | 0;
    b.set(x, y, darken(paper, 0.05 + b.rnd() * 0.05));
  }
  const bar = (x, y, w, h) => {
    b.rect(x, y, w, h, frame);
    b.hline(x, y, w, lighten(frame, 0.18));
  };
  if (pattern === "grid") {
    for (let k = 0; k < S; k += 12) {
      bar(k, 0, 2, S);
      bar(0, k, S, 2);
    }
  } else {
    // 冰裂纹：随机折线棂条（每个变体都不同）
    for (let i = 0; i < 9; i++) {
      let x = b.rnd() * S, y = b.rnd() * S;
      const ang = b.rnd() * Math.PI;
      const len = 14 + b.rnd() * 24;
      for (let t = 0; t < len; t++) {
        b.rect(Math.round(x), Math.round(y), 2, 2, frame);
        x += Math.cos(ang);
        y += Math.sin(ang);
      }
    }
  }
  // 外框
  b.rect(0, 0, S, 4, frame);
  b.rect(0, S - 4, S, 4, darken(frame, 0.2));
  b.rect(0, 0, 4, S, frame);
  b.rect(S - 4, 0, 4, S, darken(frame, 0.2));
  bevel(b, 0.06, 0.1);
}

/** 抹灰墙：大片底色 + 随机水渍 / 剥落 + 墙脚泛黄。 */
function plaster(b, base, { stain = 0.5, flake = 4 } = {}) {
  b.fill(base);
  grain(b, 0.025, 0.9);
  // 水渍：几团低频的暗斑
  const blobs = 3 + Math.floor(b.rnd() * 3);
  for (let i = 0; i < blobs; i++) {
    const cx = b.rnd() * S, cy = b.rnd() * S, r = 6 + b.rnd() * 12;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d < 1 && b.rnd() < stain) {
          const c = b.get(x, y);
          b.set(x, y, mix([c[0], c[1], c[2]], darken(base, 0.12), (1 - d) * 0.5));
        }
      }
    }
  }
  // 剥落：露出底下的青砖
  for (let i = 0; i < flake; i++) {
    if (b.rnd() < 0.5) continue;
    const fx = (b.rnd() * (S - 10)) | 0, fy = (b.rnd() * (S - 8)) | 0;
    const fw = 4 + ((b.rnd() * 6) | 0), fh = 3 + ((b.rnd() * 4) | 0);
    b.rect(fx, fy, fw, fh, mix(P.slateDeep, P.slate, b.rnd()));
    b.hline(fx, fy, fw, darken(base, 0.25));
  }
  bevel(b, 0.06, 0.1);
}

/* ------------------------------------------------------------------ */
/* 素材表                                                               */
/* ------------------------------------------------------------------ */

const C = {
  oak: hex(0xa47447), oakDeep: hex(0x6e4a2a), oakLit: hex(0xc99a68),
  cherry: hex(0xc98479), cherryDeep: hex(0x8d4f4a), cherryLit: hex(0xe7aea2),
  ebony: hex(0x3e2c24), ebonyDeep: hex(0x241913), ebonyLit: hex(0x5d4536),
  bambooPlank: hex(0xc8b26a), bambooDeep: hex(0x8f7a3e), bambooLit: hex(0xe6d391),
  greyBrick: hex(0x6d7579), greyMortar: hex(0x4b5154),
  stoneBrick: hex(0x8a8d8f), stoneMortar: hex(0x55595b),
  redBrick: hex(0xa4483a), redMortar: hex(0x6b5f55),
  terracotta: hex(0xb8673f),
  plaster: hex(0xe9e3d6),
  ochre: hex(0xd6a15a),
  blueGlaze: hex(0x3f73b8), blueGlazeDeep: hex(0x22457a), blueGlazeLit: hex(0x8db8ec),
  greenGlaze: hex(0x3f9a5c), greenGlazeDeep: hex(0x235c37), greenGlazeLit: hex(0x8fd6a4),
  lacquer: hex(0x25181a), lacquerLit: hex(0x4a2f33),
  sandstone: hex(0xd4b483), sandstoneDeep: hex(0xa88a5c),
  straw: hex(0xc9a75e), strawDeep: hex(0x8f7438),
  copper: hex(0x6f9c8a), copperDeep: hex(0x3f6658), copperLit: hex(0xb07a4a),
  paper: hex(0xf3ead2),
  carpet: hex(0xa8252a), carpetGold: hex(0xd9a441),
};

export const CRAFT_TILES = {
  /* ---- 木 ---- */
  oak_planks: (b) => { b.seed(601); b.fill(C.oak); planks(b, C.oak, C.oakDeep, C.oakLit); },
  cherry_planks: (b) => { b.seed(602); b.fill(C.cherry); planks(b, C.cherry, C.cherryDeep, C.cherryLit, { knot: 0.35 }); },
  ebony_planks: (b) => { b.seed(603); b.fill(C.ebony); planks(b, C.ebony, C.ebonyDeep, C.ebonyLit, { knot: 0.3 }); },
  bamboo_planks: (b) => {
    // 竹编：纵横交错的竹篾
    b.seed(604).fill(C.bambooPlank);
    const w = 8;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const cell = ((x / w) | 0) + ((y / w) | 0);
        const horizontal = cell % 2 === 0;
        const t = horizontal ? (y % w) / w : (x % w) / w;
        const c = mix(C.bambooDeep, C.bambooLit, Math.sin(t * Math.PI) * 0.85);
        b.set(x, y, c);
      }
    }
    // 随机几根颜色深浅不同的篾
    for (let i = 0; i < 6; i++) {
      const k = ((b.rnd() * 8) | 0) * w;
      const vertical = b.rnd() < 0.5;
      for (let t = 0; t < S; t++) {
        for (let q = 1; q < w - 1; q++) {
          const x = vertical ? k + q : t, y = vertical ? t : k + q;
          const c = b.get(x, y);
          b.set(x, y, darken([c[0], c[1], c[2]], 0.12));
        }
      }
    }
    grain(b, 0.03, 0.6);
    bevel(b, 0.08, 0.12);
  },
  lacquer_wood: (b) => {
    // 黑漆木：近黑底 + 漆面高光 + 随机描金卷草
    b.seed(605).fill(C.lacquer);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const f = Math.sin((x + y) * 0.08) * 0.5 + 0.5;
        b.set(x, y, mix(C.lacquer, C.lacquerLit, f * 0.35));
      }
    }
    for (let i = 0; i < 3; i++) {
      const cx = b.rnd() * S, cy = b.rnd() * S, r = 5 + b.rnd() * 6;
      for (let a = 0; a < Math.PI * 1.6; a += 0.08) {
        const rr = r * (1 - a / 8);
        b.set(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), P.goldDeep);
      }
    }
    b.frame(2, 2, S - 4, S - 4, P.goldDeep);
    microGrain(b, 0.015, 0.4);
  },

  /* ---- 砖石 ---- */
  grey_brick: (b) => { b.seed(611); brickWall(b, C.greyBrick, C.greyMortar, { rows: 10, minW: 10, maxW: 18, tones: 0.09 }); },
  stone_bricks: (b) => { b.seed(612); brickWall(b, C.stoneBrick, C.stoneMortar, { rows: 4, minW: 20, maxW: 34, crack: 0.35, tones: 0.07 }); },
  mossy_bricks: (b) => {
    b.seed(613);
    brickWall(b, C.stoneBrick, C.stoneMortar, { rows: 4, minW: 20, maxW: 34, crack: 0.3, tones: 0.07 });
    // 苔藓从砖缝蔓延：沿暗色砖缝随机长出
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const c = b.get(x, y);
        const isMortar = c[0] < 100;
        if ((isMortar && b.rnd() < 0.55) || b.rnd() < 0.05) {
          b.set(x, y, mix(P.moss, P.grassDeep, b.rnd()));
        }
      }
    }
  },
  red_brick: (b) => { b.seed(614); brickWall(b, C.redBrick, C.redMortar, { rows: 8, minW: 14, maxW: 20, tones: 0.12 }); },
  marble_bricks: (b) => { b.seed(615); brickWall(b, P.marble, P.marbleDeep, { rows: 4, minW: 28, maxW: 40, crack: 0.15, tones: 0.04, chip: 0.1 }); },
  sandstone: (b) => {
    // 砂岩：水平沉积层，每层色调与厚度随机
    b.seed(616);
    let y = 0;
    while (y < S) {
      const h = 3 + Math.floor(b.rnd() * 8);
      const tone = jitter(b, C.sandstone, 0.08);
      for (let yy = y; yy < Math.min(S, y + h); yy++) {
        for (let x = 0; x < S; x++) b.set(x, yy, jitter(b, tone, 0.03));
      }
      b.hline(0, Math.min(S - 1, y + h - 1), S, C.sandstoneDeep);
      y += h;
    }
    bevel(b, 0.08, 0.12);
  },
  cobblestone: (b) => { b.seed(617); cobbles(b, P.stone, P.stoneDeep, { count: 20 }); bevel(b, 0.06, 0.1); },
  mossy_cobble: (b) => { b.seed(618); cobbles(b, P.stone, P.stoneDeep, { count: 20, moss: 0.65 }); bevel(b, 0.06, 0.1); },
  river_pebbles: (b) => { b.seed(619); cobbles(b, hex(0xa39a8c), hex(0x5f5a52), { count: 46, tones: 0.22 }); bevel(b, 0.05, 0.08); },
  carved_stone: (b) => {
    // 雕花石：回纹框 + 中央随机选一种团花
    b.seed(620).fill(P.stone);
    grain(b, 0.03, 0.8);
    const d = P.stoneDeep, l = P.stoneLit;
    b.frame(3, 3, S - 6, S - 6, d);
    b.frame(4, 4, S - 8, S - 8, l);
    // 回纹
    for (let k = 8; k < S - 8; k += 8) {
      b.rect(k, 8, 4, 2, d); b.rect(k + 2, 10, 2, 2, d);
      b.rect(k, S - 10, 4, 2, d); b.rect(k + 2, S - 12, 2, 2, d);
    }
    const petals = 4 + Math.floor(b.rnd() * 5);
    const rot = b.rnd() * Math.PI;
    for (let i = 0; i < petals; i++) {
      const a = rot + (i / petals) * Math.PI * 2;
      for (let r = 3; r < 15; r++) {
        const x = Math.round(32 + Math.cos(a) * r), y = Math.round(32 + Math.sin(a) * r);
        const w = Math.round(Math.sin((r / 15) * Math.PI) * 3);
        for (let q = -w; q <= w; q++) b.set(x + Math.round(-Math.sin(a) * q), y + Math.round(Math.cos(a) * q), r % 4 === 0 ? l : d);
      }
    }
    b.circle(32, 32, 3, l);
    bevel(b, 0.1, 0.14);
  },

  /* ---- 墙面 ---- */
  white_plaster: (b) => { b.seed(631); plaster(b, C.plaster); },
  ochre_plaster: (b) => { b.seed(632); plaster(b, C.ochre, { stain: 0.4 }); },
  terracotta: (b) => {
    b.seed(633).fill(C.terracotta);
    grain(b, 0.05, 0.9);
    // 窑变斑：随机深浅团块
    for (let i = 0; i < 7; i++) {
      const cx = b.rnd() * S, cy = b.rnd() * S, r = 3 + b.rnd() * 7;
      const c2 = b.rnd() < 0.5 ? darken(C.terracotta, 0.15) : lighten(C.terracotta, 0.1);
      for (let y = Math.floor(cy - r); y < cy + r; y++) {
        for (let x = Math.floor(cx - r); x < cx + r; x++) {
          if (Math.hypot(x - cx, y - cy) < r && b.rnd() < 0.6) b.set(((x % S) + S) % S, ((y % S) + S) % S, c2);
        }
      }
    }
    bevel(b, 0.1, 0.14);
  },
  lattice_window: (b) => { b.seed(634); lattice(b, P.woodMid, C.paper, { pattern: "grid" }); },
  ice_lattice: (b) => { b.seed(635); lattice(b, C.cherryDeep, C.paper, { pattern: "ice" }); },

  /* ---- 屋面 ---- */
  roof_blue: (b) => { b.seed(641); rowTiles(b, C.blueGlaze, C.blueGlazeDeep, C.blueGlazeLit); },
  roof_green: (b) => { b.seed(642); rowTiles(b, C.greenGlaze, C.greenGlazeDeep, C.greenGlazeLit); },
  thatch: (b) => {
    // 茅草：随机方向的短草茎层层叠压
    b.seed(643).fill(C.strawDeep);
    for (let i = 0; i < 900; i++) {
      const x = b.rnd() * S, y = b.rnd() * S;
      const len = 4 + b.rnd() * 7;
      const ang = Math.PI / 2 + (b.rnd() - 0.5) * 0.7;
      const c = mix(C.strawDeep, lighten(C.straw, 0.2), b.rnd());
      for (let t = 0; t < len; t++) {
        const px = Math.round(x + Math.cos(ang) * t), py = Math.round(y + Math.sin(ang) * t);
        b.set(((px % S) + S) % S, ((py % S) + S) % S, c);
      }
    }
    bevel(b, 0.1, 0.14);
  },

  /* ---- 地面 / 装饰 ---- */
  jade_floor: (b) => {
    // 玉砖地：大方砖，每块玉色深浅与纹理走向随机
    b.seed(651);
    const n = 2, w = S / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const tone = jitter(b, P.jade, 0.12);
        const ang = b.rnd() * Math.PI;
        for (let y = j * w; y < (j + 1) * w; y++) {
          for (let x = i * w; x < (i + 1) * w; x++) {
            const vein = Math.sin((x * Math.cos(ang) + y * Math.sin(ang)) * 0.35 + Math.sin(x * 0.2) * 2) * 0.5 + 0.5;
            b.set(x, y, mix(darken(tone, 0.12), lighten(tone, 0.25), vein * vein));
          }
        }
        b.frame(i * w, j * w, w, w, P.jadeDeep);
      }
    }
    grain(b, 0.02, 0.5);
    bevel(b, 0.1, 0.12);
  },
  copper_plate: (b) => {
    // 铜板：铜色底上随机长出铜绿
    b.seed(652).fill(C.copperLit);
    grain(b, 0.05, 0.9);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = Math.sin(x * 0.21 + b.rnd() * 0.6) * Math.cos(y * 0.17) + b.rnd() * 0.8;
        if (n > 0.55) b.set(x, y, mix(C.copperDeep, C.copper, b.rnd()));
      }
    }
    for (const k of [0, 32]) {
      b.hline(0, k, S, darken(C.copperDeep, 0.3));
      b.vline(k, 0, S, darken(C.copperDeep, 0.3));
    }
    for (const [x, y] of [[4, 4], [36, 4], [4, 36], [36, 36], [28, 28], [60, 60]]) b.circle(x, y, 1.2, C.copperDeep);
    bevel(b, 0.12, 0.16);
  },
  straw_mat: (b) => {
    // 草席：细密的横向编织 + 布边
    b.seed(653).fill(C.straw);
    for (let y = 0; y < S; y++) {
      const tone = (y % 4 < 2) ? lighten(C.straw, 0.08) : darken(C.straw, 0.06);
      for (let x = 0; x < S; x++) {
        const knot = (x + (y >> 2) * 3) % 6 === 0;
        b.set(x, y, knot ? darken(tone, 0.12) : jitter(b, tone, 0.03));
      }
    }
    b.rect(0, 0, S, 3, hex(0x2f4f3f));
    b.rect(0, S - 3, S, 3, hex(0x2f4f3f));
    bevel(b, 0.06, 0.1);
  },
  silk_carpet: (b) => {
    // 红毯：朱红底 + 金边 + 随机云纹
    b.seed(654).fill(C.carpet);
    grain(b, 0.03, 0.9);
    b.frame(2, 2, S - 4, S - 4, C.carpetGold);
    b.frame(5, 5, S - 10, S - 10, C.carpetGold);
    for (let i = 0; i < 4; i++) {
      const cx = 12 + b.rnd() * 40, cy = 12 + b.rnd() * 40;
      for (let a = 0; a < Math.PI * 2; a += 0.12) {
        const r = 4 + Math.sin(a * 3) * 1.5;
        b.set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), lighten(C.carpetGold, 0.1));
      }
    }
  },
};

/** 新建材的名称列表（atlas 用来生成变体，mesher 用来挑变体）。 */
export const CRAFT_TILE_NAMES = Object.keys(CRAFT_TILES);
