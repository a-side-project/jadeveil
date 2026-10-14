/**
 * 方块注册表 —— 每种方块定义六个面的贴图、是否实心、是否发光、是否透明。
 * 面序：0=+X(东) 1=-X(西) 2=+Y(顶) 3=-Y(底) 4=+Z(南) 5=-Z(北)
 */
export const FACE = { EAST: 0, WEST: 1, TOP: 2, BOTTOM: 3, SOUTH: 4, NORTH: 5 };

/** 面朝向明暗系数（烘焙进顶点色，让体素不扁平）。 */
export const FACE_LIGHT = [0.68, 0.9, 1.0, 0.52, 0.76, 0.84];

const def = (name, faces, opts = {}) => ({
  name,
  faces,
  solid: opts.solid !== false,
  opaque: opts.opaque !== false,
  emissive: opts.emissive || 0,
  light: opts.light || 0,
  liquid: !!opts.liquid,
  cutout: !!opts.cutout,
  unbreakable: !!opts.unbreakable,
  label: opts.label || name,
});

/** 六面同贴图的简写。 */
const all = (t) => [t, t, t, t, t, t];
/** 顶/侧/底 三分的简写。 */
const tsc = (top, side, bottom = side) => [side, side, top, bottom, side, side];

export const BLOCKS = [
  def("air", all(null), { solid: false, opaque: false, label: "AIR" }),

  // 基岩：世界底，不可破坏、不可覆盖
  def("bedrock", all("bedrock"), { unbreakable: true, label: "BEDROCK" }),

  def("grass", tsc("grass_top", "grass_side", "dirt"), { label: "GRASS" }),
  def("dirt", all("dirt"), { label: "DIRT" }),
  def("rock", all("rock"), { label: "ROCK" }),
  def("stone_dark", all("stone_dark"), { label: "DARKSTONE" }),
  def("moss_stone", all("moss_stone"), { label: "MOSS STONE" }),
  def("slate", all("slate"), { label: "SLATE" }),
  def("marble", all("marble"), { label: "MARBLE" }),
  def("sand", all("sand"), { label: "SAND" }),

  def("water", all("water"), { solid: false, opaque: false, liquid: true, label: "WATER" }),
  def("lotus_pad", all("lotus_pad"), { solid: false, opaque: false, cutout: true, label: "LILY PAD" }),
  def("lotus_flower", all("lotus_flower"), { solid: false, opaque: false, cutout: true, label: "LOTUS" }),

  def("bamboo", all("bamboo_stalk"), { label: "BAMBOO" }),
  // 竹叶 / 松针：有碰撞体 —— 它们形成大片树冠，看起来是实心块，
  // 若不可站立玩家会「站上去就穿模」（用户反馈与材质相关）
  def("bamboo_leaf", all("bamboo_leaf"), { solid: true, opaque: false, cutout: true, label: "BAMBOO LEAF" }),
  def("pine_leaf", all("pine_leaf"), { solid: true, opaque: false, cutout: true, label: "PINE NEEDLES" }),
  def("flower_red", all("flower_red"), { solid: false, opaque: false, cutout: true, label: "RED FLOWER" }),
  def("flower_yellow", all("flower_yellow"), { solid: false, opaque: false, cutout: true, label: "YELLOW FLOWER" }),
  def("grass_tuft", all("grass_tuft"), { solid: false, opaque: false, cutout: true, label: "GRASS TUFT" }),

  def("wall_red", all("wall_red"), { label: "CRIMSON WALL" }),
  def("wall_base", all("wall_base"), { label: "WALL BASE" }),
  def("pillar_red", all("pillar_red"), { label: "CRIMSON PILLAR" }),
  def("beam_painted", all("beam_painted"), { label: "PAINTED BEAM" }),
  def("railing_marble", all("railing_marble"), { label: "MARBLE RAILING" }),
  def("wood_beam", all("wood_beam"), { label: "WOOD BEAM" }),
  def("gold_brick", all("gold_brick"), { label: "GOLD BRICK" }),

  def("roof_gold", all("roof_gold"), { label: "GLAZED GOLD TILE" }),
  def("roof_gold_ridge", all("roof_gold_ridge"), { label: "GOLD RIDGE" }),
  def("roof_eave", all("roof_eave"), { label: "GOLD EAVE" }),
  def("roof_corner", all("roof_corner"), { label: "UPTURNED CORNER" }),
  def("roof_ink", all("roof_ink"), { label: "INK TILE" }),
  def("roof_ink_eave", all("roof_ink_eave"), { label: "INK EAVE" }),

  def("jade_block", all("jade_block"), { label: "JADE BRICK" }),
  def("archway_plaque", all("archway_plaque"), { label: "ARCHWAY PLAQUE" }),
  def("stone_lion", all("stone_lion"), { solid: true, opaque: false, cutout: true, label: "STONE LION" }),

  // 宫灯：有碰撞体（否则玩家会直接穿过灯笼）
  def("lantern", all("lantern"), {
    solid: true, opaque: false, cutout: true,
    emissive: 1.0, light: 1, label: "LANTERN",
  }),
  def("lantern_tassel", all("lantern_tassel"), {
    solid: false, opaque: false, cutout: true, label: "LANTERN TASSEL",
  }),
  def("glow", all("glow"), { emissive: 1.0, light: 1, label: "GLOW ORB" }),
  // 云雾：有碰撞体 —— 可以「踏云」，不再穿透
  def("cloud", all("cloud"), { solid: true, opaque: false, label: "CLOUD" }),
];

export const BLOCK_ID = {};
BLOCKS.forEach((b, i) => (BLOCK_ID[b.name] = i));

export const ID = BLOCK_ID;
export const AIR = BLOCK_ID.air;

/** 玩家可放置的方块（快捷栏）。 */
export const HOTBAR = [
  "grass", "slate", "wall_red", "roof_gold", "roof_eave",
  "pillar_red", "jade_block", "marble", "lantern",
];

export function blockDef(id) {
  return BLOCKS[id] || BLOCKS[0];
}

export function isSolid(id) {
  return BLOCKS[id] ? BLOCKS[id].solid : false;
}

export function isOpaque(id) {
  return BLOCKS[id] ? BLOCKS[id].opaque : false;
}

export function isLiquid(id) {
  return BLOCKS[id] ? BLOCKS[id].liquid : false;
}

/** 是否不可破坏（基岩等世界底方块）。 */
export function isUnbreakable(id) {
  return BLOCKS[id] ? !!BLOCKS[id].unbreakable : false;
}

/** 世界底基岩的高度范围（含）。 */
export const BEDROCK_TOP = 2;
