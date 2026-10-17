/**
 * 交互 —— 体素射线步进（DDA）+ 近战命中判定。
 *
 *   左键：准星下有可攻击目标 → 用手持武器攻击（带冷却）；否则挖掉方块，弹出掉落物
 *   右键：手持方块 → 放置（消耗背包）；手持火把 → 插在地面 / 墙面
 *
 * 用 DDA 而不是三角面 raycast：更快、更准，且天然给出被击中的面法线。
 * 世界修改一律走 WorldEdits（存档差量 + 联动），不直接 world.set。
 */
import * as THREE from "three";
import { AIR, ID, isLiquid, isUnbreakable, isSolid, blockDef } from "../world/blocks.js";
import { dropForBlock } from "../game/items.js";
import { torchBlockFor, isTorch } from "../game/torches.js";

/** 空手攻击（没有武器时） */
const FIST = { damage: 1, cooldown: 0.35, reach: 3.0, knockback: 2 };

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
    this.selected = ID.grass; // 当前可放置的方块 id（由背包选中格同步；null = 手里不是方块）
    this.hit = null;
    this.creative = false; // 创造模式：放置不消耗背包（自动化测试也用它）
    this._attackCd = 0;

    // 由 main.js 注入的协作者
    this.edits = null; // WorldEdits
    this.inventory = null;
    this.drops = null;
    this.combat = null;
    this.avatar = null;
    this.enabled = true; // 骑乘 / 死亡 / 打开背包时关闭

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
      if (!this.player.locked || !this.enabled) return;
      if (e.button === 0) this.primary();
      else if (e.button === 2) this.secondary();
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

  update(dt = 0) {
    this._attackCd = Math.max(0, this._attackCd - dt);
    if (!this.enabled) {
      this.hit = null;
      this.highlight.visible = false;
      this.faceMark.visible = false;
      return;
    }
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

  /** 写世界：有 WorldEdits 就走它（存档 + 联动），否则直接写（单元测试场景）。 */
  _set(x, y, z, id) {
    if (this.edits) this.edits.set(x, y, z, id);
    else this.world.set(x, y, z, id);
  }

  _weapon() {
    const def = this.inventory?.selectedItem;
    return def && def.kind === "weapon" ? def : null;
  }

  /** 左键：先打人，后挖方块。 */
  primary() {
    this.avatar?.swing();
    const wpn = this._weapon() || FIST;
    if (this.combat) {
      const origin = this.camera.position.clone();
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const target = this.combat.raycast(origin, dir, wpn.reach);
      // 方块挡在目标前面时不算命中（不能隔墙砍）
      const block = this.hit || this.raycast();
      if (target && (!block || block.distance > target.t)) {
        // 冷却未满时攻击只有 25% 威力（MC 1.9 的攻击节奏）
        const ready = this._attackCd <= 0;
        const dmg = wpn.damage * (ready ? 1 : 0.25);
        const crit = ready && !this.player.onGround && this.player.velocity.y < 0; // 下落中出手 = 暴击
        const knock = new THREE.Vector3(dir.x, 0, dir.z).normalize();
        this.combat.hit(target.e, crit ? dmg * 1.5 : dmg, { dir: knock, knockback: wpn.knockback, crit, source: "melee" });
        this._attackCd = wpn.cooldown;
        if (this.onAttack) this.onAttack(target.e, crit);
        return true;
      }
    }
    if (this.onSwing) this.onSwing();
    return this.breakBlock();
  }

  /** 右键：按手持物放置。 */
  secondary() {
    const def = this.inventory?.selectedItem;
    if (this.inventory && def && def.kind === "torch") return this.placeTorch();
    if (this.inventory && (!def || def.kind !== "block")) return false;
    return this.placeBlock();
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
    this._set(hit.x, hit.y, hit.z, AIR);
    this.avatar?.swing();
    // 掉落物：从方块中心弹出
    const drop = dropForBlock(hit.id);
    if (drop && this.drops && !this.creative) this.drops.spawn(drop, 1, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    if (this.onBreak) this.onBreak(hit.id, hit.x, hit.y, hit.z);
    return true;
  }

  /** 从背包扣一个当前手持物；创造模式 / 无背包时不扣。 */
  /**
   * 从背包扣一个当前手持物；创造模式 / 无背包时不扣。
   * 必须核对手里拿的就是要放的东西（itemId）—— 否则会出现「拿着剑放方块，扣掉的是剑」。
   */
  _consume(itemId) {
    if (this.creative || !this.inventory) return true;
    const s = this.inventory.selectedStack;
    if (!s || s.id !== itemId) return false;
    return this.inventory.takeFrom(this.inventory.selected, 1);
  }

  placeTorch() {
    const hit = this.hit || this.raycast();
    if (!hit) return false;
    if (isTorch(hit.id)) return false;
    const id = torchBlockFor(hit.nx, hit.ny, hit.nz);
    if (id === null) return false;
    const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    const cur = this.world.get(x, y, z);
    if (cur !== AIR) return false;
    // 支撑必须是实心方块
    if (!isSolid(hit.id)) return false;
    if (!this._consume("torch")) return false;
    this._set(x, y, z, id);
    this.avatar?.swing();
    if (this.onPlace) this.onPlace(id, x, y, z);
    return true;
  }

  placeBlock() {
    const hit = this.hit || this.raycast();
    // 先把要放的方块 id 固定下来：扣背包会派发 inventory:change，
    // 若扣掉的是最后一个，同步逻辑会把 this.selected 清成 null —— 之后再读它就会放下「空气」
    const blockId = this.selected;
    if (!hit || blockId === null || blockId === undefined) return false;
    const x = hit.x + hit.nx;
    const y = hit.y + hit.ny;
    const z = hit.z + hit.nz;
    const cur = this.world.get(x, y, z);
    if (cur !== AIR && !isLiquid(cur)) return false;
    // 双保险：不可破坏方块不可被覆盖
    if (isUnbreakable(cur)) return false;
    const itemId = `block:${blockDef(blockId).name}`;

    // 不能把方块放进玩家身体里（用与碰撞一致的 AABB）。
    // 例外（Minecraft 行为）：如果恰好是「脚所在的那一格」，允许放置，
    // 并把玩家顶到新方块顶上 —— 这样能给自己脚下垫方块、一级级往上爬。
    const p = this.player.position;
    const def = blockDef(blockId);
    if (def.solid) {
      const w = this.player.hw ?? PLAYER_W;
      const h = this.player.bh ?? PLAYER_H;
      const overlapX = x + 1 > p.x - w && x < p.x + w;
      const overlapZ = z + 1 > p.z - w && z < p.z + w;
      const overlapY = y + 1 > p.y && y < p.y + h;
      if (overlapX && overlapY && overlapZ) {
        if (y !== Math.floor(p.y)) return false; // 身体/头部被占据，拒绝
        // 头顶要有空间才能把人顶上去
        if (this.player.collides(p.x, y + 1, p.z)) return false;
        if (!this._consume(itemId)) return false;
        this._set(x, y, z, blockId);
        this.player.position.y = y + 1;
        if (this.player.velocity.y < 0) this.player.velocity.y = 0;
        this.player.onGround = true;
        this.avatar?.swing();
        if (this.onPlace) this.onPlace(blockId, x, y, z);
        return true;
      }
    }
    if (!this._consume(itemId)) return false;
    this._set(x, y, z, blockId);
    this.avatar?.swing();
    if (this.onPlace) this.onPlace(blockId, x, y, z);
    return true;
  }
}
