/**
 * 区块网格管理 —— 负责把 VoxelWorld 的脏区块重建为 Mesh，
 * 并按距离做视距剔除与分批上传，避免一次性卡顿。
 */
import * as THREE from "three";
import { ChunkMesher } from "./mesher.js";
import { CW, VoxelWorld } from "./voxelWorld.js";

export class ChunkManager {
  constructor(world, atlas, renderer, opts = {}) {
    this.world = world;
    this.atlas = atlas;
    this.renderer = renderer;
    this.mesher = new ChunkMesher(world, atlas);
    this.group = new THREE.Group();
    this.group.name = "voxel-chunks";
    renderer.scene.add(this.group);

    this.meshes = new Map(); // key -> {opaque, cutout, water, cloud}
    this.viewDistance = opts.viewDistance ?? 7; // 区块
    this.budgetPerFrame = opts.budgetPerFrame ?? 2;
    this.queue = [];
    this.lightQueue = new Set();

    // 距离剔除：超出此距离的区块网格隐藏（不提交 draw call）
    this.cullDistance = opts.cullDistance ?? 150;
    this._cullTick = 0;
  }

  /**
   * 区块键：与 VoxelWorld 保持同一套数字键。
   *
   * 之前这里是字符串 key、而 world.dirty 是数字 key，
   * 导致 cull() 用 decode() 解析字符串得到 NaN，
   * 结果所有区块网格被判定为「不可见」——整个场景消失。
   * 现在两边统一为数字键。
   */
  key(cx, cz) {
    return VoxelWorld.key(cx, cz);
  }

  /** 生成/更新一个区块的网格。 */
  build(cx, cz) {
    const k = this.key(cx, cz);
    const geos = this.mesher.buildChunk(cx, cz);
    let entry = this.meshes.get(k);

    if (!entry) {
      entry = {};
      this.meshes.set(k, entry);
    }

    const assign = (slot, geo, material, opts = {}) => {
      const old = entry[slot];
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
      }
      if (!geo) {
        entry[slot] = null;
        return;
      }
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = opts.cast !== false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      entry[slot] = mesh;
    };

    assign("opaque", geos.opaque, this.renderer.matOpaque);
    assign("cutout", geos.cutout, this.renderer.matCutout, { cast: true });
    assign("water", geos.water, this.renderer.matWater, { cast: false });
    assign("cloud", geos.cloud, this.renderer.matCloud, { cast: false });
  }

  /**
   * 处理脏区块队列（每帧限量，避免掉帧）。
   * 光照波及的重建优先于远处的首次加载，但每帧最多一个（单个城区区块约 5ms）。
   */
  processDirty(budget = this.budgetPerFrame) {
    let n = 0;
    for (const k of this.lightQueue) {
      if (n >= Math.min(1, budget)) return n;
      this.lightQueue.delete(k);
      const [cx, cz] = VoxelWorld.decode(k);
      this.build(cx, cz);
      n++;
    }
    while (this.queue.length && n < budget) {
      const [cx, cz] = this.queue.shift();
      this.build(cx, cz);
      n++;
    }
    return n;
  }

  /** 依据玩家位置刷新需要加载/卸载的区块。 */
  update(playerPos, force = false) {
    const pcx = Math.floor(playerPos.x / CW);
    const pcz = Math.floor(playerPos.z / CW);
    const R = this.viewDistance;

    if (force || pcx !== this._pcx || pcz !== this._pcz) {
      this._pcx = pcx;
      this._pcz = pcz;

      const wanted = new Set();
      const list = [];
      for (let dx = -R; dx <= R; dx++) {
        for (let dz = -R; dz <= R; dz++) {
          const cx = pcx + dx;
          const cz = pcz + dz;
          if (!this.world.hasChunk(cx, cz)) continue;
          const d2 = dx * dx + dz * dz;
          if (d2 > R * R) continue;
          const k = this.key(cx, cz);
          wanted.add(k);
          if (!this.meshes.has(k)) list.push([cx, cz, d2]);
        }
      }
      // 近处优先
      list.sort((a, b) => a[2] - b[2]);
      this.queue = list.map(([cx, cz]) => [cx, cz]);

      // 卸载远处
      for (const [k, entry] of this.meshes) {
        if (wanted.has(k)) continue;
        for (const slot of ["opaque", "cutout", "water", "cloud"]) {
          const m = entry[slot];
          if (m) {
            this.group.remove(m);
            m.geometry.dispose();
          }
        }
        this.meshes.delete(k);
      }
    }

    // 脏区块（玩家编辑）当帧重建：放下 / 挖掉方块要立刻看到
    const dirty = this.world.takeDirty();
    if (dirty.length) {
      for (const k of dirty) {
        this.world.lightDirty.delete(k);
        const [cx, cz] = VoxelWorld.decode(k);
        const dx = cx - pcx;
        const dz = cz - pcz;
        if (dx * dx + dz * dz > R * R) continue;
        this.build(cx, cz);
      }
    }
    // 只是光照被波及的邻区块：进入分帧队列（每帧限量），一盏灯的光最多影响 4 个区块，
    // 全部当帧重建会卡一下（实测 M3 Max 上 15ms）
    for (const k of this.world.lightDirty) {
      if (this.meshes.has(k)) this.lightQueue.add(k);
    }
    this.world.lightDirty.clear();
  }

  /** 距离剔除：隐藏远处区块，减少 draw call。 */
  cull(playerPos) {
    const cd2 = this.cullDistance * this.cullDistance;
    for (const [k, entry] of this.meshes) {
      const [cx, cz] = VoxelWorld.decode(k);
      const dx = cx * CW + CW / 2 - playerPos.x;
      const dz = cz * CW + CW / 2 - playerPos.z;
      const d2 = dx * dx + dz * dz;
      const visible = d2 <= cd2;
      for (const slot of ["opaque", "cutout", "water", "cloud"]) {
        const m = entry[slot];
        if (m) m.visible = visible;
      }
    }
  }

  /** 画质：视距与剔除距离（来自 core/quality.js 的配置）。 */
  setQuality({ viewDistance, cullDistance }) {
    if (viewDistance === this.viewDistance && cullDistance === this.cullDistance) return;
    this.viewDistance = viewDistance;
    this.cullDistance = cullDistance;
    this._pcx = null; // 强制重新加载
    this._pcz = null;
  }

  /**
   * 视野里有没有水面网格 —— 没有就不必渲染平面反射（整遍场景重绘）。
   * 每帧都算（只是一百多个包围球的视锥测试），不缓存：缓存会让刚转向水面的那几帧露出旧倒影。
   */
  anyWaterVisible(camera) {
    const f = this._frustum || (this._frustum = new THREE.Frustum());
    const m = this._pv || (this._pv = new THREE.Matrix4());
    camera.updateMatrixWorld();
    m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    f.setFromProjectionMatrix(m);
    for (const e of this.meshes.values()) {
      const w = e.water;
      if (w && w.visible && f.intersectsObject(w)) return true;
    }
    return false;
  }

  get loadedChunks() {
    return this.meshes.size;
  }

  get triangles() {
    let t = 0;
    for (const e of this.meshes.values()) {
      for (const slot of ["opaque", "cutout", "water", "cloud"]) {
        const m = e[slot];
        if (m && m.geometry.index) t += m.geometry.index.count / 3;
      }
    }
    return t;
  }
}
