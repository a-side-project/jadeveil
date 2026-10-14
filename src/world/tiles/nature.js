/**
 * 自然类方块贴图 —— 逐像素绘制，32×32。
 * 统一光照约定：光源在左上，因此左上提亮、右下压暗。
 */
import { P } from "../palette.js";
import { mix, darken } from "../pixels.js";

// 贴图分辨率：64×64（高分辨率像素风）
const S = 64;
// 相对 32×32 的缩放系数，用于把原有细节密度等比放大
const K = S / 32;

/** 在底色上叠加细碎色斑，形成手绘颗粒感。 */
export function grain(b, amount = 0.05, density = 0.8) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (b.rnd() > density) continue;
      const n = (b.rnd() * 2 - 1) * amount;
      const c = b.get(x, y);
      b.set(x, y, [c[0] + n * 255, c[1] + n * 255 * 0.92, c[2] + n * 255 * 0.8]);
    }
  }
}

/** 细密高频噪声：64×64 下增加微观质感层次。 */
export function microGrain(b, amount = 0.028, density = 0.55) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (b.rnd() > density) continue;
      const n = (b.rnd() * 2 - 1) * amount;
      const c = b.get(x, y);
      b.set(x, y, [c[0] + n * 255, c[1] + n * 255, c[2] + n * 255]);
    }
  }
}

/** 左上高光 / 右下阴影的柔和渐变。 */
export function bevel(b, lit = 0.12, dark = 0.16, radius = 0.72) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = b.get(x, y);
      const d = (x / (S - 1) + y / (S - 1)) / 2 - 0.5;
      const f = 1 - d * (d > 0 ? dark * 2 : lit * 2) * radius;
      b.set(x, y, [c[0] * f, c[1] * f, c[2] * f], c[3]);
    }
  }
}

export const NATURE_TILES = {
  /* ---------------- 草地 / 土 ---------------- */
  grass_top: (b) => {
    b.seed(101).fill(P.grass);
    for (let i = 0; i < 150 * K * K; i++) {
      const x = (b.rnd() * S) | 0, y = (b.rnd() * S) | 0;
      b.set(x, y, b.rnd() > 0.45 ? P.grassDeep : P.bambooLit);
      if (b.rnd() > 0.7) b.set(x + 1, y, mix(P.grass, P.grassDeep, 0.5));
    }
    grain(b, 0.045);
    microGrain(b, 0.03);
    bevel(b, 0.1, 0.1);
  },

  grass_side: (b) => {
    b.seed(102).fill(P.earth);
    grain(b, 0.06);
    microGrain(b, 0.03);
    const edge = [];
    for (let x = 0; x < S; x++) edge.push(Math.round((7 + ((b.rnd() * 4) | 0) - 1) * K));
    for (let x = 0; x < S; x++) {
      for (let y = 0; y <= edge[x]; y++) b.set(x, y, y < 3 * K ? P.bambooLit : P.grass);
      b.set(x, edge[x], P.grassDeep);
      if (b.rnd() > 0.6) b.set(x, edge[x] + 1, mix(P.grassDeep, P.earth, 0.45));
    }
    bevel(b, 0.12, 0.14);
  },

  dirt: (b) => {
    b.seed(103).fill(P.earth);
    grain(b, 0.075);
    microGrain(b, 0.035);
    for (let i = 0; i < 22 * K * K; i++) {
      const x = (b.rnd() * S) | 0, y = (b.rnd() * S) | 0;
      const c = b.rnd() > 0.5 ? P.earthLit : P.earthDeep;
      b.set(x, y, c);
      b.set(x + 1, y, mix(c, P.earth, 0.4));
    }
    bevel(b, 0.1, 0.14);
  },

  sand: (b) => {
    b.seed(104).fill(P.sand);
    grain(b, 0.05);
    microGrain(b, 0.03);
    for (let i = 0; i < 40 * K * K; i++) b.set((b.rnd() * S) | 0, (b.rnd() * S) | 0, P.sandDeep);
    bevel(b, 0.1, 0.08);
  },

  /* ---------------- 石作 ---------------- */
  rock: (b) => {
    b.seed(110).fill(P.stone);
    grain(b, 0.06, 0.9);
    microGrain(b, 0.04);
    for (let i = 0; i < 4 * K; i++) {
      let x = (b.rnd() * S) | 0, y = (b.rnd() * S) | 0;
      for (let k = 0; k < 9 * K; k++) {
        b.set(x, y, P.stoneDeep);
        x += b.rnd() > 0.5 ? 1 : -1;
        y += b.rnd() > 0.35 ? 1 : 0;
      }
    }
    bevel(b, 0.14, 0.16);
  },

  stone_dark: (b) => {
    b.seed(111).fill(mix(P.ink, P.stone, 0.35));
    grain(b, 0.07, 0.9);
    microGrain(b, 0.04);
    for (let i = 0; i < 5 * K; i++) {
      let x = (b.rnd() * S) | 0, y = (b.rnd() * S) | 0;
      for (let k = 0; k < 8 * K; k++) {
        b.set(x, y, P.inkDeep);
        x += b.rnd() > 0.5 ? 1 : -1;
        y += b.rnd() > 0.4 ? 1 : 0;
      }
    }
    bevel(b, 0.16, 0.2);
  },

  moss_stone: (b) => {
    b.seed(112).fill(mix(P.stone, P.stoneDeep, 0.25));
    grain(b, 0.06);
    microGrain(b, 0.035);
    for (let i = 0; i < 90 * K * K; i++) {
      const x = (b.rnd() * S) | 0, y = (b.rnd() * S) | 0;
      if (y < 4 * K || b.rnd() > 0.55) b.set(x, y, b.rnd() > 0.5 ? P.moss : P.bambooDeep);
    }
    bevel(b, 0.14, 0.16);
  },

  /** 青石板路 —— 石工齐整，是主城地面基调 */
  slate: (b) => {
    b.seed(113).fill(P.slate);
    grain(b, 0.045, 0.7);
    microGrain(b, 0.03);
    const slabH = 10 * K;
    for (let y = 0; y < S; y++) {
      if (y % slabH === 0) for (let x = 0; x < S; x++) b.set(x, y, P.slateDeep);
    }
    for (let row = 0; row < 4; row++) {
      const y0 = Math.round(row * slabH);
      const shift = row % 2 === 0 ? 0 : 8 * K;
      for (let x = 0; x < S; x++) {
        if ((x + shift) % (16 * K) === 0)
          for (let y = y0; y < Math.min(y0 + slabH, S); y++) b.set(x, y, P.slateDeep);
      }
      if (y0 + 1 < S)
        for (let x = 0; x < S; x++) b.set(x, y0 + 1, mix(P.slateLit, P.slate, 0.4));
    }
    bevel(b, 0.08, 0.12);
  },

  marble: (b) => {
    b.seed(114).fill(P.marble);
    grain(b, 0.035, 0.6);
    microGrain(b, 0.025);
    for (let i = 0; i < 3 * K; i++) {
      let x = (b.rnd() * S) | 0, y = (b.rnd() * S) | 0;
      for (let k = 0; k < 14 * K; k++) {
        b.set(x, y, mix(P.marbleDeep, P.marble, 0.35));
        x += b.rnd() > 0.5 ? 1 : -1;
        y += b.rnd() > 0.5 ? 1 : 0;
      }
    }
    bevel(b, 0.1, 0.1);
  },

  /* ---------------- 水与荷 ---------------- */
  water: (b) => {
    b.seed(120);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const t = y / S;
        const w = Math.sin((x * 0.55 + y * 0.9) * 0.6) * 0.5 + 0.5;
        b.set(x, y, mix(P.waterDeep, P.water, t * 0.45 + w * 0.55), 235);
      }
    }
    for (let i = 0; i < 5 * K * K; i++) {
      const y = 3 * K + ((b.rnd() * (S - 6 * K)) | 0);
      const x0 = (b.rnd() * S) | 0;
      const len = (5 + ((b.rnd() * 9) | 0)) * K;
      for (let k = 0; k < len; k++) b.set(x0 + k, y, P.waterLit, 245);
    }
    grain(b, 0.03, 0.5);
  },

  lotus_pad: (b) => {
    b.seed(121);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - S/2, y - S/2);
        if (d > 14.5 * K) {
          b.set(x, y, P.water, 220);
        } else {
          const n = (b.rnd() * 2 - 1) * 0.06;
          const c = mix(P.moss, P.bamboo, Math.min(1, d / (15 * K)));
          b.set(x, y, [c[0] * (1 + n), c[1] * (1 + n), c[2] * (1 + n)], 255);
        }
      }
    }
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      for (let r = 3 * K; r < 14 * K; r++) {
        b.set(S/2 + Math.cos(ang) * r, S/2 + Math.sin(ang) * r, P.bambooDeep, 255);
      }
    }
    b.circle(S/2, S/2, 2 * K, P.bambooLit);
  },

  lotus_flower: (b) => {
    b.seed(122);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) b.set(x, y, P.water, 225);
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      for (let r = 2 * K; r < 13 * K; r++) {
        const x = S/2 + Math.cos(ang) * r;
        const y = S/2 + Math.sin(ang) * r * 0.85 + 1 * K;
        b.set(x, y, r > 9 * K ? P.lotusLit : P.lotus, 255);
        b.set(x, y + 1, P.lotus, 255);
      }
    }
    b.circle(S/2, S/2, 10 * K, P.lotusLit);
    b.circle(S/2, S/2, 8 * K, P.lotus);
    b.circle(S/2, S/2 + 1 * K, 5 * K, P.lotusDeep);
    b.circle(S/2, S/2 + 1 * K, 3 * K, P.lanternHot);
    b.circle(S/2, S/2, 1.5 * K, P.gold);
  },

  /* ---------------- 竹 / 松 / 花草 ---------------- */
  bamboo_stalk: (b) => {
    b.seed(130).fill(P.bamboo);
    for (let x = 0; x < S; x++) {
      const f = 1 + 0.16 * Math.cos((x / S) * Math.PI * 2);
      for (let y = 0; y < S; y++) {
        const c = b.get(x, y);
        b.set(x, y, [c[0] * f, c[1] * f, c[2] * f]);
      }
    }
    for (const y of [7*K, 8*K, 22*K, 23*K]) {
      for (let x = 0; x < S; x++) b.set(x, y, y % 2 ? P.bambooDeep : P.bambooLit);
    }
    grain(b, 0.04, 0.6);
  },

  bamboo_leaf: (b) => {
    b.seed(131);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) b.set(x, y, [0, 0, 0], 0);
    for (let i = 0; i < 46 * K * K; i++) {
      const cx = (b.rnd() * S) | 0, cy = (b.rnd() * S) | 0;
      const ang = b.rnd() * Math.PI * 2;
      const len = (3 + ((b.rnd() * 4) | 0)) * K;
      const c = b.rnd() > 0.62 ? P.bambooLit : b.rnd() > 0.35 ? P.bamboo : P.bambooDeep;
      for (let k = 0; k < len; k++) {
        const x = Math.round(cx + Math.cos(ang) * k);
        const y = Math.round(cy + Math.sin(ang) * k * 0.6);
        b.set(x, y, c, 255);
        if (k < len - 1 && b.rnd() > 0.6) b.set(x, y + 1, c, 255);
      }
    }
    b.outline(darken(P.bambooDeep, 0.25), 190, true);
  },

  pine_leaf: (b) => {
    b.seed(132);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) b.set(x, y, [0, 0, 0], 0);
    for (let i = 0; i < 120 * K * K; i++) {
      const cx = (b.rnd() * S) | 0, cy = (b.rnd() * S) | 0;
      const ang = b.rnd() * Math.PI * 2;
      const len = (2 + ((b.rnd() * 4) | 0)) * K;
      const c = b.rnd() > 0.7 ? P.pineLit : b.rnd() > 0.3 ? P.pine : P.pineDeep;
      for (let k = 0; k < len; k++) {
        b.set(Math.round(cx + Math.cos(ang) * k), Math.round(cy + Math.sin(ang) * k), c, 255);
      }
    }
    b.outline(P.pineDeep, 200, true);
  },

  flower_red: (b) => {
    b.seed(133);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) b.set(x, y, [0, 0, 0], 0);
    for (let x = 14*K; x < 18*K; x++) for (let y = 14*K; y < S; y++) b.set(x, y, P.grassDeep, 255);
    for (let i = 0; i < 7 * K; i++) {
      b.set(14*K + i, 22*K - (i % (3*K)), P.moss, 255);
      b.set(14*K + i, 26*K + (i % (3*K)), P.moss, 255);
    }
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2 - Math.PI / 2;
      b.circle(S/2 + Math.cos(ang) * 4*K, 12*K + Math.sin(ang) * 3.2*K, 3*K, k % 2 ? P.crimson : P.crimsonLit);
    }
    b.circle(S/2, 12*K, 2*K, P.lanternHot);
  },

  flower_yellow: (b) => {
    b.seed(134);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) b.set(x, y, [0, 0, 0], 0);
    for (let x = 14*K; x < 18*K; x++) for (let y = 13*K; y < S; y++) b.set(x, y, P.grassDeep, 255);
    for (let i = 0; i < 6 * K; i++) {
      b.set(14*K + i, 21*K - (i % (2*K)), P.moss, 255);
      b.set(14*K + i, 25*K + (i % (3*K)), P.moss, 255);
    }
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      b.circle(S/2 + Math.cos(ang) * 3.4*K, 11*K + Math.sin(ang) * 3*K, 2.8*K, P.gold);
    }
    b.circle(S/2, 11*K, 1.8*K, P.goldHot);
  },

  grass_tuft: (b) => {
    b.seed(135);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) b.set(x, y, [0, 0, 0], 0);
    for (let i = 0; i < 26 * K * K; i++) {
      let x = 4*K + ((b.rnd() * 24*K) | 0);
      let y = S - 2;
      const h = (6 + ((b.rnd() * 10) | 0)) * K;
      const lean = b.rnd() > 0.5 ? 1 : -1;
      const c = b.rnd() > 0.6 ? P.bambooLit : P.grass;
      for (let k = 0; k < h; k++) {
        b.set(x, y, c, 255);
        if (k > 2) x += lean * 0.35;
        y--;
      }
    }
    b.outline(P.grassDeep, 130, true);
  },

  /* ---------------- 云与雾 ---------------- */
  cloud: (b) => {
    b.seed(140);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n =
          Math.sin(x * 0.21) * 0.5 + Math.cos(y * 0.185 + 1.2) * 0.5 + Math.sin((x + y) * 0.105) * 0.4;
        const v = 0.5 + n * 0.28 + (b.rnd() * 2 - 1) * 0.06;
        b.set(x, y, mix(P.cloudShade, P.cloud, Math.min(1, Math.max(0, v))), 255);
      }
    }
    bevel(b, 0.1, 0.08);
  },
};
