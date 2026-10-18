/**
 * 背包界面（E）—— Minecraft 式操作：
 *
 *   左键   拿起整堆 / 放下整堆（同类合并，异类交换）
 *   右键   拿起半堆 / 往格子里放一个
 *   Shift+左键  快捷栏 ↔ 背包主区快速转移
 *   关闭时手上还拿着的物品自动放回背包（放不下就丢在脚下）
 *
 * 第二个页签「BUILD CATALOG」列出全部建造方块：点一下拿一组 64 个到手上，
 * 再放进任意格子 —— 素材多也不用满世界去挖。
 */
import { HOTBAR_SIZE, INVENTORY_SIZE } from "../game/inventory.js";
import { ITEMS, itemDef } from "../game/items.js";
import { setPixelText } from "./pixelfont.js";

const C = { gold: "#ffe08a", goldDeep: "#a8731f", bone: "#f2e6cf", dim: "#8b93a0", jade: "#6fc0ae" };

export class InventoryUI {
  /**
   * @param {object} deps { inventory, hud (RpgHud, 复用 paintSlot), onClose, dropAtPlayer(id, count) }
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.open = false;
    this.cursor = null; // 手上拿着的堆 { id, count }
    this.tab = "bag";
    this._build();
  }

  _build() {
    const s = document.createElement("style");
    s.textContent = `
      #inv { position: fixed; inset: 0; z-index: 50; display: none; align-items: center; justify-content: center;
        background: rgba(5,7,10,0.55); pointer-events: auto; }
      #inv.open { display: flex; }
      #inv .panel { position: relative; display: flex; flex-direction: column; gap: 10px; }
      #inv .head { display: flex; gap: 6px; align-items: stretch; }
      #inv .tabs { display: flex; gap: 6px; flex: 1; margin: 0; }
      #inv .head .close { width: 48px; margin: 0; }
      #inv .tabs button { cursor: pointer; padding: 8px 14px !important; }
      #inv .grid { display: grid; grid-template-columns: repeat(9, 50px); gap: 2px; }
      #inv .grid.hot { margin-top: 10px; }
      #inv .catalog { display: none; grid-template-columns: repeat(9, 50px); gap: 2px; max-height: 420px; overflow-y: auto; padding-right: 6px; }
      #inv.cat .catalog { display: grid; }
      #inv.cat .bagonly { display: none; }
      #inv .slot { cursor: pointer; }
      #inv .slot:hover { filter: brightness(1.35); }
      #inv .tip { min-height: 18px; }
      #inv-cursor { position: fixed; z-index: 80; pointer-events: none; width: 50px; height: 50px; display: none; }
      #inv-cursor .icon { position: absolute; left: 7px; top: 7px; width: 36px; height: 36px; image-rendering: pixelated; }
      #inv-cursor .count { position: absolute; right: 3px; bottom: 2px; }
    `;
    document.head.appendChild(s);

    const el = document.createElement("div");
    el.id = "inv";
    el.innerHTML = `
      <div class="panel">
        <div class="head">
          <div class="tabs btnrow"><button data-tab="bag" class="on"></button><button data-tab="cat"></button></div>
          <div class="btnrow close"><button id="inv-close" aria-label="CLOSE"></button></div>
        </div>
        <div class="title"></div>
        <div class="grid main bagonly"></div>
        <div class="catalog"></div>
        <div class="grid hot"></div>
        <div class="tip"></div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    setPixelText(el.querySelector('[data-tab="bag"]'), "INVENTORY", { color: C.bone, scale: 2 });
    setPixelText(el.querySelector('[data-tab="cat"]'), "BUILD CATALOG", { color: C.bone, scale: 2 });
    this.titleEl = el.querySelector(".title");
    this.tipEl = el.querySelector(".tip");
    el.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => this.setTab(b.dataset.tab)));
    // 关闭按钮：触屏没有 E 键，键鼠玩家也多一个直观的出口
    const closeBtn = el.querySelector("#inv-close");
    setPixelText(closeBtn, "X", { color: C.gold, scale: 2, center: true });
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); this.close(); });

    const mkSlot = (parent, index) => {
      const d = document.createElement("div");
      d.className = "slot";
      d.dataset.index = String(index);
      d.addEventListener("pointerdown", (e) => this._slotClick(index, e));
      d.addEventListener("mouseenter", () => this._tip(this.inventory.slots[index]));
      parent.appendChild(d);
      return d;
    };
    this.slotEls = new Array(INVENTORY_SIZE);
    const main = el.querySelector(".grid.main");
    for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) this.slotEls[i] = mkSlot(main, i);
    const hot = el.querySelector(".grid.hot");
    for (let i = 0; i < HOTBAR_SIZE; i++) this.slotEls[i] = mkSlot(hot, i);

    // 建材目录：全部方块物品
    const cat = el.querySelector(".catalog");
    for (const def of ITEMS.values()) {
      if (def.kind !== "block" && def.kind !== "torch") continue;
      const d = document.createElement("div");
      d.className = "slot";
      this.hud.paintSlot(d, { id: def.id, count: 1 });
      d.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        // 目录：点一下拿一组到手上（手上已有别的东西则先放回背包）
        if (this.cursor && this.cursor.id !== def.id) this._stowCursor();
        const add = e.button === 2 ? 1 : def.maxStack;
        if (this.cursor) this.cursor.count = Math.min(def.maxStack, this.cursor.count + add);
        else this.cursor = { id: def.id, count: add };
        this._renderCursor();
      });
      d.addEventListener("mouseenter", () => this._tip({ id: def.id, count: 1 }));
      cat.appendChild(d);
    }

    el.addEventListener("contextmenu", (e) => e.preventDefault());
    // 点空白处关闭
    el.addEventListener("pointerdown", (e) => {
      if (e.target === el) this.close();
    });

    this.cursorEl = document.createElement("div");
    this.cursorEl.id = "inv-cursor";
    document.body.appendChild(this.cursorEl);
    // 手上的物品跟随指针（鼠标移动 / 手指按下与拖动都更新）
    const follow = (e) => {
      this.cursorEl.style.left = `${e.clientX - 25}px`;
      this.cursorEl.style.top = `${e.clientY - 25}px`;
    };
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerdown", follow, true);

    this.setTab("bag");
  }

  setTab(tab) {
    this.tab = tab;
    this.el.classList.toggle("cat", tab === "cat");
    this.el.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    setPixelText(this.titleEl, tab === "cat" ? "PICK ANY MATERIAL - 64 PER CLICK" : "JJ'S PACK", { color: C.gold, scale: 2 });
  }

  _tip(stack) {
    const def = stack ? itemDef(stack.id) : null;
    if (!def) { this.tipEl.textContent = ""; return; }
    let line = def.label;
    if (def.kind === "weapon") line += `   DMG ${def.damage}   SPD ${(1 / def.cooldown).toFixed(1)}`;
    setPixelText(this.tipEl, line, { color: def.epic ? "#c48aff" : C.bone, scale: 2 });
  }

  _slotClick(i, e) {
    e.preventDefault();
    const inv = this.inventory;
    const right = e.button === 2;
    if (e.shiftKey && !right && inv.slots[i]) {
      // 快速转移：快捷栏 → 主区，主区 → 快捷栏
      const stack = inv.slots[i];
      const range = i < HOTBAR_SIZE ? [HOTBAR_SIZE, INVENTORY_SIZE] : [0, HOTBAR_SIZE];
      for (let k = range[0]; k < range[1] && stack.count > 0; k++) {
        if (!inv.slots[k] || inv.slots[k].id === stack.id) {
          // 只往空格或同类格放，placeInto 不会发生交换；返回的是放不下的余量
          const rest = inv.placeInto(k, { id: stack.id, count: stack.count });
          stack.count = rest ? rest.count : 0;
        }
      }
      if (stack.count <= 0) inv.slots[i] = null;
      inv._changed();
      return;
    }
    if (!this.cursor) {
      if (!inv.slots[i]) return;
      if (right) this.cursor = inv.splitHalf(i);
      else {
        this.cursor = inv.slots[i];
        inv.slots[i] = null;
        inv._changed();
      }
    } else if (right) {
      // 右键：往格子里放一个
      const cur = inv.slots[i];
      if (!cur || (cur.id === this.cursor.id && cur.count < itemDef(cur.id).maxStack)) {
        inv.placeInto(i, { id: this.cursor.id, count: 1 });
        this.cursor.count -= 1;
        if (this.cursor.count <= 0) this.cursor = null;
      }
    } else {
      this.cursor = inv.placeInto(i, this.cursor);
    }
    this._renderCursor();
  }

  _renderCursor() {
    const el = this.cursorEl;
    el.innerHTML = "";
    if (!this.cursor) { el.style.display = "none"; return; }
    el.style.display = "block";
    this.hud.paintSlot(el, this.cursor);
  }

  /** 手上的堆放回背包；背包满了就丢在玩家脚下。 */
  _stowCursor() {
    if (!this.cursor) return;
    const left = this.inventory.add(this.cursor.id, this.cursor.count);
    if (left > 0) this.dropAtPlayer?.(this.cursor.id, left);
    this.cursor = null;
    this._renderCursor();
  }

  refresh() {
    if (!this.open) return;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const s = this.slotEls[i];
      this.hud.paintSlot(s, this.inventory.slots[i]);
      s.classList.toggle("active", i === this.inventory.selected);
    }
  }

  show() {
    this.open = true;
    this.el.classList.add("open");
    this.refresh();
  }

  close() {
    if (!this.open) return;
    this.hide();
    this.onClose?.();
  }

  /** 关闭但不触发 onClose（死亡等由外部接管状态的场合）。 */
  hide() {
    if (!this.open) return;
    this._stowCursor();
    this.open = false;
    this.el.classList.remove("open");
    this._tip(null);
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }
}

