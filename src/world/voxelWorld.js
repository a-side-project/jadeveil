/**
 * 体素世界存储 —— 分区块（chunk）保存 Uint8Array，支持无限高度与快速读写。
 * 世界坐标 y 从 0 起，区块高度 CH = 96。
 */
import { AIR, isSolid, isOpaque, isLiquid } from "./blocks.js";

export const CH = 160; // 区块高度（需容纳浮岛与飞行空间）
export const CW = 16; // 区块宽度/深度

export class VoxelWorld {
  constructor(seed = 20261014) {
    this.seed = seed;
    this.chunks = new Map(); // "cx,cz" -> Uint8Array
    this.dirty = new Set();
  }

  static key(cx, cz) {
    return cx + "," + cz;
  }

  ensureChunk(cx, cz) {
    const k = VoxelWorld.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Uint8Array(CW * CH * CW);
      this.chunks.set(k, c);
    }
    return c;
  }

  hasChunk(cx, cz) {
    return this.chunks.has(VoxelWorld.key(cx, cz));
  }

  idx(x, y, z) {
    return (y * CW + z) * CW + x;
  }

  get(x, y, z) {
    if (y < 0 || y >= CH) return AIR;
    const cx = x >> 4;
    const cz = z >> 4;
    const c = this.chunks.get(VoxelWorld.key(cx, cz));
    if (!c) return AIR;
    return c[this.idx(x & 15, y, z & 15)];
  }

  set(x, y, z, id) {
    if (y < 0 || y >= CH) return;
    const cx = x >> 4;
    const cz = z >> 4;
    const c = this.ensureChunk(cx, cz);
    c[this.idx(x & 15, y, z & 15)] = id;
    this.dirty.add(VoxelWorld.key(cx, cz));
    // 边界方块会影响邻区块的可见面
    const lx = x & 15;
    const lz = z & 15;
    if (lx === 0) this.dirty.add(VoxelWorld.key(cx - 1, cz));
    if (lx === 15) this.dirty.add(VoxelWorld.key(cx + 1, cz));
    if (lz === 0) this.dirty.add(VoxelWorld.key(cx, cz - 1));
    if (lz === 15) this.dirty.add(VoxelWorld.key(cx, cz + 1));
  }

  /** 只在空气处写入（地形生成用，避免覆盖已有结构）。 */
  setIfAir(x, y, z, id) {
    if (this.get(x, y, z) === AIR) this.set(x, y, z, id);
  }

  solidAt(x, y, z) {
    return isSolid(this.get(x, y, z));
  }

  opaqueAt(x, y, z) {
    return isOpaque(this.get(x, y, z));
  }

  liquidAt(x, y, z) {
    return isLiquid(this.get(x, y, z));
  }

  /**
   * 从 y 向下找第一个「地面」高度。
   *
   * 注意：只统计不透明方块（地形/建筑），跳过云雾、灯笼等空中装饰，
   * 否则出生点、NPC 路径、小地图会错把云层当成地面。
   */
  groundHeight(x, z, from = CH - 1) {
    for (let y = Math.min(from, CH - 1); y >= 0; y--) {
      if (isOpaque(this.get(x, y, z))) return y;
    }
    return -1;
  }

  /** 任意实心方块的最高高度（含云雾/灯笼等）。 */
  topSolidHeight(x, z, from = CH - 1) {
    for (let y = Math.min(from, CH - 1); y >= 0; y--) {
      if (isSolid(this.get(x, y, z))) return y;
    }
    return -1;
  }

  takeDirty() {
    const list = [...this.dirty];
    this.dirty.clear();
    return list;
  }

  markAllDirty() {
    for (const k of this.chunks.keys()) this.dirty.add(k);
  }

  stats() {
    let solid = 0;
    for (const c of this.chunks.values()) {
      for (let i = 0; i < c.length; i++) if (c[i] !== AIR) solid++;
    }
    return { chunks: this.chunks.size, solid };
  }
}
