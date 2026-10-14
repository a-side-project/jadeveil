/**
 * 生成式背景音乐 —— 实时合成、永不重复循环。
 *
 * 层次（潘达利亚·雾与玉）：
 *   · 持续低音 drone（D2 + 低五度），带慢呼吸 LFO —— 大地的底
 *   · 弦乐般的 detuned saw pad，慢速滤波扫频 —— 云雾弥漫
 *   · 太鼓（低音噪声 + 下扫正弦），每 4 秒一击 —— 仪式感
 *   · 铜锣（非谐泛音群 + 长混响），每 24 秒一下 —— 气势
 *   · 古筝式拨弦（Karplus–Strong）在五声音阶上随机游走 —— 东方旋律
 *   · 风声（低通噪声慢 LFO）—— 环境
 *
 * 随昼夜变化：夜里更稀疏、更收敛、更暗。
 */
import { osc, noiseBurst, pluck, getNoise } from "./synth.js";

const ROOT = 73.42; // D2
const SCALE = [0, 2, 4, 7, 9]; // D 大调五声：D E F# A B
const hz = (deg, oct) => ROOT * Math.pow(2, oct + deg / 12);

export class Music {
  /** @param {AudioContext} ctx @param {AudioNode} dest 音乐总线 @param {AudioNode} wet 混响输入 */
  constructor(ctx, dest, wet) {
    this.ctx = ctx;
    this.dest = dest;
    this.wet = wet;
    this.night = 0;
    this._started = false;
    this._beatIndex = 0;
    this._step = 0.5;
    this._next = 0;
    this._mIdx = 4;
  }

  _build() {
    const ctx = this.ctx;

    this.gain = ctx.createGain();
    this.gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.gain.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 3.0); // 渐入
    this.gain.connect(this.dest);

    // 1. drone：D2 + 低五度，慢呼吸
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.15;
    droneGain.connect(this.gain);
    const droneLP = ctx.createBiquadFilter();
    droneLP.type = "lowpass";
    droneLP.frequency.value = 300;
    droneLP.connect(droneGain);
    for (const f of [hz(0, 0), hz(7, -1)]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(droneLP);
      o.start();
    }
    const droneLFO = ctx.createOscillator();
    droneLFO.frequency.value = 0.05;
    const droneLFOg = ctx.createGain();
    droneLFOg.gain.value = 0.05;
    droneLFO.connect(droneLFOg);
    droneLFOg.connect(droneGain.gain);
    droneLFO.start();

    // 2. pad：detuned saws + 慢速低通扫频
    const padGain = ctx.createGain();
    padGain.gain.value = 0.05;
    padGain.connect(this.gain);
    const padLP = ctx.createBiquadFilter();
    padLP.type = "lowpass";
    padLP.frequency.value = 760;
    padLP.Q.value = 0.5;
    padLP.connect(padGain);
    for (const [deg, oct, det] of [[0, 1, -7], [0, 1, 7], [7, 1, -5], [7, 1, 5]]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz(deg, oct);
      o.detune.value = det;
      o.connect(padLP);
      o.start();
    }
    const padLFO = ctx.createOscillator();
    padLFO.frequency.value = 0.07;
    const padLFOg = ctx.createGain();
    padLFOg.gain.value = 260;
    padLFO.connect(padLFOg);
    padLFOg.connect(padLP.frequency);
    padLFO.start();

    // 3. 风声
    const windGain = ctx.createGain();
    windGain.gain.value = 0.02;
    windGain.connect(this.gain);
    const windLP = ctx.createBiquadFilter();
    windLP.type = "lowpass";
    windLP.frequency.value = 520;
    windLP.connect(windGain);
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = getNoise(ctx);
    windSrc.loop = true;
    windSrc.connect(windLP);
    windSrc.start();
    const windLFO = ctx.createOscillator();
    windLFO.frequency.value = 0.11;
    const windLFOg = ctx.createGain();
    windLFOg.gain.value = 0.014;
    windLFO.connect(windLFOg);
    windLFOg.connect(windGain.gain);
    windLFO.start();

    this._c = { droneGain, padLP, padGain, windGain };
  }

  _taiko(t, amp) {
    const ctx = this.ctx;
    noiseBurst({ ctx, dest: this.gain, when: t, peak: amp * 0.5, attack: 0.002, release: 0.35, filterType: "lowpass", filterFreq: 320, filterEnd: 60 });
    osc({ ctx, dest: this.gain, when: t, type: "sine", freq: 92, freqEnd: 38, peak: amp * 0.55, attack: 0.002, release: 0.4 });
  }

  _gong(t) {
    const ctx = this.ctx;
    const partials = [1, 1.35, 1.73, 2.21, 2.85, 3.6];
    for (const p of partials) {
      osc({ ctx, dest: this.wet, when: t, type: "sine", freq: 130.81 * p, peak: 0.055 / p, attack: 0.005, release: 3.6 });
    }
    noiseBurst({ ctx, dest: this.wet, when: t, peak: 0.07, attack: 0.003, release: 0.5, filterType: "bandpass", filterFreq: 2100, filterQ: 2 });
  }

  _melodyNote(t) {
    const ctx = this.ctx;
    // 五声音阶上随机游走，偶有跳进，总体在小范围徘徊
    this._mIdx = Math.max(0, Math.min(SCALE.length * 2 - 1, this._mIdx + (Math.floor(Math.random() * 5) - 2)));
    const oct = this._mIdx < SCALE.length ? 1 : 2;
    const deg = SCALE[this._mIdx % SCALE.length];
    pluck({ ctx, dest: this.wet, when: t, freq: hz(deg, oct), peak: 0.11, release: 2.2, brightness: 0.42 });
  }

  _beat(t, i) {
    const busy = 1 - this.night; // 夜里更稀疏
    if (i % 8 === 0) this._taiko(t, 0.5);
    else if (i % 8 === 4 && Math.random() < 0.3 * busy) this._taiko(t, 0.24);
    if (i % 48 === 0) this._gong(t);
    if (Math.random() < 0.30 * (0.4 + 0.6 * busy)) this._melodyNote(t);
  }

  _tick() {
    while (this._next < this.ctx.currentTime + 0.4) {
      this._beat(this._next, this._beatIndex);
      this._beatIndex++;
      this._next += this._step;
    }
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._build();
    this._next = this.ctx.currentTime + 0.15;
    this._timer = setInterval(() => this._tick(), 120);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  update(night) {
    if (!this._started || !this._c) return;
    this.night = night;
    const t = this.ctx.currentTime;
    this._c.padLP.frequency.setTargetAtTime(900 - night * 520, t, 1.0);
    this._c.padGain.gain.setTargetAtTime(0.05 - night * 0.022, t, 1.0);
    this._c.droneGain.gain.setTargetAtTime(0.15 - night * 0.05, t, 1.0);
    this._c.windGain.gain.setTargetAtTime(0.02 + night * 0.012, t, 1.0);
  }
}
