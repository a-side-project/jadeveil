/**
 * 训练假人 —— 第一个可攻击的实体（武器、龙技能的靶子），也是 Damageable 接口的参考实现。
 *
 * 外观与玩家/NPC 同一套 MC 人形骨架：草编躯干 + 靶心头套 + 平举双臂，立在木桩上。
 * 受击：弹簧摇晃 + 红闪 + 击退方向的倾倒；被打空血条会倒下，3 秒后复位；
 * 脱战 4 秒自动回满（RPG 训练场的标准行为）。
 */
import * as THREE from "three";
import { buildHumanoid, skinMaterials, skinTexture, PX } from "../player/skin.js";

const DUMMY_HP = 120;

function paintDummySkin() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  const rnd = (x, y) => {
    let h = (x * 73856093) ^ (y * 19349663);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const fill = (x0, y0, w, h, base, var_ = 18) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const n = (rnd(x, y) - 0.5) * var_;
        const stripe = (y % 3 === 0) ? -10 : 0; // 草编横纹
        ctx.fillStyle = `rgb(${base[0] + n + stripe | 0},${base[1] + n + stripe | 0},${base[2] + n * 0.6 + stripe | 0})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  };
  const straw = [196, 160, 92];
  const sack = [168, 128, 78];
  fill(0, 0, 32, 16, straw);
  fill(16, 16, 24, 16, sack);
  fill(40, 16, 16, 16, straw);
  fill(32, 48, 16, 16, straw);
  // 头套正面：红白靶心
  const cx = 11.5, cy = 11.5;
  for (let y = 8; y < 16; y++) {
    for (let x = 8; x < 16; x++) {
      const r = Math.hypot(x - cx, y - cy);
      const ring = Math.floor(r / 1.3) % 2;
      ctx.fillStyle = ring === 0 ? "#c0392b" : "#f2e6cf";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // 躯干正面：交叉捆绳
  ctx.fillStyle = "#6e4f2a";
  for (let k = 0; k < 8; k++) {
    ctx.fillRect(20 + k, 20 + k, 1, 1);
    ctx.fillRect(27 - k, 20 + k, 1, 1);
  }
  return c;
}

let _mats = null;
const _postMat = new THREE.MeshStandardMaterial({ color: 0x6e4f2a, roughness: 0.9 });

export class TrainingDummy {
  constructor(scene, x, y, z, yaw = 0) {
    if (!_mats) _mats = skinMaterials(skinTexture(paintDummySkin()));
    // 每个假人一份材质副本，受击红闪互不影响
    this.mats = { base: _mats.base.clone(), over: _mats.over.clone() };
    const rig = buildHumanoid(this.mats);
    this.rig = rig;
    rig.legs.forEach((l) => (l.visible = false));
    rig.arms[0].rotation.z = -1.45;
    rig.arms[1].rotation.z = 1.45;

    this.group = new THREE.Group();
    this.group.add(rig.group);
    const post = new THREE.Mesh(new THREE.BoxGeometry(3 * PX, 12 * PX, 3 * PX), _postMat);
    post.position.y = 6 * PX;
    post.castShadow = true;
    this.group.add(post);
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    scene.add(this.group);

    this.pos = this.group.position;
    this.home = this.pos.clone();
    this.radius = 0.42;
    this.height = 1.85;
    this.maxHp = DUMMY_HP;
    this.hp = DUMMY_HP;
    this.alive = true;
    this.label = "TRAINING DUMMY";

    this._wobble = 0; // 摇晃角
    this._wobbleV = 0;
    this._tiltDir = new THREE.Vector2(0, 1);
    this._flash = 0;
    this._sinceHit = 99;
    this._down = 0; // 倒地计时
    this._fall = 0; // 倒地角度 0..1
  }

  takeDamage(amount, opts = {}) {
    if (!this.alive) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    this._sinceHit = 0;
    this._flash = 1;
    // 击退冲量 → 摇晃（受击方向决定倒向）
    if (opts.dir) this._tiltDir.set(opts.dir.x, opts.dir.z).normalize();
    this._wobbleV += 2.2 + (opts.knockback || 0) * 0.5;
    if (this.hp <= 0) {
      this.alive = false;
      this._down = 3.0;
    }
    return dealt;
  }

  update(dt) {
    this._sinceHit += dt;
    // 弹簧阻尼摇晃
    this._wobbleV += -this._wobble * 60 * dt - this._wobbleV * 7 * dt;
    this._wobble += this._wobbleV * dt;
    // 倒地 / 复位
    if (!this.alive) {
      this._fall = Math.min(1, this._fall + dt * 3);
      this._down -= dt;
      if (this._down <= 0) {
        this.alive = true;
        this.hp = this.maxHp;
      }
    } else {
      this._fall = Math.max(0, this._fall - dt * 2);
      if (this._sinceHit > 4 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * dt * 0.5);
    }
    const tilt = this._wobble * 0.35 + this._fall * 1.45;
    this.rig.group.rotation.set(this._tiltDir.y * tilt, 0, -this._tiltDir.x * tilt);
    // 受击红闪
    this._flash = Math.max(0, this._flash - dt * 5);
    const f = this._flash;
    for (const m of [this.mats.base, this.mats.over]) m.emissive.setRGB(f * 0.9, f * 0.08, f * 0.05);
  }
}
