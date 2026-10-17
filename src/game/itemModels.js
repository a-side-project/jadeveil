/**
 * 物品的 3D 模型（手持 / 掉落物）与 2D 图标（背包 / 快捷栏）。
 *
 *   · 方块物品：小立方体，六面直接用世界图集的贴图（与地上的方块像素一致）
 *   · 像素物品（武器 / 火把）：16×16 像素图挤出成体素薄片 —— MC 物品模型做法；
 *     标了 glow 的像素单独成一个网格，进选择性泛光层（玉剑刃光、火苗）
 *
 * 几何按物品 id 缓存，同一物品的所有实例共享。
 */
import * as THREE from "three";
import { BLOCKS } from "../world/blocks.js";
import { BLOOM_SCENE } from "../core/renderer.js";
import { extrudeSprite, spriteCanvas } from "./sprites.js";

const _cache = new Map();

// 面序与 blocks.js 一致：0=+X 1=-X 2=+Y 3=-Y 4=+Z 5=-Z
const CUBE_FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.68 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.9 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.52 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.76 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.84 },
];

function blockGeometry(blockId, atlas) {
  const def = BLOCKS[blockId];
  const pos = [], norm = [], uv = [], col = [], idx = [];
  CUBE_FACES.forEach((f, i) => {
    const tile = def.faces[i];
    if (!tile) return;
    const r = atlas.uvRect(tile);
    const base = pos.length / 3;
    // UV 角点顺序与 mesher 一致：0=左下 1=右下 2=右上 3=左上
    const uvs = [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]];
    for (let k = 0; k < 4; k++) {
      const c = f.c[k];
      pos.push(c[0] - 0.5, c[1] - 0.5, c[2] - 0.5);
      norm.push(...f.n);
      uv.push(...uvs[k]);
      col.push(f.shade, f.shade, f.shade);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

let _blockMat = null;
let _spriteMat = null;
let _glowMat = null;

function materials(atlas) {
  if (!_blockMat) {
    _blockMat = new THREE.MeshStandardMaterial({
      map: atlas.texture, vertexColors: true, roughness: 0.85, alphaTest: 0.5, side: THREE.DoubleSide,
    });
    _spriteMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
    // 发光像素：不受光照，直接输出高亮颜色，交给选择性泛光扩散
    _glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    // 略高于 1：进泛光有辉光，但第一人称贴近镜头时不至于过曝成一片
    _glowMat.color.setScalar(1.05);
  }
  return { block: _blockMat, sprite: _spriteMat, glow: _glowMat };
}

/**
 * 生成物品的 3D 模型（宽约 1 单位，以中心为原点；调用方自行缩放）。
 * @param {object} def  itemDef
 */
export function createItemModel(def, atlas) {
  const mats = materials(atlas);
  const group = new THREE.Group();
  group.name = `item:${def.id}`;
  let geo = _cache.get(def.id);
  if (!geo) {
    geo = def.kind === "block"
      ? { base: blockGeometry(def.blockId, atlas), glow: null, cube: true }
      : { ...extrudeSprite(def.sprite), cube: false };
    _cache.set(def.id, geo);
  }
  if (geo.base) {
    const m = new THREE.Mesh(geo.base, geo.cube ? mats.block : mats.sprite);
    m.castShadow = true;
    group.add(m);
  }
  if (geo.glow) {
    const g = new THREE.Mesh(geo.glow, mats.glow);
    g.layers.enable(BLOOM_SCENE);
    group.add(g);
  }
  group.userData.cube = geo.cube;
  return group;
}

/* ------------------------------------------------------------------ */
/* 2D 图标                                                              */
/* ------------------------------------------------------------------ */

const _iconCache = new Map();

/**
 * 物品图标 canvas。方块画成 MC 背包里那种等轴测小立方体（顶亮、左中、右暗），
 * 像素物品直接放大像素图。
 */
export function itemIcon(def, atlas, size = 64) {
  const key = `${def.id}:${size}`;
  const hit = _iconCache.get(key);
  if (hit) return hit;
  let c;
  if (def.kind !== "block") {
    c = spriteCanvas(def.sprite, size);
  } else {
    const b = BLOCKS[def.blockId];
    const top = atlas.tileCanvas(b.faces[2], 32);
    const side = atlas.tileCanvas(b.faces[4], 32);
    c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const s = size / 64;
    // 等轴测：顶面是菱形，左右两个侧面是平行四边形
    const drawFace = (img, m, shade) => {
      ctx.save();
      ctx.setTransform(m[0] * s, m[1] * s, m[2] * s, m[3] * s, m[4] * s, m[5] * s);
      ctx.drawImage(img, 0, 0, 32, 32);
      if (shade > 0) {
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fillRect(0, 0, 32, 32);
      }
      ctx.restore();
    };
    drawFace(top, [0.875, 0.4375, -0.875, 0.4375, 32, 4], 0);
    drawFace(side, [0.875, 0.4375, 0, 0.9, 4, 18], 0.18);
    drawFace(side, [0.875, -0.4375, 0, 0.9, 32, 32], 0.38);
  }
  _iconCache.set(key, c);
  return c;
}
