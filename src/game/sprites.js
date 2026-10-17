/**
 * 16×16 物品像素图 —— 武器 / 火把等非方块物品。
 *
 * 和方块贴图一样逐像素程序化绘制（零外链），同一份像素数据同时用于：
 *   · 背包 / 快捷栏图标（canvas）
 *   · 手持 3D 模型（extrudeSprite：每个像素挤出成 1/16 格厚的小方块，
 *     即 Minecraft 的「物品模型」做法）
 *
 * 像素格式：grid[y][x] = { c: "#rrggbb", glow?: true } | null
 * glow 像素在 3D 里走选择性泛光（极品武器的刃光、火把的火苗）。
 */
import * as THREE from "three";

const S = 16;

function blank() {
  return Array.from({ length: S }, () => new Array(S).fill(null));
}

const put = (g, x, y, c, glow = false) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  g[y][x] = { c, glow };
};

/**
 * Minecraft 式对角剑：刃沿 x+y=15 从护手斜伸到右上角。
 * 刃宽 3 像素（亮边 / 中 / 暗边）+ 1 像素描边，护手垂直于刃，握把与剑首在左下。
 */
function sword({ edge, mid, dark, outline, guard, guardDark, grip, gripDark, glowBlade = false }) {
  const g = blank();
  // 刃：沿 s = x + y = 15，x 从 6 到 14
  for (let x = 5; x <= 14; x++) {
    const y = 15 - x;
    put(g, x, y - 1, edge); // s=14 亮边（左上）
    put(g, x, y, mid, glowBlade); // s=15 中线（极品武器：只有这一道能量芯发光）
    if (x < 14) put(g, x + 1, y, dark); // s=16 暗边（右下）
  }
  // 剑尖收口 + 描边
  for (let x = 5; x <= 14; x++) {
    const y = 15 - x;
    for (const [ox, oy] of [[-1, -1], [0, -2], [1, 1], [2, 0]]) {
      const px = x + ox, py = y + oy;
      if (px >= 0 && py >= 0 && px < S && py < S && !g[py][px]) put(g, px, py, outline);
    }
  }
  put(g, 15, 0, outline);
  put(g, 14, 0, outline);
  put(g, 15, 1, outline);
  // 护手：沿 x - y = -6 方向（垂直于刃）
  for (let k = -2; k <= 2; k++) {
    put(g, 4 + k, 10 + k, k === 0 ? guard : (Math.abs(k) === 2 ? guardDark : guard));
  }
  put(g, 2, 7, outline); put(g, 7, 12, outline);
  // 握把：沿 s = 15 继续向左下
  for (let x = 1; x <= 3; x++) {
    put(g, x, 15 - x - 1, x === 2 ? grip : gripDark);
    put(g, x, 15 - x, grip);
  }
  // 剑首
  put(g, 0, 15, guardDark);
  put(g, 0, 14, guard);
  put(g, 1, 15, guard);
  return g;
}

/** 火把：木柄 + 顶端火苗（火苗走泛光）。 */
function torch() {
  const g = blank();
  for (let y = 7; y <= 15; y++) {
    put(g, 7, y, y % 3 === 0 ? "#5a3a1c" : "#7a5228");
    put(g, 8, y, y % 3 === 1 ? "#4a2e15" : "#694421");
  }
  // 火苗：外焰橙、内焰黄、焰心近白
  const flame = [
    [7, 2, "#ff9a2e"], [8, 2, "#ffb347"],
    [6, 3, "#ff7a1a"], [7, 3, "#ffd15c"], [8, 3, "#ffd15c"], [9, 3, "#ff7a1a"],
    [6, 4, "#ff8a24"], [7, 4, "#fff2b0"], [8, 4, "#ffe680"], [9, 4, "#ff8a24"],
    [6, 5, "#ff9a2e"], [7, 5, "#ffe680"], [8, 5, "#fff2b0"], [9, 5, "#ff9a2e"],
    [7, 6, "#ffb347"], [8, 6, "#ff9a2e"],
  ];
  for (const [x, y, c] of flame) put(g, x, y, c, true);
  return g;
}

export const SPRITES = {
  sword_wood: sword({
    edge: "#c8a06a", mid: "#a47a45", dark: "#6e4f2a", outline: "#2a1d10",
    guard: "#6e4f2a", guardDark: "#4a3519", grip: "#5a3d1e", gripDark: "#3d2912",
  }),
  sword_stone: sword({
    edge: "#c9ccd0", mid: "#9a9ea4", dark: "#62666c", outline: "#1f2226",
    guard: "#6e4f2a", guardDark: "#4a3519", grip: "#5a3d1e", gripDark: "#3d2912",
  }),
  // 玉剑：极品武器 —— 青玉刃 + 金护手，刃身发光
  sword_jade: sword({
    edge: "#c9fff0", mid: "#5fe3c0", dark: "#1f8f78", outline: "#0b3b33",
    guard: "#ffd47a", guardDark: "#b07d22", grip: "#8e2a20", gripDark: "#5c1a13",
    glowBlade: true,
  }),
  torch: torch(),
};

/** 像素图 → canvas（背包图标）。 */
export function spriteCanvas(name, size = 64) {
  const g = SPRITES[name];
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const k = size / S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = g[y][x];
      if (!p) continue;
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(x * k), Math.round(y * k), Math.ceil(k), Math.ceil(k));
    }
  }
  return c;
}

/**
 * 像素图 → 挤出的 3D 物品模型（Minecraft 物品模型做法）。
 * 每个不透明像素是一个 1/16 × 1/16 × 1/16 的小方块，只生成暴露面。
 * 返回 { base, glow } 两份几何（glow 可能为 null），模型宽 1 单位、以中心为原点。
 */
export function extrudeSprite(name) {
  const g = SPRITES[name];
  const px = 1 / S;
  const half = px / 2;
  const make = () => ({ pos: [], norm: [], col: [], idx: [] });
  const out = { base: make(), glow: make() };
  const color = new THREE.Color();
  const filled = (x, y) => x >= 0 && y >= 0 && x < S && y < S && !!g[y][x];

  const quad = (b, corners, n, c) => {
    const base = b.pos.length / 3;
    for (const v of corners) {
      b.pos.push(v[0], v[1], v[2]);
      b.norm.push(n[0], n[1], n[2]);
      b.col.push(c.r, c.g, c.b);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = g[y][x];
      if (!p) continue;
      const b = p.glow ? out.glow : out.base;
      // Color.set 会按 ColorManagement 把 sRGB 十六进制转到线性工作空间
      color.set(p.c);
      // 像素坐标 → 模型坐标：x 向右、y 向上，中心为原点
      const x0 = x * px - 0.5, x1 = x0 + px;
      const y1 = 0.5 - y * px, y0 = y1 - px;
      const z0 = -half, z1 = half;
      quad(b, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], color);
      quad(b, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], color);
      // 侧面稍暗，挤出厚度才读得出来
      const side = color.clone().multiplyScalar(0.72);
      if (!filled(x - 1, y)) quad(b, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], side);
      if (!filled(x + 1, y)) quad(b, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], side);
      if (!filled(x, y - 1)) quad(b, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], side);
      if (!filled(x, y + 1)) quad(b, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], side);
    }
  }

  const build = (b) => {
    if (!b.idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(b.norm, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
    geo.setIndex(b.idx);
    geo.computeBoundingSphere();
    return geo;
  };
  return { base: build(out.base), glow: build(out.glow) };
}
