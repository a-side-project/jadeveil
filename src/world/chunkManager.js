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
    this.lanterns = [];

    // 距离剔除：超出此距离的区块网格隐藏（不提交 draw call）
    this.cullDistance = opts.cullDistance ?? 150;
    this._cullTick = 0;
  }

  key(cx, cz) {
    return cx + "," + cz;
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

  /** 处理脏区块队列（每帧限量，避免掉帧）。 */
  processDirty(budget = this.budgetPerFrame) {
    let n = 0;
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

    // 脏区块（玩家编辑）优先重建
    const dirty = this.world.takeDirty();
    if (dirty.length) {
      for (const k of dirty) {
        const [cx, cz] = VoxelWorld.decode(k);
        const dx = cx - pcx;
        const dz = cz - pcz;
        if (dx * dx + dz * dz > R * R) continue;
        this.build(cx, cz);
      }
    }
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

  /** 设置画质档位。 */
  setQuality(level) {
    const presets = {
      low: { viewDistance: 4, cullDistance: 90 },
      medium: { viewDistance: 6, cullDistance: 130 },
      high: { viewDistance: 7, cullDistance: 170 },
      ultra: { viewDistance: 9, cullDistance: 230 },
    };
    const p = presets[level] || presets.high;
    this.viewDistance = p.viewDistance;
    this.cullDistance = p.cullDistance;
    this._pcx = null; // 强制重新加载
    this._pcz = null;
    return p;
  }

  /** 收集玩家附近的灯笼位置，用于点光源池。 */
  collectLanterns(landmarks, playerPos, maxDist = 46) {
    const out = [];
    for (const lm of landmarks) {
      if (lm.type !== "lantern") continue;
      const dx = lm.pos[0] - playerPos.x;
      const dy = lm.pos[1] - playerPos.y;
      const dz = lm.pos[2] - playerPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxDist * maxDist) continue;
      out.push({ pos: lm.pos, d2 });
    }
    out.sort((a, b) => a.d2 - b.d2);
    return out;
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
