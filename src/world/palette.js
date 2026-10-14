/**
 * 潘达利亚色板 —— 所有颜色集中在此，保证全局色相统一、不出现脏色。
 * 参考：朱红宫墙 / 琉璃金瓦 / 青玉 / 墨瓦 / 竹青 / 汉白玉。
 */
import { hex } from "./pixels.js";

export const P = {
  // 朱红系 —— 宫墙、柱、幡
  crimson: hex(0xc0392b),
  crimsonDeep: hex(0x8e2a20),
  crimsonLit: hex(0xd95a48),
  crimsonGlow: hex(0xef7a5e),
  vermilion: hex(0xd8402f),

  // 琉璃金系 —— 屋顶、金饰
  gold: hex(0xe8b44a),
  goldDeep: hex(0xa8731f),
  goldLit: hex(0xffe08a),
  goldHot: hex(0xfff3cf),
  bronze: hex(0x8c6a3f),
  bronzeLit: hex(0xb08b52),
  patina: hex(0x5d8f7a),

  // 青玉系
  jade: hex(0x4a9e8f),
  jadeDeep: hex(0x2f6b60),
  jadeLit: hex(0x6fc0ae),
  jadeHot: hex(0x9fdfd0),

  // 墨瓦 / 石系
  ink: hex(0x3a4a52),
  inkDeep: hex(0x232f35),
  inkLit: hex(0x566a74),
  slate: hex(0x6e7a80),
  slateDeep: hex(0x4a545a),
  slateLit: hex(0x929ea4),
  stone: hex(0x7d8286),
  stoneDeep: hex(0x585e62),
  stoneLit: hex(0xa2a8ac),

  // 竹青 / 植被
  bamboo: hex(0x7fa650),
  bambooDeep: hex(0x516d2c),
  bambooLit: hex(0xa8cb70),
  pine: hex(0x3f6b3a),
  pineDeep: hex(0x2a4a28),
  pineLit: hex(0x5f9152),
  moss: hex(0x5d8b45),
  grass: hex(0x74ab4d),
  grassDeep: hex(0x4e7a34),

  // 土石
  earth: hex(0x6b543c),
  earthDeep: hex(0x473728),
  earthLit: hex(0x8a6f50),
  sand: hex(0xd9c290),
  sandDeep: hex(0xb09c6d),

  // 汉白玉
  marble: hex(0xded7c6),
  marbleDeep: hex(0xb3aa96),
  marbleLit: hex(0xf6f1e3),

  // 水与花
  water: hex(0x3e7c8c),
  waterDeep: hex(0x27596b),
  waterLit: hex(0x63a5b2),
  lotus: hex(0xe58fa8),
  lotusDeep: hex(0xbc5f7e),
  lotusLit: hex(0xf7bccd),

  // 灯与光
  lanternRed: hex(0xe0432f),
  lanternLit: hex(0xffb35c),
  lanternHot: hex(0xffe9b0),
  paperWarm: hex(0xf6d99b),

  // 杂
  woodDark: hex(0x4a3526),
  woodMid: hex(0x6d4c31),
  woodLit: hex(0x8f6a44),
  ink4: hex(0x1b2328),
  cloud: hex(0xf2f6fa),
  cloudShade: hex(0xc9d6e2),
};

export const FACE_SHADE = {
  // 面朝向明暗：顶面最亮、底面最暗，模拟天光方向。
  top: 1.0,
  bottom: 0.52,
  north: 0.84,
  south: 0.76,
  east: 0.68,
  west: 0.9,
};
