/**
 * 方块交互 —— 体素射线步进（DDA），左键破坏 / 右键放置。
 * 用 DDA 而不是三角面 raycast：更快、更准，且天然给出被击中的面法线。
 */
import * as THREE from "three";
import { AIR, ID, isLiquid, isUnbreakable, blockDef } from "../world/blocks.js";

// 与 controller.js 保持一致，避免判定区与实际碰撞体不符
const PLAYER_W = 0.32;
const PLAYER_H = 1.78;

export class Interaction {
  constructor(world, camera, player, scene) {
    this.world = world;
    this.camera = camera;
    this.player = player;
    this.scene = scene;
    this.reach = 6.2;
    this.selected = ID.grass;
    this.hit = null;

    this._buildHighlight();
    this._bind();
  }

  _buildHighlight() {
    const geo = new THREE.BoxGeometry(1.006, 1.006, 1.006);
    const edges = new THREE.EdgesGeometry(geo);
    this.highlight = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: 0xffe9b8,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.highlight.visible = false;
    this.highlight.renderOrder = 5;
    this.scene.add(this.highlight);

    this.faceMark = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffd98a,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.faceMark.visible = false;
    this.scene.add(this.faceMark);
  }

  _bind() {
    const dom = this.player.dom;
    dom.addEventListener("mousedown", (e) => {
      if (!this.player.locked) return;
      if (e.button === 0) this.breakBlock();
      else if (e.button === 2) this.placeBlock();
    });
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** 体素 DDA 步进，返回 {x,y,z,nx,ny,nz,id} 或 null。 */
  raycast() {
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.normalize();

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dir.x > 0 ? 1 : -1;
    const stepY = dir.y > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;

    const tDeltaX = Math.abs(1 / (dir.x || 1e-9));
    const tDeltaY = Math.abs(1 / (dir.y || 1e-9));
    const tDeltaZ = Math.abs(1 / (dir.z || 1e-9));

    const bx = stepX > 0 ? x + 1 - origin.x : origin.x - x;
    const by = stepY > 0 ? y + 1 - origin.y : origin.y - y;
    const bz = stepZ > 0 ? z + 1 - origin.z : origin.z - z;

    let tMaxX = tDeltaX * bx;
    let tMaxY = tDeltaY * by;
    let tMaxZ = tDeltaZ * bz;

    let nx = 0;
    let ny = 0;
    let nz = 0;
    let t = 0;

    for (let i = 0; i < 256; i++) {
      const id = this.world.get(x, y, z);
      if (id !== AIR && !isLiquid(id)) {
        return { x, y, z, nx, ny, nz, id, distance: t };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > this.reach) break;
    }
    return null;
  }

  update() {
    const hit = this.raycast();
    this.hit = hit;
    if (!hit) {
      this.highlight.visible = false;
      this.faceMark.visible = false;
      return;
    }
    this.highlight.visible = true;
    this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    // 不可破坏方块（基岩）用冷色描边，一眼区分「这是世界底」
    const unb = isUnbreakable(hit.id);
    this.highlight.material.color.setHex(unb ? 0x6a7f9a : 0xffe9b8);
    this.faceMark.visible = !unb;
    if (unb) return;
    this.faceMark.position.set(
      hit.x + 0.5 + hit.nx * 0.502,
      hit.y + 0.5 + hit.ny * 0.502,
      hit.z + 0.5 + hit.nz * 0.502,
    );
    if (hit.nx !== 0) this.faceMark.rotation.set(0, Math.PI / 2, 0);
    else if (hit.ny !== 0) this.faceMark.rotation.set(Math.PI / 2, 0, 0);
    else this.faceMark.rotation.set(0, 0, 0);
  }

  breakBlock() {
    const hit = this.hit || this.raycast();
    if (!hit) return false;
    if (hit.id === ID.water) return false;
    // 基岩不可破坏 —— 世界底的最后一道防线
    if (isUnbreakable(hit.id)) {
      if (this.onBlocked) this.onBlocked("BEDROCK — CANNOT BREAK");
      return false;
    }
    this.world.set(hit.x, hit.y, hit.z, AIR);
    return true;
  }

  placeBlock() {
    const hit = this.hit || this.raycast();
    if (!hit) return false;
    const x = hit.x + hit.nx;
    const y = hit.y + hit.ny;
    const z = hit.z + hit.nz;
    const cur = this.world.get(x, y, z);
    if (cur !== AIR && !isLiquid(cur)) return false;
    // 双保险：不可破坏方块不可被覆盖
    if (isUnbreakable(cur)) return false;

    // 不能把方块放进玩家身体里（用与碰撞一致的 AABB）
    const p = this.player.position;
    const def = blockDef(this.selected);
    if (def.solid) {
      const w = PLAYER_W;
      const overlapX = x + 1 > p.x - w && x < p.x + w;
      const overlapZ = z + 1 > p.z - w && z < p.z + w;
      const overlapY = y + 1 > p.y && y < p.y + PLAYER_H;
      if (overlapX && overlapY && overlapZ) return false;
    }
    this.world.set(x, y, z, this.selected);
    return true;
  }
}
