/**
 * 画质系统 —— 档位、设备分级、自动降档。
 *
 * 档位只描述「要什么」，真正的开关由 apply() 落到渲染器 / 区块 / 粒子上：
 *   pixelRatio   渲染分辨率上限（Retina 屏上 2 = 4 倍像素，是低端机最大的开销）
 *   shadows      太阳阴影（每帧多渲染一遍场景）
 *   bloom        选择性泛光（每帧多渲染一遍场景）
 *   godrays      体积光（每帧多渲染一遍 1/4 分辨率的遮罩）
 *   reflections  水面平面反射（每帧多渲染一遍场景）
 *   viewDistance 区块视距
 *   particles    环境粒子密度 0..1
 *
 * 高配机器默认就是满级（ULTRA）：设备分级只决定起点，AUTO 模式下帧率持续偏低才往下降一档，
 * 降档时会提示玩家可以在设置里自己调。
 */

export const TIERS = ["low", "medium", "high", "ultra"];

export const PRESETS = {
  low: {
    pixelRatio: 1, shadows: false, shadowMap: 1024, bloom: false, godrays: false, reflections: false,
    reflectScale: 0.35, viewDistance: 4, cullDistance: 90, particles: 0.3,
  },
  medium: {
    pixelRatio: 1, shadows: true, shadowMap: 1024, bloom: true, godrays: false, reflections: true,
    reflectScale: 0.35, viewDistance: 5, cullDistance: 110, particles: 0.6,
  },
  high: {
    pixelRatio: 1.5, shadows: true, shadowMap: 2048, bloom: true, godrays: true, reflections: true,
    reflectScale: 0.5, viewDistance: 7, cullDistance: 170, particles: 1,
  },
  ultra: {
    pixelRatio: 2, shadows: true, shadowMap: 4096, bloom: true, godrays: true, reflections: true,
    reflectScale: 0.6, viewDistance: 9, cullDistance: 230, particles: 1,
  },
};

/** 玩家可以单独开关的效果（覆盖档位默认值）。 */
export const TOGGLES = ["shadows", "bloom", "godrays", "reflections"];

const STORE = "jadeveil.graphics.v1";

/**
 * 设备分级：根据 GPU 型号、内存、是否触屏，给出 AUTO 模式的起点。
 * 只用于起点；真正的判据是 AutoGovernor 实测的帧率。
 */
export function detectTier(gl) {
  let gpu = "";
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { /* 部分浏览器禁止读取 */ }
  const g = gpu.toLowerCase();
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const phone = coarse && Math.min(screen.width, screen.height) < 600;

  let tier;
  if (/swiftshader|llvmpipe|software|microsoft basic/.test(g)) tier = "low";
  else if (coarse) {
    // 平板 / 手机：Apple 芯片与新款 Adreno / Mali-G7xx 能撑中档，其余低档；
    // 手机屏幕小、发热降频快，内存不足 6GB 的一律从低档起步
    const strong = /apple|adreno \(tm\) (7|8)\d\d|mali-g7\d|immortalis/.test(g);
    tier = strong && !(phone && mem < 6) ? "medium" : "low";
  } else if (/apple m\d|apple gpu/.test(g)) tier = "ultra";
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc a\d/.test(g)) tier = "ultra";
  else if (/iris|radeon(\(tm\))? graphics|radeon vega/.test(g)) tier = "medium";
  else if (/intel|uhd|hd graphics|mali|adreno|powervr/.test(g)) tier = "medium";
  else tier = "high";

  // 内存 / 核数兜底：小内存机器不给高档
  if (mem <= 2 || cores <= 2) tier = "low";
  else if (mem <= 4 && TIERS.indexOf(tier) > 1) tier = "medium";

  return { tier, gpu: gpu || "UNKNOWN GPU", touch: coarse };
}

/**
 * 画质状态：mode = "auto" | 档位名；overrides 是玩家单独改过的开关。
 * 持久化到 localStorage（读写失败时只是不记住，不影响游戏）。
 */
export class GraphicsSettings {
  constructor(detected) {
    this.detected = detected;
    this.mode = "auto";
    this.autoTier = detected.tier;
    this.overrides = {};
    this.fov = 72;
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (s && (s.mode === "auto" || PRESETS[s.mode])) this.mode = s.mode;
      if (s && s.overrides && typeof s.overrides === "object") {
        for (const k of TOGGLES) if (typeof s.overrides[k] === "boolean") this.overrides[k] = s.overrides[k];
      }
      // 上次自动降过档：这次从记录档位往上试一档（机器其实够快 / 上次只是临时很忙时能自己恢复），
      // 真的慢的话 8 秒内会再降回去
      if (s && PRESETS[s.autoTier]) {
        const i = Math.min(TIERS.indexOf(detected.tier), TIERS.indexOf(s.autoTier) + 1);
        this.autoTier = TIERS[i];
      }
      if (s && Number.isFinite(s.fov)) this.fov = Math.max(55, Math.min(100, s.fov));
    } catch { /* 无存储 */ }
    // ?quality=low|medium|high|ultra|auto 强制档位（排查 / 自动化验收用，不写回存储）
    const q = new URLSearchParams(location.search).get("quality");
    if (q && (q === "auto" || PRESETS[q])) { this.mode = q; this._forced = true; }
  }

  get tier() {
    return this.mode === "auto" ? this.autoTier : this.mode;
  }

  /** 当前生效的完整配置（档位默认值 + 玩家开关）。 */
  get profile() {
    return { ...PRESETS[this.tier], ...this.overrides, tier: this.tier };
  }

  setMode(mode) {
    this.mode = mode;
    // 换档位 = 重新采用该档位的全部默认值（与主流游戏一致）
    this.overrides = {};
    if (mode === "auto") this.autoTier = this.detected.tier;
    this.save();
  }

  setToggle(name, on) {
    this.overrides[name] = on;
    this.save();
  }

  save() {
    if (this._forced) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ mode: this.mode, overrides: this.overrides, autoTier: this.autoTier, fov: this.fov }));
    } catch { /* 无存储 */ }
  }
}

/**
 * 自动画质：AUTO 模式下按 4 秒窗口统计帧时间，连续两个窗口的中位数都低于 45 FPS 才降一档。
 *
 *  · 降档后能自己升回来：连续 20 秒（5 个窗口）中位帧率都有余量（≥ 57 FPS）就升一档，最多回到检测出的档位。
 *    一次临时的卡顿（后台在编译、别的程序占满 GPU）不会让画质一直停在低档、视距只剩一小圈
 *  · 防抖：升上去又被打回来，下一次升档要等的时间翻倍（20 → 40 → 80 秒…）
 *  · 连续两个慢窗口才算数：读档、区块重建这类短暂卡顿不会把画质拉低
 *  · 窗口内中位帧时间 > 200ms 视为「标签页被节流 / 在后台」，不算 GPU 慢；
 *    窗口不在前台、正在跑自动化测试时不统计
 *  · 刚换档后先等 3 秒让着色器编译、区块重建完成再开始统计
 */
export class AutoGovernor {
  constructor(settings, onDowngrade) {
    this.settings = settings;
    this.onDowngrade = onDowngrade;
    this.samples = [];
    this.windowT = 0;
    this.settle = 6; // 首次统计前等待（开局加载、编译）
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.upgradeWindows = 5; // 连续多少个有余量的窗口才升档（被打回来后翻倍）
    this._justUpgraded = false;
    this.onUpgrade = null;
    // 窗口是否在前台（可替换：自动化测试里窗口通常不在前台）
    this.focused = () => document.hasFocus();
  }

  reset(settle = 3) {
    this.samples.length = 0;
    this.windowT = 0;
    this.settle = settle;
  }

  /**
   * @param {number} rawDt 真实帧间隔（不能用主循环里被截到 0.1s 的 dt，否则长任务会被误判成 10 FPS）
   * @param {boolean} measurable 当前是否适合测量（游戏 / 标题页，且窗口在前台）
   */
  update(rawDt, measurable = true) {
    if (this.settings.mode !== "auto") return;
    if (!measurable || document.visibilityState !== "visible" || !this.focused()) { this.reset(1); return; }
    const dt = rawDt;
    if (this.settle > 0) { this.settle -= dt; return; }
    this.samples.push(dt);
    this.windowT += dt;
    if (this.windowT < 4) return;
    const s = this.samples.slice().sort((a, b) => a - b);
    const median = s[s.length >> 1];
    this.reset(0);
    if (median > 0.2) { this.slowWindows = 0; this.fastWindows = 0; return; } // 被节流，不是真的慢
    const i = TIERS.indexOf(this.settings.autoTier);
    if (median <= 1 / 45) {
      this.slowWindows = 0;
      const ceiling = TIERS.indexOf(this.settings.detected?.tier ?? TIERS[TIERS.length - 1]);
      this.fastWindows = median <= 1 / 57 ? this.fastWindows + 1 : 0;
      if (this.fastWindows < this.upgradeWindows || i >= ceiling) return;
      this.fastWindows = 0;
      this.settings.autoTier = TIERS[i + 1];
      this.settings.save();
      this._justUpgraded = true;
      this.reset(3);
      this.onUpgrade?.(this.settings.autoTier);
      return;
    }
    this.fastWindows = 0;
    if (++this.slowWindows < 2) return;
    this.slowWindows = 0;
    if (i <= 0) return;
    // 刚升上来又撑不住：下次升档要多等一倍
    if (this._justUpgraded) this.upgradeWindows *= 2;
    this._justUpgraded = false;
    this.settings.autoTier = TIERS[i - 1];
    this.settings.save();
    this.reset(3);
    this.onDowngrade?.(this.settings.autoTier, Math.round(1 / median));
  }
}
