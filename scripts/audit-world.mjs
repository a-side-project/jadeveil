#!/usr/bin/env node
/**
 * 世界审计 —— 在 node 里跑一遍世界生成，按规则检查结构问题。有违规就以非 0 退出（可接 CI）。
 *
 *   node scripts/audit-world.mjs            汇总报告
 *   node scripts/audit-world.mjs --verbose  列出每条违规的坐标样本
 *
 * 规则：
 *   overlap      结构之间互相覆盖（一个结构把另一个结构放好的方块改掉了）
 *   vegetation   树干 / 树叶 / 竹子 / 花草长在结构里面或屋顶上
 *   cloud        宫墙以内任何高度出现云（低处的实心云会堵路，高处的白云压在殿顶上像积雪、挡住全城）
 *   coplanar     两个都会生成面的不同半透明方块贴在一起（重叠面闪烁）
 *   floating     结构脚下悬空（地坪那一格不是实心）
 *   enclosure    宫墙没有围住城门、牌坊、长街、坊市（城的边界和规划不一致）
 *   reach        居民站位走不到（与城门大道不在同一个连通区域）
 */
import { WorldGenerator, CITY } from "../src/world/generator.js";
import { BLOCKS, ID } from "../src/world/blocks.js";
import { CITY_PLAN } from "../src/world/cityPlan.js";
import { NavGrid } from "../src/world/navgrid.js";
import { STATIONS } from "../src/world/npc.js";

const verbose = process.argv.includes("--verbose");
const t0 = Date.now();
const gen = new WorldGenerator(20261014);
gen.keepOwners = true; // 保留「每一格属于哪个结构」，用来判断植被是不是长进了结构里
const w = gen.generate();
const ownerAt = (x, y, z) => gen._cellOwner.get((x + 512) * 1048576 + (z + 512) * 256 + y);
const B = (id) => BLOCKS[id] || BLOCKS[0];
const report = {};
const add = (rule, sample) => {
  const r = (report[rule] ||= { count: 0, samples: [] });
  r.count++;
  if (r.samples.length < 8) r.samples.push(sample);
};

// ---- overlap ----
for (const [pair, n] of gen.conflicts) for (let i = 0; i < n; i++) add("overlap", pair);

// 城区范围：宫墙以内（规划矩形）
const { north, south, halfX: hx } = CITY_PLAN.wall;
const inCity = (x, z) => Math.abs(x) <= hx && z >= north && z <= south;
const base = CITY.baseY;

const PLANT = new Set([ID.wood_beam, ID.pine_leaf, ID.bamboo, ID.bamboo_leaf, ID.flower_red, ID.flower_yellow, ID.grass_tuft]);
for (let x = -hx - 4; x <= hx + 4; x++) {
  for (let z = north - 4; z <= south + 4; z++) {
    const claimed = gen.claimed(x, z);
    for (let y = base + 1; y < base + 80; y++) {
      const id = w.get(x, y, z);
      if (!id) continue;
      const b = B(id);
      // ---- vegetation：不属于任何结构的植物（自然撒的）出现在结构占地的列里 ----
      if (claimed && PLANT.has(id) && !ownerAt(x, y, z)) add("vegetation", `${b.name}@${x},${y},${z}`);
      // ---- cloud ----
      if (id === ID.cloud && inCity(x, z)) add("cloud", `${x},${y},${z}`);
    }
  }
}

// ---- coplanar：按网格生成器的规则判断相邻两格是否都生成面 ----
const { ChunkMesher } = await import("../src/world/mesher.js");
const mesher = new ChunkMesher(w, { uvRect: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }) });
const faceDirs = [[1, 0, 0, 0, 1], [0, 1, 0, 2, 3], [0, 0, 1, 4, 5]];
for (const [k, c] of w.chunks) {
  const cx = Math.floor(k / 4096) - 1024, cz = (k % 4096) - 1024;
  mesher._fill(cx * 16, cz * 16);
  for (let i = 0; i < c.length; i++) {
    const id = c[i];
    if (!id) continue;
    const b = B(id);
    if (b.opaque) continue;
    const lx = i & 15, lz = (i >> 4) & 15, y = i >> 8;
    if (lx === 15 || lz === 15) continue; // 只在本区块内比较（局部缓存覆盖 ±1）
    const x = cx * 16 + lx, z = cz * 16 + lz;
    for (const [dx, dy, dz, fa, fb] of faceDirs) {
      const o = mesher._id(x + dx, y + dy, z + dz);
      if (!o || o === id) continue;
      const ob = B(o);
      if (ob.opaque) continue;
      if (b.faces[fa] === null || ob.faces[fb] === null) continue;
      if (mesher.faceVisible(x, y, z, fa, id) && mesher.faceVisible(x + dx, y + dy, z + dz, fb, o)) {
        add("coplanar", `${b.name}|${ob.name}@${x},${y},${z}`);
      }
    }
  }
}

// ---- floating：结构的方块必须经由相邻方块（含斜角）连到地面；浮岛与石阶除外 ----
{
  const key = (x, y, z) => (x + 512) * 1048576 + (z + 512) * 256 + y;
  const owned = new Set();
  for (const [k, o] of gen._cellOwner) if (!o.startsWith("island@")) owned.add(k);
  const reached = new Set();
  const q = [];
  for (const k of owned) {
    const y = k % 256, z = Math.floor(k / 256) % 4096 - 512, x = Math.floor(k / 1048576) - 512;
    const below = w.get(x, y - 1, z);
    if (below && B(below).solid && !owned.has(key(x, y - 1, z))) { reached.add(k); q.push([x, y, z]); }
  }
  while (q.length) {
    const [x, y, z] = q.pop();
    // 26 邻接：斜角相接也算连着（飞檐起翘、屋脊就是这样挂出去的）
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dy && !dz) continue;
      const k = key(x + dx, y + dy, z + dz);
      if (!owned.has(k) || reached.has(k)) continue;
      if (!w.get(x + dx, y + dy, z + dz)) continue;
      reached.add(k);
      q.push([x + dx, y + dy, z + dz]);
    }
  }
  for (const k of owned) {
    if (reached.has(k)) continue;
    const y = k % 256, z = Math.floor(k / 256) % 4096 - 512, x = Math.floor(k / 1048576) - 512;
    if (!w.get(x, y, z)) continue;
    add("floating", `${B(w.get(x, y, z)).name}@${x},${y},${z} ${gen._cellOwner.get(k)}`);
  }
}

// ---- enclosure ----
const must = [["gate", 0, CITY_PLAN.gate.z], ["archway", 0, CITY_PLAN.archway.z], ...CITY_PLAN.blocks.map((b) => [`shop@${b.x},${b.z}`, b.x, b.z]), ...CITY_PLAN.pagodas.map((p) => [`pagoda@${p.x},${p.z}`, p.x, p.z])];
for (const [name, x, z] of must) if (!inCity(x, z)) add("enclosure", `${name} outside the wall`);

// ---- reach ----
const nav = new NavGrid(w);
const ref = nav.componentAt ? nav.componentAt(0, CITY_PLAN.archway.z - 6) : null;
if (ref != null) {
  for (const s of STATIONS) {
    const [sx, sz] = s.pos;
    const c = nav.componentAt(sx, sz);
    if (c !== ref) add("reach", `${s.role}@${sx},${sz} comp ${c} != ${ref}`);
  }
  const hall = nav.componentAt(0, CITY_PLAN.hall.z);
  if (hall !== ref) add("reach", `hall interior comp ${hall} != ${ref}`);
}

const rules = ["overlap", "vegetation", "cloud", "coplanar", "floating", "enclosure", "reach"];
let bad = 0;
console.log(`world audit (${Date.now() - t0} ms)`);
for (const r of rules) {
  const v = report[r];
  const n = v ? v.count : 0;
  bad += n;
  console.log(`  ${n ? "FAIL" : "ok  "}  ${r.padEnd(11)} ${n}`);
  if (v && verbose) for (const s of v.samples) console.log(`          ${s}`);
}
if (verbose && gen.conflictSamples) console.log("  overlap cells:", gen.conflictSamples.slice(0, 12));
if (verbose && report.overlap) {
  const pairs = {};
  for (const [p, n] of gen.conflicts) pairs[p] = n;
  console.log("  overlap pairs:", pairs);
}
process.exit(bad ? 1 : 0);
