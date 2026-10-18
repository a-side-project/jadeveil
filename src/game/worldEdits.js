/**
 * 世界编辑 —— 玩家对世界的一切修改都走这里，而不是直接 world.set。
 *
 * 为什么要单独一层：
 *   · 存档：世界本身由固定种子确定性生成，存档只需要「玩家改过哪些格」这份差量，
 *     KB 级，读档时在生成好的世界上重放即可
 *   · 联动：火把外观、NPC 导航网格、掉落物等都要知道哪一格变了，统一在这里派发
 *
 * 存档里方块用「名字」而不是数字 id 存（附一张调色板），
 * 以后在方块表中间插新方块也不会把老存档读错。
 */
import { BLOCKS, BLOCK_ID } from "../world/blocks.js";
import { events } from "./events.js";

export class WorldEdits {
  constructor(world) {
    this.world = world;
    this.edits = new Map(); // "x,y,z" -> id
  }

  /** 修改一格并派发 world:edit。返回原来的方块 id。 */
  set(x, y, z, id) {
    const prev = this.world.get(x, y, z);
    if (prev === id) return prev;
    this.world.set(x, y, z, id);
    this.edits.set(`${x},${y},${z}`, id);
    events.emit("world:edit", { x, y, z, id, prev });
    return prev;
  }

  get count() {
    return this.edits.size;
  }

  serialize() {
    const palette = [];
    const index = new Map();
    const list = [];
    for (const [k, id] of this.edits) {
      const name = BLOCKS[id] ? BLOCKS[id].name : "air";
      let p = index.get(name);
      if (p === undefined) {
        p = palette.length;
        palette.push(name);
        index.set(name, p);
      }
      const [x, y, z] = k.split(",").map(Number);
      list.push(x, y, z, p);
    }
    return { palette, list };
  }

  /**
   * 读档：在生成好的世界上重放差量。未知方块名（版本差异）跳过。
   * 差量多时光照不逐格增量更新，重放完整体重算一次（见 LightEngine.batch）。
   */
  load(data) {
    if (!data || !Array.isArray(data.list) || !Array.isArray(data.palette)) return 0;
    // 只认注册表自己的键（`in` 会把 "constructor"、"toString" 这类原型属性也当成方块名）
    const ids = data.palette.map((n) => (Object.hasOwn(BLOCK_ID, n) ? BLOCK_ID[n] : -1));
    const replay = () => {
      let n = 0;
      for (let i = 0; i + 3 < data.list.length; i += 4) {
        const x = data.list[i], y = data.list[i + 1], z = data.list[i + 2], p = data.list[i + 3];
        const id = ids[p];
        if (id === undefined || id < 0 || !Number.isFinite(x)) continue;
        this.set(x, y, z, id);
        n++;
      }
      return n;
    };
    const L = this.world.lighting;
    if (!L || data.list.length / 4 < 400) return replay();
    const n = L.batch(replay);
    if (n) this.world.markAllDirty();
    return n;
  }
}
