/**
 * 末影龙模型 —— 按 Minecraft Java 版 EnderDragonModel 1:1 还原。
 *
 * 部件尺寸、枢轴、box UV 偏移（256×256 贴图）全部照原版：
 *   头：上唇 12×5×16 / 头颅 16×16×16 / 双角鳞 2×4×6 / 双鼻孔 2×2×4，下颚 12×4×16
 *   颈：5 节 10×10×10 + 每节背鳞 2×4×6
 *   身：24×24×64 + 三片背鳞 2×6×12
 *   翼：翼骨 56×8×8 + 翼膜 56×0×56；翼尖骨 56×4×4 + 翼尖膜 56×0×56
 *   前腿 8×24×8 → 6×24×6 → 足 8×4×16；后腿 16×32×16 → 12×32×12 → 足 18×6×24
 *   尾：12 节 10×10×10 + 背鳞
 *
 * 坐标：原版模型单位 1/16 格、Y 轴向下、-Z 为前；这里换成 three（Y 向上），
 * 整体再乘 DRAGON_SCALE（作坐骑用，比原版的 16 格体长小一些，比例不变）。
 *
 * 贴图是程序化绘制的（零外链），但 UV 布局与原版完全一致 ——
 * 换上原版 dragon.png 也能直接对上。眼睛单独一层自发光网格，进选择性泛光。
 */
import * as THREE from "three";
import { skinBox } from "../player/skin.js";
import { BLOOM_SCENE } from "../core/renderer.js";

export const DRAGON_SCALE = 0.75; // 体长约 13 格、翼展约 12 格（原版 1.0 约 16 格）
const TEX = 256;
const U = DRAGON_SCALE / 16; // 原版 1 模型单位 → 世界单位

/** 原版 box(x, y, z, w, h, d) 的几何：skinBox 以中心为原点，这里平移到原版的盒子角点。 */
function mcBox(x, y, z, w, h, d, u, v, mirror = false) {
  const g = skinBox(w, h, d, u, v, 0, TEX, TEX, U);
  // 原版 y 向下：盒子占 y..y+h → three 里占 -(y+h)..-y
  g.translate((x + w / 2) * U, -(y + h / 2) * U, (z + d / 2) * U);
  if (mirror) {
    g.scale(-1, 1, 1);
    // 镜像会翻转三角形绕序，换回来保持正面朝外
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.index.needsUpdate = true;
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setX(i, -n.getX(i));
  }
  return g;
}

/** 原版坐标 → three 坐标（单位换算 + Y 翻转）。 */
const P = (x, y, z) => new THREE.Vector3(x * U, -y * U, z * U);

/* ------------------------------------------------------------------ */
/* 贴图                                                                 */
/* ------------------------------------------------------------------ */

const hash = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

function paintDragonTexture() {
  const c = document.createElement("canvas");
  c.width = TEX;
  c.height = TEX;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(TEX, TEX);
  const d = img.data;
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= TEX || y >= TEX) return;
    const i = (y * TEX + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  };

  /**
   * 区域填充：kind 决定材质
   *   scale    —— 躯干/颈/尾：近黑底 + 交错的鳞片亮点（原版那种深灰麻点）
   *   spine    —— 背鳞：较亮的灰
   *   bone     —— 翼骨：深灰 + 骨节横纹
   *   membrane —— 翼膜：极暗 + 纵向肋纹
   *   claw     —— 爪/足：灰黑
   */
  const region = (x0, y0, w, h, kind) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const n = hash(x, y, 9);
        let v;
        if (kind === "scale") {
          // 鳞片：2×2 交错格，格心稍亮
          const cx = (x + ((y >> 1) & 1)) & 1;
          const cy = y & 1;
          v = 18 + n * 10 + (cx === 0 && cy === 0 ? 14 : 0);
        } else if (kind === "spine") {
          v = 52 + n * 18;
        } else if (kind === "bone") {
          v = 34 + n * 10 + ((x % 8) === 0 ? 12 : 0);
        } else if (kind === "membrane") {
          v = 14 + n * 6 + ((x % 14) === 0 ? 10 : 0) + ((y % 14) === 0 ? 6 : 0);
        } else {
          v = 28 + n * 14;
        }
        // 原版末影龙带一点冷紫偏色
        put(x, y, v, v * 0.95, v * 1.12);
      }
    }
  };

  // 按原版 texOffs 与 box 尺寸铺满各部件的 UV 区域（box UV 占 2(w+d) × (d+h)）
  const boxArea = (u, v, w, h, dd, kind) => region(u, v, 2 * (w + dd), dd + h, kind);
  boxArea(0, 0, 24, 24, 64, "scale"); // 身体
  boxArea(112, 30, 16, 16, 16, "scale"); // 头颅
  boxArea(176, 44, 12, 5, 16, "scale"); // 上唇
  boxArea(176, 65, 12, 4, 16, "scale"); // 下颚
  boxArea(192, 104, 10, 10, 10, "scale"); // 颈/尾节
  boxArea(48, 0, 2, 4, 6, "spine"); // 颈背鳞
  boxArea(220, 53, 2, 6, 12, "spine"); // 身背鳞
  boxArea(0, 0, 2, 4, 6, "spine"); // 头角
  boxArea(112, 0, 2, 2, 4, "claw"); // 鼻孔
  boxArea(112, 88, 56, 8, 8, "bone"); // 翼骨
  boxArea(112, 136, 56, 4, 4, "bone"); // 翼尖骨
  region(0, 88, 112, 56, "membrane"); // 翼膜（零厚度盒：顶/底两面）
  region(0, 144, 112, 56, "membrane"); // 翼尖膜
  boxArea(112, 104, 8, 24, 8, "scale"); // 前腿
  boxArea(226, 138, 6, 24, 6, "scale"); // 前小腿
  boxArea(144, 104, 8, 4, 16, "claw"); // 前足
  boxArea(0, 0, 16, 32, 16, "scale"); // 后腿（与身体共用原版偏移）
  boxArea(196, 0, 12, 32, 12, "scale"); // 后小腿
  boxArea(112, 0, 18, 6, 24, "claw"); // 后足

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/* 模型                                                                 */
/* ------------------------------------------------------------------ */

export class DragonModel {
  constructor() {
    this.texture = paintDragonTexture();
    this.mat = new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.7, metalness: 0.1 });
    this.matMembrane = new THREE.MeshStandardMaterial({
      map: this.texture, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide,
    });
    // 末影龙的紫眼：不受光照、直接高亮输出，进选择性泛光
    this.matEye = new THREE.MeshBasicMaterial({ color: 0xe27bff, toneMapped: false });
    this.matEye.color.multiplyScalar(2.2);

    this.root = new THREE.Group();
    this.root.name = "ender-dragon";
    this._build();
    this.root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.flap = 0;
  }

  _mesh(geo, parent, mat = this.mat) {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  }

  _part(pivot, parent) {
    const g = new THREE.Group();
    g.position.copy(pivot);
    parent.add(g);
    return g;
  }

  _build() {
    // frame：整条龙随扇翼上下起伏的载体（原版各部件都挂在模型根上，这里统一挂 frame）
    const F = new THREE.Group();
    this.root.add(F);
    this.frame = F;

    // ---- 身体：枢轴 (0, 4, 8) ----
    this.body = this._part(P(0, 4, 8), F);
    this._mesh(mcBox(-12, 0, -16, 24, 24, 64, 0, 0), this.body);
    for (const z of [-10, 10, 30]) this._mesh(mcBox(-1, -6, z, 2, 6, 12, 220, 53), this.body);

    // ---- 颈：5 节，链式挂在身体前端 ----
    this.neck = [];
    let parent = this.body;
    for (let i = 0; i < 5; i++) {
      const seg = this._part(i === 0 ? P(0, 6, -20) : P(0, 0, -10), parent);
      this._mesh(mcBox(-5, -5, -5, 10, 10, 10, 192, 104), seg);
      this._mesh(mcBox(-1, -9, -3, 2, 4, 6, 48, 0), seg);
      this.neck.push(seg);
      parent = seg;
    }

    // ---- 头：挂在第 5 节颈前端 ----
    this.head = this._part(P(0, 0, -10), parent);
    this._mesh(mcBox(-6, -1, -24, 12, 5, 16, 176, 44), this.head); // 上唇
    this._mesh(mcBox(-8, -8, -10, 16, 16, 16, 112, 30), this.head); // 头颅
    this._mesh(mcBox(-5, -12, -4, 2, 4, 6, 0, 0), this.head); // 左角鳞
    this._mesh(mcBox(3, -12, -4, 2, 4, 6, 0, 0, true), this.head); // 右角鳞（镜像）
    this._mesh(mcBox(-5, -3, -22, 2, 2, 4, 112, 0), this.head); // 左鼻孔
    this._mesh(mcBox(3, -3, -22, 2, 2, 4, 112, 0, true), this.head); // 右鼻孔
    this.jaw = this._part(P(0, 4, -8), this.head);
    this._mesh(mcBox(-6, 0, -16, 12, 4, 16, 176, 65), this.jaw);

    // 紫眼：贴在头颅前脸上半部两侧，并包住一点侧面（原版 dragon_eyes 的位置）
    const eye = new THREE.BoxGeometry(5 * U, 1.6 * U, 0.6 * U);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(eye, this.matEye);
      e.position.copy(P(s * 5, -4.5, -10.25));
      e.layers.enable(BLOOM_SCENE);
      this.head.add(e);
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.6 * U, 1.6 * U, 3.5 * U), this.matEye);
      side.position.copy(P(s * 8.25, -4.5, -8.5));
      side.layers.enable(BLOOM_SCENE);
      this.head.add(side);
    }
    // 吐息发射点：上下唇之间
    this.mouth = this._part(P(0, 2, -24), this.head);

    // ---- 双翼：枢轴 (∓12, 5, 2)；右翼是左翼 box 的 X 镜像（与原版一致） ----
    this.wings = [];
    for (const s of [-1, 1]) {
      const m = s > 0;
      const wing = this._part(P(s * 12, 5, 2), F);
      this._mesh(mcBox(-56, -4, -4, 56, 8, 8, 112, 88, m), wing);
      this._mesh(mcBox(-56, 0, 2, 56, 0, 56, -56, 88, m), wing, this.matMembrane);
      const tip = this._part(P(s * 56, 0, 0), wing);
      this._mesh(mcBox(-56, -2, -2, 56, 4, 4, 112, 136, m), tip);
      this._mesh(mcBox(-56, 0, 2, 56, 0, 56, -56, 144, m), tip, this.matMembrane);
      this.wings.push({ wing, tip, s });
    }

    // ---- 腿：前 (∓12, 20, 2)，后 (∓16, 16, 42) ----
    this.legs = [];
    for (const s of [-1, 1]) {
      const m = s > 0;
      const front = this._part(P(s * 12, 20, 2), F);
      this._mesh(mcBox(-4, -4, -4, 8, 24, 8, 112, 104, m), front);
      const ftip = this._part(P(0, 20, -1), front);
      this._mesh(mcBox(-3, -1, -3, 6, 24, 6, 226, 138, m), ftip);
      const ffoot = this._part(P(0, 23, 0), ftip);
      this._mesh(mcBox(-4, 0, -12, 8, 4, 16, 144, 104, m), ffoot);

      const rear = this._part(P(s * 16, 16, 42), F);
      this._mesh(mcBox(-8, -4, -8, 16, 32, 16, 0, 0, m), rear);
      const rtip = this._part(P(0, 32, -4), rear);
      this._mesh(mcBox(-6, -2, 0, 12, 32, 12, 196, 0, m), rtip);
      const rfoot = this._part(P(0, 31, 4), rtip);
      this._mesh(mcBox(-9, 0, -20, 18, 6, 24, 112, 0, m), rfoot);
      this.legs.push({ front, ftip, ffoot, rear, rtip, rfoot });
    }

    // ---- 尾：12 节，链式挂在身体后端 ----
    this.tail = [];
    parent = this.body;
    for (let i = 0; i < 12; i++) {
      const seg = this._part(i === 0 ? P(0, 6, 53) : P(0, 0, 10), parent);
      this._mesh(mcBox(-5, -5, -5, 10, 10, 10, 192, 104), seg);
      this._mesh(mcBox(-1, -9, -3, 2, 4, 6, 48, 0), seg);
      this.tail.push(seg);
      parent = seg;
    }

    // 骑乘座位：颈根上方
    this.seat = this._part(P(0, -1, -10), this.body);
  }

  /**
   * 原版 setupAnim 的扇翼曲线：
   *   wing.xRot  = 0.125 - cos(f) * 0.2
   *   wing.zRot  = -(sin(f) + 0.125) * 0.8      （右翼取反）
   *   tip.zRot   =  (sin(f + 2) + 0.5) * 0.75
   *   jaw.xRot   = (sin(f) + 1) * 0.2
   * 颈与尾沿链条做相位递进的正弦摆动；腿保持原版的收拢飞行姿态。
   *
   * @param {number} dt
   * @param {object} s { flapRate: 每秒扇翼次数, glide: 0..1 滑翔（翼展开不扇）, jawOpen: 0..1, turn: -1..1 }
   */
  update(dt, s = {}) {
    const rate = s.flapRate ?? 0.6;
    this.flap += dt * rate;
    const f = this.flap * Math.PI * 2;
    const glide = s.glide ?? 0;

    // 符号换算：原版模型空间 Y 向下，换到 three（Y 向上）后，
    // 绕 X / Z 轴的旋转取反、绕 Y 轴不变；右翼是左翼的 X 镜像，Y / Z 旋转再取反。
    for (const { wing, tip, s: side } of this.wings) {
      // 主翼上扬角：(sin f + 0.125) × 0.8 —— 上扬约 52°、下扇约 40°
      const up = (Math.sin(f) + 0.125) * 0.8 * (1 - glide) + 0.06 * glide;
      wing.rotation.x = -(0.125 - Math.cos(f) * 0.2 * (1 - glide));
      wing.rotation.y = -side * 0.25; // 后掠
      wing.rotation.z = side * up;
      // 翼尖相对主翼下垂：(sin(f + 2) + 0.5) × 0.75，相位领先 2 弧度形成鞭梢甩动
      const droop = (Math.sin(f + 2) + 0.5) * 0.75 * (1 - glide) + 0.12 * glide;
      tip.rotation.z = -side * droop;
    }

    this.jaw.rotation.x = Math.max((Math.sin(f) + 1) * 0.06, (s.jawOpen ?? 0) * 0.65);

    // 颈：抬头 + 随扇翼起伏；转向时头先摆
    const turn = s.turn ?? 0;
    for (let i = 0; i < this.neck.length; i++) {
      const k = i / this.neck.length;
      this.neck[i].rotation.x = -0.06 + Math.sin(f - i * 0.6) * 0.035 + (s.headPitch ?? 0) * 0.12;
      this.neck[i].rotation.y = turn * 0.09 * (1 - k * 0.3);
    }
    this.head.rotation.x = 0.18 - (s.headPitch ?? 0) * 0.4;
    // 尾：横向相位波 + 微垂；转向时尾向反方向甩
    for (let i = 0; i < this.tail.length; i++) {
      this.tail[i].rotation.y = Math.sin(f * 0.5 - i * 0.45) * 0.045 - turn * 0.035;
      this.tail[i].rotation.x = 0.02 + Math.sin(f - i * 0.5) * 0.02;
    }
    // 腿：原版飞行姿态（前腿 1.3/-0.5/0.75，后腿 1.0/0.5/0.75）—— three 的 Y 翻转让 xRot 取反
    for (const L of this.legs) {
      L.front.rotation.x = -1.3 * 0.75;
      L.ftip.rotation.x = 0.5;
      L.ffoot.rotation.x = -0.75;
      L.rear.rotation.x = -1.0 * 0.85;
      L.rtip.rotation.x = -0.5;
      L.rfoot.rotation.x = -0.75;
    }
    // 整条龙随扇翼上下浮动（下扇时上升）
    this.frame.position.y = Math.sin(f + 1.2) * 1.6 * U * (1 - glide * 0.7);
  }

  /** 吐息发射点的世界坐标与朝向。 */
  mouthWorld(outPos, outDir) {
    this.mouth.getWorldPosition(outPos);
    if (outDir) {
      outDir.set(0, 0, -1).applyQuaternion(this.head.getWorldQuaternion(new THREE.Quaternion()));
    }
    return outPos;
  }
}
