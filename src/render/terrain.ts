/**
 * The land: a smooth sculpted surface coloured by habitat, shaded with procedural
 * detail (rock on slopes, strata, worn footpaths from real traffic, seasonal tint,
 * snow, wetness, caustics under shallows), plus the cut-away sides of the slab and
 * the plinth it rests on.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  type IUniform,
} from "three";
import type { StaticWorldView } from "@/worker/protocol";
import { type HeightField, SLAB_BOTTOM, SUBDIV, fbm2, valueNoise } from "./heightfield";
import { BIOME_COLORS, PATH, ROCK_DARK, ROCK_LIGHT, SEABED_DEEP, SEABED_SHALLOW, SNOW } from "./palette";

export const GLSL_NOISE = /* glsl */ `
float trHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float trNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = trHash(i);
  float b = trHash(i + vec2(1.0, 0.0));
  float c = trHash(i + vec2(0.0, 1.0));
  float d = trHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float trFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * trNoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s / 0.9375;
}
`;

export interface TerrainUniforms {
  uTime: IUniform<number>;
  uSeason: IUniform<Vector3>; // tint multiplier for vegetation greens
  uSeasonMix: IUniform<number>; // 0 lush … 1 dormant
  uSnow: IUniform<number>;
  uWet: IUniform<number>;
  uTraffic: IUniform<DataTexture>;
  uWorld: IUniform<Vector3>; // (w, h, 0)
  uNight: IUniform<number>;
  [key: string]: IUniform<unknown>;
}

export interface TerrainParts {
  mesh: Mesh;
  skirt: Mesh;
  plinth: Mesh;
  floor: Mesh;
  uniforms: TerrainUniforms;
  trafficTexture: DataTexture;
  setTraffic(traffic: Uint16Array): void;
  dispose(): void;
}

function biomeColorAt(view: StaticWorldView, wx: number, wy: number, seed: number, out: Color): Color {
  const { w, h } = view;
  // jittered bilinear blend of the four nearest tiles' habitat colours, so borders are organic
  const jx = wx - 0.5 + (valueNoise(wx * 1.9, wy * 1.9, seed + 41) - 0.5) * 1.1;
  const jy = wy - 0.5 + (valueNoise(wx * 1.9 + 31.7, wy * 1.9 + 11.3, seed + 43) - 0.5) * 1.1;
  const ix = Math.floor(jx);
  const iy = Math.floor(jy);
  const fx = jx - ix;
  const fy = jy - iy;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const tx = Math.min(w - 1, Math.max(0, ix + dx));
      const ty = Math.min(h - 1, Math.max(0, iy + dy));
      const wgt = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      const col = BIOME_COLORS[view.biome[ty * w + tx] as number] ?? BIOME_COLORS[3]!;
      r += col.r * wgt;
      g += col.g * wgt;
      b += col.b * wgt;
    }
  }
  return out.setRGB(r, g, b);
}

export function buildTerrain(view: StaticWorldView, field: HeightField, quality: "low" | "medium" | "high"): TerrainParts {
  const { w, h } = view;
  const seed = view.config.seed;
  const sw = field.sw;
  const sh = field.sh;

  // ── surface geometry
  const positions = new Float32Array(sw * sh * 3);
  const colors = new Float32Array(sw * sh * 3);
  const normals = new Float32Array(sw * sh * 3);
  const tmp = new Color();
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const i = sy * sw + sx;
      const x = sx / SUBDIV - w / 2;
      const z = sy / SUBDIV - h / 2;
      const y = field.ground[i] as number;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      const wx = sx / SUBDIV;
      const wy = sy / SUBDIV;
      if (y < 0) {
        const depth = Math.min(1, -y / 2.0);
        tmp.copy(SEABED_SHALLOW).lerp(SEABED_DEEP, depth);
      } else {
        biomeColorAt(view, wx, wy, seed, tmp);
        // a sandy rim just above the waterline, and bare soil in stream beds
        const rim = Math.max(0, 1 - y / 0.22);
        if (rim > 0) tmp.lerp(SEABED_SHALLOW, rim * 0.85);
        const wet = field.wetMask[i] as number;
        if (wet > 0) tmp.lerp(SEABED_SHALLOW, wet * 0.7);
        // high ground thins from turf to bare rock
        const alpine = Math.max(0, Math.min(1, (y - 5.0) / 3.5));
        if (alpine > 0) tmp.lerp(ROCK_DARK, alpine * 0.7);
        const patch = fbm2(wx * 0.35, wy * 0.35, seed + 59, 3);
        tmp.multiplyScalar(0.86 + 0.28 * patch);
        // hollows are darker, crests catch the light
        tmp.multiplyScalar(field.occlusion[i] as number);
      }
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
  }
  // analytic normals from the height samples
  const g = field.ground;
  const step = 1 / SUBDIV;
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const i = sy * sw + sx;
      const l = g[sy * sw + Math.max(0, sx - 1)] as number;
      const r = g[sy * sw + Math.min(sw - 1, sx + 1)] as number;
      const d = g[Math.max(0, sy - 1) * sw + sx] as number;
      const u = g[Math.min(sh - 1, sy + 1) * sw + sx] as number;
      const nx = -(r - l) / (2 * step);
      const nz = -(u - d) / (2 * step);
      const len = Math.sqrt(nx * nx + 1 + nz * nz);
      normals[i * 3] = nx / len;
      normals[i * 3 + 1] = 1 / len;
      normals[i * 3 + 2] = nz / len;
    }
  }
  // The low preset draws every second sample: a quarter of the triangles over the same vertices,
  // so the silhouette and the skirt still meet (SUBDIV is even, so the rim is always included).
  const stride = quality === "low" ? 2 : 1;
  const indices = new Uint32Array(((sw - 1) / stride) * ((sh - 1) / stride) * 6);
  let k = 0;
  for (let sy = 0; sy < sh - 1; sy += stride) {
    for (let sx = 0; sx < sw - 1; sx += stride) {
      const a = sy * sw + sx;
      const b = a + stride;
      const c = a + sw * stride;
      const d = c + stride;
      // alternate the diagonal for a less directional triangulation
      if (((sx + sy) / stride) & 1) {
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      } else {
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = d;
        indices[k++] = a;
        indices[k++] = d;
        indices[k++] = b;
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  // ── traffic texture (one texel per tile, updated once per simulated day)
  const trafficData = new Uint8Array(w * h);
  const trafficTexture = new DataTexture(trafficData, w, h, RedFormat, UnsignedByteType);
  trafficTexture.magFilter = LinearFilter;
  trafficTexture.minFilter = LinearFilter;
  trafficTexture.needsUpdate = true;

  const uniforms: TerrainUniforms = {
    uTime: { value: 0 },
    uSeason: { value: new Vector3(1, 1, 1) },
    uSeasonMix: { value: 0 },
    uSnow: { value: 0 },
    uWet: { value: 0 },
    uTraffic: { value: trafficTexture },
    uWorld: { value: new Vector3(w, h, 0) },
    uNight: { value: 0 },
  };

  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWPos;
varying vec3 vWNormal;
uniform float uTime;
uniform vec3 uSeason;
uniform float uSeasonMix;
uniform float uSnow;
uniform float uWet;
uniform sampler2D uTraffic;
uniform vec3 uWorld;
uniform float uNight;
${GLSL_NOISE}
#ifdef TR_LOW
#define trFbmQ(p) trNoise(p)
#else
#define trFbmQ(p) trFbm(p)
#endif`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec2 p = vWPos.xz;
  float n1 = trFbmQ(p * 0.55);
  float n2 = trFbmQ(p * 3.1 + 40.0);
#ifdef TR_LOW
  float n3 = n2;
#else
  float n3 = trNoise(p * 11.0);
#endif
  vec3 nrm = normalize(vWNormal);
  float land = smoothstep(-0.02, 0.06, vWPos.y);
  vec3 base = diffuseColor.rgb;

  // living ground: seasonal tint on the green component of the habitat colour
  float greenness = clamp((base.g - max(base.r, base.b)) * 6.0, 0.0, 1.0);
  vec3 seasonal = base * uSeason;
  vec3 dormant = mix(base, vec3(dot(base, vec3(0.3, 0.5, 0.2))) * vec3(1.12, 1.02, 0.78), 0.75);
  base = mix(base, mix(seasonal, dormant, uSeasonMix), greenness * land);
  base *= 0.84 + 0.2 * n2 + 0.12 * n3;
  // meadow flecks: small lighter and darker patches read as tussocks from above
#ifndef TR_LOW
  float tuft = trNoise(p * 23.0);
  base *= mix(1.0, 0.86 + 0.3 * tuft, greenness * land * 0.8);
#endif

  // rock where it is steep, with faint strata following elevation
  float slope = 1.0 - nrm.y;
  float highUp = smoothstep(4.5, 8.5, vWPos.y);
  float rock = smoothstep(0.34 - 0.16 * highUp, 0.56 - 0.2 * highUp, slope + (n2 - 0.5) * 0.14) * land;
  float strata = 0.5 + 0.5 * sin(vWPos.y * 5.0 + n1 * 6.0 + n2 * 3.0);
  strata = mix(0.5, smoothstep(0.2, 0.8, strata), 0.55);
  vec3 rockCol = mix(vec3(${ROCK_DARK.r.toFixed(4)}, ${ROCK_DARK.g.toFixed(4)}, ${ROCK_DARK.b.toFixed(4)}), vec3(${ROCK_LIGHT.r.toFixed(4)}, ${ROCK_LIGHT.g.toFixed(4)}, ${ROCK_LIGHT.b.toFixed(4)}), 0.2 + 0.8 * strata * (0.45 + 0.55 * n1));
  rockCol *= 0.82 + 0.3 * n3;
  // lichen and moss creep onto rock where it is not too steep
  rockCol = mix(rockCol, base * 0.8, (1.0 - smoothstep(0.3, 0.55, slope)) * 0.35 * n2);
  base = mix(base, rockCol, rock);

  // footpaths worn by real traffic
  vec2 tuv = (p + uWorld.xy * 0.5) / uWorld.xy;
  float wear = texture2D(uTraffic, tuv).r;
  float pathMask = smoothstep(0.1, 0.55, wear + (n3 - 0.5) * 0.25) * land * (1.0 - rock);
  base = mix(base, vec3(${PATH.r.toFixed(4)}, ${PATH.g.toFixed(4)}, ${PATH.b.toFixed(4)}) * (0.85 + 0.2 * n2), pathMask * 0.8);

  // seabed: rippled sand and moving caustics in the shallows
  float under = 1.0 - land;
  float depth = clamp(-vWPos.y / 2.0, 0.0, 1.0);
  float ripple = 0.5 + 0.5 * sin(p.x * 5.5 + n1 * 6.0) * sin(p.y * 4.5 + n2 * 4.0);
  base = mix(base, base * (0.9 + 0.14 * ripple), under);
#ifndef TR_LOW
  vec2 cp = p * 1.6;
  float c1 = trNoise(cp + vec2(uTime * 0.22, uTime * 0.17));
  float c2 = trNoise(cp * 1.7 - vec2(uTime * 0.19, uTime * 0.26));
  float caustic = pow(1.0 - abs(c1 - c2), 7.0);
  base += vec3(0.55, 0.62, 0.5) * caustic * under * (1.0 - depth) * (1.0 - uNight) * 0.55;
#endif

  // rain darkens, snow settles on what faces the sky
  base *= 1.0 - 0.22 * uWet * land;
  float snowLine = smoothstep(0.45, 0.8, nrm.y + (n2 - 0.5) * 0.3) * land;
  float snowAmt = clamp(uSnow * 1.25 + smoothstep(8.6, 10.6, vWPos.y + n1 * 1.2) * 0.75 - (1.0 - snowLine), 0.0, 1.0) * snowLine;
  base = mix(base, vec3(${SNOW.r.toFixed(4)}, ${SNOW.g.toFixed(4)}, ${SNOW.b.toFixed(4)}), snowAmt * 0.92);

  diffuseColor.rgb = base;
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.55, clamp(uWet, 0.0, 1.0) * 0.5);`,
      );
  };
  if (quality === "low") material.defines = { ...(material.defines ?? {}), TR_LOW: "" };
  material.customProgramCacheKey = () => `tr-terrain-v2-${quality}`;

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = quality !== "low";
  mesh.name = "terrain";

  // ── cut-away sides of the slab
  const edge: { x: number; z: number; y: number }[] = [];
  const pushEdge = (sx: number, sy: number) => edge.push({ x: sx / SUBDIV - w / 2, z: sy / SUBDIV - h / 2, y: g[sy * sw + sx] as number });
  for (let sx = 0; sx < sw; sx++) pushEdge(sx, 0);
  for (let sy = 1; sy < sh; sy++) pushEdge(sw - 1, sy);
  for (let sx = sw - 2; sx >= 0; sx--) pushEdge(sx, sh - 1);
  for (let sy = sh - 2; sy >= 1; sy--) pushEdge(0, sy);
  const en = edge.length;
  const sPos = new Float32Array((en + 1) * 2 * 3);
  const sBed = new Float32Array((en + 1) * 2);
  const sU = new Float32Array((en + 1) * 2);
  let along = 0;
  for (let e = 0; e <= en; e++) {
    const p = edge[e % en]!;
    const prev = edge[(e + en - 1) % en]!;
    if (e > 0) along += Math.hypot(p.x - prev.x, p.z - prev.z);
    const top = Math.max(p.y, 0);
    sPos.set([p.x, top, p.z], e * 6);
    sPos.set([p.x, SLAB_BOTTOM, p.z], e * 6 + 3);
    sBed[e * 2] = p.y;
    sBed[e * 2 + 1] = p.y;
    sU[e * 2] = along;
    sU[e * 2 + 1] = along;
  }
  const sIdx = new Uint32Array(en * 6);
  for (let e = 0; e < en; e++) {
    const a = e * 2;
    sIdx.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], e * 6);
  }
  const skirtGeometry = new BufferGeometry();
  skirtGeometry.setAttribute("position", new BufferAttribute(sPos, 3));
  skirtGeometry.setAttribute("aBed", new BufferAttribute(sBed, 1));
  skirtGeometry.setAttribute("aU", new BufferAttribute(sU, 1));
  skirtGeometry.setIndex(new BufferAttribute(sIdx, 1));
  const skirtMaterial = new ShaderMaterial({
    side: DoubleSide,
    uniforms: { uTime: uniforms.uTime, uNight: uniforms.uNight, uLight: { value: new Color(1, 1, 1) } },
    vertexShader: /* glsl */ `
      attribute float aBed;
      attribute float aU;
      varying float vBed;
      varying float vU;
      varying float vY;
      void main() {
        vBed = aBed;
        vU = aU;
        vY = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying float vBed;
      varying float vU;
      varying float vY;
      uniform float uTime;
      uniform float uNight;
      uniform vec3 uLight;
      ${GLSL_NOISE}
      void main() {
        vec3 col;
        if (vY > vBed) {
          // a block of clear water seen from the side: bright at the surface, deep teal below
          float d = clamp(-vY / 2.6, 0.0, 1.0);
          vec3 top = vec3(0.22, 0.66, 0.68);
          vec3 deep = vec3(0.015, 0.13, 0.2);
          col = mix(top, deep, pow(d, 0.6));
          float shafts = trNoise(vec2(vU * 0.7 + uTime * 0.05, vY * 0.35)) * (1.0 - d);
          col += vec3(0.08, 0.16, 0.15) * shafts * 0.5;
          // a bright meniscus where the water meets the glass
          col += vec3(0.3, 0.45, 0.42) * smoothstep(0.1, 0.0, -vY);
          col *= 0.95 - 0.3 * smoothstep(0.0, 0.3, vBed - vY + 0.3);
        } else {
          // strata of the island's foundations
          float n = trFbm(vec2(vU * 0.35, vY * 0.9));
          float yy = vY + (n - 0.5) * 0.7;
          float below = vBed - yy;
          vec3 sand = vec3(0.42, 0.36, 0.24);
          vec3 clay = vec3(0.33, 0.2, 0.13);
          vec3 loam = vec3(0.17, 0.12, 0.09);
          vec3 slate = vec3(0.1, 0.105, 0.115);
          col = mix(sand, clay, smoothstep(0.1, 0.55, below));
          col = mix(col, loam, smoothstep(0.7, 1.4, below));
          col = mix(col, slate, smoothstep(1.7, 3.2, below));
          float bands = 0.5 + 0.5 * sin(yy * 11.0 + n * 9.0);
          col *= 0.78 + 0.3 * smoothstep(0.3, 0.7, bands) * n;
          float pebble = step(0.86, trNoise(vec2(vU * 5.0, vY * 5.0)));
          col = mix(col, col * 1.35, pebble * 0.5);
        }
        col *= mix(vec3(1.0), vec3(0.3, 0.4, 0.6), uNight) * uLight;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const skirt = new Mesh(skirtGeometry, skirtMaterial);
  skirt.name = "skirt";

  // ── plinth and the table it stands on
  // a simple dark base slab: built from a box of five faces
  const bx = w / 2 + 1.6;
  const bz = h / 2 + 1.6;
  const top = SLAB_BOTTOM;
  const bottom = SLAB_BOTTOM - 2.2;
  const pv: number[] = [];
  const pn: number[] = [];
  const quad = (a: number[], b: number[], c2: number[], d: number[], nrm: number[]) => {
    pv.push(...a, ...b, ...c2, ...a, ...c2, ...d);
    for (let q = 0; q < 6; q++) pn.push(...nrm);
  };
  quad([-bx, top, -bz], [-bx, top, bz], [bx, top, bz], [bx, top, -bz], [0, 1, 0]);
  quad([-bx, bottom, bz], [bx, bottom, bz], [bx, top, bz], [-bx, top, bz], [0, 0, 1]);
  quad([bx, bottom, -bz], [-bx, bottom, -bz], [-bx, top, -bz], [bx, top, -bz], [0, 0, -1]);
  quad([bx, bottom, bz], [bx, bottom, -bz], [bx, top, -bz], [bx, top, bz], [1, 0, 0]);
  quad([-bx, bottom, -bz], [-bx, bottom, bz], [-bx, top, bz], [-bx, top, -bz], [-1, 0, 0]);
  const pg = new BufferGeometry();
  pg.setAttribute("position", new BufferAttribute(new Float32Array(pv), 3));
  pg.setAttribute("normal", new BufferAttribute(new Float32Array(pn), 3));
  const plinth = new Mesh(pg, new MeshStandardMaterial({ color: new Color("#2a2019"), roughness: 0.5, metalness: 0.08 }));
  plinth.receiveShadow = true;
  plinth.name = "plinth";

  const floorGeometry = new PlaneGeometry(520, 520);
  floorGeometry.rotateX(-Math.PI / 2);
  const floorMaterial = new ShaderMaterial({
    uniforms: {
      uNear: { value: new Color("#2b3a31") },
      uFar: { value: new Color("#0b130f") },
      uHalf: { value: new Vector3(bx, 0, bz) },
      uDim: { value: new Color(1, 1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vP;
      uniform vec3 uNear;
      uniform vec3 uFar;
      uniform vec3 uHalf;
      uniform vec3 uDim;
      void main() {
        float d = length(vP.xz);
        // a pool of gallery light on the table, falling off into the dark
        vec3 col = mix(uNear, uFar, smoothstep(38.0, 135.0, d));
        vec2 q = max(abs(vP.xz) - uHalf.xz, 0.0);
        float edge = length(q);
        col *= 0.3 + 0.7 * smoothstep(0.0, 11.0, edge);
        col *= uDim;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.position.y = bottom - 0.01;
  floor.name = "floor";

  const setTraffic = (traffic: Uint16Array): void => {
    for (let i = 0; i < w * h; i++) {
      const t = traffic[i] as number;
      // perceptual mapping: a few dozen passes already read as a faint trail
      trafficData[i] = Math.min(255, Math.round(255 * (1 - Math.exp(-t / 60))));
    }
    trafficTexture.needsUpdate = true;
  };

  return {
    mesh,
    skirt,
    plinth,
    floor,
    uniforms,
    trafficTexture,
    setTraffic,
    dispose() {
      geometry.dispose();
      material.dispose();
      skirtGeometry.dispose();
      skirtMaterial.dispose();
      pg.dispose();
      (plinth.material as MeshStandardMaterial).dispose();
      floorGeometry.dispose();
      floorMaterial.dispose();
      trafficTexture.dispose();
    },
  };
}
