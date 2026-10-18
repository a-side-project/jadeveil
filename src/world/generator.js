/**
 * 世界生成 —— 潘达利亚风格地形 + 熊猫人主城。
 *
 * 布局（世界坐标，主城中心在原点）：
 *   · 中轴大道沿 Z 轴，自南（+Z）向北（-Z）延伸
 *   · 南端：石狮牌坊 → 灯笼长街 → 中央水池（荷花）→ 主殿（重檐金瓦）
 *   · 东西两侧：坊市、宝塔、竹林、云雾仙山浮岛
 */
import { ID, BEDROCK_TOP } from "./blocks.js";
import { VoxelWorld, CH } from "./voxelWorld.js";
import { fbm2, ridge2, valueNoise2, hash2i, clamp, smoothstep, warp2 } from "../core/noise.js";
import { CITY_PLAN } from "./cityPlan.js";

export const CITY = {
  center: [0, 0],
  plazaRadius: 26,
  avenueHalfWidth: 5,
  avenueStart: 96, // 南端
  avenueEnd: -34, // 北端（主殿前）
  waterY: 30, // 水面高度
  baseY: 34, // 主城地坪高度
};

export class WorldGenerator {
  constructor(seed = 20261014) {
    this.seed = seed;
    this.world = new VoxelWorld(seed);
    this.landmarks = [];
  }

  /* ================= 地形高度场 ================= */

  /** 返回 [地表高度, 生物群系] —— 群系: 0 平原 1 丘陵 2 山 3 湖 */
  heightAt(x, z) {
    const s = this.seed;
    const [wx, wz] = warp2(x * 0.006, z * 0.006, 14, s + 5);

    const continent = fbm2(wx * 0.0045, wz * 0.0045, { octaves: 4, seed: s });
    const hills = fbm2(wx * 0.018, wz * 0.018, { octaves: 4, seed: s + 31 });
    const ridge = ridge2(wx * 0.011, wz * 0.011, { octaves: 5, seed: s + 77 });
    const detail = fbm2(x * 0.09, z * 0.09, { octaves: 3, seed: s + 101 });

    // 主城周围压平，形成台地
    const d = Math.hypot(x, z);
    const flat = 1 - smoothstep(CITY.plazaRadius + 6, CITY.plazaRadius + 46, d);

    // 山脉权重：离城越远越强
    const mountainMask = smoothstep(70, 190, d) * smoothstep(0.42, 0.72, continent);

    let h = 26 + continent * 12 + hills * 7 + detail * 2.2;
    h += ridge * ridge * 46 * mountainMask;

    // 湖泊：低洼处
    const lakeN = fbm2(wx * 0.009 + 40, wz * 0.009 - 22, { octaves: 3, seed: s + 200 });
    const lakeMask = smoothstep(0.62, 0.34, lakeN) * (1 - mountainMask) * smoothstep(30, 60, d);
    h = h * (1 - lakeMask) + (CITY.waterY - 3) * lakeMask;

    // 主城台地
    h = h * (1 - flat) + CITY.baseY * flat;

    return Math.round(clamp(h, 6, CH - 12));
  }

  biomeAt(x, z, h) {
    const d = Math.hypot(x, z);
    if (h <= CITY.waterY + 1 && d > 30) return 3;
    if (h > 62) return 2;
    if (h > 46) return 1;
    return 0;
  }

  /* ================= 地形填充 ================= */

  /**
   * 世界底基岩层。
   *
   * 铺满整个生成区域（含城墙外、浮岛正下方），作为世界的绝对底。
   * 不可破坏、不可覆盖，从根源上杆绝「挖穿后无限下坠」。
   */
  buildBedrock() {
    const w = this.world;
    const R = 176; // 比生成半径（168）再大一圈，避免边缘漏洞
    for (let x = -R; x <= R; x++) {
      for (let z = -R; z <= R; z++) {
        w.fillColumnRaw(x, z, 0, BEDROCK_TOP, ID.bedrock);
      }
    }
    return this;
  }

  generateTerrain() {
    const w = this.world;
    const R = 168; // 生成半径（区块对齐）
    const step = 1;
    // 从基岩顶面之上开始填充，一直填到地表。
    // 关键：必须填满到 y = BEDROCK_TOP+1，否则地表之下会留下真空腔，
    // 玩家挖下去就会掉进虚空（旧版只填 14 格，这是无限下坠的根因）。
    const yBase = BEDROCK_TOP + 1;

    for (let x = -R; x <= R; x += step) {
      for (let z = -R; z <= R; z += step) {
        const h = this.heightAt(x, z);
        const biome = this.biomeAt(x, z, h);

        for (let y = yBase; y <= h; y++) {
          let id;
          const depth = h - y;
          if (depth === 0) {
            if (biome === 3) id = ID.sand;
            else if (biome === 2) id = h > 74 ? ID.stone_dark : ID.rock;
            else id = ID.grass;
          } else if (depth < 4) {
            id = biome === 3 ? ID.sand : ID.dirt;
          } else if (depth < 9) {
            id = ID.rock;
          } else {
            id = ID.stone_dark;
          }
          if (biome === 2 && depth === 0 && hash2i(x, z, this.seed + 9) > 0.55) id = ID.moss_stone;
          w.setRaw(x, y, z, id);
        }

        // 水体
        if (h < CITY.waterY) {
          w.fillColumnRaw(x, z, h + 1, CITY.waterY, ID.water);
        }
      }
    }
    return this;
  }

  /* ================= 植被散布 ================= */

  scatterVegetation() {
    const w = this.world;
    const R = 150;
    for (let x = -R; x <= R; x++) {
      for (let z = -R; z <= R; z++) {
        const d = Math.hypot(x, z);
        if (d < CITY.plazaRadius + 4) continue;
        // 宫墙以内是整平过的台地：地表在地坪上，按低地林（竹林为主）长；墙外按天然地形
        const terrace = this.insideWall(x, z, 2);
        const nh = terrace ? CITY.baseY : this.heightAt(x, z);
        const biome = terrace ? 0 : this.biomeAt(x, z, nh);
        if (biome === 3) continue;
        // 植被种在「现在」的地表上，而不是天然地形高度上：植被在所有建筑之后才撒，
        // 主城台地底下原本是草地 —— 按天然高度种，树干会从地下穿过主殿地面、树冠塞满殿内
        // （曾经的 1550 块松针：看不见的空气墙 + 闪烁）。
        const h = w.groundHeight(x, z);
        if (h < nh - 1 || h > Math.max(nh, CITY.baseY) + 1) continue; // 头顶是浮岛 / 建筑：不是地表
        const top = w.get(x, h, z);
        if (top !== ID.grass && top !== ID.moss_stone) continue;
        if (w.get(x, h + 1, z) !== ID.air) continue;
        // 紧贴结构的一格不种（留出走动的缝）；树冠、竹丛的每一格由 _avoidFootprint 把关，
        // 整棵作为一件放置 —— 有一格会伸进结构就整棵不种（旧版一刀切留 4 格，城里只剩两成空地能长树）
        if (this.claimed(x, z, 1)) continue;

        const r = hash2i(x, z, this.seed + 555);
        const bambooDensity = smoothstep(120, 40, d) * 0.5 + 0.12;

        if (biome === 2) {
          if (r < 0.035) this._item(() => this.pineTree(x, h + 1, z));
          else if (r < 0.06) w.set(x, h + 1, z, ID.grass_tuft);
        } else if (biome === 1) {
          if (r < 0.05) this._item(() => this.pineTree(x, h + 1, z));
          else if (r < 0.16) this.bambooCluster(x, h + 1, z);
          else if (r < 0.22) w.set(x, h + 1, z, ID.grass_tuft);
          else if (r < 0.25) w.set(x, h + 1, z, ID.flower_yellow);
        } else {
          if (r < bambooDensity * 0.22) this.bambooCluster(x, h + 1, z);
          else if (r < bambooDensity * 0.3) this._item(() => this.pineTree(x, h + 1, z));
          else if (r < 0.3) w.set(x, h + 1, z, ID.grass_tuft);
          else if (r < 0.34) w.set(x, h + 1, z, ID.flower_red);
          else if (r < 0.37) w.set(x, h + 1, z, ID.flower_yellow);
        }
      }
    }
    return this;
  }

  bambooCluster(x, y, z) {
    const w = this.world;
    const n = 3 + ((hash2i(x, z, this.seed + 71) * 4) | 0);
    for (let i = 0; i < n; i++) {
      const ox = x + ((hash2i(x + i, z, 3) * 5) | 0) - 2;
      const oz = z + ((hash2i(x, z + i, 7) * 5) | 0) - 2;
      const base = w.groundHeight(ox, oz);
      if (base < 0) continue;
      // 竹子只长在土地上（groundHeight 取的是最高的不透明方块 —— 可能是屋顶、墙头），且整根竹竿的位置必须是空的
      const soil = w.get(ox, base, oz);
      if (soil !== ID.grass && soil !== ID.moss_stone && soil !== ID.dirt) continue;
      if (Math.abs(base - (y - 1)) > 2) continue;
      // 竹竿不能立在结构占地的列里（贴墙一格也不行）；竹叶伸进占地的那几片由 _avoidFootprint 逐片剪掉
      if (this.claimed(ox, oz, 1)) continue;
      const hgt = 9 + ((hash2i(ox, oz, 13) * 9) | 0);
      let clear = true;
      for (let k = 1; k <= hgt && clear; k++) if (w.get(ox, base + k, oz) !== ID.air) clear = false;
      if (!clear) continue;
      for (let k = 1; k <= hgt; k++) {
        if (base + k >= CH) break;
        w.set(ox, base + k, oz, ID.bamboo);
      }
      // 竹叶
      for (let k = Math.max(2, hgt - 6); k <= hgt; k++) {
        const ly = base + k;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            if (dx === 0 && dz === 0) continue;
            if (Math.abs(dx) + Math.abs(dz) > 3) continue;
            if (hash2i(ox + dx, oz + dz + k, 21) > 0.45) {
              w.setIfAir(ox + dx, ly, oz + dz, ID.bamboo_leaf);
            }
          }
        }
      }
    }
  }

  pineTree(x, y, z) {
    const w = this.world;
    const hgt = 8 + ((hash2i(x, z, 31) * 7) | 0);
    // 树干所在的整列（含树冠高度）必须是空的：不会长进建筑、屋檐、浮岛里
    for (let k = 0; k <= hgt + 1; k++) if (w.get(x, y + k, z) !== ID.air) return;
    for (let k = 0; k < hgt; k++) {
      if (y + k >= CH) break;
      w.set(x, y + k, z, ID.wood_beam);
    }
    // 层叠树冠
    let radius = 3;
    for (let k = hgt - 1; k >= 3; k--) {
      const ly = y + k;
      const r = k > hgt - 3 ? 2 : radius;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dz * dz > r * r + 1) continue;
          if (dx === 0 && dz === 0 && k < hgt) continue;
          if (hash2i(x + dx, z + dz + k * 7, 41) > 0.22) {
            w.setIfAir(x + dx, ly, z + dz, ID.pine_leaf);
          }
        }
      }
      if (k % 2 === 0 && radius < 4) radius++;
    }
    w.setIfAir(x, y + hgt, z, ID.pine_leaf);
  }

  /* ================= 主城 ================= */

  /** 把主城范围内及中轴大道的地面整平并铺上青石板。 */
  flattenCity() {
    const w = this.world;
    const R = CITY.plazaRadius + 8;
    // 中轴大道延伸得比城区更远，必须一并整平，
    // 否则牌坊/城门/长街会被埋在自然地形里。
    const CORRIDOR_HALF = 26;
    const Z_MIN = -118;
    const Z_MAX = 118;

    // 台地以上整列清空，而不是只清到天然地形高度：
    // 台地比原地形高的地方（原来是山谷），山谷里长出来的松树、竹林会把树冠留在台地上方，
    // 之后的建筑直接盖在这些树冠上 —— 主殿里曾藏着 1550 块松针（看不见的「空气墙」+ 闪烁）。
    // 这一步在浮岛、云、宝塔之前执行，此时台地上方只有地形和植被。
    // surface：广场、中轴走廊铺石板；宫墙内其余空地是草地（坊间的竹林、松林、花草长在这里 ——
    // 整片铺成石板时城里一棵树都长不出来，整座城只剩光秃秃的建筑）
    const flattenAt = (x, z, surface = ID.slate) => {
      const h = this.heightAt(x, z);
      for (let y = CITY.baseY + 1; y < CH; y++) if (w.get(x, y, z) !== ID.air) w.set(x, y, z, ID.air);
      for (let y = h + 1; y < CITY.baseY; y++) w.set(x, y, z, ID.dirt);
      w.set(x, CITY.baseY, z, surface);
    };
    const paved = (x, z) => Math.hypot(x, z) <= R || Math.abs(x) <= CORRIDOR_HALF;

    // 1) 宫墙以内整片台地（外扩 2 格给墙基）：坊市、宝塔、宫墙都落在同一个地坪上。
    //    旧版只整平中央圆形广场 + 中轴走廊，两侧的坊市和宫墙坐在起伏的天然地形上 ——
    //    有的悬空、有的埋进山里（审计：3368 列悬空）
    const wl = CITY_PLAN.wall;
    for (let x = -wl.halfX - 2; x <= wl.halfX + 2; x++) {
      for (let z = wl.north - 2; z <= wl.south + 2; z++) flattenAt(x, z, paved(x, z) ? ID.slate : ID.grass);
    }
    // 2) 中央圆形广场与中轴大道走廊在墙外延伸的部分（南出城门、北连远山）
    for (let x = -Math.max(R, CORRIDOR_HALF); x <= Math.max(R, CORRIDOR_HALF); x++) {
      for (let z = Z_MIN; z <= Z_MAX; z++) {
        if (Math.abs(x) <= wl.halfX + 2 && z >= wl.north - 2 && z <= wl.south + 2) continue; // 已整平
        if (Math.abs(x) > CORRIDOR_HALF && Math.hypot(x, z) > R) continue;
        flattenAt(x, z);
      }
    }
    return this;
  }

  /** 中轴大道：从南端牌坊直通主殿。 */
  buildAvenue() {
    const w = this.world;
    const hw = CITY.avenueHalfWidth;
    for (let z = CITY.avenueEnd; z <= CITY.avenueStart; z++) {
      for (let x = -hw - 3; x <= hw + 3; x++) {
        const edge = Math.abs(x) > hw;
        w.set(x, CITY.baseY, z, edge ? ID.marble : ID.slate);
        // 路缘石
        if (Math.abs(x) === hw + 1) w.set(x, CITY.baseY, z, ID.marble);
        if (Math.abs(x) === hw + 2) w.set(x, CITY.baseY, z, ID.slate);
        // 清理上方
        for (let y = CITY.baseY + 1; y < CITY.baseY + 14; y++) w.set(x, y, z, ID.air);
      }
      // 中央御道金线
      if (z % 8 === 0) {
        for (let x = -1; x <= 1; x++) w.set(x, CITY.baseY, z, ID.gold_brick);
      }
    }
    return this;
  }

  /**
   * 灯笼长街：大道两侧成对的宫灯，从主殿前（avenueEnd）一路排向南端城门。
   *
   * 旧版写成 z -= 9、从 avenueEnd 往北排 —— 方向反了，十几对灯柱排进了主殿和殿后，
   * 殿里的 12 盏灯笼、6 根挑杆就是这么来的。现在在所有建筑之后生成，
   * 并且只在整根灯柱的位置都是空的时候才立（水池、桥、牌坊、城门处自动跳过）。
   */
  buildLanternStreet() {
    const w = this.world;
    const hw = CITY.avenueHalfWidth;
    for (let z = CITY.avenueEnd + 6; z <= CITY.avenueStart - 6; z += 9) {
      for (const sx of [-1, 1]) {
        const x = sx * (hw + 3);
        const base = CITY.baseY;
        let clear = w.solidAt(x, base, z) && !w.liquidAt(x, base, z);
        for (let k = 1; k <= 9 && clear; k++) if (w.get(x, base + k, z) !== ID.air) clear = false;
        if (!clear) continue;
        // 灯柱
        for (let k = 1; k <= 4; k++) w.set(x, base + k, z, ID.pillar_red);
        w.set(x, base + 5, z, ID.wood_beam);
        // 灯身
        w.set(x, base + 6, z, ID.lantern);
        w.set(x, base + 7, z, ID.lantern);
        w.set(x, base + 8, z, ID.lantern_tassel);
        this.landmarks.push({ type: "lantern", pos: [x, base + 7, z] });
      }
    }
    return this;
  }

  /** 中央水池 + 荷花 + 曲桥。 */
  buildPond() {
    const w = this.world;
    const cx = 0;
    const cz = 8;
    const R = 15;
    for (let x = cx - R - 3; x <= cx + R + 3; x++) {
      for (let z = cz - R - 3; z <= cz + R + 3; z++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d > R + 2.5) continue;
        if (d > R) {
          // 池岸：汉白玉围栏基座
          w.set(x, CITY.baseY, z, ID.marble);
          continue;
        }
        // 池底
        for (let y = CITY.baseY - 4; y <= CITY.baseY; y++) w.set(x, y, z, ID.stone_dark);
        w.set(x, CITY.baseY - 4, z, ID.sand);
        // 水
        for (let y = CITY.baseY - 3; y <= CITY.baseY - 1; y++) w.set(x, y, z, ID.water);
        w.set(x, CITY.baseY, z, ID.water);
      }
    }
    // 荷花与荷叶
    for (let i = 0; i < 90; i++) {
      const a = hash2i(i, 3, 91) * Math.PI * 2;
      const r = Math.sqrt(hash2i(i, 7, 93)) * (R - 2);
      const x = Math.round(cx + Math.cos(a) * r);
      const z = Math.round(cz + Math.sin(a) * r);
      if (w.get(x, CITY.baseY, z) !== ID.water) continue;
      const t = hash2i(x, z, 95);
      if (t < 0.16) w.set(x, CITY.baseY, z, ID.lotus_flower);
      else if (t < 0.62) w.set(x, CITY.baseY, z, ID.lotus_pad);
    }
    // 曲桥（南北向）
    for (let z = cz - R - 4; z <= cz + R + 4; z++) {
      for (let x = -2; x <= 2; x++) {
        w.set(x, CITY.baseY + 1, z, ID.marble);
        if (Math.abs(x) === 2) {
          w.set(x, CITY.baseY + 2, z, ID.railing_marble);
        }
      }
    }
    // 桥墩
    for (let z = cz - R; z <= cz + R; z += 6) {
      for (let x = -2; x <= 2; x += 4) {
        for (let y = CITY.baseY - 3; y <= CITY.baseY; y++) w.set(x, y, z, ID.stone_dark);
      }
    }
    this.landmarks.push({ type: "pond", pos: [cx, CITY.baseY, cz] });
    return this;
  }

  /** 通用：一段朱红宫墙（带金瓦压顶）。 */
  wallSegment(x0, z0, x1, z1, height = 6, opts = {}) {
    const w = this.world;
    // gate：[xFrom, xTo]（世界坐标）这一段不砌墙（城门洞）
    const { base = CITY.baseY, gate = null, crenel = true } = opts;
    const dx = Math.sign(x1 - x0);
    const dz = Math.sign(z1 - z0);
    const len = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
    for (let i = 0; i <= len; i++) {
      const x = x0 + dx * i;
      const z = z0 + dz * i;
      if (gate && x >= gate[0] && x <= gate[1]) continue;
      // 墙线上已经有别的结构（城门、登岛石阶）：这里留出缺口，不把它们砌进墙里
      if (this._ownedByOther(x, z, base + 1, base + height + 2)) continue;
      // 墙基：一直砌到实心地面，不悬空
      for (let y = base; y > 0 && !w.solidAt(x, y, z); y--) w.set(x, y, z, ID.wall_base);
      for (let k = 1; k <= height; k++) {
        w.set(x, base + k, z, k === 1 ? ID.wall_base : ID.wall_red);
      }
      // 压顶金瓦
      w.set(x, base + height + 1, z, ID.roof_eave);
      if (crenel) w.set(x, base + height + 2, z, ID.roof_gold_ridge);
    }
    return this;
  }

  /** 主殿：三层台基 + 重檐金瓦 + 朱红立柱。 */
  buildMainHall(cx, cz, w0 = 17, d0 = 13) {
    const w = this.world;
    const base = CITY.baseY;

    // 台基（三层）
    // 三层台基逐层收进（最底层最宽）：旧版 ex = layer * 2 把台基上下颠倒了 ——
    // 顶层最宽，悬在下面两层之外，台阶走不上去，殿内与城里的导航网格不连通
    for (let layer = 0; layer < 3; layer++) {
      const ex = (2 - layer) * 2;
      const y = base + 1 + layer;
      for (let x = cx - w0 - ex; x <= cx + w0 + ex; x++) {
        for (let z = cz - d0 - ex; z <= cz + d0 + ex; z++) {
          w.set(x, y, z, layer === 2 ? ID.marble : ID.marble);
        }
      }
    }
    // 三层台基占 base+1..base+3，殿内地面是台基顶层（金砖），人站在 base+4。
    // 旧版 floorY = base+3 —— 墙的第一层嵌进台基、殿内金砖被埋在汉白玉下面看不见。
    const floorY = base + 4;

    // 殿身：朱红墙 + 立柱
    const wallH = 9;
    for (let x = cx - w0; x <= cx + w0; x++) {
      for (let z = cz - d0; z <= cz + d0; z++) {
        const onEdge = x === cx - w0 || x === cx + w0 || z === cz - d0 || z === cz + d0;
        if (!onEdge) continue;
        // 正面留门
        const isFront = z === cz + d0;
        const inDoor = isFront && Math.abs(x - cx) <= 3;
        for (let k = 0; k < wallH; k++) {
          if (inDoor && k < 6) continue;
          w.set(x, floorY + k, z, ID.wall_red);
        }
      }
    }
    // 立柱（四角 + 正面）
    const pillarXs = [cx - w0, cx - 6, cx + 6, cx + w0];
    for (const px of pillarXs) {
      for (const pz of [cz - d0, cz + d0]) {
        for (let k = 0; k < wallH; k++) w.set(px, floorY + k, pz, ID.pillar_red);
      }
    }
    // 梁枋彩画
    for (let x = cx - w0; x <= cx + w0; x++) {
      for (const pz of [cz - d0, cz + d0]) w.set(x, floorY + wallH - 1, pz, ID.beam_painted);
    }
    for (let z = cz - d0; z <= cz + d0; z++) {
      for (const px of [cx - w0, cx + w0]) w.set(px, floorY + wallH - 1, z, ID.beam_painted);
    }

    // 殿内金砖地
    for (let x = cx - w0 + 1; x < cx + w0; x++) {
      for (let z = cz - d0 + 1; z < cz + d0; z++) w.set(x, floorY - 1, z, ID.gold_brick);
    }
    // 殿内长明灯
    for (const px of [cx - 8, cx + 8]) {
      for (const pz of [cz - 5, cz + 5]) {
        w.set(px, floorY, pz, ID.glow);
        this.landmarks.push({ type: "lantern", pos: [px, floorY, pz] });
      }
    }

    // 下层重檐：一圈 4 层的裙檐（收进到墙线以内，顶面就是上层殿身的地面）。
    // 旧版铺成一座实心的金字塔，把上层殿身整个埋在里面
    this.buildRoof(cx, cz, w0 + 3, d0 + 3, floorY + wallH, { style: "gold", upturn: 3, maxLayers: 4 });
    // 上层殿身（收进）
    const w1 = w0 - 5;
    const d1 = d0 - 4;
    const y1 = floorY + wallH + 4;
    for (let x = cx - w1; x <= cx + w1; x++) {
      for (let z = cz - d1; z <= cz + d1; z++) {
        const onEdge = x === cx - w1 || x === cx + w1 || z === cz - d1 || z === cz + d1;
        if (!onEdge) continue;
        for (let k = 0; k < 6; k++) w.set(x, y1 + k, z, ID.wall_red);
      }
    }
    for (const px of [cx - w1, cx + w1]) {
      for (const pz of [cz - d1, cz + d1]) {
        for (let k = 0; k < 6; k++) w.set(px, y1 + k, pz, ID.pillar_red);
      }
    }
    // 上层重檐
    this.buildRoof(cx, cz, w1 + 3, d1 + 3, y1 + 6, { style: "gold", upturn: 4 });

    // 正脊宝顶
    const topY = y1 + 6 + 5;
    for (let k = 0; k < 4; k++) w.set(cx, topY + k, cz, ID.gold_brick);
    w.set(cx, topY + 4, cz, ID.glow);
    this.landmarks.push({ type: "lantern", pos: [cx, topY + 4, cz] });

    this.landmarks.push({ type: "hall", pos: [cx, floorY, cz] });
    return this;
  }

  /**
   * 屋顶：四坡顶 + 飞檐起翘。
   * 逐层向内收进，边缘用 roof_eave，四角用 roof_corner 做出起翘。
   */
  /**
   * maxLayers：只铺这么多层（重檐的下层只是一圈裙檐，上层殿身立在它上面）；默认铺到屋脊
   */
  buildRoof(cx, cz, hw, hd, y0, { style = "gold", upturn = 3, maxLayers = Infinity } = {}) {
    const w = this.world;
    const eave = style === "gold" ? ID.roof_eave : ID.roof_ink_eave;
    const tile = style === "gold" ? ID.roof_gold : ID.roof_ink;
    const ridge = style === "gold" ? ID.roof_gold_ridge : ID.roof_ink;
    const corner = style === "gold" ? ID.roof_corner : ID.roof_ink;

    const fullLayers = Math.min(hw, hd);
    const layers = Math.min(fullLayers, maxLayers);
    for (let l = 0; l < layers; l++) {
      const y = y0 + l;
      const ex = hw - l;
      const ez = hd - l;
      if (ex < 0 || ez < 0) break;
      for (let x = cx - ex; x <= cx + ex; x++) {
        for (let z = cz - ez; z <= cz + ez; z++) {
          const onX = x === cx - ex || x === cx + ex;
          const onZ = z === cz - ez || z === cz + ez;
          if (!onX && !onZ) {
            // 内部填实，避免屋顶漏空。第一层也要填：旧版只填 l > 0，
            // 墙顶与第二层之间留下一整圈 1 格高的缝，天光从檐下漏进殿里、屋顶看起来悬在墙上
            w.set(x, y, z, tile);
            continue;
          }
          const isCorner = onX && onZ;
          let id = tile;
          if (isCorner) id = corner;
          else if (l === 0) id = eave;
          else if (l === fullLayers - 1) id = ridge;
          w.set(x, y, z, id);
        }
      }
    }

    // 飞檐起翘：四角向外上方挑出
    for (let s = 1; s <= upturn; s++) {
      const y = y0 + s - 1;
      const ex = hw + s;
      const ez = hd + s;
      const pts = [
        [cx - ex, cz - ez], [cx + ex, cz - ez], [cx - ex, cz + ez], [cx + ex, cz + ez],
      ];
      for (const [px, pz] of pts) {
        w.set(px, y, pz, corner);
        w.set(px, y + 1, pz, corner);
      }
      // 檐角之间的连线
      for (let x = cx - ex; x <= cx + ex; x++) {
        w.set(x, y, cz - ez, eave);
        w.set(x, y, cz + ez, eave);
      }
      for (let z = cz - ez; z <= cz + ez; z++) {
        w.set(cx - ex, y, z, eave);
        w.set(cx + ex, y, z, eave);
      }
    }
    return this;
  }

  /** 宝塔：多层八角（此处用方形层叠）墨瓦塔。 */
  buildPagoda(cx, cz, levels = 5) {
    const w = this.world;
    const base = CITY.baseY;
    // 塔基
    for (let x = cx - 6; x <= cx + 6; x++) {
      for (let z = cz - 6; z <= cz + 6; z++) {
        w.set(x, base + 1, z, ID.marble);
        w.set(x, base + 2, z, ID.marble);
      }
    }
    let y = base + 3;
    for (let l = 0; l < levels; l++) {
      const r = Math.max(2, 5 - l);
      for (let x = cx - r; x <= cx + r; x++) {
        for (let z = cz - r; z <= cz + r; z++) {
          const onEdge = x === cx - r || x === cx + r || z === cz - r || z === cz + r;
          if (!onEdge) continue;
          for (let k = 0; k < 5; k++) w.set(x, y + k, z, ID.wall_red);
        }
      }
      for (const px of [cx - r, cx + r]) {
        for (const pz of [cz - r, cz + r]) {
          for (let k = 0; k < 5; k++) w.set(px, y + k, pz, ID.pillar_red);
        }
      }
      // 每层檐
      this.buildRoof(cx, cz, r + 2, r + 2, y + 5, { style: "ink", upturn: 2 });
      // 塔身灯
      w.set(cx, y + 3, cz + r, ID.lantern);
      this.landmarks.push({ type: "lantern", pos: [cx, y + 3, cz + r] });
      y += 5 + 3;
    }
    // 塔刹
    for (let k = 0; k < 5; k++) w.set(cx, y + k, cz, ID.gold_brick);
    w.set(cx, y + 5, cz, ID.glow);
    this.landmarks.push({ type: "lantern", pos: [cx, y + 5, cz] });
    return this;
  }

  /** 牌坊：四柱三间，金瓦顶 + 匾额 + 石狮。 */
  buildArchway(cx, cz) {
    const w = this.world;
    const base = CITY.baseY;
    const halfW = 9;
    const pillarXs = [cx - halfW, cx - 3, cx + 3, cx + halfW];
    for (const px of pillarXs) {
      for (let k = 1; k <= 9; k++) w.set(px, base + k, cz, ID.pillar_red);
      for (let k = 1; k <= 9; k++) w.set(px, base + k, cz + 1, ID.pillar_red);
      // 柱础
      w.set(px, base + 1, cz, ID.marble);
      w.set(px, base + 1, cz + 1, ID.marble);
    }
    // 额枋
    for (let x = cx - halfW; x <= cx + halfW; x++) {
      for (const z of [cz, cz + 1]) {
        w.set(x, base + 8, z, ID.beam_painted);
        w.set(x, base + 9, z, ID.beam_painted);
      }
    }
    // 匾额
    for (let x = cx - 4; x <= cx + 4; x++) {
      for (const z of [cz, cz + 1]) w.set(x, base + 10, z, ID.archway_plaque);
    }
    // 顶
    this.buildRoof(cx, cz, halfW + 2, 3, base + 11, { style: "gold", upturn: 3 });

    // 石狮
    for (const sx of [-1, 1]) {
      const lx = cx + sx * (halfW + 3);
      w.set(lx, base + 1, cz, ID.marble);
      w.set(lx, base + 2, cz, ID.stone_lion);
    }
    this.landmarks.push({ type: "archway", pos: [cx, base, cz] });
    return this;
  }

  /** 云雾仙山浮岛 —— 悬空的岛，底部倒锥，顶上有松与亭。 */
  buildFloatingIsland(cx, cy, cz, radius = 11) {
    const w = this.world;
    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let z = cz - radius; z <= cz + radius; z++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d > radius) continue;
        const edge = 1 - d / radius;
        const top = cy + Math.round(edge * 3);
        // 岛面
        for (let y = top - 2; y <= top; y++) {
          w.set(x, y, z, y === top ? ID.grass : ID.dirt);
        }
        // 倒锥底
        const depth = Math.round(Math.pow(edge, 0.7) * radius * 1.5);
        for (let k = 1; k <= depth; k++) {
          const r2 = radius * (1 - k / (depth + 1));
          if (Math.hypot(x - cx, z - cz) > r2) continue;
          w.set(x, top - 2 - k, z, k > depth * 0.6 ? ID.stone_dark : ID.rock);
        }
      }
    }
    // 岛上植被
    for (let i = 0; i < 14; i++) {
      const a = hash2i(i, cx, 61) * Math.PI * 2;
      const r = Math.sqrt(hash2i(i, cz, 63)) * (radius - 3);
      const x = Math.round(cx + Math.cos(a) * r);
      const z = Math.round(cz + Math.sin(a) * r);
      const top = w.groundHeight(x, z, cy + 6);
      if (top < 0) continue;
      if (hash2i(x, z, 65) > 0.5) this.pineTree(x, top + 1, z);
      else this.bambooCluster(x, top + 1, z);
    }
    // 岛心小亭
    const topY = w.groundHeight(cx, cz, cy + 6);
    if (topY > 0) {
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
        for (let k = 1; k <= 4; k++) w.set(cx + dx, topY + k, cz + dz, ID.pillar_red);
      }
      this.buildRoof(cx, cz, 4, 4, topY + 5, { style: "gold", upturn: 2 });
      w.set(cx, topY + 1, cz, ID.lantern);
      this.landmarks.push({ type: "lantern", pos: [cx, topY + 1, cz] });
    }
    return this;
  }

  /** 云雾：在浮岛与山腰铺一层半透明的云方块。 */
  buildClouds() {
    const w = this.world;
    for (let i = 0; i < 260; i++) {
      const a = hash2i(i, 11, 81) * Math.PI * 2;
      const r = 40 + hash2i(i, 13, 83) * 150;
      const cx = Math.round(Math.cos(a) * r);
      const cz = Math.round(Math.sin(a) * r);
      const cy = 58 + Math.round(hash2i(i, 17, 85) * 26);
      const rx = 5 + Math.round(hash2i(i, 19, 87) * 9);
      const rz = 5 + Math.round(hash2i(i, 23, 89) * 9);
      for (let x = cx - rx; x <= cx + rx; x++) {
        for (let z = cz - rz; z <= cz + rz; z++) {
          const d = Math.hypot((x - cx) / rx, (z - cz) / rz);
          if (d > 1) continue;
          const n = valueNoise2(x * 0.12, z * 0.12, this.seed + 300);
          if (n + (1 - d) * 0.6 < 0.62) continue;
          // 不贴着任何结构（石阶上方的云会挡住登岛的人、塔身上会长出云团）；
          // 宫墙上空一律不放：白色的云块压在殿顶上像积雪，挡住全城（城里抬头看到的是天空本身的云）
          if (this.insideWall(x, z, 8) || this.claimed(x, z, 2)) continue;
          w.setIfAir(x, cy, z, ID.cloud);
          if (n > 0.78) w.setIfAir(x, cy + 1, z, ID.cloud);
        }
      }
    }
    return this;
  }

  /**
   * 浮空石阶通道 —— 从地面蜿蜒而上，通往浮岛顶面。
   *
   * 设计要点：
   *  · 螺旋上升：绕浮岛中心盘旋，每圈升高固定值，坡度平缓
   *  · 单级台阶高度差 ≤ 1 格，玩家可直接走上去（无需跳跃）
   *  · 青石板铺面 + 两侧石灯（发光，夜景可见）+ 栏杆
   *  · 石阶本身有碰撞体，且不遮挡浮岛上方空域
   */
  buildSkyStair(cx, cy, cz, radius, topY) {
    const w = this.world;
    const base = CITY.baseY;

    // 起点：浮岛外侧地面
    const startR = radius + 10;
    const startY = base + 1;
    const rise = topY - startY;
    if (rise <= 0) return this;

    // 螺旋参数：圈数由高度决定，保证每圈升高不超过 6 格（坡度平缓）
    const turns = Math.max(2, Math.ceil(rise / 6));
    const totalSteps = Math.ceil(rise); // 每级升 1 格
    const stepAngle = (turns * Math.PI * 2) / totalSteps;

    // 石阶半径：保持较宽，避免上层与下层在垂直方向堆叠成墙
    // 半径随高度缓慢收缩，但最小不低于 radius + 4
    const minR = radius + 4;
    const rAt = (t) => Math.max(minR, startR - t * 2.0);

    let prevX = null;
    let prevZ = null;

    for (let i = 0; i <= totalSteps; i++) {
      const t = i / totalSteps;
      const ang = -Math.PI / 2 + i * stepAngle;
      const r = rAt(t);
      const x = Math.round(cx + Math.cos(ang) * r);
      const z = Math.round(cz + Math.sin(ang) * r);
      const y = Math.round(startY + i);

      // 铺台阶（3×3 平台，保证行走宽度）
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          w.set(x + dx, y, z + dz, ID.slate);
          // 下方补一层支撑，避免悬空薄片
          w.set(x + dx, y - 1, z + dz, ID.moss_stone);
        }
      }

      // 两侧石灯（每 8 级一对）—— 只放在外侧，避免在岛边形成垂直墙
      if (i % 8 === 0 && i > 0) {
        const lx = Math.round(x + Math.cos(ang) * 2.5);
        const lz = Math.round(z + Math.sin(ang) * 2.5);
        w.set(lx, y + 1, lz, ID.marble);
        w.set(lx, y + 2, lz, ID.lantern);
        this.landmarks.push({ type: "lantern", pos: [lx, y + 2, lz] });
      }

      // 外侧栏杆（每 4 级一段）
      if (i % 4 === 0) {
        const rx = Math.round(x + Math.cos(ang) * 2);
        const rz = Math.round(z + Math.sin(ang) * 2);
        w.set(rx, y + 1, rz, ID.railing_marble);
      }

      prevX = x;
      prevZ = z;
    }

    // 顶部平台：与浮岛顶面衔接
    // 关键：平台必须与岛顶同高，且从平台到岛心铺一条无障碍的连接桥，
    // 否则玩家升到顶后会被石阶自身挡住，无法横移到岛上。
    const endAng = -Math.PI / 2 + totalSteps * stepAngle;
    const endR = rAt(1);
    const ex = Math.round(cx + Math.cos(endAng) * endR);
    const ez = Math.round(cz + Math.sin(endAng) * endR);

    // 清空顶部平台到岛心之间的所有障碍（含石阶自身堆叠）
    const clearSteps = Math.max(Math.abs(ex - cx), Math.abs(ez - cz)) + 4;
    for (let i = 0; i <= clearSteps; i++) {
      const t = i / Math.max(1, clearSteps);
      const bx = Math.round(ex + (cx - ex) * t);
      const bz = Math.round(ez + (cz - ez) * t);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let yy = topY + 1; yy <= topY + 10; yy++) {
            w.set(bx + dx, yy, bz + dz, ID.air);
          }
        }
      }
    }

    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        w.set(ex + dx, topY, ez + dz, ID.slate);
        w.set(ex + dx, topY - 1, ez + dz, ID.moss_stone);
      }
    }

    // 从顶部平台铺一条连接桥到岛心（桥面与岛顶同高，上方清空）
    const steps = Math.max(Math.abs(ex - cx), Math.abs(ez - cz));
    for (let i = 0; i <= steps; i++) {
      const t = i / Math.max(1, steps);
      const bx = Math.round(ex + (cx - ex) * t);
      const bz = Math.round(ez + (cz - ez) * t);
      for (let dz = -1; dz <= 1; dz++) {
        w.set(bx, topY, bz + dz, ID.slate);
        for (let yy = topY + 1; yy <= topY + 5; yy++) w.set(bx, yy, bz + dz, ID.air);
      }
    }

    this.landmarks.push({ type: "skystair", pos: [cx, topY, cz] });
    return this;
  }

  /**
   * 清理浮岛周围的孤立屋顶碎片 —— 它们会挡住飞行路线。
   * 判定：在浮岛空域内、下方 6 格全空、且不属于浮岛主体的孤立方块。
   */
  clearStrayFragments(islands) {
    const w = this.world;
    let removed = 0;
    for (const isl of islands) {
      const { x, y, z, r } = isl;
      const R = r + 14;
      for (let dx = -R; dx <= R; dx++) {
        for (let dz = -R; dz <= R; dz++) {
          const d = Math.hypot(dx, dz);
          if (d < r + 2) continue; // 浮岛主体不动
          if (d > R) continue;
          for (let yy = y - 20; yy <= y + 20; yy++) {
            if (!w.solidAt(x + dx, yy, z + dz)) continue;
            // 下方 6 格全空 => 孤立悬空碎片
            let gap = 0;
            for (let k = 1; k <= 6; k++) if (!w.solidAt(x + dx, yy - k, z + dz)) gap++;
            if (gap < 6) continue;
            // 上方也空 => 确实是孤立碎片
            if (w.solidAt(x + dx, yy + 1, z + dz)) continue;
            w.set(x + dx, yy, z + dz, ID.air);
            removed++;
          }
        }
      }
    }
    return removed;
  }

  /**
   * 巨型地标：通天宝塔 —— 全城视觉锚点。
   *
   * 设计目的：制造「尺度参照」。旁边是正常尺度的主殿与 NPC，
   * 对比之下才能感知宝塔的巨大，从而产生震撼与方向感。
   */
  buildGrandPagoda(cx, cz, levels = 9) {
    const w = this.world;
    const base = CITY.baseY;
    const R0 = 15;

    // ---- 三层巨型台基 ----
    for (let layer = 0; layer < 3; layer++) {
      const ex = R0 + 6 - layer * 2;
      const y = base + 1 + layer * 2;
      for (let x = cx - ex; x <= cx + ex; x++) {
        for (let z = cz - ex; z <= cz + ex; z++) {
          for (let k = 0; k < 2; k++) w.set(x, y + k, z, ID.marble);
        }
      }
      if (layer === 2) {
        for (let x = cx - ex; x <= cx + ex; x++) {
          w.set(x, y + 2, cz - ex, ID.railing_marble);
          w.set(x, y + 2, cz + ex, ID.railing_marble);
        }
        for (let z = cz - ex; z <= cz + ex; z++) {
          w.set(cx - ex, y + 2, z, ID.railing_marble);
          w.set(cx + ex, y + 2, z, ID.railing_marble);
        }
      }
    }
    let y = base + 7;

    // ---- 逐层塔身 + 重檐 ----
    for (let l = 0; l < levels; l++) {
      const r = Math.max(3, R0 - l);
      const bodyH = l === 0 ? 9 : 6;

      for (let x = cx - r; x <= cx + r; x++) {
        for (let z = cz - r; z <= cz + r; z++) {
          const onEdge = x === cx - r || x === cx + r || z === cz - r || z === cz + r;
          if (!onEdge) continue;
          for (let k = 0; k < bodyH; k++) {
            const isWindow = k >= 2 && k <= 3 && (x + z) % 4 === 0;
            w.set(x, y + k, z, isWindow ? ID.beam_painted : ID.wall_red);
          }
        }
      }
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          for (let k = 0; k < bodyH; k++) w.set(cx + sx * r, y + k, cz + sz * r, ID.pillar_red);
        }
      }
      for (let x = cx - r; x <= cx + r; x++) {
        w.set(x, y + bodyH - 1, cz - r, ID.beam_painted);
        w.set(x, y + bodyH - 1, cz + r, ID.beam_painted);
      }
      // 塔心长明灯立在灯柱上（旧版悬在空心塔身的半空）
      const lampY = y + Math.floor(bodyH / 2);
      for (let k = y; k < lampY; k++) w.set(cx, k, cz, ID.pillar_red);
      w.set(cx, lampY, cz, ID.glow);
      this.landmarks.push({ type: "lantern", pos: [cx, lampY, cz] });

      // 层层外挑的屋檐
      this.buildRoof(cx, cz, r + 3, r + 3, y + bodyH, { style: "gold", upturn: 3 });

      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          // 檐角挂灯：挂在檐角正下方、贴着屋檐（旧版放在屋檐上方 4 格，悬空）
          const lx = cx + sx * (r + 3);
          const lz = cz + sz * (r + 3);
          w.set(lx, y + bodyH - 1, lz, ID.lantern);
          w.set(lx, y + bodyH - 2, lz, ID.lantern_tassel);
          this.landmarks.push({ type: "lantern", pos: [lx, y + bodyH - 1, lz] });
        }
      }
      y += bodyH + 4;
    }

    // ---- 塔刹宝顶 ----
    for (let k = 0; k < 7; k++) w.set(cx, y + k, cz, ID.gold_brick);
    w.set(cx, y + 7, cz, ID.glow);
    this.landmarks.push({ type: "lantern", pos: [cx, y + 7, cz] });
    w.set(cx, y + 8, cz, ID.gold_brick); // 宝顶连成一体（旧版这里空着，最顶上的灯悬空）
    w.set(cx, y + 9, cz, ID.glow);
    this.landmarks.push({ type: "lantern", pos: [cx, y + 9, cz] });
    this.landmarks.push({ type: "grandpagoda", pos: [cx, y + 7, cz] });
    return y + 9;
  }

  /** 远景山峦剪影 —— 层次与纵深。 */
  buildFarMountains() {
    const w = this.world;
    const s = this.seed;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + hash2i(i, 3, s + 401) * 0.24;
      const dist = 138 + hash2i(i, 7, s + 402) * 26;
      const cx = Math.round(Math.cos(a) * dist);
      const cz = Math.round(Math.sin(a) * dist);
      const peak = 96 + Math.round(hash2i(i, 11, s + 403) * 44);
      const rad = 14 + Math.round(hash2i(i, 13, s + 404) * 12);

      for (let x = cx - rad; x <= cx + rad; x++) {
        for (let z = cz - rad; z <= cz + rad; z++) {
          const d = Math.hypot(x - cx, z - cz);
          if (d > rad) continue;
          const t = 1 - d / rad;
          const top = Math.round(CITY.baseY + Math.pow(t, 0.75) * (peak - CITY.baseY));
          for (let yy = Math.max(0, top - 26); yy <= top; yy++) {
            const depth = top - yy;
            let id = ID.rock;
            if (depth === 0) id = top > 118 ? ID.marble : ID.moss_stone;
            else if (depth < 5) id = ID.stone_dark;
            w.set(x, yy, z, id);
          }
        }
      }
    }
    return this;
  }

  /** 低空云海 —— 环绕主城的云带（避开城区上方，不遮蔽全城）。 */
  buildCloudSea() {
    const w = this.world;
    const s = this.seed;
    for (let i = 0; i < 420; i++) {
      const a = hash2i(i, 21, s + 501) * Math.PI * 2;
      // 只落在城区之外（城墘半径 62），形成环绕的云海
      const dist = 96 + hash2i(i, 23, s + 502) * 72;
      const cx = Math.round(Math.cos(a) * dist);
      const cz = Math.round(Math.sin(a) * dist);
      // 略高于城台地坪（38..46）：从城上俯瞰，城外是一圈云海（「云上之城」）。
      // 宫墙以内一律不放（旧版没有这条，后苑、通天宝塔一楼、城门外大道里塞满了实心的云）；
      // 压到地坪以下也不行 —— 城外那个高度是海面以下，云海整片消失
      const cy = 38 + Math.round(hash2i(i, 27, s + 503) * 8);
      const rx = 7 + Math.round(hash2i(i, 29, s + 504) * 11);
      const rz = 7 + Math.round(hash2i(i, 31, s + 505) * 11);
      for (let x = cx - rx; x <= cx + rx; x++) {
        for (let z = cz - rz; z <= cz + rz; z++) {
          const d = Math.hypot((x - cx) / rx, (z - cz) / rz);
          if (d > 1) continue;
          const n = valueNoise2(x * 0.09, z * 0.09, s + 506);
          if (n + (1 - d) * 0.7 < 0.6) continue;
          if (this.insideWall(x, z, 6) || this.claimed(x, z, 2)) continue;
          w.setIfAir(x, cy, z, ID.cloud);
          if (n > 0.72) w.setIfAir(x, cy + 1, z, ID.cloud);
        }
      }
    }
    return this;
  }

  /** (x, z) 是否在宫墙矩形以内（含外扩 margin 格）。 */
  insideWall(x, z, margin = 0) {
    const wl = CITY_PLAN.wall;
    return Math.abs(x) <= wl.halfX + margin && z >= wl.north - margin && z <= wl.south + margin;
  }

  /* ================= 占地登记 ================= */

  /**
   * 结构占地登记：生成期间每一次写入都记在「当前正在建的结构」名下。
   *
   *   · 冲突：一个结构把另一个结构已经放好的方块（地坪以上）改成了别的东西 —— 记进 this.conflicts，
   *     由审计（scripts/audit-world.mjs）报告；旧版主殿里的灯柱、拴马桩打穿牌坊柱子都是这一类
   *   · 占地：所有结构在地坪以上写过的列记进 this.footprint；之后撒的植被、云海、灯柱查它，绝不侵入
   *
   * 这套机制对以后新加的任何结构自动生效，不需要每个生成函数自己维护边界。
   */
  _beginClaims() {
    const w = this.world;
    const R = 200, S = R * 2 + 1;
    this._fpR = R;
    this.footprint = new Uint8Array(S * S);
    this.conflicts = new Map(); // "a ← b" → 次数
    this._cellOwner = new Map();
    this._owner = null;
    const base = CITY.baseY;
    // 返回 false = 这次写入被拒绝（让位）：装饰性结构（摊位、灯柱）不能改掉别的结构已经放好的方块
    const rec = (x, y, z, id) => {
      const owner = this._owner;
      // 自然植被（无主）：不许把任何一格写进结构占地的列（树冠伸进屋檐、竹子长进殿里）。
      // 在 _item 里（松树）被拒绝 = 整棵不种；不在 _item 里（竹叶）= 只剪掉这一片
      if (this._avoidFootprint && y > base && Math.abs(x) <= R && Math.abs(z) <= R && this.footprint[(z + R) * S + (x + R)]) return false;
      if (!owner || y <= base) return true;
      const k = (x + 512) * 1048576 + (z + 512) * 256 + y;
      const prev = this._cellOwner.get(k);
      const cur = w.get(x, y, z);
      if (prev && prev !== owner && cur !== ID.air && cur !== id && this._yield) return false;
      if (prev && prev !== owner && cur !== ID.air && cur !== id) {
        const pair = `${prev} <- ${owner}`;
        this.conflicts.set(pair, (this.conflicts.get(pair) || 0) + 1);
        if ((this.conflictSamples ||= []).length < 40) this.conflictSamples.push(`${pair} @${x},${y},${z}`);
      }
      if (id === ID.air) this._cellOwner.delete(k);
      else {
        this._cellOwner.set(k, owner);
        if (Math.abs(x) <= R && Math.abs(z) <= R) this.footprint[(z + R) * S + (x + R)] = 1;
      }
      return true;
    };
    const set = w.set.bind(w), setRaw = w.setRaw.bind(w);
    // 事务（_item）：记下每次写入前的状态，被拒绝时整件撤回
    const wrap = (raw) => (x, y, z, id) => {
      const tx = this._tx;
      if (tx) {
        const k = (x + 512) * 1048576 + (z + 512) * 256 + y;
        tx.log.push([x, y, z, w.get(x, y, z), this._cellOwner.get(k)]);
      }
      if (rec(x, y, z, id)) raw(x, y, z, id);
      else if (tx) tx.failed = true;
    };
    w.set = wrap(set);
    w.setRaw = wrap(setRaw);
    this._rawSet = set;
    this._restoreWorld = () => { delete w.set; delete w.setRaw; };
  }

  /**
   * 以结构名 name 执行一段生成代码（写入都登记在它名下）。
   * opts.yield：装饰性结构 —— 遇到别的结构已有的方块就让开，不覆盖
   */
  _as(name, fn, opts = {}) {
    const prev = this._owner, prevYield = this._yield;
    this._owner = name;
    this._yield = !!opts.yield;
    try { fn(); } finally { this._owner = prev; this._yield = prevYield; }
  }

  /**
   * 整件放置一个装饰（一个摊位、一盏石灯、一座小亭）：只要其中任何一格被拒绝（让位），
   * 整件撤回 —— 不会留下半截柱子、悬空的屋顶。返回是否放成功。
   */
  _item(fn) {
    if (!this._cellOwner) { fn(); return true; }
    const outer = this._tx;
    const tx = { log: [], failed: false };
    this._tx = tx;
    let landmarks = this.landmarks.length;
    try { fn(); } finally { this._tx = outer; }
    if (!tx.failed) {
      if (outer) outer.log.push(...tx.log);
      return true;
    }
    for (let i = tx.log.length - 1; i >= 0; i--) {
      const [x, y, z, prev, owner] = tx.log[i];
      this._rawSet(x, y, z, prev);
      const k = (x + 512) * 1048576 + (z + 512) * 256 + y;
      if (owner) this._cellOwner.set(k, owner); else this._cellOwner.delete(k);
    }
    this.landmarks.length = landmarks; // 撤回这件装饰登记的灯笼等地标
    return false;
  }

  /** (x, z) 这一列在 y0..y1 之间有没有属于别的结构的方块。 */
  _ownedByOther(x, z, y0, y1) {
    if (!this._cellOwner) return false;
    for (let y = y0; y <= y1; y++) {
      const o = this._cellOwner.get((x + 512) * 1048576 + (z + 512) * 256 + y);
      if (o && o !== this._owner) return true;
    }
    return false;
  }

  /** (x, z) 周围 margin 格内是否有结构占地。 */
  claimed(x, z, margin = 0) {
    if (!this.footprint) return false;
    const R = this._fpR, S = R * 2 + 1;
    for (let dx = -margin; dx <= margin; dx++) for (let dz = -margin; dz <= margin; dz++) {
      const xx = x + dx, zz = z + dz;
      if (Math.abs(xx) > R || Math.abs(zz) > R) continue;
      if (this.footprint[(zz + R) * S + (xx + R)]) return true;
    }
    return false;
  }

  /* ================= 总装 ================= */

  generate() {
    this._beginClaims();
    // ---- 地形 ----
    this.buildBedrock();
    this.generateTerrain();
    this.buildFarMountains(); // 远景山峦：在生成半径外缘堆山，制造纵深
    this.flattenCity(); // 整个宫墙以内整平：所有建筑落在同一个地坪上，不悬空、不埋进山里
    this.buildAvenue();
    this._as("pond", () => this.buildPond());
    this._as("rear-garden", () => this.buildRearGardenGround());

    // ---- 主体建筑（按规划布局，非随机散布） ----
    this._as("gate", () => this.buildCityGate(CITY_PLAN.gate.z));
    this._as("archway", () => this.buildArchway(0, CITY_PLAN.archway.z));
    this._as("hall", () => this.buildMainHall(0, CITY_PLAN.hall.z, CITY_PLAN.hall.halfW, CITY_PLAN.hall.halfD));
    for (const b of CITY_PLAN.blocks) {
      this._as(`shop@${b.x},${b.z}`, () => this.buildShopBlock(b.x, b.z, b.w, b.d, b.h, b.roof));
    }
    for (const p of CITY_PLAN.pagodas) this._as(`pagoda@${p.x},${p.z}`, () => this.buildPagoda(p.x, p.z, p.levels));
    // 巨型地标：通天宝塔，立于中轴主殿之后，全城可见
    this._as("grand-pagoda", () => this.buildGrandPagoda(0, CITY_PLAN.grandPagoda.z, CITY_PLAN.grandPagoda.levels));

    // ---- 浮岛与登岛石阶（石阶和浮岛同属一个结构） ----
    for (const isl of CITY_PLAN.islands) {
      this._as(`island@${isl.x},${isl.z}`, () => this.buildFloatingIsland(isl.x, isl.y, isl.z, isl.r));
    }
    // 清理浮岛周围的孤立屋顶碎片（会挡住飞行路线）；必须在石阶之前，避免把台阶误删
    this.clearStrayFragments(CITY_PLAN.islands);
    for (const isl of CITY_PLAN.islands) {
      // 该浮岛中心列的最高实心方块作为顶面
      let topY = isl.y;
      for (let yy = isl.y + 20; yy >= isl.y - 10; yy--) {
        if (this.world.solidAt(isl.x, yy, isl.z)) { topY = yy; break; }
      }
      this._as(`island@${isl.x},${isl.z}`, () => this.buildSkyStair(isl.x, isl.y, isl.z, isl.r, topY + 1));
    }

    // ---- 宫墙：最后砌，遇到城门、石阶自动留缺口 ----
    const wl = CITY_PLAN.wall;
    const gw = CITY_PLAN.gate.halfW;
    this._as("city-wall", () => {
      this.wallSegment(-wl.halfX, wl.north, wl.halfX, wl.north, wl.height, {});
      this.wallSegment(-wl.halfX, wl.south, wl.halfX, wl.south, wl.height, { gate: [-gw, gw] });
      this.wallSegment(-wl.halfX, wl.north, -wl.halfX, wl.south, wl.height, {});
      this.wallSegment(wl.halfX, wl.north, wl.halfX, wl.south, wl.height, {});
    });

    // ---- 装饰：遇到已有结构就让开（不会打穿柱子、墙、屋檐） ----
    this._as("rear-garden-decor", () => this.buildRearGardenDecor(), { yield: true });
    this._as("props", () => this.buildProps(), { yield: true });
    this._as("lantern-street", () => this.buildLanternStreet(), { yield: true });

    // ---- 自然装饰最后撒：只落在没有结构占地的地方 ----
    // 植被先于云：云是实心方块，先铺云的话植被按「最高实心方块」找地表会落在云顶上而整片跳过
    // （城外的竹林、松林只剩一成）；云用 setIfAir，会自己绕开树冠
    this._avoidFootprint = true;
    try { this.scatterVegetation(); } finally { this._avoidFootprint = false; }
    this.buildClouds();
    this.buildCloudSea(); // 低空云海：从高处俯瞰形成「云上之城」

    // 生成阶段用了 setRaw/fillColumnRaw（不逐格标脏），这里统一标脏
    this._restoreWorld();
    if (!this.keepOwners) this._cellOwner = null;
    this.world.markAllDirty();

    return this.world;
  }

  /** 南城门：城台 + 门洞 + 城楼。 */
  buildCityGate(cz) {
    const w = this.world;
    const base = CITY.baseY;
    const halfW = CITY_PLAN.gate.halfW;
    const h = CITY_PLAN.gate.height;

    // 城台
    for (let x = -halfW; x <= halfW; x++) {
      for (let z = cz - 4; z <= cz + 4; z++) {
        for (let k = 1; k <= h; k++) {
          // 门洞
          const inDoor = Math.abs(x) <= 3 && z > cz - 4 && z < cz + 4;
          if (inDoor && k <= 6) continue;
          w.set(x, base + k, z, k === 1 ? ID.wall_base : ID.wall_red);
        }
      }
    }
    // 门洞地面
    for (let x = -3; x <= 3; x++) {
      for (let z = cz - 4; z <= cz + 4; z++) w.set(x, base, z, ID.slate);
    }
    // 门洞拱顶
    for (let x = -3; x <= 3; x++) {
      for (let z = cz - 4; z <= cz + 4; z++) w.set(x, base + 7, z, ID.marble);
    }

    // 城楼（重檐）
    this.buildRoof(0, cz, halfW + 2, 6, base + h + 1, { style: "gold", upturn: 3 });
    for (let x = -halfW + 2; x <= halfW - 2; x++) {
      for (let z = cz - 3; z <= cz + 3; z++) {
        const onEdge = x === -halfW + 2 || x === halfW - 2 || z === cz - 3 || z === cz + 3;
        if (onEdge) for (let k = 0; k < 5; k++) w.set(x, base + h + 1 + k, z, ID.wall_red);
      }
    }
    this.buildRoof(0, cz, halfW - 1, 4, base + h + 6, { style: "gold", upturn: 3 });

    // 城门灯笼
    for (const sx of [-1, 1]) {
      w.set(sx * (halfW - 1), base + h + 2, cz + 4, ID.lantern);
      this.landmarks.push({ type: "lantern", pos: [sx * (halfW - 1), base + h + 2, cz + 4] });
    }
    this.landmarks.push({ type: "gate", pos: [0, base, cz] });
    return this;
  }

  /** 坊市店铺：台基 + 朱红墙 + 窗棂 + 斗拱 + 屋顶。 */
  buildShopBlock(cx, cz, hw, hd, height, roofStyle) {
    const w = this.world;
    const base = CITY.baseY;

    // 台基
    for (let x = cx - hw - 1; x <= cx + hw + 1; x++) {
      for (let z = cz - hd - 1; z <= cz + hd + 1; z++) {
        w.set(x, base + 1, z, ID.marble);
      }
    }
    const floorY = base + 2;

    // 墙体
    for (let x = cx - hw; x <= cx + hw; x++) {
      for (let z = cz - hd; z <= cz + hd; z++) {
        const onEdge = x === cx - hw || x === cx + hw || z === cz - hd || z === cz + hd;
        if (!onEdge) continue;
        for (let k = 0; k < height; k++) {
          // 窗棂：每隔 3 格留一个窗
          const isWindow = k >= 2 && k <= 3 && (x + z) % 3 === 0 && !(z === cz + hd && Math.abs(x - cx) <= 2);
          w.set(x, floorY + k, z, isWindow ? ID.beam_painted : ID.wall_red);
        }
      }
    }

    // 正面开门
    for (let x = cx - 2; x <= cx + 2; x++) {
      for (let k = 0; k < 4; k++) w.set(x, floorY + k, cz + hd, ID.air);
    }

    // 立柱 + 柱础
    for (const px of [cx - hw, cx + hw]) {
      for (const pz of [cz - hd, cz + hd]) {
        w.set(px, floorY, pz, ID.marble);
        for (let k = 1; k < height; k++) w.set(px, floorY + k, pz, ID.pillar_red);
      }
    }

    // 斗拱（檐下小方块）
    for (let x = cx - hw; x <= cx + hw; x++) {
      for (const pz of [cz - hd, cz + hd]) {
        w.set(x, floorY + height, pz, ID.beam_painted);
        if (x % 2 === 0) w.set(x, floorY + height + 1, pz, ID.wood_beam);
      }
    }
    for (let z = cz - hd; z <= cz + hd; z++) {
      for (const px of [cx - hw, cx + hw]) {
        w.set(px, floorY + height, z, ID.beam_painted);
        if (z % 2 === 0) w.set(px, floorY + height + 1, z, ID.wood_beam);
      }
    }

    // 屋顶
    this.buildRoof(cx, cz, hw + 2, hd + 2, floorY + height + 2, {
      style: roofStyle,
      upturn: 2,
    });

    // 店内长明灯
    // 店内灯台：灯立在两格高的木柱上（旧版灯悬在半空，什么都没挂着）
    w.set(cx, floorY, cz, ID.wood_beam);
    w.set(cx, floorY + 1, cz, ID.wood_beam);
    w.set(cx, floorY + 2, cz, ID.glow);
    this.landmarks.push({ type: "lantern", pos: [cx, floorY + 2, cz] });
    return this;
  }

  /** 后苑：塔林、石灯、竹林。 */
  /** 后苑地面（先铺，之后的宝塔、通天塔落在它上面）。 */
  buildRearGardenGround() {
    const w = this.world;
    const base = CITY.baseY;
    const { zFrom, zTo } = CITY_PLAN.rear;
    for (let x = -30; x <= 30; x++) {
      for (let z = zTo; z <= zFrom; z++) w.set(x, base, z, ID.moss_stone);
    }
    return this;
  }

  /** 后苑装饰：石灯阵列与小亭（在通天塔之后放，避开它的占地）。 */
  buildRearGardenDecor() {
    const w = this.world;
    const base = CITY.baseY;
    const { zFrom, zTo } = CITY_PLAN.rear;

    // 装饰整件放置：整个占地都空着才放，否则整件跳过（不会只剩半截柱子、悬空的屋顶）。
    // 后苑中间是通天塔的台基，石灯与小亭排在两侧。
    const fits = (x0, z0, x1, z1) => {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (this.claimed(x, z)) return false;
      return true;
    };

    // 石灯阵列
    for (let z = zFrom - 6; z >= zTo + 6; z -= 12) {
      for (const sx of [-1, 1]) {
        const x = sx * 25;
        if (!fits(x, z, x, z)) continue;
        this._item(() => {
          for (let k = 1; k <= 3; k++) w.set(x, base + k, z, ID.marble);
          w.set(x, base + 4, z, ID.lantern);
          this.landmarks.push({ type: "lantern", pos: [x, base + 4, z] });
        });
      }
    }

    // 小亭（含两级起翘的屋檐，占地半径 6）
    for (const [ox, oz] of [[-27, zFrom - 14], [27, zFrom - 14], [-27, zTo + 12], [27, zTo + 12]]) {
      if (!fits(ox - 6, oz - 6, ox + 6, oz + 6)) continue;
      this._item(() => {
        for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
          for (let k = 1; k <= 4; k++) w.set(ox + dx, base + k, oz + dz, ID.pillar_red);
        }
        this.buildRoof(ox, oz, 4, 4, base + 5, { style: "ink", upturn: 2 });
        w.set(ox, base + 1, oz, ID.glow);
        this.landmarks.push({ type: "lantern", pos: [ox, base + 1, oz] });
      });
    }
    return this;
  }

  /** 生活化道具：摊位、酒旗、水井、花坛、拴马桩、鱼缸。 */
  buildProps() {
    const w = this.world;
    const base = CITY.baseY;

    // 沿中轴大道两侧摆摊位
    for (let z = 80; z >= 34; z -= 11) {
      for (const sx of [-1, 1]) this._item(() => {
        const x = sx * 10;
        // 摊位台面
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) w.set(x + dx, base + 1, z + dz, ID.wood_beam);
        }
        // 摊主位置留空，上方遮阳布
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) w.set(x + dx, base + 4, z + dz, ID.beam_painted);
        }
        // 支柱
        w.set(x - 1, base + 2, z - 1, ID.wood_beam);
        w.set(x - 1, base + 3, z - 1, ID.wood_beam);
        w.set(x + 1, base + 2, z + 1, ID.wood_beam);
        w.set(x + 1, base + 3, z + 1, ID.wood_beam);
        // 酒旗：旗杆从地面立起（旧版只在 base+5 放了一格，悬在半空）
        for (let k = 1; k <= 5; k++) w.set(x + sx * 2, base + k, z, ID.pillar_red);
        w.set(x + sx * 2, base + 6, z, ID.lantern);
        this.landmarks.push({ type: "lantern", pos: [x + sx * 2, base + 6, z] });
      });
    }

    // 水井（广场两侧）
    for (const sx of [-1, 1]) this._item(() => {
      const x = sx * 20;
      const z = 20;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) {
            w.set(x, base, z, ID.water);
          } else {
            w.set(x + dx, base + 1, z + dz, ID.moss_stone);
          }
        }
      }
      // 井架
      w.set(x - 1, base + 2, z, ID.wood_beam);
      w.set(x + 1, base + 2, z, ID.wood_beam);
      w.set(x - 1, base + 3, z, ID.wood_beam);
      w.set(x + 1, base + 3, z, ID.wood_beam);
      w.set(x, base + 3, z, ID.wood_beam);
    });

    // 花坛（广场四角）
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this._item(() => {
      const x = sx * 22;
      const z = 8 + sz * 22;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
          w.set(x + dx, base + 1, z + dz, edge ? ID.marble : ID.dirt);
          if (!edge) {
            const t = hash2i(x + dx, z + dz, 7);
            w.set(x + dx, base + 2, z + dz, t > 0.6 ? ID.flower_red : t > 0.3 ? ID.flower_yellow : ID.grass_tuft);
          }
        }
      }
    });

    // 拴马桩（城门内）
    for (const sx of [-1, 1]) {
      for (let z = 96; z >= 88; z -= 4) this._item(() => {
        const x = sx * 9;
        for (let k = 1; k <= 3; k++) w.set(x, base + k, z, ID.marble);
        w.set(x, base + 4, z, ID.stone_lion);
      });
    }
    return this;
  }
}
