/**
 * 输入路由 —— 所有离散按键动作的唯一入口。
 *
 * 每条绑定声明：哪些键、在什么情境下生效（when）、按住时的自动重复是否触发（repeat）、做什么（run）。
 * 按顺序匹配，第一条命中的绑定独占这次按键 —— 同一个键不会被两处代码各处理一遍
 * （旧版 E / O 在三个监听器里各写一遍，按住 E 背包会以键盘重复速率开关）。
 *
 * 持续性的移动键（WASD、空格、Shift、C）仍由玩家控制器以「按住集合」读取，那是轴输入，不在这里。
 *
 * 情境 ctx：{ mode, settingsOpen, mounted, gameMode, engaged, dead }
 */
export class InputRouter {
  constructor(getCtx) {
    this.getCtx = getCtx;
    this.bindings = [];
    this.upBindings = [];
    window.addEventListener("keydown", (e) => this._dispatch(e, this.bindings, true));
    window.addEventListener("keyup", (e) => this._dispatch(e, this.upBindings, false));
  }

  /**
   * @param {object} b { name, keys: string[], when?: (ctx) => boolean, repeat?: boolean, run: (ctx, e) => any, preventDefault?: boolean }
   */
  bind(b) {
    this.bindings.push(b);
    return this;
  }

  /** 松开按键的动作（例如松开 1 停止龙息）。 */
  bindUp(b) {
    this.upBindings.push(b);
    return this;
  }

  _dispatch(e, list, down) {
    const ctx = this.getCtx();
    for (const b of list) {
      if (!b.keys.includes(e.code)) continue;
      if (b.when && !b.when(ctx)) continue;
      if (down && e.repeat && !b.repeat) {
        // 自动重复：吞掉（不让后面的绑定再处理同一次按键）
        if (b.preventDefault) e.preventDefault();
        return;
      }
      if (b.preventDefault) e.preventDefault();
      b.run(ctx, e);
      return;
    }
  }

  /** 列出全部绑定（设置页的按键说明、测试用）。 */
  list() {
    return this.bindings.map((b) => ({ name: b.name, keys: b.keys }));
  }
}
