/**
 * 游戏事件总线 —— 系统之间只通过事件通信，不互相直接调用。
 *
 * 例：生命系统发出 "player:damage"，HUD 闪红、音效播放受击声、相机抖动
 * 各自订阅，生命系统不需要知道它们的存在。新增系统只需订阅，不改旧代码。
 *
 * 事件名约定 "领域:动作"：
 *   player:damage / player:heal / player:death / player:respawn
 *   inventory:change / inventory:select
 *   world:edit
 *   mount:summon / mount:dismiss / mount:skill
 *   entity:hit / entity:death
 *   save:done / save:loaded
 */
export class EventBus {
  constructor() {
    this._map = new Map();
  }

  /** 订阅；返回取消订阅函数。 */
  on(name, fn) {
    let set = this._map.get(name);
    if (!set) {
      set = new Set();
      this._map.set(name, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  once(name, fn) {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  /**
   * 派发。单个监听器抛错不影响其它监听器 —— 一个 HUD bug 不该让伤害结算中断。
   */
  emit(name, payload) {
    const set = this._map.get(name);
    if (!set) return;
    // 快照一份再派发（监听器里可能注销自己）；只有一个监听器时直接调，不分配数组
    const list = set.size === 1 ? set : [...set];
    for (const fn of list) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] listener for "${name}" failed`, err);
      }
    }
  }
}

/** 全局唯一事件总线。 */
export const events = new EventBus();
