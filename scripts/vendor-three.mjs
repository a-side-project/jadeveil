#!/usr/bin/env node
/**
 * 把 three 从 node_modules 里「vendor」进仓库，让站点自包含（可离线、可直接部署为静态资源）。
 *
 * 背景：index.html 的 importmap 原来指向 ./node_modules/three，
 * 而 node_modules/ 被 .gitignore 排除、也不会随 Worker 静态资源一起上传，
 * 于是别人 clone 或线上访问都会 404。
 *
 * 做法：从入口文件出发，沿相对 import 递归追踪，只拷贝真正用到的文件。
 *
 * 用法: node scripts/vendor-three.mjs
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const THREE = join(ROOT, "node_modules", "three");
const OUT = join(ROOT, "vendor", "three");

// 站点真正用到的入口（src/core/renderer.js 引用的 5 个后处理模块）
const ADDON_ENTRIES = [
  "postprocessing/EffectComposer.js",
  "postprocessing/RenderPass.js",
  "postprocessing/UnrealBloomPass.js",
  "postprocessing/ShaderPass.js",
  "postprocessing/OutputPass.js",
];

// three 的核心构建产物；three.module.js 内部会 import './three.core.js'
const CORE_FILES = ["build/three.module.js", "build/three.core.js"];

const IMPORT_RE = /(?:^|[\s;{(])(?:import|export)[^'"()]*?from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /(?:^|[\s;{(])import\s*['"]([^'"]+)['"]/g;

async function deps(file) {
  const src = await readFile(file, "utf8");
  const found = new Set();
  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) found.add(m[1]);
  }
  return [...found];
}

async function copy(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, await readFile(from));
}

const copied = new Set();

async function walk(absFrom, relInJsm) {
  if (copied.has(relInJsm)) return;
  copied.add(relInJsm);
  const absTo = join(OUT, "addons", relInJsm);
  await copy(absFrom, absTo);

  for (const dep of await deps(absFrom)) {
    if (!dep.startsWith(".")) continue; // 'three' 之类的裸依赖交给 importmap
    const nextAbs = resolve(dirname(absFrom), dep);
    if (!existsSync(nextAbs)) {
      console.warn(`  ! 缺少依赖: ${dep} (来自 ${relInJsm})`);
      continue;
    }
    await walk(nextAbs, relative(THREE + "/examples/jsm", nextAbs));
  }
}

if (!existsSync(join(THREE, "build", "three.module.js"))) {
  console.error("找不到 node_modules/three，请先 npm install");
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });

for (const f of CORE_FILES) await copy(join(THREE, f), join(OUT, f));
console.log(`three 核心: ${CORE_FILES.length} 个文件`);

for (const entry of ADDON_ENTRIES) {
  await walk(join(THREE, "examples", "jsm", entry), entry);
}
console.log(`addons: ${copied.size} 个文件`);
console.log([...copied].sort().map((f) => "  " + f).join("\n"));

const version = JSON.parse(await readFile(join(THREE, "package.json"), "utf8")).version;
await writeFile(
  join(OUT, "VERSION.txt"),
  `three ${version}\nvendored from node_modules/three by scripts/vendor-three.mjs\n`,
);
console.log(`\n✓ 完成: vendor/three (three ${version})`);
