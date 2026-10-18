/**
 * 实体光照 —— 让玩家、居民、龙、假人与体素世界吃同一套烘焙光照。
 *
 * 体素网格的光照烘焙在顶点里（world/lighting.js），人物模型不是体素，
 * 所以每帧按它所在位置采样一次光照（三线性插值 + 时间平滑），喂给材质：
 *   · 天空光 → 走进屋里、檐下时跟墙面一起变暗
 *   · 方块光 → 夜里站在灯笼下会被暖光照亮
 * 换算公式与体素着色器完全一致（同一组 uniform），人和墙的明暗永远对得上。
 *
 * 单个物体（玩家、龙、假人）用 uniform；居民是 InstancedMesh，用逐实例属性。
 */
import * as THREE from "three";

/**
 * 给材质打补丁。可叠加在已有的 onBeforeCompile 之上（居民材质已经有一个皮肤图集补丁）。
 * @param {THREE.Material} mat
 * @param {object} lightUniforms renderer.lightUniforms
 * @param {{ instanced?: boolean }} opts
 * @returns {{ value: THREE.Vector2 } | null} 单体模式下返回本材质的 uEntLight，调用方每帧写入
 */
export function makeLit(mat, lightUniforms, { instanced = false } = {}) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  const own = instanced ? null : { value: new THREE.Vector2(1, 0) };
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, lightUniforms);
    if (own) sh.uniforms.uEntLight = own;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        ${instanced ? "attribute vec2 aEntLight;" : "uniform vec2 uEntLight;"}
        varying vec2 vEntLight;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vEntLight = ${instanced ? "aEntLight" : "uEntLight"};`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec2 vEntLight;
        uniform float uSkyFloor;
        uniform vec3 uBlockColor;
        uniform float uBlockStrength;
        vec3 jvAlbedoE;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        jvAlbedoE = diffuseColor.rgb;
        diffuseColor.rgb *= mix(uSkyFloor, 1.0, pow(vEntLight.x, 1.5));`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += jvAlbedoE * uBlockColor * pow(vEntLight.y, 1.35) * uBlockStrength;`);
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|ent-light-${instanced ? "i" : "u"}`;
  mat.needsUpdate = true;
  return own;
}

/**
 * 单体实体的光照跟随：每帧采样 + 指数平滑（进出门洞时约 0.25 秒过渡完，不会一跳）。
 */
export class EntityLightProbe {
  constructor(lighting, uniforms) {
    this.lighting = lighting;
    this.uniforms = uniforms.filter(Boolean);
    this.value = new THREE.Vector2(1, 0);
    this._s = [0, 0];
    this._init = false;
  }

  /** @param {{x:number,y:number,z:number}} pos 采样点（通常取胸口高度） */
  update(pos, dt) {
    const s = this.lighting.sampleSmooth(pos.x, pos.y, pos.z, this._s);
    const k = this._init ? 1 - Math.exp(-dt * 12) : 1;
    this._init = true;
    this.value.x += (s[0] - this.value.x) * k;
    this.value.y += (s[1] - this.value.y) * k;
    for (const u of this.uniforms) u.value.copy(this.value);
  }
}
