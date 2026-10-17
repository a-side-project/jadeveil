/**
 * 物品注册表 —— 数据驱动：加一个新道具 = 在 ITEM_DEFS 里加一行。
 *
 * 物品 id 是稳定字符串（存档里存的就是它），与方块的数字 id 解耦：
 *   · 方块物品："block:<方块名>"，由方块表自动注册
 *   · 其余物品：武器、火把等，在下方手写
 *
 * kind:
 *   block  —— 右键放置为方块
 *   torch  —— 右键放置为火把（地面 / 墙面自动判定朝向）
 *   weapon —— 左键攻击，带伤害与冷却
 */
import { BLOCKS } from "../world/blocks.js";

/** 可从方块表取得的方块物品（排除空气、液体、基岩、装饰性附属块）。 */
const NON_ITEM_BLOCKS = new Set([
  "air", "water", "bedrock", "lantern_tassel", "torch",
  "torch_wall_e", "torch_wall_w", "torch_wall_s", "torch_wall_n",
]);

const ITEM_DEFS = [
  {
    id: "sword_wood", label: "WOODEN SWORD", kind: "weapon", sprite: "sword_wood",
    maxStack: 1, damage: 4, cooldown: 0.55, reach: 3.6, knockback: 4,
  },
  {
    id: "sword_stone", label: "STONE SWORD", kind: "weapon", sprite: "sword_stone",
    maxStack: 1, damage: 6, cooldown: 0.6, reach: 3.6, knockback: 5,
  },
  {
    id: "sword_jade", label: "JADE BLADE", kind: "weapon", sprite: "sword_jade",
    maxStack: 1, damage: 9, cooldown: 0.5, reach: 3.9, knockback: 7, epic: true,
  },
  {
    id: "torch", label: "TORCH", kind: "torch", sprite: "torch", maxStack: 64,
  },
];

export const ITEMS = new Map();

for (const def of ITEM_DEFS) ITEMS.set(def.id, def);
BLOCKS.forEach((b, blockId) => {
  if (NON_ITEM_BLOCKS.has(b.name)) return;
  ITEMS.set(`block:${b.name}`, {
    id: `block:${b.name}`,
    label: b.label,
    kind: "block",
    blockId,
    maxStack: 64,
  });
});

export function itemDef(id) {
  return ITEMS.get(id) || null;
}

/** 方块被挖掉后掉落什么物品（null = 什么都不掉）。 */
export function dropForBlock(blockId) {
  const b = BLOCKS[blockId];
  if (!b) return null;
  if (b.name.startsWith("torch")) return "torch";
  const id = `block:${b.name}`;
  return ITEMS.has(id) ? id : null;
}

/**
 * 新角色的起始物品：正好 36 格。
 * 快捷栏放武器、火把和最常用的 7 种建材；背包里是其余全部中式建材，
 * 拿来就能盖房子（还缺的在背包界面的「建材目录」里随取）。
 */
export const STARTER_KIT = [
  ["sword_jade", 1], ["torch", 64],
  ["block:oak_planks", 64], ["block:grey_brick", 64], ["block:white_plaster", 64],
  ["block:roof_blue", 64], ["block:lattice_window", 32], ["block:stone_bricks", 64], ["block:cherry_planks", 64],
  ["sword_stone", 1], ["block:roof_gold", 64], ["block:wall_red", 64], ["block:pillar_red", 32],
  ["block:jade_floor", 64], ["block:cobblestone", 64], ["block:marble_bricks", 64], ["block:lantern", 16],
  ["block:thatch", 64], ["block:terracotta", 64], ["block:red_brick", 64], ["block:roof_green", 64],
  ["block:bamboo_planks", 64], ["block:ebony_planks", 64], ["block:mossy_bricks", 64], ["block:sandstone", 64],
  ["block:carved_stone", 32], ["block:copper_plate", 32], ["block:silk_carpet", 32], ["block:ochre_plaster", 64],
  ["block:ice_lattice", 32], ["block:lacquer_wood", 32], ["block:river_pebbles", 64], ["block:straw_mat", 32],
  ["block:slate", 64], ["block:marble", 64], ["block:grass", 64],
];

