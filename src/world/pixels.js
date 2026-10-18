/**
 * 逐像素绘制工具 —— 所有方块贴图都由代码生成，不依赖任何外链图片。
 * Bitmap 是最小单位：一个 TILE×TILE 的 RGBA 画布。
 */
import { mulberry32 } from "../core/noise.js";

export function hex(h) {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function lighten(c, t) {
  return [c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t];
}

export function darken(c, t) {
  return [c[0] * (1 - t), c[1] * (1 - t), c[2] * (1 - t)];
}

/** 轻微色相偏移，避免同色系糊成一片。 */
export function tint(c, dr, dg, db) {
  return [c[0] + dr, c[1] + dg, c[2] + db];
}

export class Bitmap {
  constructor(size) {
    this.size = size;
    this.data = new Uint8ClampedArray(size * size * 4);
    this.rnd = mulberry32(0x9e3779b9);
  }

  seed(n) {
    this.rnd = mulberry32(n >>> 0);
    return this;
  }

  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return this;
    const i = (y * this.size + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
    return this;
  }

  get(x, y) {
    const i = ((y % this.size + this.size) % this.size * this.size +
      ((x % this.size) + this.size) % this.size) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /** 整块填色。 */
  fill(c, a = 255) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) this.set(x, y, c, a);
    return this;
  }

  rect(x, y, w, h, c, a = 255) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c, a);
    return this;
  }

  /** 只描边。 */
  frame(x, y, w, h, c, a = 255) {
    for (let i = x; i < x + w; i++) {
      this.set(i, y, c, a);
      this.set(i, y + h - 1, c, a);
    }
    for (let j = y; j < y + h; j++) {
      this.set(x, j, c, a);
      this.set(x + w - 1, j, c, a);
    }
    return this;
  }

  hline(x, y, w, c, a = 255) {
    for (let i = x; i < x + w; i++) this.set(i, y, c, a);
    return this;
  }

  vline(x, y, h, c, a = 255) {
    for (let j = y; j < y + h; j++) this.set(x, j, c, a);
    return this;
  }

  /** 每像素加一点噪声色偏 —— 像素画“手绘感”的关键。 */
  speckle(base, amount, opts = {}) {
    const { density = 1, warm = 0.35 } = opts;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.rnd() > density) continue;
        const n = (this.rnd() * 2 - 1) * amount;
        const c = this.get(x, y);
        const warmBias = n * warm;
        this.set(x, y, [
          c[0] + n * 255 + warmBias * 24,
          c[1] + n * 255 + warmBias * 8,
          c[2] + n * 255 - warmBias * 10,
        ], c[3]);
      }
    }
    return this;
  }

  /** 顶部高光 / 底部阴影，模拟体素块的自遮蔽。 */
  verticalRamp(topLight, bottomDark) {
    for (let y = 0; y < this.size; y++) {
      const t = y / (this.size - 1);
      const f = t < 0.5 ? 1 + topLight * (1 - t * 2) : 1 - bottomDark * ((t - 0.5) * 2);
      for (let x = 0; x < this.size; x++) {
        const c = this.get(x, y);
        this.set(x, y, [c[0] * f, c[1] * f, c[2] * f], c[3]);
      }
    }
    return this;
  }

  /** 像素级描边（四邻域外轮廓）。 */
  outline(c, a = 255, inset = false) {
    const copy = new Uint8ClampedArray(this.data);
    const alpha = (x, y) => {
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) return 0;
      return copy[(y * this.size + x) * 4 + 3];
    };
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const self = alpha(x, y);
        const around = alpha(x - 1, y) + alpha(x + 1, y) + alpha(x, y - 1) + alpha(x, y + 1);
        // 内描边：形状里紧挨着「完全透明」像素的那一圈。旧版用「四邻 alpha 之和不满」判断，
        // 形状内部的半透明像素（灯笼中心的暖光）也被当成边缘涂成了暗红
        const touchesEmpty = alpha(x - 1, y) === 0 || alpha(x + 1, y) === 0 || alpha(x, y - 1) === 0 || alpha(x, y + 1) === 0;
        if (inset ? self > 0 && touchesEmpty : self === 0 && around > 0) {
          this.set(x, y, c, a);
        }
      }
    }
    return this;
  }

  /** 简易砖缝图案。 */
  bricks(brickW, brickH, mortar, offset = 0.5) {
    for (let y = 0; y < this.size; y++) {
      const row = Math.floor(y / brickH);
      const shift = row % 2 === 0 ? 0 : Math.round(brickW * offset);
      if (y % brickH === 0) {
        for (let x = 0; x < this.size; x++) this.set(x, y, mortar);
      }
      for (let x = 0; x < this.size; x++) {
        if ((x + shift) % brickW === 0) this.set(x, y, mortar);
      }
    }
    return this;
  }

  /** 圆角矩形填充（用于灯笼、瓦当等）。 */
  circle(cx, cy, r, c, a = 255) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r) {
          const soft = d > r - 1 ? 0.72 : 1;
          this.set(x, y, c, a * soft);
        }
      }
    }
    return this;
  }

  /** 读回一个 tile 的原始像素（供图集拼装用）。 */
  copyInto(target, dx, dy) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const i = (y * this.size + x) * 4;
        const o = ((dy + y) * target.width + (dx + x)) * 4;
        target.data[o] = this.data[i];
        target.data[o + 1] = this.data[i + 1];
        target.data[o + 2] = this.data[i + 2];
        target.data[o + 3] = this.data[i + 3];
      }
    }
  }
}
