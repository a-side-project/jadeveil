/**
 * 水面着色器 —— 真实感水面。
 *
 *  · 多层 Gerstner 波叠加（顶点位移 + 解析法线）
 *  · 菲涅尔反射（视角越掠射反射越强）
 *  · 基于视角的透明度
 *  · 深浅水颜色过渡（按水深采样）
 *  · 岸边泡沫 / 浅滩渐变
 *  · 太阳高光随角度变化
 *  · 水下视角色偏
 */
import * as THREE from "three";

export const WaterShader = {
  uniforms: {
    uTime: { value: 0 },
    uShallow: { value: new THREE.Color(0x63a5b2) },
    uDeep: { value: new THREE.Color(0x1d4a5c) },
    uFoam: { value: new THREE.Color(0xe8f4f6) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
    uSunColor: { value: new THREE.Color(0xfff2d4) },
    uSkyColor: { value: new THREE.Color(0xbcd8f0) },
    uNight: { value: 0 },
    uOpacity: { value: 0.86 },
    uWaveScale: { value: 1.0 },
    // ---- 平面反射 ----
    uReflection: { value: null },
    uReflectMatrix: { value: new THREE.Matrix4() },
    uReflectStrength: { value: 0.82 },
    uWaterLevel: { value: 35.0 },
    // 水下程度 0..1（由 renderer.updateWaterView 每帧平滑更新）
    uUnderwater: { value: 0 },
  },

  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uWaveScale;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUv;
    varying float vWaveHeight;

    // Gerstner 波：返回位移与切线
    vec3 gerstner(vec2 p, vec2 dir, float steepness, float wavelength, float speed, float t, out vec3 tangent, out vec3 binormal) {
      float k = 6.28318 / wavelength;
      float c = sqrt(9.8 / k);
      vec2 d = normalize(dir);
      float f = k * (dot(d, p) - c * speed * t);
      float a = steepness / k;

      tangent = vec3(
        1.0 - d.x * d.x * steepness * sin(f),
        d.x * steepness * cos(f),
        -d.x * d.y * steepness * sin(f)
      );
      binormal = vec3(
        -d.x * d.y * steepness * sin(f),
        d.y * steepness * cos(f),
        1.0 - d.y * d.y * steepness * sin(f)
      );
      return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
    }

    void main() {
      vUv = uv;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vec2 p = worldPos.xz;

      vec3 t1, b1, t2, b2, t3, b3;
      vec3 w1 = gerstner(p, vec2(1.0, 0.35), 0.16, 7.0, 1.0, uTime, t1, b1);
      vec3 w2 = gerstner(p, vec2(-0.6, 1.0), 0.12, 4.3, 1.25, uTime, t2, b2);
      vec3 w3 = gerstner(p, vec2(0.3, -1.0), 0.08, 2.6, 1.6, uTime, t3, b3);

      vec3 disp = (w1 + w2 + w3) * uWaveScale;
      vec3 pos = position + disp;

      // 解析法线
      vec3 n = normalize(cross(b1 + b2 + b3, t1 + t2 + t3));
      vNormal = normalize(mat3(modelMatrix) * n);
      vWaveHeight = disp.y;

      vec4 wp = modelMatrix * vec4(pos, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,

  fragmentShader: /* glsl */ `
    precision highp float;

    uniform float uTime;
    uniform vec3 uShallow;
    uniform vec3 uDeep;
    uniform vec3 uFoam;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;
    uniform float uNight;
    uniform float uOpacity;
    uniform sampler2D uReflection;
    uniform mat4 uReflectMatrix;
    uniform float uReflectStrength;
    uniform float uWaterLevel;
    uniform float uUnderwater;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUv;
    varying float vWaveHeight;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                 mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
      return v;
    }

    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(cameraPosition - vWorldPos);
      float dist = length(cameraPosition - vWorldPos);

      // 细节法线扰动（细波纹）
      vec2 rp = vWorldPos.xz * 0.9 + vec2(uTime * 0.35, uTime * 0.22);
      float r1 = fbm(rp);
      float r2 = fbm(rp * 2.3 + 11.0);
      N = normalize(N + vec3((r1 - 0.5) * 0.35, 0.0, (r2 - 0.5) * 0.35));

      // 菲涅尔
      float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      fres = clamp(fres, 0.02, 1.0);

      // 真实水深（水面到水底的垂直距离）
      float depth = max(0.0, uWaterLevel - vWorldPos.y);

      // 深度吸收：越深越暗越偏青，不是简单的双向插值
      vec3 waterCol = mix(uShallow, uDeep, clamp(depth * 1.6, 0.0, 1.0));

      // ---------- 平面反射：采样镜像渲染结果 ----------
      vec3 reflCol = mix(uSkyColor, vec3(0.06, 0.09, 0.20), uNight);
      vec4 rUv = uReflectMatrix * vec4(vWorldPos, 1.0);
      if (rUv.w > 0.0) {
        vec2 uv = rUv.xy / rUv.w;
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
          // 用法线扰动 UV，得到随波起伏的真实倒影
          vec2 off = vec2(N.x, N.z) * 0.030 / (1.0 + dist * 0.02);
          vec3 sampled = texture2D(uReflection, clamp(uv + off, 0.001, 0.999)).rgb;
          reflCol = mix(reflCol, sampled, uReflectStrength);
        }
      }

      // ---------- 水下焦散：波纹聚光 ----------
      float caustic = fbm(vWorldPos.xz * 1.9 + vec2(uTime * 0.28, -uTime * 0.19));
      caustic = pow(smoothstep(0.52, 0.96, caustic), 2.0);

      // 太阳高光
      vec3 H = normalize(normalize(uSunDir) + V);
      float spec = pow(max(dot(N, H), 0.0), 220.0);
      float specWide = pow(max(dot(N, H), 0.0), 24.0) * 0.25;

      vec3 col = mix(waterCol, reflCol, fres);
      col += uSunColor * caustic * 0.14 * (1.0 - uNight * 0.8);
      col += uSunColor * (spec + specWide) * (1.0 - uNight * 0.75);

      // 岸边泡沫：只在浅水出现
      float foamNoise = fbm(vWorldPos.xz * 1.6 + uTime * 0.15);
      float foam = smoothstep(0.62, 0.92, foamNoise + vWaveHeight * 2.2)
                 * smoothstep(3.5, 0.15, depth);
      col = mix(col, uFoam, foam * 0.6 * (1.0 - uNight * 0.5));

      // 视角透明度：掠射更不透明，俯视更透明
      float alpha = mix(uOpacity, 0.97, fres);

      // ---------- 从水下向上看：斯涅尔窗 + 全内反射 ----------
      //
      // 水面从下方看和从上方看是完全不同的画面：
      //   · 接近垂直向上 → 斯涅尔窗，水面外的天空/太阳透射进来（明亮）
      //   · 掠射角     → 全内反射，什么都透不出去，只看到水体自身（暗、青绿）
      if (uUnderwater > 0.001) {
        float cosI = clamp(dot(N, -V), 0.0, 1.0);
        float win = smoothstep(0.52, 0.92, cosI);

        vec3 outside = mix(uSkyColor, uSunColor, 0.30);
        outside *= 1.0 - uNight * 0.86;
        outside += vec3(0.04, 0.10, 0.22) * uNight;

        vec3 tir = mix(vec3(0.04, 0.115, 0.155), waterCol * 0.5, 0.45);
        tir *= 1.0 - uNight * 0.45;

        vec3 underCol = mix(tir, outside, win);
        // 波峰亮边：即使从下方看，水面依旧有起伏与高光
        underCol += uSunColor * spec * 0.55 * (1.0 - uNight * 0.7);
        underCol += uSunColor * caustic * 0.10 * (1.0 - uNight * 0.8);

        col = mix(col, underCol, uUnderwater);
        alpha = mix(alpha, 1.0, uUnderwater);
      } else if (cameraPosition.y < uWaterLevel) {
        // 兼容路径（uUnderwater 尚未生效时）
        col = mix(col, vec3(0.10, 0.30, 0.36), 0.5);
        alpha = 0.92;
      }

      gl_FragColor = vec4(col, alpha);
      #include <colorspace_fragment>
    }
  `,
};

export function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(WaterShader.uniforms),
    vertexShader: WaterShader.vertexShader,
    fragmentShader: WaterShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
