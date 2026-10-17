/**
 * 背包模型 —— 纯数据，不碰 DOM / three.js（界面在 ui/inventoryUI.js）。
 *
 * 布局与 Minecraft 一致：36 格，0–8 是快捷栏，9–35 是背包主区。
 * 每格要么为 null，要么是 { id, count }。
 * 所有修改都派发 "inventory:change"，界面、手持物、存档各自订阅。
 */
import { itemDef } from "./items.js";
import { events } from "./events.js";

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;

export class Inventory {
  constructor() {
    this.slots = new Array(INVENTORY_SIZE).fill(null);
    this.selected = 0; // 快捷栏选中格 0..8
  }

  _changed() {
    events.emit("inventory:change", this);
  }

  get selectedStack() {
    return this.slots[this.selected];
  }

  get selectedItem() {
    const s = this.selectedStack;
    return s ? itemDef(s.id) : null;
  }

  select(i) {
    this.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    events.emit("inventory:select", this);
  }

  /**
   * 放入物品：先叠到已有的同类堆，再放进空格（快捷栏优先）。
   * 返回放不下的剩余数量（0 = 全部放入）。
   */
  add(id, count = 1) {
    const def = itemDef(id);
    if (!def || count <= 0) return count;
    let left = count;
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < def.maxStack) {
        const n = Math.min(left, def.maxStack - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, def.maxStack);
        this.slots[i] = { id, count: n };
        left -= n;
      }
    }
    if (left !== count) this._changed();
    return left;
  }

  /** 能否完整放入（拾取前判断，避免捡一半）。 */
  canFit(id, count = 1) {
    const def = itemDef(id);
    if (!def) return false;
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += def.maxStack;
      else if (s.id === id) room += def.maxStack - s.count;
      if (room >= count) return true;
    }
    return false;
  }

  /** 从指定格扣减；扣到 0 清空该格。返回是否成功。 */
  takeFrom(slot, count = 1) {
    const s = this.slots[slot];
    if (!s || s.count < count) return false;
    s.count -= count;
    if (s.count === 0) this.slots[slot] = null;
    this._changed();
    return true;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /**
   * 两格交换 / 合并（界面拖放用）。同类可叠则合并，否则交换。
   */
  moveSlot(from, to) {
    if (from === to) return;
    const a = this.slots[from];
    const b = this.slots[to];
    if (a && b && a.id === b.id) {
      const max = itemDef(a.id).maxStack;
      const n = Math.min(a.count, max - b.count);
      b.count += n;
      a.count -= n;
      if (a.count === 0) this.slots[from] = null;
    } else {
      this.slots[from] = b;
      this.slots[to] = a;
    }
    this._changed();
  }

  /** 拆半：右键拖起半堆。返回拿起的堆（已从格子里移除）。 */
  splitHalf(slot) {
    const s = this.slots[slot];
    if (!s) return null;
    const n = Math.ceil(s.count / 2);
    s.count -= n;
    if (s.count === 0) this.slots[slot] = null;
    this._changed();
    return { id: s.id, count: n };
  }

  /** 把一堆放进某格（拖放落点），返回放不下的剩余堆或 null。 */
  placeInto(slot, stack) {
    const cur = this.slots[slot];
    if (!cur) {
      this.slots[slot] = stack;
      this._changed();
      return null;
    }
    if (cur.id === stack.id) {
      const max = itemDef(cur.id).maxStack;
      const n = Math.min(stack.count, max - cur.count);
      cur.count += n;
      stack.count -= n;
      this._changed();
      return stack.count > 0 ? stack : null;
    }
    this.slots[slot] = stack;
    this._changed();
    return cur; // 交换：手上换成原来那堆
  }

  clear() {
    this.slots.fill(null);
    this._changed();
  }

  serialize() {
    return {
      selected: this.selected,
      slots: this.slots.map((s) => (s ? [s.id, s.count] : null)),
    };
  }

  /** 读档：未知物品（旧版本/已删除的道具）静默丢弃，不让存档读崩。 */
  load(data) {
    this.slots.fill(null);
    if (data && Array.isArray(data.slots)) {
      data.slots.slice(0, INVENTORY_SIZE).forEach((s, i) => {
        if (!s) return;
        const [id, count] = s;
        const def = itemDef(id);
        if (!def || !(count > 0)) return;
        this.slots[i] = { id, count: Math.min(count, def.maxStack) };
      });
    }
    this.selected = Math.max(0, Math.min(HOTBAR_SIZE - 1, (data && data.selected) | 0));
    this._changed();
    events.emit("inventory:select", this);
  }
}
