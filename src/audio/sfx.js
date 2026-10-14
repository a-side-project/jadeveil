/**
 * 音效库 —— 全部由 Web Audio 实时合成。
 *
 * 每种材质有对应的破坏/放置/脚步音色；还有跳跃、落地、入水出水、
 * 划水、UI 交互、基岩阻挡等。dest 分「干声总线」与「混响输入」，
 * 需要空间感的音（碎裂、钟、入水）走混响，其余走干声。
 */
import { osc, noiseBurst } from "./synth.js";

/** 方块名 → 材质类别（决定音色）。 */
export function materialOf(name) {
  const n = name || "";
  if (/roof|gold|brick|ridge|eave|corner|lantern|glow|tassel/.test(n)) return "metal";
  if (/jade|marble/.test(n)) return "jade";
  if (/grass|leaf|flower|lotus|tuft|pine/.test(n)) return "plant";
  if (/water/.test(n)) return "water";
  if (/wood|beam|railing|bamboo/.test(n)) return "wood";
  if (/dirt|sand|earth/.test(n)) return "dirt";
  return "stone"; // 石/墙/岩/基岩/石狮等一律按硬质处理
}

export class SFX {
  constructor(ctx, { dry, wet }) {
    this.ctx = ctx;
    this.dry = dry; // 干声总线
    this.wet = wet; // 混响输入（会经混响回到总线）
  }

  /** 破坏方块：材质决定音色。 */
  breakBlock(name) {
    const m = materialOf(name);
    const { ctx, dry } = this;
    if (m === "wood") {
      noiseBurst({ ctx, dest: dry, peak: 0.42, release: 0.10, filterType: "bandpass", filterFreq: 1250, filterQ: 1.2 });
      osc({ ctx, dest: dry, type: "triangle", freq: 200, freqEnd: 95, peak: 0.26, release: 0.10 });
    } else if (m === "plant") {
      noiseBurst({ ctx, dest: dry, peak: 0.22, release: 0.22, filterType: "highpass", filterFreq: 2400 });
    } else if (m === "jade") {
      noiseBurst({ ctx, dest: dry, peak: 0.4, release: 0.28, filterType: "highpass", filterFreq: 3200, filterQ: 2 });
      noiseBurst({ ctx, dest: dry, peak: 0.2, release: 0.14, filterType: "bandpass", filterFreq: 5200, filterQ: 6 });
      osc({ ctx, dest: this.wet, type: "sine", freq: 1320, freqEnd: 860, peak: 0.08, release: 0.5 });
    } else if (m === "metal") {
      noiseBurst({ ctx, dest: dry, peak: 0.36, release: 0.2, filterType: "bandpass", filterFreq: 2200, filterQ: 3 });
      osc({ ctx, dest: this.wet, type: "triangle", freq: 620, freqEnd: 300, peak: 0.12, release: 0.6 });
    } else if (m === "dirt") {
      noiseBurst({ ctx, dest: dry, peak: 0.35, release: 0.14, filterType: "lowpass", filterFreq: 620, filterEnd: 220 });
      osc({ ctx, dest: dry, type: "sine", freq: 130, freqEnd: 60, peak: 0.28, release: 0.12 });
    } else {
      // 石/墙/岩：沉而脆的碎裂
      noiseBurst({ ctx, dest: dry, peak: 0.5, release: 0.16, filterType: "lowpass", filterFreq: 950, filterEnd: 320 });
      osc({ ctx, dest: dry, type: "sine", freq: 118, freqEnd: 55, peak: 0.38, release: 0.14 });
      noiseBurst({ ctx, dest: this.wet, peak: 0.12, release: 0.3, filterType: "highpass", filterFreq: 1800 });
    }
  }

  /** 放置方块：短促的「咚」。 */
  placeBlock(name) {
    const m = materialOf(name);
    const { ctx, dry } = this;
    const base = m === "wood" ? 160 : 122;
    noiseBurst({ ctx, dest: dry, peak: 0.3, release: 0.07, filterType: "lowpass", filterFreq: m === "wood" ? 720 : 1000, filterEnd: 300 });
    osc({ ctx, dest: dry, type: "sine", freq: base, freqEnd: base * 0.55, peak: 0.3, release: 0.09 });
  }

  /** 脚步：surface 为方块名或已分类材质。 */
  footstep(surface, running) {
    const { ctx, dry } = this;
    const p = running ? 0.5 : 0.32;
    if (surface === "water") {
      noiseBurst({ ctx, dest: dry, peak: 0.18, release: 0.12, filterType: "lowpass", filterFreq: 620 });
      return;
    }
    const m = materialOf(surface);
    if (m === "plant" || m === "dirt") {
      noiseBurst({ ctx, dest: dry, peak: p * 0.55, release: 0.07, filterType: "lowpass", filterFreq: 520, filterEnd: 200 });
    } else if (m === "wood") {
      noiseBurst({ ctx, dest: dry, peak: p, release: 0.06, filterType: "bandpass", filterFreq: 920, filterQ: 1 });
    } else if (m === "stone") {
      noiseBurst({ ctx, dest: dry, peak: p * 0.85, release: 0.05, filterType: "lowpass", filterFreq: 1450 });
      osc({ ctx, dest: dry, type: "sine", freq: 150, freqEnd: 80, peak: p * 0.3, release: 0.05 });
    } else {
      noiseBurst({ ctx, dest: dry, peak: p * 0.7, release: 0.06, filterType: "lowpass", filterFreq: 1150 });
    }
  }

  jump() {
    osc({ ctx: this.ctx, dest: this.dry, type: "sine", freq: 250, freqEnd: 430, peak: 0.11, release: 0.12 });
  }

  /** 落地：fall 为下落高度，越大越响。 */
  land(fall) {
    const hard = Math.min(1, fall / 12);
    noiseBurst({ ctx: this.ctx, dest: this.dry, peak: 0.2 + hard * 0.42, release: 0.1 + hard * 0.1, filterType: "lowpass", filterFreq: 720, filterEnd: 240 });
    osc({ ctx: this.ctx, dest: this.dry, type: "sine", freq: 124, freqEnd: 60, peak: 0.15 + hard * 0.2, release: 0.1 });
  }

  /** 入水 / 出水。 */
  splash(kind) {
    const { ctx, dry } = this;
    if (kind === "enter") {
      noiseBurst({ ctx, dest: this.wet, peak: 0.6, release: 0.5, filterType: "lowpass", filterFreq: 1900, filterEnd: 320 });
      noiseBurst({ ctx, dest: dry, peak: 0.24, release: 0.2, filterType: "highpass", filterFreq: 1500 });
      osc({ ctx, dest: dry, type: "sine", freq: 320, freqEnd: 120, peak: 0.1, release: 0.25 });
    } else {
      noiseBurst({ ctx, dest: dry, peak: 0.3, release: 0.26, filterType: "lowpass", filterFreq: 1200, filterEnd: 300 });
      noiseBurst({ ctx, dest: dry, peak: 0.16, release: 0.16, filterType: "highpass", filterFreq: 2000 });
    }
  }

  /** 划水：带通噪声的水流声。 */
  swimStroke() {
    noiseBurst({ ctx: this.ctx, dest: this.dry, peak: 0.16, release: 0.22, filterType: "bandpass", filterFreq: 720, filterQ: 0.8 });
  }

  /** 水下气泡（入水潜水瞬间）。 */
  bubble() {
    const { ctx, dry } = this;
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        osc({ ctx, dest: dry, type: "sine", freq: 300 + Math.random() * 500, freqEnd: 700 + Math.random() * 500, peak: 0.05, release: 0.08 });
      }, i * 70);
    }
  }

  /* ---------------- UI ---------------- */
  uiClick() {
    osc({ ctx: this.ctx, dest: this.dry, type: "square", freq: 900, peak: 0.07, release: 0.04 });
  }
  uiHover() {
    osc({ ctx: this.ctx, dest: this.dry, type: "sine", freq: 700, peak: 0.035, release: 0.03 });
  }
  uiSelect() {
    osc({ ctx: this.ctx, dest: this.dry, type: "sine", freq: 660, peak: 0.07, release: 0.08 });
    osc({ ctx: this.ctx, dest: this.wet, type: "sine", freq: 990, peak: 0.05, release: 0.25 });
  }
  blocked() {
    osc({ ctx: this.ctx, dest: this.dry, type: "square", freq: 165, peak: 0.09, release: 0.09 });
    osc({ ctx: this.ctx, dest: this.dry, type: "square", freq: 118, peak: 0.07, release: 0.09 });
  }
}
