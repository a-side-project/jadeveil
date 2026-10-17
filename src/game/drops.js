/**
 * 掉落物 —— 挖下的方块会弹出一个旋转的小物品，走近自动吸入背包（Minecraft 行为）。
 *
 *   · 物理：重力 + 只对竖直方向做方块碰撞（落在方块顶面停住），横向带阻尼滑行
 *   · 拾取：进入 1.6 格后被吸向玩家，0.5 格内进背包；背包放不下就留在地上
 *   · 同类掉落物相互靠近时合并成一堆，挖一大片也不会堆满几百个模型
 *   · 存活 5 分钟后消失；总数上限 MAX_DROPS，超出先移除最老的
 */
import * as THREE from "three";
import { isSolid } from "../world/blocks.js";
import { itemDef } from "./items.js";
import { createItemModel } from "./itemModels.js";
import { events } from "./events.js";

const MAX_DROPS = 160;
const LIFETIME = 300;
const PICKUP_DELAY = 0.45; // 刚掉出来的短暂不可拾取，否则贴脸挖的方块会瞬间消失看不到弹出
const MAGNET = 1.6;
const GRAB = 0.55;
const GRAVITY = 22;

export class DropManager {
  constructor(scene, world, atlas) {
    this.scene = scene;
    this.world = world;
    this.atlas = atlas;
    this.drops = [];
  }

  spawn(id, count, x, y, z, vel) {
    const def = itemDef(id);
    if (!def || count <= 0) return null;
    if (this.drops.length >= MAX_DROPS) this._remove(0);
    const model = createItemModel(def, this.atlas);
    model.scale.setScalar(def.kind === "block" ? 0.26 : 0.42);
    const group = new THREE.Group();
    group.add(model);
    group.position.set(x, y, z);
    this.scene.add(group);
    const d = {
      id, count, group, model,
      pos: group.position,
      vel: vel ? vel.clone() : new THREE.Vector3((Math.random() - 0.5) * 2.4, 3.2 + Math.random() * 1.5, (Math.random() - 0.5) * 2.4),
      age: 0,
      spin: Math.random() * Math.PI * 2,
      grounded: false,
    };
    this.drops.push(d);
    return d;
  }

  _remove(i) {
    const d = this.drops[i];
    this.scene.remove(d.group);
    this.drops.splice(i, 1);
  }

  /**
   * @param {object} player  需要 position
   * @param {Inventory} inventory
   */
  update(dt, player, inventory) {
    const w = this.world;
    const target = new THREE.Vector3(player.position.x, player.position.y + 0.9, player.position.z);
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.age > LIFETIME) { this._remove(i); continue; }

      const toP = target.clone().sub(d.pos);
      const dist = toP.length();
      const canPick = d.age > PICKUP_DELAY && !player.mount && inventory.canFit(d.id, d.count);

      if (canPick && dist < MAGNET) {
        // 吸附：越近越快
        d.pos.addScaledVector(toP.normalize(), Math.min(dist, (10 - dist * 3) * dt));
        if (dist < GRAB) {
          inventory.add(d.id, d.count);
          events.emit("item:pickup", { id: d.id, count: d.count });
          this._remove(i);
          continue;
        }
      } else {
        // 竖直：重力 + 落在方块顶面
        d.vel.y -= GRAVITY * dt;
        const ny = d.pos.y + d.vel.y * dt;
        const fx = Math.floor(d.pos.x), fz = Math.floor(d.pos.z);
        if (d.vel.y < 0 && isSolid(w.get(fx, Math.floor(ny - 0.12), fz))) {
          d.pos.y = Math.floor(ny - 0.12) + 1 + 0.12;
          d.vel.y = 0;
          d.grounded = true;
        } else {
          d.pos.y = ny;
          d.grounded = false;
        }
        // 横向：撞到方块就停下该轴
        const k = Math.exp(-(d.grounded ? 8 : 1.2) * dt);
        d.vel.x *= k;
        d.vel.z *= k;
        const nx = d.pos.x + d.vel.x * dt;
        if (!isSolid(w.get(Math.floor(nx), Math.floor(d.pos.y), fz))) d.pos.x = nx; else d.vel.x = 0;
        const nz = d.pos.z + d.vel.z * dt;
        if (!isSolid(w.get(Math.floor(d.pos.x), Math.floor(d.pos.y), Math.floor(nz)))) d.pos.z = nz; else d.vel.z = 0;
        if (d.pos.y < -5) { this._remove(i); continue; }
      }

      // 外观：旋转 + 上下浮动
      d.spin += dt * 1.6;
      d.model.rotation.y = d.spin;
      d.model.position.y = d.grounded ? 0.12 + Math.sin(d.age * 2.6) * 0.06 : 0;
    }

    // 合并：同类、都落地、间距 < 0.8 的掉落物合成一堆
    for (let i = 0; i < this.drops.length; i++) {
      const a = this.drops[i];
      if (!a.grounded) continue;
      const max = itemDef(a.id).maxStack;
      for (let j = this.drops.length - 1; j > i; j--) {
        const b = this.drops[j];
        if (!b.grounded || b.id !== a.id || a.count + b.count > max) continue;
        if (a.pos.distanceToSquared(b.pos) < 0.64) {
          a.count += b.count;
          a.age = Math.min(a.age, b.age);
          this._remove(j);
        }
      }
    }
  }

  serialize() {
    return this.drops.slice(-80).map((d) => [d.id, d.count, +d.pos.x.toFixed(2), +d.pos.y.toFixed(2), +d.pos.z.toFixed(2)]);
  }

  load(list) {
    while (this.drops.length) this._remove(0);
    if (!Array.isArray(list)) return;
    for (const [id, count, x, y, z] of list) {
      const d = this.spawn(id, count, x, y, z, new THREE.Vector3());
      if (d) d.age = PICKUP_DELAY;
    }
  }
}
