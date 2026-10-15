/**
 * 玩家化身 —— 体素风的熊猫人武僧。
 *
 * 两套表现：
 *   · body    第三人称的全身模型，站在世界坐标里
 *   · arms    第一人称的手部视模型，挂在相机上
 *
 * 姿势由状态驱动：站立 / 行走 / 奔跑 / 游泳 / 飞行 / 坠落。
 * 游泳时身体会真实地放平（俯冲成水平），双臂做自由泳划水，双腿打水。
 */
import * as THREE from "three";
import { createWings } from "./wings.js";

const WHITE = 0xf3f1ea; // 熊猫白
const BLACK = 0x282a2f; // 熊猫黑
const JADE = 0x54b795; // 玉带
const DARK = 0x1e2024;

const mat = (color, rough = 0.74) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });

/** 造一个方块网格，pivot 在给定锚点，便于绕关节旋转。 */
function part(w, h, d, color, rough) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, rough));
  m.castShadow = true;
  return m;
}

const lerp = (a, b, k) => a + (b - a) * k;
/** 帧率无关的阻尼插值。 */
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

export class Avatar {
  constructor() {
    this.time = 0;
    this._swim = 0; // 游泳程度 0..1（平滑）
    this._fly = 0;
    this._pose = 0; // 迈步相位
    this._fp = true; // 是否第一人称（决定手部视模型是否可见）

    this.group = new THREE.Group();
    this.group.name = "avatar";
    this._buildBody();

    this.viewArms = new THREE.Group();
    this.viewArms.name = "viewArms";
    this._buildArms();
  }

  /* ---------------- 第三人称全身 ---------------- */

  _buildBody() {
    // body 的 pivot 在髋部（y=0.72），方便整体放平/俯冲
    const body = new THREE.Group();
    body.position.y = 0.72;
    this.body = body;
    this.group.add(body);

    // 躯干
    const torso = part(0.62, 0.68, 0.36, WHITE);
    torso.position.y = 0.34;
    body.add(torso);

    // 玉带：腰间的青玉腰带，点明门派
    const sash = part(0.66, 0.10, 0.40, JADE, 0.45);
    sash.position.y = 0.04;
    body.add(sash);

    // 头
    const head = new THREE.Group();
    head.position.y = 0.68;
    this.head = head;
    body.add(head);

    const skull = part(0.40, 0.38, 0.38, WHITE);
    skull.position.y = 0.19;
    head.add(skull);
    // 黑眼圈
    const patchL = part(0.13, 0.13, 0.03, BLACK);
    patchL.position.set(-0.10, 0.22, -0.20);
    head.add(patchL);
    const patchR = patchL.clone();
    patchR.position.x = 0.10;
    head.add(patchR);
    // 耳朵
    const earL = part(0.12, 0.12, 0.05, BLACK);
    earL.position.set(-0.19, 0.38, 0);
    head.add(earL);
    const earR = earL.clone();
    earR.position.x = 0.19;
    head.add(earR);
    // 口鼻
    const muzzle = part(0.16, 0.10, 0.06, BLACK);
    muzzle.position.set(0, 0.12, -0.21);
    head.add(muzzle);

    // 手臂：pivot 在肩，网格向下偏移半个臂长
    this.arms = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.40, 0.62, 0);
      body.add(pivot);
      const upper = part(0.17, 0.62, 0.17, BLACK);
      upper.position.y = -0.31;
      pivot.add(upper);
      this.arms.push(pivot);
    }

    // 腿：pivot 在髋
    this.legs = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.16, 0.02, 0);
      body.add(pivot);
      const leg = part(0.19, 0.72, 0.19, BLACK);
      leg.position.y = -0.36;
      pivot.add(leg);
      this.legs.push(pivot);
    }

    // 灵翼：巨大（翼展 WING_SPAN = 5.8 格）、像素贴图、接入选择性泛光。
    // 几何、贴图与扇动曲线都在 wings.js，量化常量集中在那里。
    this.wingRig = createWings();
    this.wingRig.setVisible(false);
    body.add(this.wingRig.group);
  }

  /* ---------------- 第一人称手部 ---------------- */

  _buildArms() {
    this.fpArms = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.34, -0.30, -0.55);
      this.viewArms.add(pivot);
      const arm = part(0.15, 0.15, 0.56, BLACK);
      arm.position.z = -0.28;
      pivot.add(arm);
      // 手掌：白色，让划水动作看得清
      const paw = part(0.17, 0.17, 0.16, WHITE);
      paw.position.z = -0.62;
      pivot.add(paw);
      this.fpArms.push(pivot);
    }
  }

  /* ---------------- 姿势 ---------------- */

  /**
   * @param {number} dt
   * @param {object} s 状态 { swimming, submersion, onGround, speed, sprinting, flying, sinking, yaw, pitch }
   */
  update(dt, s) {
    this.time += dt;
    const t = this.time;

    // 平滑状态量，避免姿势突变
    this._swim = damp(this._swim, s.swimming ? 1 : 0, 8, dt);
    this._fly = damp(this._fly, s.flying ? 1 : 0, 7, dt);
    const swim = this._swim;

    const moving = s.speed > 0.6;
    const stride = s.sprinting ? 11.5 : 8.0;
    if (moving && s.onGround) this._pose += dt * stride * Math.min(1, s.speed / 5);
    else this._pose = damp(this._pose, 0, 5, dt);

    const gait = Math.sin(this._pose);
    const gait2 = Math.sin(this._pose * 2);

    // ---------- 整体朝向 ----------
    this.group.rotation.y = s.yaw;

    // 游泳时身体放平；飞行时前倾并随俯仰/速度起伏
    const flyPitch = s.pitch ? s.pitch * 0.5 : 0;
    const targetPitch = swim * -1.30 + this._fly * (-0.22 + flyPitch);
    this.body.rotation.x = damp(this.body.rotation.x, targetPitch, 7, dt);

    // ---------- 手臂 ----------
    const [armL, armR] = this.arms;
    // 自由泳：双臂绕肩交替划水；游泳时手臂沿体侧向前伸展
    const crawl = Math.sin(t * 3.6);
    const swimArmX = -1.55 + crawl * 1.35;
    const swimArmX2 = -1.55 - crawl * 1.35;

    const walkArm = gait * 0.72;
    const flyArm = -0.45;

    armL.rotation.x = damp(armL.rotation.x, lerp(walkArm, swimArmX, swim) + this._fly * flyArm, 9, dt);
    armR.rotation.x = damp(armR.rotation.x, lerp(-walkArm, swimArmX2, swim) + this._fly * flyArm, 9, dt);
    // 游泳时手臂稍微外张，避免穿过躯干
    const spread = lerp(0.06, 0.30, swim);
    armL.rotation.z = damp(armL.rotation.z, spread, 8, dt);
    armR.rotation.z = damp(armR.rotation.z, -spread, 8, dt);

    // ---------- 腿 ----------
    const [legL, legR] = this.legs;
    // 打腿：比划水更快、幅度更小
    const kick = Math.sin(t * 4.6);
    legL.rotation.x = damp(legL.rotation.x, lerp(gait * 0.78, kick * 0.42, swim), 9, dt);
    legR.rotation.x = damp(legR.rotation.x, lerp(-gait * 0.78, -kick * 0.42, swim), 9, dt);

    // ---------- 灵翼 ----------
    // 1.25 Hz、±0.72 rad 的大幅扇动。
    // （旧版是 sin(t * 30) ≈ 4.8 Hz 的高频抖动，且用绕 X 旋转驱动沿 X 伸出的
    //   翅膀 —— 绕 X 转只会让羽面自转，翼尖几乎不动，所以「看着不扇」。）
    const flying = this._fly > 0.02;
    this.wingRig.setVisible(flying);
    if (flying) this.wingRig.update(t);

    // ---------- 头部与躯干 ----------
    // 抬头换气：游泳时头略抬，避免整张脸埋进水里
    this.head.rotation.x = damp(this.head.rotation.x, swim * 0.55, 7, dt);
    // 呼吸起伏 + 飞行微浮
    const breathe = gait2 * (moving && s.onGround ? 0.02 : 0.012);
    const flyBob = this._fly * Math.sin(t * 12) * 0.03;
    this.body.position.y = 0.72 + breathe + swim * 0.06 + flyBob;

    // ---------- 第一人称手部 ----------
    // 只在「第一人称 + 水中」出现：平时不挡视线，第三人称/观察模式一律隐藏。
    // （否则 V 切换到全身视角时，这双手还会悬在屏幕上。）
    const showArms = this._fp && swim > 0.02;
    this.viewArms.visible = showArms;
    if (showArms) {
      for (let i = 0; i < 2; i++) {
        const a = this.fpArms[i];
        const phase = i === 0 ? crawl : -crawl;
        // 前后推水 + 上下起伏
        a.position.z = -0.55 - phase * 0.30 + swim * 0.10;
        a.position.y = -0.30 + Math.max(0, phase) * 0.10 - swim * 0.10;
        a.rotation.x = 0.30 + phase * 0.55;
        a.rotation.y = phase * 0.22;
      }
    }
  }

  /** 第一人称隐藏全身、显示手部；其余模式相反。 */
  setMode(mode) {
    this._fp = mode === "first";
    this.group.visible = !this._fp;
    // viewArms 的可见性由 update() 每帧按「第一人称 + 入水」决定
  }

  /** 把全身模型放到玩家位置（脚底对齐）。 */
  placeTo(position) {
    this.group.position.set(position.x, position.y, position.z);
  }
}
