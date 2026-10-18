/**
 * 玩家控制器 —— 第一人称 / 第三人称 / 自由观察。
 *
 * 碰撞：子步进（sub-stepping）+ 逐轴扫掠 AABB。
 *   每帧位移被拆成若干步，单步位移不超过 MAX_STEP（0.35 格），
 *   从根本上消除高速下坠时的隧穿（tunneling）。
 *
 * 飞行：带质量的飞行物理 —— 加速度/减速度、空气阻力、动量滑行、
 *   俯仰角影响速度矢量、退出飞行时平滑过渡回重力。
 */
import * as THREE from "three";
import { isSolid, isLiquid, blockDef } from "../world/blocks.js";
import { CH } from "../world/voxelWorld.js";

/** 低于此高度即判定「掉出世界」，强制重生。 */
export const VOID_Y = -1;

const PLAYER_W = 0.32; // 半宽（AABB 半径）
const PLAYER_H = 1.78; // 身高
const EYE_H = 1.62; // 眼高
const EPS = 1e-4;

// ---- 蹲下（MC 的潜行）----
const CROUCH_H = 1.5; // 蹲下时的碰撞高度
const CROUCH_EYE_DROP = 0.35; // 视线降低量
const CROUCH_SPEED = 0.3; // 相对步行速度

const GRAVITY = 30;
const JUMP_V = 9.4;
const WALK = 5.0;
const RUN = 8.6;
const MAX_FALL = 60;

// ---- 游泳物理 ----
// 浮力按浸没比例驱动：平衡点 sub = WATER_SINK / BUOYANCY ≈ 0.83，
// 即身体约 83% 沉在水下、头露出水面 —— 这才是人真正浮在水上的样子。
const SWIM = 3.6; // 常态游速
const SWIM_FAST = 5.8; // 加速游速
const SWIM_UP = 4.4; // 主动上浮
const SWIM_DOWN = 5.0; // 主动下潜
const BUOYANCY = 3.6; // 净浮力系数
const WATER_SINK = 3.0; // 水中自重下沉
const SWIM_TURN = 8.0; // 垂直速度响应速度
const WADE_DRAG = 0.52; // 浅滩涉水的减速

// 飞行物理参数
const FLY_ACCEL = 26; // 推进加速度
const FLY_DRAG = 2.4; // 空气阻力系数（线性）
const FLY_MAX = 16; // 常规最大速度
const FLY_MAX_FAST = 34; // 加速时最大速度
const FLY_DIVE = 22; // 俯冲额外加速度
const FLY_GLIDE_MIN = 2.2; // 无推进时的最小滑行速度（防止悬浮）
const FLY_EXIT_BLEND = 3.2; // 退出飞行时速度衰减时间常数

const MAX_STEP = 0.35; // 单个子步的最大位移（格）

export const CAMERA_MODES = ["first", "third", "orbit"];
export const CAMERA_LABELS = { first: "FIRST PERSON", third: "THIRD PERSON", orbit: "FREE ORBIT" };

export class Player {
  constructor(world, camera, domElement) {
    this.world = world;
    this.camera = camera;
    this.dom = domElement;

    this.position = new THREE.Vector3(0, 60, 88);
    this.velocity = new THREE.Vector3();
    this.onGround = false;
    this.flying = false;
    this.sprinting = false;

    // 碰撞体尺寸（半宽 / 高）。骑乘末影龙时由坐骑换成龙的碰撞体。
    this.hw = PLAYER_W;
    this.bh = PLAYER_H;
    this.eyeH = EYE_H;
    // 飞行手感参数；坐骑可整体替换（龙更快、更有惯性）
    this.flyTuning = { accel: FLY_ACCEL, max: FLY_MAX, maxFast: FLY_MAX_FAST };
    // 当前坐骑（null = 步行）。坐骑负责位置之外的一切：模型、技能、相机距离。
    this.mount = null;
    // 第三人称相机距离（骑乘时拉远）
    this.thirdDist = 5.2;
    this.shake = 0;
    // 下一次落地免摔落伤害（从龙背上下来时由坐骑置位）
    this.safeFall = false;

    // 水体状态
    this.inWater = false; // 脚部在水里（涉水）
    this.swimming = false; // 躯干在水里（真正的游泳）
    this.headUnderwater = false; // 头部在水面下
    this.submersion = 0; // 浸没比例 0..1

    // 音频事件钩子（由 main.js 挂接）
    this.onJump = null;
    this.onLand = null;
    this.onFootstep = null;
    this.onSplash = null;
    this.onSwimStroke = null;
    this._wasGrounded = false;
    this._peakY = 0;
    this._stepT = 0;
    this._strokeT = 0;
    this._wasSwimming = false;
    this._wasHeadUnder = false;

    // 视角：yaw/pitch 目标值 + 当前值（阻尼）
    this.yaw = Math.PI;
    this.pitch = -0.06;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.sensitivity = 0.0022;
    this.damping = 22;

    this.mode = "first";
    this.orbitAngle = 0;
    this.orbitDist = 14;
    this.orbitHeight = 6;

    this.headBob = true;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.roll = 0;

    this.fov = 72;
    this.baseFov = 72;

    this.keys = new Set();
    this.locked = false;
    // 触屏模式：没有指针锁定，「正在操控」由触屏层决定（见 engaged）
    this.touchMode = false;
    this.touchEngaged = false;
    // 模拟量移动输入（触屏摇杆）：active 时取代 WASD，x 右为正、y 前为正，模长 0..1 = 速度比例
    this.moveInput = { x: 0, y: 0, active: false, sprint: false };

    // 蹲下 / 疾跑：按住（hold，默认）或按一下切换（toggle），在设置里选；触屏的蹲下固定为切换
    this.crouchMode = "hold";
    this.sprintMode = "hold";
    this.crouching = false;
    this.crouchToggled = false;
    this.sprintToggled = false;
    this._crouchEye = 0; // 视线下降量（平滑过渡，不会一下子掉下去）
    this._noFwdT = 0;
    this._tmp = new THREE.Vector3();
    this._probe = new THREE.Vector3();

    // 统计：本帧实际执行的子步数（用于碰撞测试证据）
    this.lastSubsteps = 0;

    this._bind();
  }

  /** 玩家是否正在操控角色：键鼠 = 指针已锁定；触屏 = 游戏进行中。 */
  get engaged() {
    return this.locked || this.touchEngaged;
  }

  _bind() {
    const dom = this.dom;

    dom.addEventListener("click", () => {
      if (this.locked || this.touchMode) return;
      // 没有有效手势时浏览器会拒绝锁定（返回被拒的 Promise），吞掉即可
      const r = dom.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === dom;
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.targetYaw -= e.movementX * this.sensitivity;
      this.targetPitch -= e.movementY * this.sensitivity;
      const lim = Math.PI / 2 - 0.02;
      this.targetPitch = Math.max(-lim, Math.min(lim, this.targetPitch));
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") e.preventDefault();
      if (!e.repeat && this.engaged) {
        if (e.code === "KeyC" && this.crouchMode === "toggle") this.toggleCrouch();
        if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && this.sprintMode === "toggle") this.sprintToggled = !this.sprintToggled;
      }
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  get eyePosition() {
    return this._tmp.set(
      this.position.x,
      this.position.y + this.eyeH - this._crouchEye + this.bobAmount,
      this.position.z,
    );
  }

  /** 切换模式下的蹲下（键盘 C / 触屏 CROUCH 按钮）。飞行、游泳、骑乘时不响应。 */
  toggleCrouch() {
    if (this.flying || this.swimming || this.mount) return;
    this.crouchToggled = !this.crouchToggled;
  }

  /**
   * 蹲下状态机：想蹲就立刻蹲（碰撞箱变矮）；想站起来要先确认头顶有空间，
   * 否则保持蹲姿 —— 不会站起来卡进天花板。
   */
  _updateCrouch(dt) {
    const keys = this.keys;
    if (this.mount || this.flying || this.swimming) {
      // 骑乘由坐骑接管碰撞体；飞行 / 游泳时 C 是下降。都不蹲
      if (this.crouching && !this.mount) this.bh = PLAYER_H;
      this.crouching = false;
      this.crouchToggled = false;
    } else {
      // 只认 C：Ctrl 在浏览器里和 W 组合是「关闭标签页」，不能拿来做需要按住的游戏键
      const want = this.crouchMode === "toggle" ? this.crouchToggled : keys.has("KeyC");
      if (want && !this.crouching) {
        this.crouching = true;
        this.bh = CROUCH_H;
      } else if (!want && this.crouching) {
        this.bh = PLAYER_H;
        if (this.collides(this.position.x, this.position.y, this.position.z)) this.bh = CROUCH_H; // 头顶有方块：站不起来
        else this.crouching = false;
      }
    }
    const target = this.crouching ? CROUCH_EYE_DROP : 0;
    this._crouchEye += (target - this._crouchEye) * (1 - Math.exp(-14 * dt));
  }

  /* ================= 水体 ================= */

  /**
   * 分别取脚部 / 躯干 / 眼睛所处的格子是否为液体。
   * 用格子中心判定，避免站在水陆交界处反复抖动。
   */
  probeWater() {
    const p = this.position;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    return {
      feet: isLiquid(this.world.get(x, Math.floor(p.y + 0.1), z)),
      mid: isLiquid(this.world.get(x, Math.floor(p.y + PLAYER_H * 0.5), z)),
      head: isLiquid(this.world.get(x, Math.floor(p.y + EYE_H), z)),
    };
  }

  /**
   * 浸没比例 0..1：身体有多大比例位于水面以下。
   *
   * 自上而下扫，找到的第一格水其顶面即近似水面高度。
   * 这个量直接决定浮力大小。
   */
  submersionAt() {
    const p = this.position;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    for (let h = PLAYER_H; h >= -0.01; h -= 0.25) {
      const wy = Math.floor(p.y + h);
      if (isLiquid(this.world.get(x, wy, z))) {
        const surfaceY = wy + 1;
        return Math.max(0, Math.min(1, (surfaceY - p.y) / PLAYER_H));
      }
    }
    return 0;
  }

  /* ================= 碰撞 ================= */

  /**
   * 玩家 AABB 是否与实心方块相交。
   * 使用半开区间 + epsilon，避免恰好贴合时误判。
   *
   * 注意：脚底恰好站在方块顶面（py 为整数）时，AABB 从 py 开始，
   * 不会包含下方那块实心方块 —— 这是正确的（否则会误判为陷入）。
   * 但落地判定需要额外检查「脚下是否有支撑」，见 hasSupportBelow()。
   */
  collides(px, py, pz) {
    const w = this.hw;
    const h = this.bh;
    const x0 = Math.floor(px - w + EPS);
    const x1 = Math.floor(px + w - EPS);
    const y0 = Math.floor(py + EPS);
    const y1 = Math.floor(py + h - EPS);
    const z0 = Math.floor(pz - w + EPS);
    const z1 = Math.floor(pz + w - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (isSolid(this.world.get(x, y, z))) return true;
        }
      }
    }
    return false;
  }

  /**
   * 脚下是否有支撑（脚底正下方一格是否为实心）。
   * 用于落地判定：玩家恰好站在方块顶面时 collides() 为 false，
   * 但此时应该算落地。
   */
  hasSupportBelow(px, py, pz) {
    const w = this.hw;
    const x0 = Math.floor(px - w + EPS);
    const x1 = Math.floor(px + w - EPS);
    const z0 = Math.floor(pz - w + EPS);
    const z1 = Math.floor(pz + w - EPS);
    const y = Math.floor(py - EPS); // 脚底正下方那一格
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (isSolid(this.world.get(x, y, z))) return true;
      }
    }
    return false;
  }

  /**
   * 沿单轴移动 amount，遇到碰撞则贴齐到方块表面。
   * 返回是否发生了碰撞。
   *
   * 解算策略：先二分逼近得到合法位置，再从方块网格直接推导贴合面，
   * 保证玩家精确站在方块顶面（不会悬空，也不会陷入）。
   */
  moveAxis(axis, amount) {
    if (amount === 0) return false;
    const p = this.position;
    const before = p[axis];
    p[axis] += amount;

    // 垂直下落时，即使 collides() 为 false，也要检查脚下支撑：
    // 玩家可能恰好停在方块顶面（此时 AABB 不包含下方方块）。
    if (axis === "y" && amount < 0 && !this.collides(p.x, p.y, p.z)) {
      if (this.hasSupportBelow(p.x, p.y, p.z)) {
        // 贴齐到支撑面，并标记落地
        const surface = Math.floor(p.y - EPS) + 1;
        p.y = surface;
        this.velocity.y = 0;
        this.onGround = true;
        return true;
      }
      return false;
    }

    if (!this.collides(p.x, p.y, p.z)) return false;

    const sign = Math.sign(amount);
    const w = this.hw;
    const h = this.bh;

    // 二分逼近：找到最远的合法位置
    p[axis] = before;
    let lo = 0;
    let hi = amount;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      p[axis] = before + mid;
      if (this.collides(p.x, p.y, p.z)) hi = mid;
      else lo = mid;
    }
    p[axis] = before + lo;

    // 从方块网格推导精确贴合面
    if (axis === "y") {
      if (sign < 0) {
        // 下落撞地：脚底对齐到最高实心方块的顶面。
        // 关键：必须从「本子步起点」向下扫描，而不是从当前位置，
        // 否则高速下落时会跳过薄壳（1 格厚的屋顶），直接吸附到下方地面。
        const startFeet = Math.floor(before + EPS);
        const endFeet = Math.floor(p.y + EPS);
        let surface = null;
        for (let y = startFeet; y >= endFeet - 1; y--) {
          if (this._anySolidAtY(y)) { surface = y + 1; break; }
        }
        if (surface !== null) {
          const saved = p.y;
          p.y = surface;
          if (this.collides(p.x, p.y, p.z)) p.y = saved;
        }
        // 只有真正找到支撑面（或脚下有支撑）才算落地，
        // 否则会出现「悬在空中也报 onGround」的假落地。
        this.onGround = surface !== null || this.hasSupportBelow(p.x, p.y, p.z);
      } else {
        // 上升撞顶：头顶对齐到最低实心方块的底面
        const startHead = Math.floor(before + h - EPS);
        const endHead = Math.floor(p.y + h - EPS);
        let surface = null;
        for (let y = startHead; y <= endHead + 1; y++) {
          if (this._anySolidAtY(y)) { surface = y - h - EPS; break; }
        }
        if (surface !== null) {
          const saved = p.y;
          p.y = surface;
          if (this.collides(p.x, p.y, p.z)) p.y = saved;
        }
      }
      this.velocity.y = 0;
    } else {
      // 水平：贴齐到方块侧面
      const other = axis === "x" ? "z" : "x";
      const lo2 = Math.floor(p[axis] - w + EPS);
      const hi2 = Math.floor(p[axis] + w - EPS);
      let surface = null;
      if (sign > 0) {
        for (let b = lo2; b <= hi2 + 1; b++) {
          if (this._anySolidAtXZ(axis, b)) { surface = b - w - EPS; break; }
        }
      } else {
        for (let b = hi2; b >= lo2 - 1; b--) {
          if (this._anySolidAtXZ(axis, b)) { surface = b + 1 + w + EPS; break; }
        }
      }
      if (surface !== null) {
        const saved = p[axis];
        p[axis] = surface;
        if (this.collides(p.x, p.y, p.z)) p[axis] = saved;
      }
      void other;
      this.velocity[axis] = 0;
    }
    return true;
  }

  /** 玩家 AABB 覆盖的范围内，指定 y 层是否有实心方块。 */
  _anySolidAtY(y) {
    const p = this.position;
    const w = this.hw;
    const x0 = Math.floor(p.x - w + EPS);
    const x1 = Math.floor(p.x + w - EPS);
    const z0 = Math.floor(p.z - w + EPS);
    const z1 = Math.floor(p.z + w - EPS);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (isSolid(this.world.get(x, y, z))) return true;
      }
    }
    return false;
  }

  /** 玩家 AABB 覆盖的范围内，指定 x 或 z 层是否有实心方块。 */
  _anySolidAtXZ(axis, value) {
    const p = this.position;
    const w = this.hw;
    const h = this.bh;
    const y0 = Math.floor(p.y + EPS);
    const y1 = Math.floor(p.y + h - EPS);
    const a0 = Math.floor(p[axis === "x" ? "z" : "x"] - w + EPS);
    const a1 = Math.floor(p[axis === "x" ? "z" : "x"] + w - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let a = a0; a <= a1; a++) {
        const x = axis === "x" ? value : a;
        const z = axis === "x" ? a : value;
        if (isSolid(this.world.get(x, y, z))) return true;
      }
    }
    return false;
  }

  /**
   * 子步进移动：把一帧位移拆成多个不超过 MAX_STEP 的子步，
   * 每个子步内逐轴扫掠。彻底消除高速隧穿。
   */
  moveWithCollision(dx, dy, dz) {
    const dist = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
    this.lastSubsteps = steps;

    const sx = dx / steps;
    const sy = dy / steps;
    const sz = dz / steps;

    for (let i = 0; i < steps; i++) {
      // 逐轴分离，避免斜向穿角
      this.moveAxis("x", sx);
      this.moveAxis("z", sz);
      this.moveAxis("y", sy);
    }
  }

  /* ================= 每帧更新 ================= */

  update(dt) {
    dt = Math.min(dt, 0.05);
    const keys = this.keys;

    // ---- 视角阻尼 ----
    const k = 1 - Math.exp(-this.damping * dt);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;

    // ---- 输入方向 ----
    let fwd = 0;
    let side = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) fwd += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) fwd -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) side += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) side -= 1;
    this._updateCrouch(dt);
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight");
    this.sprinting = this.sprintMode === "toggle" ? this.sprintToggled : shift;
    // 触屏摇杆：模拟量，轻推慢走、推到底疾跑
    const mi = this.moveInput;
    if (mi.active && (mi.x !== 0 || mi.y !== 0)) {
      fwd = mi.y;
      side = mi.x;
      this.sprinting = this.sprinting || mi.sprint;
    }
    // 切换式疾跑：停下（0.3 秒没有向前的输入）或蹲下时自动取消，与主流游戏一致
    if (fwd > 0) this._noFwdT = 0;
    else this._noFwdT += dt;
    if (this.sprintToggled && (this._noFwdT > 0.3 || this.crouching)) this.sprintToggled = false;
    if (this.crouching) this.sprinting = false;

    // 只把超过 1 的合成方向压回单位长度（键盘斜向）；摇杆的小幅度保留为慢速
    const len = Math.hypot(fwd, side);
    if (len > 1) {
      fwd /= len;
      side /= len;
    }

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);

    // ---- 入水判定 ----
    const w = this.probeWater();
    this.inWater = w.feet;
    this.submersion = w.feet || w.mid ? this.submersionAt() : 0;
    // 躯干浸在水里才算真的在游；只有脚踝沾水只是涉水
    this.swimming = w.mid && !this.flying;
    this.headUnderwater = w.head;

    // 入水/出水/潜水事件（用于溅水声与气泡）
    if (this.swimming && !this._wasSwimming) this.onSplash?.("enter");
    else if (!this.swimming && this._wasSwimming) this.onSplash?.("exit");
    if (this.headUnderwater && !this._wasHeadUnder) this.onSplash?.("dive");
    this._wasSwimming = this.swimming;
    this._wasHeadUnder = this.headUnderwater;

    if (this.flying) {
      this._updateFlight(dt, fwd, side, sinY, cosY, keys);
    } else if (this.swimming) {
      this._updateSwim(dt, fwd, side, sinY, cosY, keys);
    } else {
      this._updateWalk(dt, fwd, side, sinY, cosY, keys);
    }

    // ---- 蹲着走到边缘不会掉下去（MC 的潜行）：这一步会让脚下失去支撑的轴，速度清零 ----
    if (this.crouching && this.onGround && !this.flying && !this.swimming) {
      const p = this.position;
      const nx = p.x + this.velocity.x * dt, nz = p.z + this.velocity.z * dt;
      if (!this.hasSupportBelow(nx, p.y, p.z)) this.velocity.x = 0;
      if (!this.hasSupportBelow(p.x, p.y, nz)) this.velocity.z = 0;
      if (!this.hasSupportBelow(p.x + this.velocity.x * dt, p.y, p.z + this.velocity.z * dt)) {
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
    }

    // ---- 移动与碰撞（子步进） ----
    const wasGrounded = this.onGround;
    this.onGround = false;
    this.moveWithCollision(
      this.velocity.x * dt,
      this.velocity.y * dt,
      this.velocity.z * dt,
    );

    // 落地/滞空峰值追踪：用于落地音效强度
    // 飞行 / 游泳不累计下落高度：从飞行中落地、落进水里都不算摔
    if (this.flying || this.swimming || this.inWater) this._peakY = this.position.y;
    if (this.onGround) {
      if (!wasGrounded) this.onLand?.(Math.max(0, this._peakY - this.position.y));
      this._peakY = this.position.y;
    } else {
      this._peakY = Math.max(this._peakY, this.position.y);
    }

    // 掉出世界保护：绝不允许无限下坠。
    // 旧实现是「瞬移到 y=70 同一 x/z」，若那里正好是挖穿的洞，
    // 玩家会再次掉下去 —— 形成无限循环（用户遇到的 bug）。
    // 现在改为重生到校验过的安全点。
    if (this.position.y < VOID_Y) this.respawn();
    // 世界顶部硬限位：绝不允许飞出体素体积（否则上方无碰撞体可挡）
    const CEIL = CH - this.bh - 0.05;
    if (this.position.y > CEIL) {
      this.position.y = CEIL;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }
    const LIM = 176;
    this.position.x = Math.max(-LIM, Math.min(LIM, this.position.x));
    this.position.z = Math.max(-LIM, Math.min(LIM, this.position.z));

    // ---- 头部摆动 ----
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.headBob && this.onGround && horizSpeed > 0.6) {
      this.bobPhase += dt * horizSpeed * 1.85;
      const amp = Math.min(horizSpeed / RUN, 1) * 0.055;
      this.bobAmount = Math.sin(this.bobPhase * 2) * amp;
      this.roll = Math.sin(this.bobPhase) * amp * 0.42;
    } else {
      this.bobAmount *= 1 - Math.min(1, dt * 8);
      this.roll *= 1 - Math.min(1, dt * 8);
      this.bobPhase += dt * 1.2;
    }

    // ---- 脚步声 ----
    // 按「走过的距离」触发，而不是按时间 —— 步频才和实际行走节奏一致。
    // 旧版用 horizSpeed*dt*1.9 累加、阈值 1，导致每秒 ~9 步，像机关枪。
    // 步行约每 2.1 格一步、冲刺约每 2.6 格一步，听感自然。
    if (this.onGround && horizSpeed > 0.5) {
      this._stepT += horizSpeed * dt;
      const stepDist = this.sprinting ? 2.6 : 2.1;
      if (this._stepT >= stepDist) {
        this._stepT = 0;
        const below = this.world.get(
          Math.floor(this.position.x),
          Math.floor(this.position.y - EPS),
          Math.floor(this.position.z),
        );
        const name = this.inWater ? "water" : blockDef(below).name;
        this.onFootstep?.(name, this.sprinting);
      }
    } else {
      this._stepT = 0;
    }

    this.updateCamera(dt);
    this._applyShake(dt);
  }

  /**
   * 飞行物理：带质量的飞行。
   *  · 推进力沿视线方向（俯仰角影响速度矢量）
   *  · 线性空气阻力，松开按键后保留动量滑行
   *  · 俯冲时额外加速
   *  · 无输入时缓慢衰减，不会瞬间停住
   *
   * 关键：无输入时不能把速度衰减到 0，否则玩家会悬浮在空中。
   * 无推进时保留一个「滑行速度」，让玩家能真正飞到目标位置。
   */
  _updateFlight(dt, fwd, side, sinY, cosY, keys) {
    const v = this.velocity;
    const tune = this.flyTuning;
    const maxSpeed = this.sprinting ? tune.maxFast : tune.max;

    // 视线方向（含俯仰）
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const fwdX = -sinY * cp;
    const fwdY = sp;
    const fwdZ = -cosY * cp;
    // 右方向（水平）
    const rightX = cosY;
    const rightZ = -sinY;

    // 推进加速度
    let ax = 0;
    let ay = 0;
    let az = 0;
    if (fwd !== 0) {
      ax += fwdX * fwd * tune.accel;
      ay += fwdY * fwd * tune.accel;
      az += fwdZ * fwd * tune.accel;
    }
    if (side !== 0) {
      ax += rightX * side * tune.accel;
      az += rightZ * side * tune.accel;
    }
    // 垂直推进
    if (keys.has("Space")) ay += tune.accel * 0.85;
    if (keys.has("ControlLeft") || keys.has("KeyC")) ay -= tune.accel * 0.85;

    // 俯冲：朝下飞时额外加速（重力感）
    if (fwdY < -0.15 && fwd > 0) {
      ay += fwdY * FLY_DIVE;
    }

    v.x += ax * dt;
    v.y += ay * dt;
    v.z += az * dt;

    // 空气阻力（线性 + 二次项）
    const speed = v.length();
    if (speed > 0) {
      const drag = FLY_DRAG * speed + 0.02 * speed * speed;
      const decel = Math.min(drag * dt, speed);
      v.multiplyScalar((speed - decel) / speed);
    }

    // 限速
    const s2 = v.length();
    if (s2 > maxSpeed) v.multiplyScalar(maxSpeed / s2);

    // 防悬浮：无推进输入时，保留一个最小滑行速度，
    // 避免阻力把速度衰减到 0 导致玩家停在半空。
    const hasThrust = fwd !== 0 || side !== 0 || keys.has("Space") ||
                      keys.has("ControlLeft") || keys.has("KeyC");
    if (!hasThrust) {
      const sp2 = v.length();
      if (sp2 > 1e-4 && sp2 < FLY_GLIDE_MIN) {
        v.multiplyScalar(FLY_GLIDE_MIN / sp2);
      }
    }
  }

  /** 步行物理：重力 + 跳跃 + 地面/空中不同的操控性。 */
  _updateWalk(dt, fwd, side, sinY, cosY, keys) {
    // 浅滩涉水：速度明显下降，走起来有阻力
    const speed = (this.crouching ? WALK * CROUCH_SPEED : this.sprinting ? RUN : WALK) * (this.inWater ? WADE_DRAG : 1);
    const dirX = -sinY * fwd + cosY * side;
    const dirZ = -cosY * fwd - sinY * side;

    // 地面操控性强，空中弱（保留动量）
    const acc = this.onGround ? 1 - Math.exp(-18 * dt) : 1 - Math.exp(-4 * dt);
    this.velocity.x += (dirX * speed - this.velocity.x) * acc;
    this.velocity.z += (dirZ * speed - this.velocity.z) * acc;

    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -MAX_FALL) this.velocity.y = -MAX_FALL;

    if (keys.has("Space") && this.onGround) {
      this.velocity.y = JUMP_V;
      this.onJump?.();
      this.onGround = false;
    }
  }

  /**
   * 游泳物理。
   *
   *  · 浮力按浸没比例驱动：浸得越深托得越强，
   *    于是玩家自然停在「头露出水面」的平衡位置，而不是一直沉底或一直上飘
   *  · Space 上浮、Ctrl / C 下潜
   *  · 水的粘滞阻力远大于空气，松手后很快滑行减速
   */
  _updateSwim(dt, fwd, side, sinY, cosY, keys) {
    const v = this.velocity;
    const speed = this.sprinting ? SWIM_FAST : SWIM;
    const dirX = -sinY * fwd + cosY * side;
    const dirZ = -cosY * fwd - sinY * side;

    // 水平：水中加减速都比陆地柔和
    const acc = 1 - Math.exp(-6.5 * dt);
    v.x += (dirX * speed - v.x) * acc;
    v.z += (dirZ * speed - v.z) * acc;

    const up = keys.has("Space");
    const down = keys.has("ControlLeft") || keys.has("KeyC");

    // 目标垂直速度 = 自重下沉 + 浮力上托
    let targetVy = -WATER_SINK + BUOYANCY * this.submersion;
    if (up) targetVy = SWIM_UP;
    else if (down) targetVy = -SWIM_DOWN;

    v.y += (targetVy - v.y) * (1 - Math.exp(-SWIM_TURN * dt));

    // 站在水底时按跳跃可以蹬出水面（浅滩上岸）
    if (up && this.onGround) v.y = Math.max(v.y, JUMP_V * 0.72);

    // 划水音：有水平推进时周期触发
    if (fwd !== 0 || side !== 0) {
      this._strokeT += dt;
      if (this._strokeT >= 0.72) {
        this._strokeT = 0;
        this.onSwimStroke?.();
      }
    } else {
      this._strokeT = Math.max(0, this._strokeT - dt);
    }
  }

  /** 切换飞行：退出时保留水平动量，垂直速度平滑过渡到重力。 */
  toggleFly() {
    this.flying = !this.flying;
    if (!this.flying) {
      // 退出飞行：垂直速度衰减，交给重力接管（不瞬间归零）
      this.velocity.y *= 0.35;
      // 水平动量保留一部分，形成"滑落"感
      this.velocity.x *= 0.85;
      this.velocity.z *= 0.85;
    }
    return this.flying;
  }

  updateCamera(dt) {
    // 调试/截图机位：相机由外部摆放，控制器不接管
    if (this.mode === "debug") return;
    const cam = this.camera;
    const eye = this.eyePosition.clone();
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    if (this.mode === "first") {
      cam.position.copy(eye);
      cam.rotation.set(0, 0, 0);
      cam.rotateY(this.yaw);
      cam.rotateX(this.pitch);
      cam.rotateZ(this.roll);
      cam.fov = this.baseFov + Math.min((horizSpeed / RUN) * 5, 5);
      cam.updateProjectionMatrix();
    } else if (this.mode === "third") {
      const dir = new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        -Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch),
      ).normalize();
      let dist = this.thirdDist;
      const step = 0.22;
      const probe = this._probe;
      for (let d = 0.4; d <= dist; d += step) {
        probe.copy(eye).addScaledVector(dir, d);
        if (isSolid(this.world.get(Math.floor(probe.x), Math.floor(probe.y), Math.floor(probe.z)))) {
          dist = Math.max(0.6, d - 0.5);
          break;
        }
      }
      cam.position.copy(eye).addScaledVector(dir, dist);
      cam.rotation.set(0, 0, 0);
      cam.rotateY(this.yaw);
      cam.rotateX(this.pitch);
      cam.fov = this.baseFov;
      cam.updateProjectionMatrix();
    } else {
      this.orbitAngle += dt * 0.12;
      const cx = this.position.x + Math.cos(this.orbitAngle) * this.orbitDist;
      const cz = this.position.z + Math.sin(this.orbitAngle) * this.orbitDist;
      const cy = this.position.y + this.orbitHeight;
      cam.position.set(cx, cy, cz);
      cam.lookAt(this.position.x, this.position.y + 1.4, this.position.z);
      cam.fov = 62;
      cam.updateProjectionMatrix();
    }
  }

  /** 镜头震动（爆炸 / 龙吼 / 重摔）：随机偏移按指数衰减。 */
  _applyShake(dt) {
    if (!(this.shake > 0.001)) return;
    const a = this.shake * 0.35;
    this.camera.position.x += (Math.random() - 0.5) * a;
    this.camera.position.y += (Math.random() - 0.5) * a;
    this.camera.position.z += (Math.random() - 0.5) * a;
    this.shake *= Math.exp(-6 * dt);
  }

  cycleMode() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  /**
   * 寻找一个**校验过的安全出生点**。
   *
   * 安全定义：
   *   1. 该列存在不透明地面（gy >= 0）
   *   2. 脚部所在格与头顶两格都是空的（不会卡进方块）
   *
   * 从偏好点螺旋向外搜索，找不到则退而求其次。
   */
  findSafeSpawn(world, preferX = 0, preferZ = 84) {
    const ok = (x, z) => {
      const gy = world.groundHeight(x, z); // 只统计不透明方块
      if (gy < 0) return null;
      if (isSolid(world.get(x, gy + 1, z))) return null;
      if (isSolid(world.get(x, gy + 2, z))) return null;
      return gy;
    };

    const px = Math.round(preferX), pz = Math.round(preferZ);
    let gy = ok(px, pz);
    if (gy !== null) return new THREE.Vector3(px + 0.5, gy + 1.001, pz + 0.5);

    for (let r = 2; r <= 140; r += 2) {
      const n = Math.max(8, Math.round(r * 0.9));
      for (let a = 0; a < n; a++) {
        const ang = (a / n) * Math.PI * 2;
        const x = Math.round(px + Math.cos(ang) * r);
        const z = Math.round(pz + Math.sin(ang) * r);
        const g = ok(x, z);
        if (g !== null) return new THREE.Vector3(x + 0.5, g + 1.001, z + 0.5);
      }
    }

    // 兜底：任意有实心支撑的高度（基岩之上）
    for (let r = 0; r <= 140; r += 4) {
      for (const s of [-1, 1]) {
        const x = Math.round(px + r * s);
        const h = world.topSolidHeight(x, pz);
        if (h >= 0) return new THREE.Vector3(x + 0.5, h + 1.001, pz + 0.5);
      }
    }
    return new THREE.Vector3(px + 0.5, CH - 20, pz + 0.5);
  }

  /**
   * 瞬移后清掉「下落起点」：摔落伤害按 (最高点 - 落地点) 计算，
   * 不重置的话从高处瞬移到地面（读档 / 重生 / 传送）会被当成一次致命坠落。
   */
  resetFall() {
    this._peakY = this.position.y;
    this.safeFall = false;
  }

  /** 重生到安全点（掉出世界时调用）。 */
  respawn() {
    const p = this.findSafeSpawn(this.world, 0, 84);
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.onGround = true;
    this.flying = false;
    this.voidRespawns = (this.voidRespawns || 0) + 1;
    this.resetFall();
    if (this.onRespawn) this.onRespawn(p);
    return p;
  }

  /** 出生点：校验过的安全位置，面向主殿。 */
  spawnAt(world) {
    const p = this.findSafeSpawn(world, 0, 84);
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.onGround = true;
    this.resetFall();
    this.yaw = Math.PI;
    this.targetYaw = Math.PI;
    this.pitch = -0.05;
    this.targetPitch = -0.05;
    return p;
  }
}
