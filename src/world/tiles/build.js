/**
 * 建筑类方块贴图 —— 朱红宫墙 / 琉璃金瓦 / 青玉 / 灯笼 / 石狮。
 * 与 nature.js 共用同一套光照约定（左上亮、右下暗）。
 */
import { P } from "../palette.js";
import { mix, lighten, darken } from "../pixels.js";
import { grain, bevel } from "./nature.js";

// 贴图分辨率：64×64（高分辨率像素风）
const S = 64;
const K = S / 32;

/** 琉璃瓦：一排排半圆筒瓦，带高光脊线。 */
function glazedTiles(b, base, deep, lit, rows = 4) {
  const rowH = S / rows;
  const colW = 8 * K;
  for (let y = 0; y < S; y++) {
    const ry = y % rowH;
    const t = ry / rowH;
    // 每排瓦片：上缘暗（瓦沟），中部亮（瓦脊）
    const shade = 0.62 + 0.55 * Math.sin(t * Math.PI);
    for (let x = 0; x < S; x++) {
      const col = Math.floor(x / colW);
      const cx = x % colW;
      const curve = 0.86 + 0.3 * Math.sin((cx / colW) * Math.PI);
      const c = mix(deep, base, Math.min(1, shade * curve));
      b.set(x, y, c);
    }
  }
  // 瓦脊高光
  for (let r = 0; r < rows; r++) {
    const y = Math.round(r * rowH + rowH * 0.42);
    for (let x = 0; x < S; x++) {
      if ((x % colW) > 1 && (x % colW) < colW - 1) b.set(x, y, mix(lit, base, 0.35));
    }
    const y2 = Math.round(r * rowH + rowH * 0.62);
    for (let x = 0; x < S; x++) b.set(x, y2, mix(lit, base, 0.55));
  }
  // 瓦沟阴影
  for (let r = 0; r < rows; r++) {
    const y = Math.round(r * rowH);
    for (let x = 0; x < S; x++) b.set(x, y, deep);
  }
}

export const BUILD_TILES = {
  /* ---------------- 朱红宫墙 ---------------- */
  wall_red: (b) => {
    b.seed(201).fill(P.crimson);
    grain(b, 0.05, 0.85);
    // 抹灰质感：横向的深浅带
    for (let y = 0; y < S; y++) {
      const band = Math.sin(y * 0.55) * 0.5 + 0.5;
      for (let x = 0; x < S; x++) {
        const c = b.get(x, y);
        const f = 0.94 + band * 0.1;
        b.set(x, y, [c[0] * f, c[1] * f, c[2] * f]);
      }
    }
    bevel(b, 0.14, 0.18);
  },

  /** 墙裙：下段石基，上段朱红，中间一道金线。 */
  wall_base: (b) => {
    b.seed(202).fill(P.crimson);
    grain(b, 0.05, 0.8);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (y > 19 * K) {
          const c = mix(P.stoneDeep, P.stone, (y - 19 * K) / (13 * K));
          b.set(x, y, c);
        }
      }
    }
    for (let x = 0; x < S; x++) {
      b.set(x, 18 * K, P.goldDeep);
      b.set(x, 19 * K, P.gold);
      b.set(x, 20 * K, P.goldDeep);
    }
    grain(b, 0.04, 0.5);
    bevel(b, 0.12, 0.16);
  },

  /** 朱红立柱：两侧暗、中间亮，带金箍。 */
  pillar_red: (b) => {
    b.seed(203).fill(P.crimson);
    for (let x = 0; x < S; x++) {
      const t = x / (S - 1);
      const f = 0.72 + 0.5 * Math.sin(t * Math.PI);
      for (let y = 0; y < S; y++) {
        const c = b.get(x, y);
        b.set(x, y, [c[0] * f, c[1] * f, c[2] * f]);
      }
    }
    grain(b, 0.045, 0.7);
    for (const y of [0, 1, 15*K, 16*K, S-2, S-1]) {
      for (let x = 0; x < S; x++) b.set(x, y, y % 2 ? P.goldDeep : P.gold);
    }
    bevel(b, 0.1, 0.14);
  },

  /* ---------------- 琉璃金瓦 ---------------- */
  roof_gold: (b) => {
    b.seed(210);
    glazedTiles(b, P.gold, P.goldDeep, P.goldLit, 4);
    grain(b, 0.035, 0.55);
  },

  roof_gold_ridge: (b) => {
    b.seed(211);
    glazedTiles(b, P.gold, P.goldDeep, P.goldLit, 4);
    // 正脊：中央一条厚重的金脊
    for (let y = 12*K; y < 20*K; y++) {
      for (let x = 0; x < S; x++) {
        const t = Math.abs(y - 15.5*K) / (4*K);
        b.set(x, y, mix(P.goldHot, P.gold, t));
      }
    }
    for (let x = 0; x < S; x++) {
      b.set(x, 11*K, P.goldDeep);
      b.set(x, 20*K, P.goldDeep);
    }
    grain(b, 0.03, 0.5);
  },

  /** 檐口：金瓦 + 下方朱红椽子 + 瓦当滴水。 */
  roof_eave: (b) => {
    b.seed(212);
    glazedTiles(b, P.gold, P.goldDeep, P.goldLit, 2);
    for (let y = 16*K; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const isRafter = Math.floor(x / (4*K)) % 2 === 0;
        b.set(x, y, isRafter ? P.crimsonDeep : P.crimson);
      }
    }
    // 瓦当（圆形滴水）
    for (let k = 0; k < 4; k++) {
      const cx = 4*K + k * 8*K;
      b.circle(cx, 17*K, 3*K, P.goldLit);
      b.circle(cx, 17*K, 1.6*K, P.goldHot);
    }
    for (let x = 0; x < S; x++) b.set(x, 15*K, P.goldDeep);
    grain(b, 0.04, 0.6);
  },

  /** 飞檐起翘的角部构件：金瓦 + 上翘的脊兽剪影。 */
  roof_corner: (b) => {
    b.seed(213);
    glazedTiles(b, P.gold, P.goldDeep, P.goldLit, 3);
    // 上翘的角脊
    for (let i = 0; i < 14*K; i++) {
      const x = 18*K + i;
      const y = 14*K - Math.round(Math.pow(i / (13*K), 1.7) * 11*K);
      for (let k = 0; k < 3; k++) b.set(x, y + k, k === 0 ? P.goldHot : k === 1 ? P.gold : P.goldDeep);
    }
    b.circle(S-1, 3*K, 2.4*K, P.goldLit);
    b.circle(S-1, 3*K, 1.2*K, P.goldHot);
    grain(b, 0.03, 0.5);
  },

  /* ---------------- 墨瓦（配殿 / 塔） ---------------- */
  roof_ink: (b) => {
    b.seed(220);
    glazedTiles(b, P.ink, P.inkDeep, P.inkLit, 4);
    grain(b, 0.04, 0.6);
  },

  roof_ink_eave: (b) => {
    b.seed(221);
    glazedTiles(b, P.ink, P.inkDeep, P.inkLit, 2);
    for (let y = 16*K; y < S; y++) {
      for (let x = 0; x < S; x++) {
        b.set(x, y, Math.floor(x / (4*K)) % 2 === 0 ? P.inkDeep : P.ink);
      }
    }
    for (let k = 0; k < 4; k++) b.circle(4*K + k * 8*K, 17*K, 3*K, P.inkLit);
    for (let x = 0; x < S; x++) b.set(x, 15*K, P.inkDeep);
    grain(b, 0.04, 0.6);
  },

  /* ---------------- 青玉 / 彩画 ---------------- */
  jade_block: (b) => {
    b.seed(230).fill(P.jade);
    grain(b, 0.05, 0.8);
    // 玉的絮状纹理
    for (let i = 0; i < 6 * K * K; i++) {
      let x = (b.rnd() * S) | 0, y = (b.rnd() * S) | 0;
      for (let k = 0; k < 12 * K; k++) {
        b.set(x, y, mix(P.jadeLit, P.jade, 0.4));
        x += b.rnd() > 0.5 ? 1 : -1;
        y += b.rnd() > 0.6 ? 1 : 0;
      }
    }
    bevel(b, 0.16, 0.16);
  },

  /** 梁枋彩画：青绿地子 + 金线 + 朱红箍头。 */
  beam_painted: (b) => {
    b.seed(231).fill(P.jadeDeep);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const seg = Math.floor(x / (8*K));
        if (seg % 2 === 0) b.set(x, y, mix(P.jadeDeep, P.jade, 0.35));
      }
    }
    for (let x = 0; x < S; x++) {
      b.set(x, 0, P.goldDeep);
      b.set(x, 1, P.gold);
      b.set(x, S-2, P.gold);
      b.set(x, S-1, P.goldDeep);
    }
    for (let k = 0; k < 4; k++) {
      const x0 = k * 8*K;
      for (let y = 2*K; y < S-2*K; y++) {
        b.set(x0, y, P.goldDeep);
        b.set(x0 + 1, y, P.gold);
      }
      b.circle(x0 + 4*K, S/2, 2.6*K, P.crimson);
      b.circle(x0 + 4*K, S/2, 1.2*K, P.goldLit);
    }
    grain(b, 0.035, 0.6);
  },

  /** 汉白玉栏杆：望柱 + 栏板。 */
  railing_marble: (b) => {
    b.seed(232).fill(P.marble);
    grain(b, 0.03, 0.5);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (y > 22*K) b.set(x, y, mix(P.marbleDeep, P.marble, 0.3));
      }
    }
    for (let x = 0; x < S; x++) {
      b.set(x, 21*K, P.marbleDeep);
      b.set(x, 22*K, P.marbleLit);
    }
    // 望柱
    for (let y = 4*K; y < S; y++) {
      for (let x = 13*K; x < 19*K; x++) b.set(x, y, mix(P.marbleLit, P.marble, (x - 13*K) / (6*K)));
    }
    b.circle(S/2, 4*K, 3.4*K, P.marbleLit);
    b.circle(S/2, 4*K, 1.6*K, P.marble);
    bevel(b, 0.1, 0.12);
  },

  /* ---------------- 灯笼 ---------------- */
  /** 宫灯：朱红纱面 + 金色上下箍 + 暖光透出。 */
  lantern: (b) => {
    b.seed(240);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x - 15.5*K) / (15.5*K);
        const dy = (y - 15.5*K) / (15.5*K);
        const d = Math.hypot(dx, dy * 0.92);
        if (d > 0.98) {
          b.set(x, y, P.ink4, 0);
          continue;
        }
        // 灯笼的竖向骨架
        const rib = Math.abs(((x * 0.5) % (8*K)) - 4*K) < 0.9*K;
        const glow = 1 - d * 0.55;
        let c = mix(P.crimsonDeep, P.lanternLit, glow * 0.85);
        if (rib) c = mix(c, P.goldDeep, 0.55);
        b.set(x, y, c, 255);
      }
    }
    // 上下金箍
    for (let x = 0; x < S; x++) {
      for (const y of [3*K, 4*K, 27*K, 28*K]) {
        const dx = Math.abs(x - 15.5*K) / (15.5*K);
        if (dx < 0.62) b.set(x, y, y % 2 ? P.gold : P.goldLit, 255);
      }
    }
    // 中心暖光
    b.circle(S/2, S/2, 6*K, P.lanternHot, 120);
    b.circle(S/2, S/2, 3*K, P.goldHot, 190);
    b.outline(darken(P.crimsonDeep, 0.4), 210, true);
  },

  /** 灯笼穗子 / 挂绳。 */
  lantern_tassel: (b) => {
    b.seed(241);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) b.set(x, y, [0, 0, 0], 0);
    for (let x = 14*K; x < 18*K; x++) for (let y = 0; y < 6*K; y++) b.set(x, y, P.goldDeep, 255);
    for (let i = 0; i < 5; i++) {
      const x = 12*K + i * 2*K;
      for (let y = 6*K; y < 26*K; y++) {
        b.set(x, y, i % 2 ? P.crimson : P.crimsonDeep, 255);
        if (y > 20*K) b.set(x, y, i % 2 ? P.crimsonDeep : P.crimson, 255);
      }
    }
    b.outline(P.ink4, 150, true);
  },

  /* ---------------- 石狮 / 牌坊 ---------------- */
  stone_lion: (b) => {
    b.seed(250);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) b.set(x, y, [0, 0, 0], 0);
    const body = mix(P.marble, P.marbleDeep, 0.35);
    // 底座
    b.rect(4*K, 26*K, 24*K, 6*K, P.marbleDeep);
    b.rect(5*K, 26*K, 22*K, 2*K, P.marble);
    // 身躯
    b.rect(9*K, 14*K, 14*K, 13*K, body);
    // 前腿
    b.rect(9*K, 22*K, 4*K, 5*K, mix(body, P.marbleDeep, 0.3));
    b.rect(19*K, 22*K, 4*K, 5*K, mix(body, P.marbleDeep, 0.3));
    // 头
    b.circle(S/2, 11*K, 6.5*K, lighten(body, 0.08));
    // 鬃毛
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      b.circle(S/2 + Math.cos(ang) * 7*K, 11*K + Math.sin(ang) * 6.5*K, 2.2*K, mix(body, P.marbleDeep, 0.45));
    }
    // 眼与口
    b.circle(13.5*K, 10*K, 1.2*K, P.ink4);
    b.circle(18.5*K, 10*K, 1.2*K, P.ink4);
    b.rect(14*K, 14*K, 4*K, 1.6*K, P.ink4);
    // 绣球
    b.circle(24*K, 24*K, 3.4*K, mix(P.marbleLit, P.marble, 0.4));
    b.outline(P.marbleDeep, 200, true);
  },

  /** 牌坊额枋：金地 + 朱红边框。 */
  archway_plaque: (b) => {
    b.seed(251).fill(P.crimsonDeep);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (x > 3*K && x < 28*K && y > 7*K && y < 25*K) {
          const t = (y - 7*K) / (18*K);
          b.set(x, y, mix(P.goldLit, P.gold, t));
        }
      }
    }
    for (let x = 0; x < S; x++) {
      b.set(x, 6*K, P.goldDeep);
      b.set(x, 25*K, P.goldDeep);
    }
    for (let y = 0; y < S; y++) {
      b.set(3*K, y, P.goldDeep);
      b.set(28*K, y, P.goldDeep);
    }
    // 匾额上的抽象笔画
    for (let k = 0; k < 3; k++) {
      const x0 = 8*K + k * 6*K;
      for (let y = 11*K; y < 21*K; y++) b.set(x0, y, P.crimsonDeep);
      for (let x = x0; x < x0 + 4*K; x++) b.set(x, 15*K, P.crimsonDeep);
    }
    grain(b, 0.03, 0.5);
  },

  /* ---------------- 杂项 ---------------- */
  wood_beam: (b) => {
    b.seed(260).fill(P.woodMid);
    for (let y = 0; y < S; y++) {
      const f = 0.9 + 0.2 * Math.sin(y * 0.9);
      for (let x = 0; x < S; x++) {
        const c = b.get(x, y);
        b.set(x, y, [c[0] * f, c[1] * f, c[2] * f]);
      }
    }
    grain(b, 0.05, 0.7);
    bevel(b, 0.12, 0.16);
  },

  /** 金砖地面（殿内）。 */
  gold_brick: (b) => {
    b.seed(261).fill(mix(P.bronze, P.goldDeep, 0.4));
    b.bricks(16*K, 16*K, P.ink4, 0.5);
    grain(b, 0.05, 0.7);
    bevel(b, 0.12, 0.14);
  },

  /** 发光方块（灯芯 / 夜明珠）。 */
  glow: (b) => {
    b.seed(262);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - 15.5*K, y - 15.5*K) / (16*K);
        b.set(x, y, mix(P.goldHot, P.lanternLit, Math.min(1, d * 1.4)));
      }
    }
    b.circle(S/2, S/2, 5*K, P.goldHot);
    grain(b, 0.02, 0.4);
  },
};
