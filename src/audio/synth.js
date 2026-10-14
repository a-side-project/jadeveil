/**
 * 音频合成原语。
 *
 * 全部声音都由 Web Audio 实时合成：零外部素材、零版权风险、离线可用。
 * 与画面一样走「程序化生成」路线 —— 这是体素沙盒的标准做法（Minecraft 的
 * 音效本身也是合成的）。
 */

/** 复用的白噪声缓冲（每个 AudioContext 一份）。 */
let _noiseCache = null;

export function getNoise(ctx) {
  if (!_noiseCache || _noiseCache.ctx !== ctx) {
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    _noiseCache = { ctx, buffer };
  }
  return _noiseCache.buffer;
}

/**
 * 一次性振荡器音。
 * @param {object} o
 *   dest 目标节点 · type 波形 · freq 起始频率 · freqEnd 结束频率(扫频)
 *   peak 峰值 · attack 起音 · release 释音 · detune 音分偏移
 */
export function osc(o) {
  const { ctx, dest } = o;
  const t = o.when ?? ctx.currentTime;
  const type = o.type || "sine";
  const freq = o.freq ?? 440;
  const peak = o.peak ?? 0.5;
  const attack = o.attack ?? 0.004;
  const release = o.release ?? 0.15;

  const src = ctx.createOscillator();
  src.type = type;
  src.frequency.setValueAtTime(freq, t);
  if (o.freqEnd !== undefined) {
    src.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + attack + release);
  }
  if (o.detune) src.detune.value = o.detune;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);

  src.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + attack + release + 0.05);
  return src;
}

/**
 * 一次性噪声脉冲（打击 / 破坏 / 摩擦的基底）。
 */
export function noiseBurst(o) {
  const { ctx, dest } = o;
  const t = o.when ?? ctx.currentTime;
  const peak = o.peak ?? 0.4;
  const attack = o.attack ?? 0.002;
  const release = o.release ?? 0.2;
  const dur = attack + release;

  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  src.loop = true;

  const f = ctx.createBiquadFilter();
  f.type = o.filterType || "lowpass";
  f.frequency.setValueAtTime(o.filterFreq ?? 1000, t);
  if (o.filterEnd !== undefined) {
    f.frequency.exponentialRampToValueAtTime(Math.max(20, o.filterEnd), t + dur);
  }
  f.Q.value = o.filterQ ?? 0.7;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
  return src;
}

/**
 * 简易卷积混响：用指数衰减噪声生成脉冲响应，返回 { input, output }。
 * 给弹拨/钟/鼓加空间感，营造「仙山云雾」的纵深。
 */
export function makeReverb(ctx, { seconds = 3.2, decay = 2.4, mix = 0.42 } = {}) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;

  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1 - mix;
  wet.gain.value = mix;
  input.connect(dry);
  input.connect(conv);
  conv.connect(wet);

  const output = ctx.createGain();
  dry.connect(output);
  wet.connect(output);
  return { input, output };
}

/**
 * Karplus–Strong 拨弦 —— 古筝/古琴质感。
 * 用一周期噪声做种子，经带低通反馈的延迟线形成谐振，brightness 控制亮暗。
 */
export function pluck(o) {
  const { ctx, dest } = o;
  const t = o.when ?? ctx.currentTime;
  const freq = o.freq ?? 440;
  const peak = o.peak ?? 0.35;
  const release = o.release ?? 1.8;
  const brightness = o.brightness ?? 0.6;

  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 1 / freq;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = freq * (4 + brightness * 11);

  const fb = ctx.createGain();
  fb.gain.setValueAtTime(0.985, t);
  fb.gain.linearRampToValueAtTime(0, t + release);

  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + release);

  const len = Math.max(2, Math.floor(ctx.sampleRate / freq));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const seed = ctx.createBufferSource();
  seed.buffer = buf;

  seed.connect(delay);
  delay.connect(lp);
  lp.connect(fb);
  fb.connect(delay);
  lp.connect(g);
  g.connect(dest);

  seed.start(t);
  seed.stop(t + 0.03);
  return g;
}
