/**
 * Water: the luminous sea held inside the slab, and fresh water in streams and ponds.
 * Colour comes from true depth (sampled from the same height field as the terrain),
 * with foam where it meets land, glints where the sun is mirrored, and soft swell.
 *
 * Since D-054 the surface is read from a small repeating texture of ripples
 * (`detail.ts`) where it used to be computed as noise for every pixel. The texture
 * carries the slope of the water as well as its height, so that light is mirrored by
 * the waves themselves: the sun lies on the sea as a broken path of glints toward it,
 * not as specks scattered evenly. A stream is clear water over the bed that is drawn
 * beneath it, moving the way the land falls, and mirrors the sky only at a slant.
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
import { type DetailParts, detailMeans } from "./detail";
import { SUBDIV, type HeightField } from "./heightfield";
import { type KnowledgeUniforms, VEIL_GLSL, buildKnowledge } from "./overlays";
import { FOAM, FRESH_CLEAR, FRESH_DEEP, WATER_DEEP, WATER_MID, WATER_SHALLOW } from "./palette";
import { GLSL_NOISE } from "./terrain";

export interface WaterUniforms {
  uTime: IUniform<number>;
  uHeight: IUniform<DataTexture>;
  uRipples: IUniform<DataTexture>;
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

export function buildWater(field: HeightField, quality: "low" | "medium" | "high" = "high", detail: DetailParts, know?: KnowledgeUniforms): WaterParts {
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
    uRipples: { value: detail.ripples },
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

  const mean = detailMeans().ripples;
  const f = (x: number) => x.toFixed(4);
  const LEVEL = `vec2(${f(mean[0])}, ${f(mean[1])})`;

  const common = /* glsl */ `
    precision highp float;
    varying vec3 vW;
    uniform float uTime;
    uniform sampler2D uHeight;
    uniform sampler2D uRipples;
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
        // The surface is two trains of waves crossing: a slow swell and, turned across it, a shorter
        // chop. Each is one look at the ripple texture, which gives the water's slope as well as its
        // height; as waves shrink below a pixel the texture's smaller copies smooth them away, so the
        // sea is calm from far off and does not shimmer.
        vec4 swell = texture2D(uRipples, p * 0.105 + vec2(t * 0.011, t * 0.007));
        float w1 = swell.b;
#ifdef TR_LOW
        vec2 slope = (swell.rg - ${LEVEL}) * 0.5;
        float lace = swell.a;
        float glint = 0.0;
#else
        vec4 chop = texture2D(uRipples, vec2(p.x * 0.74 + p.y * 0.67, p.y * 0.74 - p.x * 0.67) * 0.41 - vec2(t * 0.034, t * 0.022));
        vec4 fine = texture2D(uRipples, p * 1.7 + vec2(t * 0.05, -t * 0.041));
        vec2 gC = chop.rg - ${LEVEL};
        vec2 gF = fine.rg - ${LEVEL};
        vec2 slope = (swell.rg - ${LEVEL}) * 0.62 + vec2(gC.x * 0.74 - gC.y * 0.67, gC.y * 0.74 + gC.x * 0.67) * 0.5 + gF * 0.36;
        float lace = fine.b;
        float glint = fine.a;
#endif
        vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));

        vec3 col = mix(${vec(WATER_SHALLOW)}, ${vec(WATER_MID)}, smoothstep(0.0, 0.75, depth));
        col = mix(col, ${vec(WATER_DEEP)}, smoothstep(0.55, 2.3, depth));
        col *= 0.93 + 0.14 * w1;
        // clear at the very edge, where the sand shows through and takes the water's colour by itself
        float alpha = mix(0.16, 0.95, smoothstep(0.0, 1.5, depth));

        // foam breathing along the shore, and a thinner line riding in behind it
        float breathe = 0.05 * sin(t * 0.8 + p.x * 0.6 + p.y * 0.4);
        float edge = 1.0 - smoothstep(0.0, 0.09 + breathe, depth);
        float foam = edge * smoothstep(0.42, 0.74, lace + edge * 0.5) * 0.85;
#ifndef TR_LOW
        float band = smoothstep(0.17, 0.22, depth) * (1.0 - smoothstep(0.23, 0.3 + breathe, depth));
        foam += band * smoothstep(0.5, 0.72, chop.b + 0.25 * lace) * 0.42;
#endif

        vec3 V = normalize(cameraPosition - vW);
        vec3 H = normalize(uSunDir + V);
        float nh = max(dot(n, H), 0.0);
        // The sun mirrored in the waves: a soft sheen, and on it sharp glints where a wavelet happens
        // to face the right way. Both lie where the slope allows them — along the path toward the sun.
        float spec = pow(nh, 150.0) * (1.0 - uNight);
        float sparkle = pow(nh, 520.0) * smoothstep(0.5, 0.78, glint) * (1.0 - uNight);
        // Dielectric reflection is weak when viewed from above and stronger toward the horizon.
        float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 5.0);
        float reflectedHeight = clamp(reflect(-V, n).y, 0.0, 1.0);
        vec3 reflection = uSky * mix(vec3(0.64, 0.71, 0.75), vec3(0.29, 0.46, 0.62), reflectedHeight);
        col *= uLight;
        col = mix(col, reflection, fres * 0.62);
        col += uSunColor * (spec * 0.7 + sparkle * 3.2);
        alpha = max(alpha, min(1.0, fres * 1.4 + spec + sparkle));
        // Rain on the water: a ring opens where a drop falls and widens as it fades, each cell of a grid
        // in its own time, more of them in a storm. Nothing is worked out for this on a dry day, and
        // from far off, where a ring is smaller than a pixel, they are left to the eye.
#ifndef TR_LOW
        if (uRain > 0.0) {
          vec2 rg = p * 5.0;
          vec2 cell = floor(rg);
          float born = trHash(cell);
          float age = fract(t * (0.8 + 0.5 * born) + born * 9.0);
          vec2 where = (vec2(trHash(cell + 3.1), trHash(cell + 7.7)) - 0.5) * 0.5;
          float d = length(fract(rg) - 0.5 - where);
          float ring = (1.0 - smoothstep(0.0, 0.035, abs(d - age * 0.24))) * (1.0 - age) * step(born, uRain * 1.3);
          ring *= 1.0 - smoothstep(0.012, 0.05, length(fwidth(p)));
          col += vec3(0.42) * ring * (1.0 - uNight * 0.6);
          alpha = max(alpha, ring * 0.6);
        }
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
  const flow: number[] = [];
  const idx: number[] = [];
  const vertexAt = new Int32Array(sw * sh).fill(-1);
  const g = field.ground;
  const groundAt = (sx: number, sy: number): number => g[Math.max(0, Math.min(sh - 1, sy)) * sw + Math.max(0, Math.min(sw - 1, sx))] as number;
  const addVertex = (sx: number, sy: number): number => {
    const i = sy * sw + sx;
    let v = vertexAt[i] as number;
    if (v >= 0) return v;
    v = pos.length / 3;
    pos.push(sx / SUBDIV - w / 2, field.fresh[i] as number, sy / SUBDIV - h / 2);
    mask.push(field.wetMask[i] as number);
    pond.push(field.pond[i] as number);
    // Which way the land falls here, and how steeply: the fall over a tile either side, so that the
    // channel's own banks do not count. Worked out once per vertex; the surface runs that way.
    const gx = groundAt(sx + SUBDIV, sy) - groundAt(sx - SUBDIV, sy);
    const gz = groundAt(sx, sy + SUBDIV) - groundAt(sx, sy - SUBDIV);
    const steep = Math.hypot(gx, gz);
    flow.push(steep > 1e-4 ? -gx / steep : 0, steep > 1e-4 ? -gz / steep : 0, steep);
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
  freshGeometry.setAttribute("aFlow", new BufferAttribute(new Float32Array(flow), 3));
  freshGeometry.setIndex(idx);
  const freshMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    defines,
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aMask;
      attribute float aPond;
      attribute vec3 aFlow;
      varying vec3 vW;
      varying float vMask;
      varying float vPond;
      varying vec3 vFlow;
      void main() {
        vMask = aMask;
        vPond = aPond;
        vFlow = aFlow;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${common}
      varying float vMask;
      varying float vPond;
      varying vec3 vFlow;
      void main() {
        vec2 p = vW.xz;
        float t = uTime;
        // a stream runs, a pond lies still: how much the bed falls decides which this is
        float running = smoothstep(0.05, 0.3, vFlow.z) * (1.0 - smoothstep(0.15, 0.6, vPond));
        // The surface is carried downhill. It is drawn twice, half a beat apart, each copy sliding
        // with the current and fading out as the other fades in, so that it moves for ever and is
        // never stretched; where nothing runs, both copies only drift.
        vec2 drift = vec2(t * 0.006, -t * 0.004);
        vec2 carry = vFlow.xy * running * 0.62;
        float beat = fract(t * 0.34);
        vec4 ra = texture2D(uRipples, p * 0.93 + drift - carry * beat);
#ifdef TR_LOW
        vec4 r = ra;
#else
        vec4 rb = texture2D(uRipples, p * 0.93 + 0.47 + drift - carry * fract(beat + 0.5));
        vec4 r = mix(ra, rb, abs(beat * 2.0 - 1.0));
#endif
        float f1 = r.b;
        vec2 slope = (r.rg - ${LEVEL}) * mix(0.55, 1.25, running);
        vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
        // clear over the gravel at the edge, deepening to green-blue in mid-channel: mostly the bed
        // itself is what is seen, and the water only tints it
        float depth = smoothstep(0.44, 0.97, vMask);
        vec3 col = mix(${vec(FRESH_CLEAR)}, ${vec(FRESH_DEEP)}, depth * (0.74 + 0.26 * f1));
        vec3 V = normalize(cameraPosition - vW);
        vec3 H = normalize(uSunDir + V);
        float nh = max(dot(n, H), 0.0);
        float spec = pow(nh, 190.0) * (1.0 - uNight);
        float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 5.0);
        float reflectedHeight = clamp(reflect(-V, n).y, 0.0, 1.0);
        vec3 reflection = uSky * mix(vec3(0.62, 0.69, 0.72), vec3(0.3, 0.46, 0.6), reflectedHeight);
        col *= uLight;
        col = mix(col, reflection, fres * 0.75);
        col += uSunColor * spec * 1.6;
        // riffles where the water runs shallow and fast
        float riffle = running * smoothstep(0.62, 0.82, f1) * (1.0 - 0.6 * depth);
        float rim = 1.0 - smoothstep(0.45, 0.8, vMask);
        float lace = smoothstep(0.55, 0.8, r.a + rim * 0.3);
        float froth = clamp(rim * lace * 0.22 + riffle * 0.5, 0.0, 1.0);
        col = mix(col, ${vec(FOAM)} * (uLight * 0.95 + 0.02), froth);
        // winter: a pale skin of ice
        col = mix(col, vec3(0.82, 0.9, 0.94) * (uLight * 0.95 + 0.03), uIce * (0.55 + 0.25 * f1));
        // the mesh extends past the bank; the visible edge is this smooth contour of the channel mask
        float body = max(mix(0.2, 0.8, depth), min(1.0, fres * 1.5 + spec + froth));
        float alpha = smoothstep(0.34, 0.5, vMask) * mix(body, 0.95, uIce);
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
