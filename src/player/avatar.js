/**
 * 玩家化身 —— 杰杰（JJ）：Minecraft 标准人形 + 64×64 皮肤。
 *
 * 两套表现：
 *   · group     第三人称全身模型（skin.js 的 MC 人形骨架），站在世界坐标里
 *   · viewArms  第一人称视模型：右臂 + 手持物，挂在相机上（与 MC 一致，始终可见）
 *
 * 姿势由状态驱动：站立 / 行走 / 奔跑 / 游泳 / 骑乘 / 挥击。
 * 游泳时身体真实地放平，双臂自由泳划水，双腿打水；
 * 骑乘末影龙时跨坐（双腿前伸外张、身体随龙俯仰）。
 */
import * as THREE from "three";
import { buildHumanoid, paintJJSkin, skinTexture, skinMaterials, partGeometry, PX } from "./skin.js";
import { createItemModel } from "../game/itemModels.js";

const lerp = (a, b, k) => a + (b - a) * k;
/** 帧率无关的阻尼插值。 */
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

/** 挥击动作时长（秒）—— 攻击 / 挖掘 / 放置共用。 */
const SWING_TIME = 0.28;

// 第一人称右臂的静止位姿（相机空间）：从屏幕右下角伸出、手掌朝前
const FP_POS = [0.56, -0.62, -0.86];
const FP_ROT = [1.5, 0.16, 0.12];
const FP_SCALE = 0.85;

export class Avatar {
  constructor(atlas) {
    this.atlas = atlas;
    this.time = 0;
    this._swim = 0; // 游泳程度 0..1（平滑）
    this._ride = 0; // 骑乘程度 0..1
    this._pose = 0; // 迈步相位
    this._fp = true; // 是否第一人称
    this._swingT = 1; // 挥击进度 0..1（1 = 未在挥击）
    this.heldDef = null;

    this.texture = skinTexture(paintJJSkin());
    this.materials = skinMaterials(this.texture);

    const rig = buildHumanoid(this.materials);
    this.group = rig.group;
    this.group.name = "avatar";
    this.body = rig.body;
    this.head = rig.head;
    this.arms = rig.arms;
    this.legs = rig.legs;

    // 第三人称手持物：挂在右手掌心（右臂 pivot 下 10px）
    this.handR = new THREE.Group();
    this.handR.position.set(0, -10 * PX, -1 * PX);
    this.arms[1].add(this.handR);

    this.viewArms = new THREE.Group();
    this.viewArms.name = "viewArms";
    this._buildViewArm();
  }

  /* ---------------- 第一人称右臂 ---------------- */

  _buildViewArm() {
    // MC 的第一人称手臂：从屏幕右下角伸出，略微内旋
    const pivot = new THREE.Group();
    pivot.position.set(FP_POS[0], FP_POS[1], FP_POS[2]);
    pivot.rotation.set(FP_ROT[0], FP_ROT[1], FP_ROT[2]);
    pivot.scale.setScalar(FP_SCALE);
    this.viewArms.add(pivot);
    this.fpPivot = pivot;
    for (const layer of ["base", "over"]) {
      const m = new THREE.Mesh(partGeometry("armR", layer), layer === "base" ? this.materials.base : this.materials.over);
      m.position.y = -4 * PX;
      pivot.add(m);
    }
    // 第一人称手持物：手掌前方
    this.fpHand = new THREE.Group();
    this.fpHand.position.set(0, -10 * PX, -1.5 * PX);
    pivot.add(this.fpHand);
    // 视模型不投影（否则相机附近会出现一块奇怪的阴影）
    this.viewArms.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  }

  /** 切换手持物：第三人称手里 + 第一人称手里各一份模型。 */
  setHeldItem(def) {
    if (def === this.heldDef || (def && this.heldDef && def.id === this.heldDef.id)) return;
    this.heldDef = def;
    for (const hand of [this.handR, this.fpHand]) {
      while (hand.children.length) hand.remove(hand.children[0]);
    }
    if (!def) return;
    const place = (hand, fp) => {
      const m = createItemModel(def, this.atlas);
      if (def.kind === "block") {
        m.scale.setScalar(fp ? 0.32 : 0.26);
        m.position.set(0, fp ? -0.02 : -0.04, fp ? -0.06 : -0.04);
        m.rotation.set(0.2, 0.75, 0);
      } else if (def.kind === "weapon") {
        // MC 持剑：像素图平面竖在手臂的 YZ 平面里，剑柄在拳心，刃朝前、略上扬。
        // 像素图对角线 (1,1) 经 Ry(90°) → (0,1,-1)，再 Rx(-30°) → 前方偏上约 15°；
        // 剑柄像素 (-0.44,-0.38) 经同一旋转落在 (0,-0.109,0.571)，平移回原点。
        const s = fp ? 0.6 : 0.72;
        m.scale.setScalar(s);
        if (fp) {
          // 第一人称：MC 的斜握 —— 剑面朝向镜头、刃从右下斜向左上（指向准星）。
          // 手部坐标系里 -Z 是屏幕上方、-Y 是前方：Ry(180°) 镜像对角线，Rx(-90°) 把像素图竖起来；
          // 剑柄像素经同一旋转落在 (0.44, 0, 0.38)，平移回拳心。
          m.rotation.set(-Math.PI / 2, Math.PI, 0);
          m.position.set(-0.44 * s, 0, -0.38 * s);
        } else {
          m.rotation.set(-0.52, Math.PI / 2, 0);
          m.position.set(0, 0.109 * s, -0.571 * s);
        }
      } else {
        // 火把：竖握，木柄底端在拳心
        const s = fp ? 0.62 : 0.56;
        m.scale.setScalar(s);
        m.rotation.set(-0.25, Math.PI / 2, 0);
        m.position.set(0, 0.42 * s, -0.08 * s);
      }
      if (fp) m.traverse((o) => { o.castShadow = false; });
      hand.add(m);
    };
    place(this.handR, false);
    place(this.fpHand, true);
  }

  /** 触发一次挥击（攻击 / 挖掘 / 放置）。 */
  swing() {
    this._swingT = 0;
  }

  get swinging() {
    return this._swingT < 1;
  }

  /* ---------------- 姿势 ---------------- */

  /**
   * @param {number} dt
   * @param {object} s 状态 { swimming, submersion, onGround, speed, sprinting, crouching, riding, rideBank, yaw, pitch }
   */
  update(dt, s) {
    this.time += dt;
    const t = this.time;

    this._swim = damp(this._swim, s.swimming ? 1 : 0, 8, dt);
    this._ride = damp(this._ride, s.riding ? 1 : 0, 10, dt);
    this._crouch = damp(this._crouch || 0, s.crouching ? 1 : 0, 12, dt);
    const crouch = this._crouch;
    this._swingT = Math.min(1, this._swingT + dt / SWING_TIME);
    const swim = this._swim;
    const ride = this._ride;

    const moving = s.speed > 0.6 && !s.riding;
    const stride = s.sprinting ? 11.5 : 8.0;
    if (moving && s.onGround) this._pose += dt * stride * Math.min(1, s.speed / 5);
    else this._pose = damp(this._pose, 0, 5, dt);
    const gait = Math.sin(this._pose);
    const gait2 = Math.sin(this._pose * 2);

    // 挥击曲线：快出慢收（MC 的挥臂节奏）
    const sw = this._swingT < 1 ? Math.sin(Math.sqrt(this._swingT) * Math.PI) : 0;

    // ---------- 整体朝向 ----------
    this.group.rotation.y = s.yaw;
    // 骑乘时整体随龙的滚转倾斜
    this.group.rotation.z = damp(this.group.rotation.z, ride * (s.rideBank || 0), 8, dt);

    // 蹲下：上身前倾（MC 的潜行姿势）
    const targetPitch = swim * -1.30 + ride * -0.12 + crouch * -0.45;
    this.body.rotation.x = damp(this.body.rotation.x, targetPitch, 7, dt);

    // ---------- 手臂 ----------
    const [armL, armR] = this.arms;
    const crawl = Math.sin(t * 3.6);
    const swimArmX = -1.55 + crawl * 1.35;
    const swimArmX2 = -1.55 - crawl * 1.35;
    const walkArm = gait * 0.72;
    // 骑乘：双手前伸握住龙颈
    const rideArm = 0.85;
    // 手持武器时右臂略前抬（MC 持剑姿态）
    const holdR = this.heldDef ? 0.18 : 0;

    const armLx = lerp(lerp(walkArm, swimArmX, swim), rideArm, ride) + crouch * 0.35;
    // 旋转约定：手臂沿 -Y 下垂、模型面朝 -Z，绕 X 正转 = 向前抬；挥击 = 向前上方抡起
    const armRx = lerp(lerp(-walkArm + holdR, swimArmX2, swim), rideArm, ride) + crouch * 0.35 + sw * 1.7;
    armL.rotation.x = damp(armL.rotation.x, armLx, 9, dt);
    armR.rotation.x = this._swingT < 1 ? armRx : damp(armR.rotation.x, armRx, 9, dt);
    const spread = lerp(lerp(0.06, 0.30, swim), 0.18, ride);
    armL.rotation.z = damp(armL.rotation.z, spread, 8, dt);
    armR.rotation.z = damp(armR.rotation.z, -spread + sw * 0.35, 12, dt);

    // ---------- 腿 ----------
    const [legL, legR] = this.legs;
    const kick = Math.sin(t * 4.6);
    // 跨坐：大腿前抬 + 外张
    const rideLeg = 1.25;
    // 蹲下时腿相对上身往后收，抵消前倾，脚仍踩在原地（蹲行时步幅减半）
    const crouchLeg = crouch * 0.45;
    const g = gait * (1 - crouch * 0.5);
    legL.rotation.x = damp(legL.rotation.x, lerp(lerp(g * 0.78, kick * 0.42, swim), rideLeg, ride) + crouchLeg, 9, dt);
    legR.rotation.x = damp(legR.rotation.x, lerp(lerp(-g * 0.78, -kick * 0.42, swim), rideLeg, ride) + crouchLeg, 9, dt);
    legL.rotation.z = damp(legL.rotation.z, ride * -0.38, 9, dt);
    legR.rotation.z = damp(legR.rotation.z, ride * 0.38, 9, dt);

    // ---------- 头 ----------
    // 头部跟随视线俯仰（MC 的头会看向准星方向）；游泳时抬头换气
    const look = s.pitch ? Math.max(-0.9, Math.min(0.9, s.pitch)) : 0;
    // 蹲下时头部抵消上身前倾，保持平视
    this.head.rotation.x = damp(this.head.rotation.x, swim * 0.55 + (1 - swim) * look + crouch * 0.45, 10, dt);
    const breathe = gait2 * (moving && s.onGround ? 0.02 : 0.012);
    this.body.position.y = 12 * PX + breathe + swim * 0.06 - crouch * 0.06;

    // ---------- 第一人称视模型 ----------
    // 只在第一人称显示；游泳时随划水前后推，挥击时整臂下劈
    this.viewArms.visible = this._fp && !s.riding;
    if (this.viewArms.visible) {
      const p = this.fpPivot;
      const bobX = moving && s.onGround ? Math.sin(this._pose) * 0.018 : 0;
      const bobY = moving && s.onGround ? Math.abs(Math.cos(this._pose)) * 0.022 : 0;
      const stroke = swim > 0.02 ? crawl * 0.12 * swim : 0;
      p.position.set(FP_POS[0] + bobX - sw * 0.16, FP_POS[1] - bobY + sw * 0.06, FP_POS[2] - stroke - sw * 0.10);
      p.rotation.set(FP_ROT[0] - sw * 0.9, FP_ROT[1] + sw * 0.6, FP_ROT[2] + sw * 0.3);
    }
  }

  /** 第一人称隐藏全身、显示手部；其余模式相反。 */
  setMode(mode) {
    this._fp = mode === "first";
    this.group.visible = !this._fp;
  }

  /** 把全身模型放到玩家位置（脚底对齐）。 */
  placeTo(position) {
    this.group.position.set(position.x, position.y, position.z);
  }
}
