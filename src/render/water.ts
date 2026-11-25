/**
 * Water: the luminous sea held inside the slab, and fresh water in streams and ponds.
 * Colour comes from true depth (sampled from the same height field as the terrain),
 * with foam where it meets land, moving glints and soft swell.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from "three";
import { SUBDIV, type HeightField } from "./heightfield";
import { type KnowledgeUniforms, VEIL_GLSL, buildKnowledge } from "./overlays";
import { FOAM, FRESH_DEEP, WATER_DEEP, WATER_MID, WATER_SHALLOW } from "./palette";
import { GLSL_NOISE } from "./terrain";

export interface WaterUniforms {
  uTime: IUniform<number>;
  uHeight: IUniform<DataTexture>;
  uWorld: IUniform<Vector3>;
  uSunDir: IUniform<Vector3>;
  uSunColor: IUniform<Color>;
  uSky: IUniform<Color>;
  uLight: IUniform<Color>;
  uNight: IUniform<number>;
  uRain: IUniform<number>;
  uIce: IUniform<number>;
  [key: string]: IUniform<unknown>;
}

export interface WaterParts {
  sea: Mesh;
  fresh: Mesh;
  uniforms: WaterUniforms;
  heightTexture: DataTexture;
  dispose(): void;
}

const vec = (c: Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

export function buildWater(field: HeightField, quality: "low" | "medium" | "high" = "high", know?: KnowledgeUniforms): WaterParts {
  const defines: Record<string, string> = quality === "low" ? { TR_LOW: "" } : {};
  const { w, h, sw, sh } = field;

  const half = new Uint16Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) half[i] = DataUtils.toHalfFloat(Math.max(-8, Math.min(8, field.ground[i] as number)));
  const heightTexture = new DataTexture(half, sw, sh, RedFormat, HalfFloatType);
  heightTexture.magFilter = LinearFilter;
  heightTexture.minFilter = LinearFilter;
  heightTexture.needsUpdate = true;

  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uHeight: { value: heightTexture },
    uWorld: { value: new Vector3(w, h, 0) },
    uSunDir: { value: new Vector3(0.4, 0.8, 0.4) },
    uSunColor: { value: new Color(1, 1, 1) },
    uSky: { value: new Color(0.7, 0.8, 0.9) },
    uLight: { value: new Color(1, 1, 1) },
    uNight: { value: 0 },
    uRain: { value: 0 },
    uIce: { value: 0 },
  };
  // water lies under the same veil as the land when a citizen's knowledge is shown
  const knowledge = know ?? buildKnowledge(w, h).uniforms;
  uniforms.uKnown = knowledge.uKnown;
  uniforms.uKnownMix = knowledge.uKnownMix;
  uniforms.uKnownTone = knowledge.uKnownTone;

  const common = /* glsl */ `
    precision highp float;
    varying vec3 vW;
    uniform float uTime;
    uniform sampler2D uHeight;
    uniform sampler2D uKnown;
    uniform float uKnownMix;
    uniform vec3 uKnownTone;
    uniform vec3 uWorld;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uSky;
    uniform vec3 uLight;
    uniform float uNight;
    uniform float uRain;
    uniform float uIce;
    ${GLSL_NOISE}
  `;

  const seaMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    defines,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      uniform float uTime;
      void main() {
        vec3 p = position;
        p.y += sin(p.x * 0.55 + uTime * 0.7) * 0.012 + sin(p.z * 0.43 - uTime * 0.5) * 0.012;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${common}
      void main() {
        vec2 p = vW.xz;
        vec2 uv = (p + uWorld.xy * 0.5) / uWorld.xy;
        float ground = texture2D(uHeight, uv).r;
        float depth = max(0.0, -ground);
        if (ground > 0.03) discard;

        float t = uTime;
        float w1 = trNoise(p * 0.8 + vec2(t * 0.22, t * 0.16));
        float w2 = trNoise(p * 2.1 - vec2(t * 0.27, t * 0.19));
#ifdef TR_LOW
        float w3 = w2;
#else
        float w3 = trNoise(p * 5.3 + vec2(-t * 0.4, t * 0.33));
#endif
        vec3 n = normalize(vec3((w1 - 0.5) * 0.3 + (w2 - 0.5) * 0.2 + (w3 - 0.5) * 0.1, 1.0, (w2 - 0.5) * 0.3 + (w1 - 0.5) * 0.2 - (w3 - 0.5) * 0.1));

        vec3 col = mix(${vec(WATER_SHALLOW)}, ${vec(WATER_MID)}, smoothstep(0.0, 0.75, depth));
        col = mix(col, ${vec(WATER_DEEP)}, smoothstep(0.55, 2.3, depth));
        col *= 0.95 + 0.1 * w1;
        float alpha = mix(0.3, 0.95, smoothstep(0.0, 1.35, depth));

        // two bands of foam breathing along the shore
        float breathe = 0.05 * sin(t * 0.8 + p.x * 0.6 + p.y * 0.4);
        float edge = 1.0 - smoothstep(0.0, 0.09 + breathe, depth);
        float lace = smoothstep(0.5, 0.85, trNoise(p * 6.5 + vec2(t * 0.35, -t * 0.28)) + edge * 0.5);
        float foam = edge * lace * 0.85;
#ifndef TR_LOW
        float band = smoothstep(0.17, 0.22, depth) * (1.0 - smoothstep(0.23, 0.3 + breathe, depth));
        foam += band * smoothstep(0.6, 0.85, trNoise(p * 8.0 - vec2(t * 0.3, t * 0.2))) * 0.4;
#endif

        vec3 V = normalize(cameraPosition - vW);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(n, H), 0.0), 110.0) * (1.0 - uNight);
        float glitter = pow(max(dot(n, H), 0.0), 26.0) * w3 * (1.0 - uNight);
        // reflection uses the calm surface normal so distant water does not break into blotches
        float fres = pow(1.0 - max(V.y, 0.0), 4.0);

        col *= uLight;
        col = mix(col, uSky * 0.9, fres * 0.3);
        col += uSunColor * (spec * 1.2 + glitter * 0.1);
        // rain rings
#ifndef TR_LOW
        float ring = smoothstep(0.86, 0.96, trNoise(p * 9.0 + floor(t * 6.0) * 3.7)) * uRain;
        col += vec3(0.25) * ring * (1.0 - uNight * 0.6);
#endif
        col = mix(col, ${vec(FOAM)} * (uLight * 0.95 + 0.02), clamp(foam, 0.0, 1.0) * 0.88);
        alpha = max(alpha, clamp(foam, 0.0, 1.0) * 0.9);
        gl_FragColor = vec4(col, alpha);
        {
          vec2 kuv = (vW.xz + uWorld.xy * 0.5) / uWorld.xy;
          ${VEIL_GLSL}
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const seaGeometry = new PlaneGeometry(w, h, 48, 48);
  seaGeometry.rotateX(-Math.PI / 2);
  const sea = new Mesh(seaGeometry, seaMaterial);
  sea.renderOrder = 2;
  sea.name = "sea";

  // ── fresh water: every height-field cell whose four corners carry a water surface
  const pos: number[] = [];
  const mask: number[] = [];
  const pond: number[] = [];
  const idx: number[] = [];
  const vertexAt = new Int32Array(sw * sh).fill(-1);
  const addVertex = (sx: number, sy: number): number => {
    const i = sy * sw + sx;
    let v = vertexAt[i] as number;
    if (v >= 0) return v;
    v = pos.length / 3;
    pos.push(sx / SUBDIV - w / 2, field.fresh[i] as number, sy / SUBDIV - h / 2);
    mask.push(field.wetMask[i] as number);
    pond.push(field.pond[i] as number);
    vertexAt[i] = v;
    return v;
  };
  for (let sy = 0; sy < sh - 1; sy++) {
    for (let sx = 0; sx < sw - 1; sx++) {
      const i = sy * sw + sx;
      const a = field.fresh[i] as number;
      const b = field.fresh[i + 1] as number;
      const c = field.fresh[i + sw] as number;
      const d = field.fresh[i + sw + 1] as number;
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) continue;
      const va = addVertex(sx, sy);
      const vb = addVertex(sx + 1, sy);
      const vc = addVertex(sx, sy + 1);
      const vd = addVertex(sx + 1, sy + 1);
      idx.push(va, vc, vb, vb, vc, vd);
    }
  }
  const freshGeometry = new BufferGeometry();
  freshGeometry.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  freshGeometry.setAttribute("aMask", new BufferAttribute(new Float32Array(mask), 1));
  freshGeometry.setAttribute("aPond", new BufferAttribute(new Float32Array(pond), 1));
  freshGeometry.setIndex(idx);
  const freshMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    defines,
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aMask;
      attribute float aPond;
      varying vec3 vW;
      varying float vMask;
      varying float vPond;
      void main() {
        vMask = aMask;
        vPond = aPond;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${common}
      varying float vMask;
      varying float vPond;
      void main() {
        vec2 p = vW.xz;
        float t = uTime;
        // streams run downhill: scroll the surface detail along the local gradient of the bed
        vec2 uv = (p + uWorld.xy * 0.5) / uWorld.xy;
        float e = 1.0 / uWorld.x;
        float gx = texture2D(uHeight, uv + vec2(e, 0.0)).r - texture2D(uHeight, uv - vec2(e, 0.0)).r;
        float gz = texture2D(uHeight, uv + vec2(0.0, e)).r - texture2D(uHeight, uv - vec2(0.0, e)).r;
        vec2 grad = vec2(gx, gz);
        vec2 flow = -normalize(grad + vec2(1e-4));
        // a stream runs, a pond lies still: how much the bed falls decides which this is
        float running = smoothstep(0.05, 0.3, length(grad)) * (1.0 - smoothstep(0.15, 0.6, vPond));
        vec2 q = vec2(dot(p, flow), dot(p, vec2(-flow.y, flow.x)));
        // the current draws the surface out into streaks along its course
        float streak = trNoise(vec2(q.x * 1.25 - t * 1.15, q.y * 6.5));
        float still = trNoise(p * 1.7 + vec2(t * 0.07, -t * 0.05));
        float f1 = mix(still, streak, running);
        float f2 = trNoise(p * 7.0 - flow * t * 1.6 * running + vec2(13.0 + t * 0.06, t * 0.04));
        // clear over the gravel at the edge, deepening to green-blue in mid-channel
        float depth = smoothstep(0.44, 0.97, vMask);
        vec3 col = mix(${vec(WATER_SHALLOW)}, ${vec(FRESH_DEEP)}, depth * (0.72 + 0.28 * f1));
        col *= 0.9 + 0.16 * f2;
        vec3 n = normalize(vec3((f1 - 0.5) * 0.6, 1.0, (f2 - 0.5) * 0.6));
        vec3 V = normalize(cameraPosition - vW);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(n, H), 0.0), 70.0) * (1.0 - uNight);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        col *= uLight;
        col = mix(col, uSky * 0.8, fres * 0.22);
        col += uSunColor * spec * 0.9;
        // riffles where the water runs shallow and fast
        float riffle = running * smoothstep(0.7, 0.93, streak) * (1.0 - 0.6 * depth);
        float rim = 1.0 - smoothstep(0.45, 0.8, vMask);
        float lace = smoothstep(0.62, 0.9, f2 + rim * 0.3);
        col = mix(col, ${vec(FOAM)} * (uLight * 0.95 + 0.02), clamp(rim * lace * 0.3 + riffle * 0.42, 0.0, 1.0));
        // winter: a pale skin of ice
        col = mix(col, vec3(0.82, 0.9, 0.94) * (uLight * 0.95 + 0.03), uIce * (0.55 + 0.25 * f1));
        // the mesh extends past the bank; the visible edge is this smooth contour of the channel mask
        float alpha = smoothstep(0.34, 0.5, vMask) * mix(mix(0.4, 0.9, depth), 0.95, uIce);
        // a stream runs out into the sea rather than ending in steps at the shore
        alpha *= smoothstep(-0.04, 0.08, vW.y);
        gl_FragColor = vec4(col, alpha);
        {
          vec2 kuv = (vW.xz + uWorld.xy * 0.5) / uWorld.xy;
          ${VEIL_GLSL}
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const fresh = new Mesh(freshGeometry, freshMaterial);
  fresh.renderOrder = 3;
  fresh.name = "fresh-water";

  return {
    sea,
    fresh,
    uniforms,
    heightTexture,
    dispose() {
      seaGeometry.dispose();
      seaMaterial.dispose();
      freshGeometry.dispose();
      freshMaterial.dispose();
      heightTexture.dispose();
    },
  };
}
