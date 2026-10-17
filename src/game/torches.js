/**
 * 火把 —— 方块数据里是 torch / torch_wall_* 五种 id（不进体素网格），这里负责外观：
 *
 *   · 模型：MC 火把的 2×10×2 像素木柄 + 顶端发光火芯（InstancedMesh，全部火把 2 个 draw call）
 *   · 墙面火把：底端贴墙、向外倾斜 22.5°（与 MC 一致）
 *   · 火苗：持续冒出的像素火星与烟（共享特效粒子池）
 *   · 光照：就近若干把火把进点光源池（与灯笼共用预算），带闪烁
 *   · 依附：支撑方块被挖掉时火把掉落成物品（MC 行为）
 */
import * as THREE from "three";
import { BLOCKS, ID, isSolid } from "../world/blocks.js";
import { BLOOM_SCENE } from "../core/renderer.js";

const MAX_TORCHES = 1024;
const PX = 1 / 16;
const TILT = Math.PI / 8; // 22.5°

/** 墙面火把：方块名 → 所贴墙面的方向（火把向反方向伸出）。 */
export const WALL_DIR = {
  torch_wall_e: [1, 0], // 墙在 +X，火把向 -X 倾
  torch_wall_w: [-1, 0],
  torch_wall_s: [0, 1],
  torch_wall_n: [0, -1],
};

export function isTorch(id) {
  const b = BLOCKS[id];
  return !!b && b.model === "torch";
}

/** 根据点击的面选择火把方块：顶面 → 地面火把；侧面 → 贴在被点击方块上的墙面火把；底面不可放。 */
export function torchBlockFor(nx, ny, nz) {
  if (ny === 1) return ID.torch;
  if (ny === -1) return null;
  // 点击面法线指向火把所在格，墙在 -法线方向
  if (nx === 1) return ID.torch_wall_w;
  if (nx === -1) return ID.torch_wall_e;
  if (nz === 1) return ID.torch_wall_n;
  if (nz === -1) return ID.torch_wall_s;
  return null;
}

/** 火把依附的支撑方块坐标。 */
export function supportOf(x, y, z, id) {
  const name = BLOCKS[id].name;
  if (name === "torch") return [x, y - 1, z];
  const d = WALL_DIR[name];
  return [x + d[0], y, z + d[1]];
}

export class TorchManager {
  constructor(scene, world, fx) {
    this.world = world;
    this.fx = fx;
    this.map = new Map(); // "x,y,z" -> { x, y, z, id, phase }

    const stick = new THREE.BoxGeometry(2 * PX, 10 * PX, 2 * PX);
    stick.translate(0, 5 * PX, 0);
    const stickMat = new THREE.MeshStandardMaterial({ color: 0x7a5228, roughness: 0.9 });
    this.stick = new THREE.InstancedMesh(stick, stickMat, MAX_TORCHES);
    const core = new THREE.BoxGeometry(2.2 * PX, 2.6 * PX, 2.2 * PX);
    core.translate(0, 11 * PX, 0);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffc35a, toneMapped: false });
    coreMat.color.multiplyScalar(2.6);
    this.core = new THREE.InstancedMesh(core, coreMat, MAX_TORCHES);
    this.core.layers.enable(BLOOM_SCENE);
    for (const m of [this.stick, this.core]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.stick.castShadow = true;
    this._dummy = new THREE.Object3D();
    this._dirty = false;
    this._t = 0;
  }

  key(x, y, z) { return `${x},${y},${z}`; }

  /** 世界里某格变成 / 不再是火把时调用（由世界编辑钩子统一驱动）。 */
  onBlockChange(x, y, z, id) {
    const k = this.key(x, y, z);
    if (isTorch(id)) this.map.set(k, { x, y, z, id, phase: Math.random() * 10 });
    else if (this.map.has(k)) this.map.delete(k);
    else return;
    this._dirty = true;
  }

  /** 支撑方块被移除时，返回需要掉落的火把列表（并从世界中移除它们）。 */
  detachAround(x, y, z) {
    const out = [];
    for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      const tx = x + dx, ty = y + dy, tz = z + dz;
      const id = this.world.get(tx, ty, tz);
      if (!isTorch(id)) continue;
      const [sx, sy, sz] = supportOf(tx, ty, tz, id);
      if (sx === x && sy === y && sz === z && !isSolid(this.world.get(sx, sy, sz))) out.push([tx, ty, tz]);
    }
    return out;
  }

  _rebuild() {
    const d = this._dummy;
    let i = 0;
    for (const t of this.map.values()) {
      if (i >= MAX_TORCHES) break;
      const name = BLOCKS[t.id].name;
      d.rotation.set(0, 0, 0);
      if (name === "torch") {
        d.position.set(t.x + 0.5, t.y, t.z + 0.5);
      } else {
        // 底端贴墙、离墙 0.5 格中心处向外倾斜
        const [wx, wz] = WALL_DIR[name];
        d.position.set(t.x + 0.5 + wx * 0.38, t.y + 0.2, t.z + 0.5 + wz * 0.38);
        d.rotation.set(-wz * TILT, 0, wx * TILT);
      }
      d.updateMatrix();
      this.stick.setMatrixAt(i, d.matrix);
      this.core.setMatrixAt(i, d.matrix);
      t._tip = new THREE.Vector3(0, 11 * PX, 0).applyMatrix4(d.matrix);
      i++;
    }
    this.stick.count = i;
    this.core.count = i;
    this.stick.instanceMatrix.needsUpdate = true;
    this.core.instanceMatrix.needsUpdate = true;
    this._dirty = false;
  }

  /** 最近的若干把火把（进点光源池）。 */
  nearest(pos, maxDist = 32) {
    const out = [];
    const m2 = maxDist * maxDist;
    for (const t of this.map.values()) {
      const dx = t.x + 0.5 - pos.x, dy = t.y + 0.7 - pos.y, dz = t.z + 0.5 - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= m2) out.push({ t, d2 });
    }
    out.sort((a, b) => a.d2 - b.d2);
    return out;
  }

  update(dt, playerPos) {
    if (this._dirty) this._rebuild();
    this._t += dt;
    // 火苗：只给玩家附近的火把冒火星（远处靠火芯泛光即可）
    for (const { t } of this.nearest(playerPos, 28)) {
      if (!t._tip) continue;
      if (Math.random() < dt * 9) {
        this.fx.emit({
          x: t._tip.x + (Math.random() - 0.5) * 0.08, y: t._tip.y + 0.06, z: t._tip.z + (Math.random() - 0.5) * 0.08,
          vx: (Math.random() - 0.5) * 0.15, vy: 0.5 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.15,
          life: 0.55, size: 0.09, size1: 0.02, color: [1.0, 0.85, 0.35], color1: [0.9, 0.25, 0.05], drag: 1.2,
        });
      }
      if (Math.random() < dt * 2.5) {
        this.fx.emit({
          x: t._tip.x, y: t._tip.y + 0.2, z: t._tip.z,
          vx: 0, vy: 0.45, vz: 0, life: 1.4, size: 0.12, size1: 0.24, color: [0.18, 0.16, 0.15], color1: [0.03, 0.03, 0.03], drag: 0.6,
        });
      }
    }
  }

  /** 点光源闪烁系数（0.85 ~ 1.1）。 */
  flicker(t) {
    const s = this._t * 9 + t.phase;
    return 0.92 + Math.sin(s) * 0.05 + Math.sin(s * 2.7) * 0.04 + Math.sin(s * 6.1) * 0.03;
  }
}
