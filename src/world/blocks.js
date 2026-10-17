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
  model: opts.model || null,
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

  // 火把：不进体素网格（六面贴图为空），由 TorchManager 渲染专用模型 + 火苗 + 点光源。
  // 地面一种 + 四个墙面朝向（贴在哪面墙上，火把就向反方向倾斜伸出）。
  // 追加在表尾，保证既有方块的数字 id 不变。
  def("torch", all(null), { solid: false, opaque: false, light: 1, model: "torch", label: "TORCH" }),
  def("torch_wall_e", all(null), { solid: false, opaque: false, light: 1, model: "torch", label: "TORCH" }),
  def("torch_wall_w", all(null), { solid: false, opaque: false, light: 1, model: "torch", label: "TORCH" }),
  def("torch_wall_s", all(null), { solid: false, opaque: false, light: 1, model: "torch", label: "TORCH" }),
  def("torch_wall_n", all(null), { solid: false, opaque: false, light: 1, model: "torch", label: "TORCH" }),

  // ---- 建造素材（tiles/craft.js，每种 6 张随机变体）----
  def("oak_planks", all("oak_planks"), { label: "OAK PLANKS" }),
  def("cherry_planks", all("cherry_planks"), { label: "CHERRY PLANKS" }),
  def("ebony_planks", all("ebony_planks"), { label: "EBONY PLANKS" }),
  def("bamboo_planks", all("bamboo_planks"), { label: "WOVEN BAMBOO" }),
  def("lacquer_wood", all("lacquer_wood"), { label: "BLACK LACQUER" }),
  def("grey_brick", all("grey_brick"), { label: "GREY BRICK" }),
  def("stone_bricks", all("stone_bricks"), { label: "STONE BRICKS" }),
  def("mossy_bricks", all("mossy_bricks"), { label: "MOSSY BRICKS" }),
  def("red_brick", all("red_brick"), { label: "RED BRICK" }),
  def("marble_bricks", all("marble_bricks"), { label: "MARBLE BRICKS" }),
  def("sandstone", tsc("sandstone", "sandstone"), { label: "SANDSTONE" }),
  def("cobblestone", all("cobblestone"), { label: "COBBLESTONE" }),
  def("mossy_cobble", all("mossy_cobble"), { label: "MOSSY COBBLE" }),
  def("river_pebbles", all("river_pebbles"), { label: "RIVER PEBBLES" }),
  def("carved_stone", all("carved_stone"), { label: "CARVED STONE" }),
  def("white_plaster", all("white_plaster"), { label: "WHITE PLASTER" }),
  def("ochre_plaster", all("ochre_plaster"), { label: "OCHRE PLASTER" }),
  def("terracotta", all("terracotta"), { label: "TERRACOTTA" }),
  def("lattice_window", all("lattice_window"), { label: "LATTICE WINDOW" }),
  def("ice_lattice", all("ice_lattice"), { label: "ICE-CRACK LATTICE" }),
  def("roof_blue", all("roof_blue"), { label: "AZURE GLAZED TILE" }),
  def("roof_green", all("roof_green"), { label: "JADE GLAZED TILE" }),
  def("thatch", all("thatch"), { label: "THATCH" }),
  def("jade_floor", all("jade_floor"), { label: "JADE FLOOR" }),
  def("copper_plate", all("copper_plate"), { label: "COPPER PLATE" }),
  def("straw_mat", tsc("straw_mat", "oak_planks"), { label: "STRAW MAT" }),
  def("silk_carpet", tsc("silk_carpet", "red_brick"), { label: "SILK CARPET" }),
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
