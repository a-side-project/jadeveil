/**
 * 区块网格生成器 —— 把体素数据烘焙成 BufferGeometry。
 *
 * 特性：
 *  · 只生成暴露面（邻块不透明则剔除），大幅降低三角形数；
 *  · 逐顶点 AO（环境光遮蔽）：按经典 3 邻域算法计算 0..3 级遮蔽；
 *  · 面朝向明暗烘焙进顶点色，配合 AO 让体素不扁平；
 *  · 发光方块写入 emissive 属性，供自定义着色器做自发光与泛光。
 */
import * as THREE from "three";
import { AIR, BLOCKS, FACE_LIGHT, isOpaque, isLiquid } from "./blocks.js";
import { CH, CW } from "./voxelWorld.js";
import { hash3i } from "../core/noise.js";

/** 有变体的贴图名（与 atlas.js 的 VARIANT_BASE 对应）。 */
const VARIANT_TILES = new Set([
  "grass_top", "grass_side", "dirt", "rock", "stone_dark", "moss_stone",
  "slate", "marble", "sand", "wall_red", "roof_gold", "roof_ink",
  "bamboo_stalk", "wood_beam", "gold_brick", "jade_block",
]);
const VARIANT_COUNT = 4;

/** 根据方块世界坐标选一个稳定的变体名。 */
function variantOf(tileName, x, y, z) {
  if (!VARIANT_TILES.has(tileName)) return tileName;
  const v = Math.floor(hash3i(x, y, z, 0x5eed) * VARIANT_COUNT) % VARIANT_COUNT;
  return `${tileName}#${v}`;
}

// 六个面的法线与四个角点（逆时针，从面外侧看）
const FACES = [
  { // 0 +X 东
    dir: [1, 0, 0],
    corners: [
      [1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1],
    ],
    uAxis: [0, 0, -1], vAxis: [0, 1, 0],
  },
  { // 1 -X 西
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0],
    ],
    uAxis: [0, 0, 1], vAxis: [0, 1, 0],
  },
  { // 2 +Y 顶
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0],
    ],
    uAxis: [1, 0, 0], vAxis: [0, 0, -1],
  },
  { // 3 -Y 底
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
    ],
    uAxis: [1, 0, 0], vAxis: [0, 0, 1],
  },
  { // 4 +Z 南
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ],
    uAxis: [1, 0, 0], vAxis: [0, 1, 0],
  },
  { // 5 -Z 北
    dir: [0, 0, -1],
    corners: [
      [1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0],
    ],
    uAxis: [-1, 0, 0], vAxis: [0, 1, 0],
  },
];

/** 每个面四个角对应的 AO 采样偏移（side1, side2, corner）。 */
const AO_OFFSETS = [
  // 对每个角，给出相对方块的两个切向邻居 + 对角邻居
  [[0, -1, 0], [0, 0, -1], [0, -1, -1]],
  [[0, -1, 0], [0, 0, 1], [0, -1, 1]],
  [[0, 1, 0], [0, 0, 1], [0, 1, 1]],
  [[0, 1, 0], [0, 0, -1], [0, 1, -1]],
];

const AO_LEVELS = [0.42, 0.62, 0.82, 1.0];

// 地下（无天空光）面的亮度因子：明显压暗但不全黑，让洞穴有“暗”感又能看清轮廓
const SKY_DARK = 0.38;

export class ChunkMesher {
  constructor(world, atlas) {
    this.world = world;
    this.atlas = atlas;
  }

  /** 计算某个面某个角的 AO 等级（0 最暗，3 最亮）。 */
  aoLevel(x, y, z, faceIdx, cornerIdx) {
    const f = FACES[faceIdx];
    const d = f.dir;
    // 面外侧的基准点
    const bx = x + d[0];
    const by = y + d[1];
    const bz = z + d[2];

    // 该角在面平面内的两个切向方向
    const c = f.corners[cornerIdx];
    // 角相对方块中心的切向偏移（-1 或 +1）
    const su = c[0] * f.uAxis[0] + c[1] * f.uAxis[1] + c[2] * f.uAxis[2];
    const sv = c[0] * f.vAxis[0] + c[1] * f.vAxis[1] + c[2] * f.vAxis[2];
    const ux = su * 2 - 1;
    const vy = sv * 2 - 1;

    const s1x = bx + f.uAxis[0] * ux;
    const s1y = by + f.uAxis[1] * ux;
    const s1z = bz + f.uAxis[2] * ux;
    const s2x = bx + f.vAxis[0] * vy;
    const s2y = by + f.vAxis[1] * vy;
    const s2z = bz + f.vAxis[2] * vy;
    const cnx = s1x + f.vAxis[0] * vy;
    const cny = s1y + f.vAxis[1] * vy;
    const cnz = s1z + f.vAxis[2] * vy;

    const o1 = isOpaque(this.world.get(s1x, s1y, s1z)) ? 1 : 0;
    const o2 = isOpaque(this.world.get(s2x, s2y, s2z)) ? 1 : 0;
    const oc = isOpaque(this.world.get(cnx, cny, cnz)) ? 1 : 0;

    if (o1 && o2) return 0;
    return 3 - (o1 + o2 + oc);
  }

  /** 该面是否需要生成。 */
  faceVisible(x, y, z, faceIdx, selfId) {
    const d = FACES[faceIdx].dir;
    const nx = x + d[0];
    const ny = y + d[1];
    const nz = z + d[2];
    const other = this.world.get(nx, ny, nz);
    if (other === AIR) return true;
    if (isOpaque(other)) return false;
    // 同种液体之间不生成面
    if (isLiquid(selfId) && isLiquid(other)) return false;
    // 非不透明方块（水/植物/灯笼）相邻时，只有类型不同才生成
    return other !== selfId;
  }

  /**
   * 生成一个区块的几何体。
   * @returns {{opaque: THREE.BufferGeometry|null, cutout: THREE.BufferGeometry|null, water: THREE.BufferGeometry|null}}
   */
  buildChunk(cx, cz) {
    const world = this.world;
    const atlas = this.atlas;
    const ox = cx * CW;
    const oz = cz * CW;

    const buckets = {
      opaque: { pos: [], norm: [], uv: [], col: [], emi: [], idx: [] },
      cutout: { pos: [], norm: [], uv: [], col: [], emi: [], idx: [] },
      water: { pos: [], norm: [], uv: [], col: [], emi: [], idx: [] },
    };

    // 预计算该区块及 1 格边界的“天空遮挡高度”：每列最顶上的不透明方块 y（无则 -1）。
    // 用它判断某个面是否暴露在天空下——地下/洞穴里的面会被压暗，解决“光穿进地下”。
    const S = CW + 2;
    const skyTop = new Int16Array(S * S);
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const wx = ox - 1 + i, wz = oz - 1 + j;
        let top = -1;
        for (let yy = CH - 1; yy >= 0; yy--) {
          if (isOpaque(world.get(wx, yy, wz))) { top = yy; break; }
        }
        skyTop[j * S + i] = top;
      }
    }
    const topAt = (wx, wz) => skyTop[(wz - (oz - 1)) * S + (wx - (ox - 1))];

    for (let y = 0; y < CH; y++) {
      for (let z = 0; z < CW; z++) {
        for (let x = 0; x < CW; x++) {
          const id = world.get(ox + x, y, oz + z);
          if (id === AIR) continue;
          const def = BLOCKS[id];
          if (!def) continue;

          const bucket = def.liquid
            ? buckets.water
            : def.opaque
              ? buckets.opaque
              : buckets.cutout;

          for (let f = 0; f < 6; f++) {
            if (!this.faceVisible(ox + x, y, oz + z, f, id)) continue;
            const tileName = def.faces[f];
            if (!tileName) continue;
            const uv = atlas.uvRect(variantOf(tileName, ox + x, y, oz + z));
            const face = FACES[f];
            const base = bucket.pos.length / 3;
            const shade = FACE_LIGHT[f];
            const emi = def.emissive || 0;

            // 天空光：顶面看本列上方是否无遮挡；侧面看邻列在该高度及以上是否无遮挡；底面恒暗。
            const fd = face.dir;
            let skyExposed;
            if (fd[1] === 1) skyExposed = topAt(ox + x, oz + z) < y + 1;
            else if (fd[1] === -1) skyExposed = false;
            else skyExposed = topAt(ox + x + fd[0], oz + z + fd[2]) < y;
            const sky = skyExposed ? 1 : SKY_DARK;

            for (let k = 0; k < 4; k++) {
              const c = face.corners[k];
              bucket.pos.push(ox + x + c[0], y + c[1], oz + z + c[2]);
              bucket.norm.push(face.dir[0], face.dir[1], face.dir[2]);

              // UV：角点顺序 0=左下 1=右下 2=右上 3=左上
              const uu = k === 1 || k === 2 ? uv.u1 : uv.u0;
              const vv = k === 2 || k === 3 ? uv.v1 : uv.v0;
              bucket.uv.push(uu, vv);

              const ao = this.aoLevel(ox + x, y, oz + z, f, k);
              const l = shade * AO_LEVELS[ao] * sky;
              bucket.col.push(l, l, l);
              bucket.emi.push(emi);
            }

            // 依据 AO 选择三角剖分方向，避免出现“折痕”
            const a0 = this.aoLevel(ox + x, y, oz + z, f, 0);
            const a1 = this.aoLevel(ox + x, y, oz + z, f, 1);
            const a2 = this.aoLevel(ox + x, y, oz + z, f, 2);
            const a3 = this.aoLevel(ox + x, y, oz + z, f, 3);
            if (a0 + a2 > a1 + a3) {
              bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            } else {
              bucket.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
            }
          }
        }
      }
    }

    const out = {};
    for (const [name, b] of Object.entries(buckets)) {
      if (b.idx.length === 0) {
        out[name] = null;
        continue;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.norm, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      g.setAttribute("aEmissive", new THREE.Float32BufferAttribute(b.emi, 1));
      g.setIndex(b.idx);
      g.computeBoundingSphere();
      out[name] = g;
    }
    return out;
  }
}
