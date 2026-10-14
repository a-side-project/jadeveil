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

      // 深浅水：用波纹高度与到相机距离近似水深
      float depthT = clamp(vWaveHeight * 1.6 + 0.5, 0.0, 1.0);
      vec3 waterCol = mix(uDeep, uShallow, depthT);

      // 天空反射色（随昼夜）
      vec3 skyRefl = mix(uSkyColor, vec3(0.06, 0.09, 0.20), uNight);

      // 太阳高光
      vec3 H = normalize(normalize(uSunDir) + V);
      float spec = pow(max(dot(N, H), 0.0), 220.0);
      float specWide = pow(max(dot(N, H), 0.0), 24.0) * 0.25;

      vec3 col = mix(waterCol, skyRefl, fres * 0.85);
      col += uSunColor * (spec + specWide) * (1.0 - uNight * 0.75);

      // 岸边泡沫：用噪声 + 波纹高度做浅滩白沫
      float foamNoise = fbm(vWorldPos.xz * 1.6 + uTime * 0.15);
      float foam = smoothstep(0.62, 0.92, foamNoise + vWaveHeight * 2.2);
      col = mix(col, uFoam, foam * 0.55 * (1.0 - uNight * 0.5));

      // 视角透明度：掠射更不透明，俯视更透明
      float alpha = mix(uOpacity, 0.97, fres);
      alpha = mix(alpha, 0.55, smoothstep(0.0, 6.0, dist) * 0.0);

      // 水下视角色偏（相机在水面之下）
      if (cameraPosition.y < vWorldPos.y) {
        col = mix(col, vec3(0.10, 0.28, 0.34), 0.55);
        col *= 0.85;
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
