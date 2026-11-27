/**
 * Flora and resource nodes.
 *
 * Every tree, bush, reed bed, root patch, outcrop and clay bank drawn here is a
 * resource node of the simulation; its size and fruit are driven by the node's actual
 * stock, so depletion and recovery are visible. Grass tufts are the only decoration
 * and are placed by habitat.
 *
 * All geometry is generated procedurally (no external assets).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
  type IUniform,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { StaticWorldView } from "@/worker/protocol";
import { valueNoise, type HeightField } from "./heightfield";
import { type KnowledgeUniforms, veil } from "./overlays";
import { GLSL_NOISE } from "./terrain";
import { CANOPY_BY_SEASON, CONIFER_BY_SEASON, GRASS_BY_SEASON, rand01, wearOf } from "./palette";

const NODE = { berry: 0, root: 1, tree: 2, reed: 3, stone: 4, clay: 5, fish: 6 } as const;
const BIOME = { shore: 1, wetland: 2, meadow: 3, forest: 4, scrub: 5, highland: 6 } as const;

// ───────────────────────── procedural geometry

function paint(geometry: BufferGeometry, fn: (x: number, y: number, z: number, out: Color) => void): BufferGeometry {
  const pos = geometry.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.deleteAttribute("uv");
  return geometry;
}

/** An organic lump: an icosphere pushed around by noise. */
function blob(radius: number, detail: number, seed: number, squashY = 1, roughness = 0.2): BufferGeometry {
  const g = new IcosahedronGeometry(radius, detail);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = valueNoise(x * 3.1 + seed, y * 3.1 + z * 2.3, seed) - 0.5;
    const k = 1 + n * roughness * 2;
    pos.setXYZ(i, x * k, y * k * squashY, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function shade(base: Color, lo: number, hi: number, yMin: number, yMax: number) {
  return (_x: number, y: number, _z: number, out: Color) => {
    const t = Math.max(0, Math.min(1, (y - yMin) / (yMax - yMin)));
    out.copy(base).multiplyScalar(lo + (hi - lo) * t);
  };
}

const WHITE = new Color(1, 1, 1);
const TRUNK = new Color("#6b4a31");
const YELLOWISH = new Color("#a9b04a");
const BLUISH = new Color("#2f6b4a");

function broadleafCanopy(seed: number, shape: "round" | "tall" | "wide", simple = false): BufferGeometry {
  // several overlapping, irregular lumps; the silhouette differs by shape
  const sx = shape === "wide" ? 1.25 : shape === "tall" ? 0.82 : 1;
  const sy = shape === "tall" ? 1.3 : shape === "wide" ? 0.82 : 1;
  const lump = (r: number, x: number, y: number, z: number, k: number, detail = 1) => blob(r, detail, seed + k, 0.86, 0.36).translate(x * sx, 0.62 + (y - 0.62) * sy, z * sx);
  // the simple form keeps the silhouette with a third of the triangles (one smooth crown, four facets)
  const parts = simple
    ? [lump(0.5, 0, 1.12, 0, 0), lump(0.38, 0.3, 0.9, 0.14, 3, 0), lump(0.4, -0.27, 0.94, -0.12, 7, 0), lump(0.33, 0.03, 0.88, -0.31, 11, 0), lump(0.3, -0.08, 1.3, 0.2, 13, 0)]
    : [
        lump(0.44, 0, 1.14, 0, 0),
        lump(0.34, 0.3, 0.92, 0.14, 3),
        lump(0.36, -0.27, 0.96, -0.12, 7),
        lump(0.29, 0.03, 0.88, -0.31, 11),
        lump(0.27, -0.08, 0.9, 0.32, 13),
        lump(0.24, 0.16, 1.36, -0.08, 17),
        lump(0.22, -0.2, 1.3, 0.1, 19),
      ];
  // white vertex colours with a height gradient: the instance colour supplies the hue
  return paint(mergeGeometries(parts)!, (x, y, z, out) => {
    const t = Math.max(0, Math.min(1, (y - 0.6) / (1.0 * sy)));
    const n = valueNoise(x * 5 + seed, z * 5 + y * 3, seed + 5);
    out.setScalar(0.42 + 0.72 * t + 0.12 * (n - 0.5));
  });
}

function coniferCanopy(): BufferGeometry {
  const parts = [
    new ConeGeometry(0.44, 0.72, 7).translate(0, 0.78, 0),
    new ConeGeometry(0.35, 0.62, 7).translate(0, 1.16, 0),
    new ConeGeometry(0.24, 0.52, 7).translate(0, 1.5, 0),
  ].map((g) => g.toNonIndexed());
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  return paint(merged, shade(WHITE, 0.5, 1.15, 0.42, 1.76));
}

function trunkGeometry(height: number, top: number, bottom: number): BufferGeometry {
  const g = new CylinderGeometry(top, bottom, height, 6).translate(0, height / 2, 0).toNonIndexed();
  g.computeVertexNormals();
  return paint(g, shade(TRUNK, 0.8, 1.05, 0, height));
}

function bushGeometry(seed: number, simple = false): BufferGeometry {
  const side = simple ? 0 : 1;
  const parts = [
    blob(0.26, 1, seed, 0.75, 0.25).translate(0, 0.19, 0),
    blob(0.2, side, seed + 5, 0.75, 0.25).translate(0.19, 0.15, 0.08),
    blob(0.19, side, seed + 9, 0.75, 0.25).translate(-0.16, 0.14, -0.11),
  ];
  return paint(mergeGeometries(parts)!, shade(WHITE, 0.6, 1.1, 0, 0.42));
}

function rockGeometry(seed: number, simple = false): BufferGeometry {
  const parts = [
    blob(0.3, 1, seed, 0.72, 0.34).translate(0, 0.14, 0),
    blob(0.2, simple ? 0 : 1, seed + 4, 0.7, 0.34).translate(0.24, 0.09, 0.14),
    blob(0.16, 0, seed + 8, 0.75, 0.3).translate(-0.2, 0.07, 0.17),
  ];
  const stone = new Color("#8f897b");
  const g = mergeGeometries(parts)!;
  return paint(g, (x, y, z, out) => {
    const n = valueNoise(x * 6 + seed, z * 6 + y * 4, seed + 2);
    out.copy(stone).multiplyScalar(0.72 + 0.4 * n + 0.25 * Math.max(0, y));
  });
}

function clayGeometry(seed: number): BufferGeometry {
  const g = mergeGeometries([
    blob(0.24, 1, seed, 0.42, 0.22).translate(0, 0.035, 0),
    blob(0.17, 1, seed + 3, 0.45, 0.22).translate(0.2, 0.025, 0.1),
    blob(0.15, 0, seed + 6, 0.45, 0.2).translate(-0.17, 0.02, 0.13),
    blob(0.12, 0, seed + 9, 0.5, 0.2).translate(-0.04, 0.02, -0.2),
  ])!;
  const clay = new Color("#a8623f");
  return paint(g, (x, y, z, out) => {
    const band = 0.5 + 0.5 * Math.sin(y * 42 + x * 3);
    out.copy(clay).multiplyScalar(0.78 + 0.22 * band + 0.1 * valueNoise(x * 8, z * 8, seed));
  });
}

/** A fan of narrow tapering blades. */
function bladeCluster(count: number, height: number, spread: number, lean: number, seed: number, base: Color, tip: Color, simple: boolean): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();
  for (let b = 0; b < count; b++) {
    const a = (b / count) * Math.PI * 2 + rand01(seed, b) * 0.9;
    const r = spread * (0.25 + 0.75 * rand01(seed, b + 40));
    const hgt = height * (0.60 + 0.65 * rand01(seed, b + 80));
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const bx = dx * r;
    const bz = dz * r;
    const width = (height > 0.3 ? 0.017 : 0.009) * (0.65 + 0.9 * rand01(seed, b + 120));
    const px = -dz * width;
    const pz = dx * width;
    const bend = lean * hgt * (0.7 + rand01(seed, b + 140) * 0.75);
    const rootL = [bx - px, 0, bz - pz];
    const rootR = [bx + px, 0, bz + pz];
    const midL = [bx + dx * bend * 0.35 - px * 0.68, hgt * 0.63, bz + dz * bend * 0.35 - pz * 0.68];
    const midR = [bx + dx * bend * 0.35 + px * 0.68, hgt * 0.63, bz + dz * bend * 0.35 + pz * 0.68];
    const end = [bx + dx * bend, hgt, bz + dz * bend];
    if (simple) {
      pos.push(...rootL, ...rootR, ...end);
    } else {
      pos.push(...rootL, ...rootR, ...midL, ...rootR, ...midR, ...midL, ...midL, ...midR, ...end);
    }
    const variation = 0.80 + 0.36 * rand01(seed, b + 160);
    for (const t of simple ? [0, 0, 1] : [0, 0, 0.63, 0, 0.63, 0.63, 0.63, 0.63, 1]) {
      c.copy(base).lerp(tip, t).multiplyScalar(variation * (0.67 + t * 0.4));
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

function leafRosette(seed: number): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const base = new Color("#5d8a3a");
  const c = new Color();
  for (let b = 0; b < 7; b++) {
    const a = (b / 7) * Math.PI * 2 + rand01(seed, b);
    const len = 0.16 + 0.1 * rand01(seed, b + 20);
    const wdt = 0.06;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz * wdt;
    const pz = dx * wdt;
    const mx = dx * len * 0.55;
    const mz = dz * len * 0.55;
    const tx = dx * len;
    const tz = dz * len;
    const hgt = 0.1 + 0.05 * rand01(seed, b + 60);
    const tri = [0, 0.01, 0, mx + px, hgt, mz + pz, mx - px, hgt, mz - pz, mx - px, hgt, mz - pz, mx + px, hgt, mz + pz, tx, hgt * 0.6, tz];
    pos.push(...tri, tri[0]!, tri[1]!, tri[2]!, tri[6]!, tri[7]!, tri[8]!, tri[3]!, tri[4]!, tri[5]!, tri[9]!, tri[10]!, tri[11]!, tri[15]!, tri[16]!, tri[17]!, tri[12]!, tri[13]!, tri[14]!);
    for (let k = 0; k < 12; k++) {
      c.copy(base).multiplyScalar(0.8 + 0.35 * rand01(seed, b * 13 + k));
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

// ───────────────────────── instancing

interface Layer {
  mesh: InstancedMesh;
  count: number;
}

export interface FloraUniforms {
  uTime: IUniform<number>;
  uWind: IUniform<number>;
  [key: string]: IUniform<unknown>;
}

function swayMaterial(uniforms: FloraUniforms, options: { flat?: boolean; rough?: number; sway?: number; canopyDetail?: boolean } = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: options.rough ?? 0.88, metalness: 0, flatShading: options.flat ?? true });
  const sway = (options.sway ?? 1).toFixed(3);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (options.canopyDetail) {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vCrown;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCrown = position;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
varying vec3 vCrown;
${GLSL_NOISE}`)
        .replace("#include <color_fragment>", `#include <color_fragment>
vec2 leaves = vCrown.xz + vCrown.y * vec2(0.73, -0.61);
float scaleFade = 1.0 - smoothstep(0.35, 0.95, length(fwidth(leaves)) * 16.0);
float clusters = trNoise(leaves * 11.0);
float tips = trNoise(leaves * 42.0 + clusters * 2.0);
float canopyLight = 0.82 + 0.32 * smoothstep(0.21, 0.76, clusters);
diffuseColor.rgb *= canopyLight * (1.0 + scaleFade * (tips - 0.5) * 0.23);
diffuseColor.rgb *= mix(vec3(0.92, 0.97, 1.06), vec3(1.12, 1.04, 0.89), clusters);`);
    }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 swayOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
  vec3 swayOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif
  float swayPhase = swayOrigin.x * 0.61 + swayOrigin.z * 0.47;
  float swayAmt = (sin(uTime * 1.5 + swayPhase) * 0.6 + sin(uTime * 2.6 + swayPhase * 1.7) * 0.4) * uWind * ${sway};
  float swayH = max(0.0, position.y);
  transformed.x += swayAmt * swayH * swayH * 0.07;
  transformed.z += swayAmt * swayH * swayH * 0.045;`,
      );
  };
  m.customProgramCacheKey = () => `tr-sway-${sway}-${options.flat ?? true}-${options.canopyDetail ?? false}`;
  return m;
}

export interface FloraParts {
  objects: Object3D[];
  uniforms: FloraUniforms;
  /** Apply the latest node stocks (only changed nodes are rewritten). */
  setAmounts(amounts: Int16Array): void;
  /** Seasonal recolouring; `yearPos` in [0,1), `snow` in [0,1]. */
  setSeason(yearPos: number, snow: number): void;
  /** World position and radius of a node's visual, for picking and focus. */
  nodeAnchor(node: number): { x: number; y: number; z: number };
  /** Where the principal visible thing on a tile stands and how wide it is (null if the tile holds none). */
  spotAt(tile: number): { x: number; z: number; r: number } | null;
  /** Foot traffic per tile, once a simulated day: grass is trodden down where people really walk. */
  setTraffic(traffic: Uint16Array): void;
  dispose(): void;
}

interface NodeVisual {
  kind: number;
  x: number;
  y: number;
  z: number;
  /** Indices into the kind's layers. */
  items: { layer: number; index: number; x: number; y: number; z: number; rot: number; scale: number; threshold: number }[];
  last: number;
  cap: number;
}

export function buildFlora(view: StaticWorldView, field: HeightField, quality: "low" | "medium" | "high", know?: KnowledgeUniforms): FloraParts {
  const seed = view.config.seed;
  const uniforms: FloraUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
  const foliage = swayMaterial(uniforms, { sway: 1, canopyDetail: quality !== "low" });
  const wood = swayMaterial(uniforms, { sway: 0.5, rough: 0.95 });
  const stiff = swayMaterial(uniforms, { sway: 0, rough: 0.9 });
  const grassMat = swayMaterial(uniforms, { sway: 2.2, flat: false, rough: 0.95 });
  grassMat.side = DoubleSide;
  const berryMat = new MeshStandardMaterial({ color: "#b3273f", roughness: 0.45, metalness: 0, emissive: "#3a0a12", emissiveIntensity: 0.35 });
  if (know) for (const m of [foliage, wood, stiff, grassMat, berryMat]) veil(m, know);

  const simple = quality === "low";
  const geoms = {
    canopyA: broadleafCanopy(3, "round", simple),
    canopyB: broadleafCanopy(17, "tall", simple),
    canopyC: broadleafCanopy(41, "wide", simple),
    conifer: coniferCanopy(),
    trunk: trunkGeometry(0.92, 0.06, 0.11),
    trunkTall: trunkGeometry(0.62, 0.05, 0.09),
    bush: bushGeometry(5, simple),
    berry: new IcosahedronGeometry(0.042, 0),
    rock: rockGeometry(9, simple),
    rock2: rockGeometry(31, simple),
    clay: clayGeometry(13),
    reed: bladeCluster(9, 0.62, 0.16, 0.24, 21, new Color("#6f8f4a"), new Color("#c9b97a"), simple),
    root: leafRosette(27),
    grass: bladeCluster(7, 0.17, 0.1, 0.52, 33, WHITE, WHITE, simple),
  };

  // First pass: decide every instance so that InstancedMesh capacities are exact.
  type LayerKey = "canopyA" | "canopyB" | "canopyC" | "conifer" | "trunk" | "trunkTall" | "bush" | "berry" | "rock" | "rock2" | "clay" | "reed" | "root";
  const layerKeys: LayerKey[] = ["canopyA", "canopyB", "canopyC", "conifer", "trunk", "trunkTall", "bush", "berry", "rock", "rock2", "clay", "reed", "root"];
  const counts: Record<LayerKey, number> = { canopyA: 0, canopyB: 0, canopyC: 0, conifer: 0, trunk: 0, trunkTall: 0, bush: 0, berry: 0, rock: 0, rock2: 0, clay: 0, reed: 0, root: 0 };
  const visuals: NodeVisual[] = [];
  const nodeCount = view.nodeKind.length;
  const { w, h } = view;
  // the thing a person stands beside when working a tile: the last tree to fall, the bush, the largest rock
  const spots = new Map<number, { x: number; z: number; r: number }>();

  const place = (v: NodeVisual, key: LayerKey, dx: number, dz: number, scale: number, threshold: number, rot: number, dy = 0): void => {
    const x = v.x + dx;
    const z = v.z + dz;
    const y = field.standAt(x, z) + dy;
    v.items.push({ layer: layerKeys.indexOf(key), index: counts[key]++, x, y, z, rot, scale, threshold });
  };

  for (let n = 0; n < nodeCount; n++) {
    const kind = view.nodeKind[n] as number;
    const tx = view.nodeX[n] as number;
    const ty = view.nodeY[n] as number;
    const centre = field.tileCentre(tx, ty);
    const v: NodeVisual = { kind, x: centre.x, y: field.standAt(centre.x, centre.z), z: centre.z, items: [], last: -1, cap: Math.max(1, view.nodeCap[n] as number) };
    const r = (salt: number) => rand01(n * 131 + seed, salt);
    const jitter = (salt: number, amount: number) => (r(salt) - 0.5) * amount;
    if (kind === NODE.tree) {
      const biome = view.biome[ty * w + tx] as number;
      const trees = v.cap > 17 ? 3 : v.cap > 12 ? 2 : 1;
      for (let t = 0; t < trees; t++) {
        const dx = jitter(t * 7 + 1, 0.72);
        const dz = jitter(t * 7 + 2, 0.72);
        const s = 0.85 + 0.75 * r(t * 7 + 3) * r(t * 7 + 8) + 0.25 * r(t * 7 + 9);
        const rot = r(t * 7 + 4) * Math.PI * 2;
        const conifer = biome === BIOME.highland || biome === BIOME.scrub || r(t * 7 + 5) < 0.16;
        // trees thin out as wood is taken: each tree disappears below its own stock threshold
        const threshold = t / trees;
        // someone felling it stands out at the edge of the crown, where they can be seen from above
        if (t === 0) spots.set(ty * w + tx, { x: v.x + dx, z: v.z + dz, r: 0.34 * s });
        if (conifer) {
          place(v, "trunkTall", dx, dz, s, threshold, rot);
          place(v, "conifer", dx, dz, s, threshold, rot);
        } else {
          place(v, "trunk", dx, dz, s, threshold, rot);
          const pick = r(t * 7 + 6);
          place(v, pick < 0.4 ? "canopyA" : pick < 0.7 ? "canopyB" : "canopyC", dx, dz, s, threshold, rot);
        }
      }
    } else if (kind === NODE.berry) {
      const dx = jitter(1, 0.3);
      const dz = jitter(2, 0.3);
      const s = 0.95 + 0.4 * r(3);
      place(v, "bush", dx, dz, s, -1, r(4) * 6.28);
      spots.set(ty * w + tx, { x: v.x + dx, z: v.z + dz, r: 0.27 * s });
      const berries = 8;
      for (let b = 0; b < berries; b++) {
        const a = r(10 + b) * Math.PI * 2;
        const rad = (0.1 + 0.16 * r(30 + b)) * s;
        place(v, "berry", dx + Math.cos(a) * rad, dz + Math.sin(a) * rad, 1, b / berries, 0, (0.16 + 0.2 * r(50 + b)) * s);
      }
    } else if (kind === NODE.root) {
      for (let p = 0; p < 4; p++) place(v, "root", jitter(p * 3 + 1, 0.6), jitter(p * 3 + 2, 0.6), 0.85 + 0.5 * r(p * 3 + 3), p / 4, r(p + 9) * 6.28);
      spots.set(ty * w + tx, { x: v.x + jitter(1, 0.6), z: v.z + jitter(2, 0.6), r: 0.1 });
    } else if (kind === NODE.reed) {
      for (let p = 0; p < 4; p++) place(v, "reed", jitter(p * 3 + 1, 0.65), jitter(p * 3 + 2, 0.65), 0.8 + 0.55 * r(p * 3 + 3), p / 4, r(p + 9) * 6.28);
      spots.set(ty * w + tx, { x: v.x + jitter(1, 0.65), z: v.z + jitter(2, 0.65), r: 0.12 });
    } else if (kind === NODE.stone) {
      for (let p = 0; p < 3; p++) place(v, p === 1 ? "rock2" : "rock", jitter(p * 3 + 1, 0.5), jitter(p * 3 + 2, 0.5), 0.9 + 0.7 * r(p * 3 + 3), p / 3, r(p + 9) * 6.28);
      spots.set(ty * w + tx, { x: v.x + jitter(1, 0.5), z: v.z + jitter(2, 0.5), r: 0.2 * (0.9 + 0.7 * r(3)) });
    } else if (kind === NODE.clay) {
      place(v, "clay", jitter(1, 0.2), jitter(2, 0.2), 1 + 0.3 * r(3), -1, r(4) * 6.28);
      spots.set(ty * w + tx, { x: v.x + jitter(1, 0.2), z: v.z + jitter(2, 0.2), r: 0.2 * (1 + 0.3 * r(3)) });
    }
    visuals.push(v);
  }

  const materialFor: Record<LayerKey, MeshStandardMaterial> = {
    canopyA: foliage, canopyB: foliage, canopyC: foliage, conifer: foliage, trunk: wood, trunkTall: wood, bush: foliage, berry: berryMat,
    rock: stiff, rock2: stiff, clay: stiff, reed: grassMat, root: foliage,
  };
  const shadowCasters = new Set<LayerKey>(["canopyA", "canopyB", "canopyC", "conifer", "trunk", "trunkTall", "bush", "rock", "rock2", "clay"]);
  const layers: Layer[] = layerKeys.map((key) => {
    const mesh = new InstancedMesh(geoms[key], materialFor[key], Math.max(1, counts[key]));
    mesh.count = counts[key];
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = quality !== "low" && shadowCasters.has(key);
    mesh.receiveShadow = key !== "berry";
    mesh.frustumCulled = false;
    mesh.name = `flora-${key}`;
    return { mesh, count: counts[key] };
  });

  // ── grass (decoration by habitat)
  const grassTiles: { x: number; z: number; s: number; rot: number; tile: number; worn: number }[] = [];
  const perTile = quality === "low" ? 2 : quality === "medium" ? 4 : 6;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const i = ty * w + tx;
      const biome = view.biome[i] as number;
      if (view.water[i] !== 0) continue;
      const density = biome === BIOME.meadow ? 1 : biome === BIOME.scrub ? 0.55 : biome === BIOME.wetland ? 0.7 : biome === BIOME.forest ? 0.3 : 0;
      for (let k = 0; k < perTile; k++) {
        if (rand01(i * 7 + seed, k) > density) continue;
        const x = tx + rand01(i, k + 20) - w / 2;
        const z = ty + rand01(i, k + 40) - h / 2;
        if (field.heightAt(x, z) < 0.12) continue;
        grassTiles.push({ x, z, s: 0.55 + 0.75 * rand01(i, k + 60), rot: rand01(i, k + 80) * 6.28, tile: i, worn: 0 });
      }
    }
  }
  // ── pebbles where fresh water meets its bank
  const pebbleSpots: { x: number; z: number; s: number; rot: number; shade: number }[] = [];
  const pebblesPerTile = quality === "low" ? 3 : 7;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const i = ty * w + tx;
      for (let k = 0; k < pebblesPerTile * 3 && pebbleSpots.length < 6000; k++) {
        const x = tx + rand01(i * 3 + seed, k + 300) - w / 2;
        const z = ty + rand01(i * 5 + seed, k + 400) - h / 2;
        const wet = field.wetAt(x, z);
        // the strip between dry ground and the water's edge
        if (wet < 0.08 || wet > 0.42) continue;
        pebbleSpots.push({ x, z, s: 0.5 + 1.1 * rand01(i, k + 500) * rand01(i, k + 520), rot: rand01(i, k + 540) * 6.28, shade: 0.72 + 0.4 * rand01(i, k + 560) });
      }
    }
  }
  const pebbleGeometry = paint(new IcosahedronGeometry(0.055, 0).scale(1, 0.55, 0.8), (_x, _y, _z, out) => out.setScalar(1));
  const pebbles = new InstancedMesh(pebbleGeometry, stiff, Math.max(1, pebbleSpots.length));
  pebbles.count = pebbleSpots.length;
  pebbles.receiveShadow = true;
  pebbles.frustumCulled = false;
  pebbles.name = "flora-pebbles";

  const grass = new InstancedMesh(geoms.grass, grassMat, Math.max(1, grassTiles.length));
  grass.count = grassTiles.length;
  grass.receiveShadow = true;
  grass.frustumCulled = false;
  grass.name = "flora-grass";

  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p3 = new Vector3();
  const s3 = new Vector3();
  const nrm = { x: 0, y: 1, z: 0 };
  const tilt = new Quaternion();
  const nv = new Vector3();
  const placeTuft = (g: number): void => {
    const t = grassTiles[g]!;
    field.normalAt(t.x, t.z, nrm);
    nv.set(nrm.x, nrm.y, nrm.z);
    tilt.setFromUnitVectors(up, nv);
    q.setFromAxisAngle(up, t.rot).premultiply(tilt);
    p3.set(t.x, field.heightAt(t.x, t.z) - 0.01, t.z);
    // trodden grass lies low and thin; on a beaten track there is none
    const size = t.s * (1 - t.worn);
    s3.set(size, size * (1 - 0.5 * t.worn), size);
    grass.setMatrixAt(g, m4.compose(p3, q, s3));
  };
  for (let g = 0; g < grassTiles.length; g++) placeTuft(g);
  grass.instanceMatrix.needsUpdate = true;
  const setTraffic = (traffic: Uint16Array): void => {
    let changed = false;
    for (let g = 0; g < grassTiles.length; g++) {
      const t = grassTiles[g]!;
      // the same mapping as the ground's path tint, in five steps so little is rewritten
      const worn = Math.round(Math.max(0, Math.min(1, (wearOf(traffic[t.tile] as number) - 0.2) / 0.55)) * 4) / 4;
      if (worn === t.worn) continue;
      t.worn = worn;
      placeTuft(g);
      changed = true;
    }
    if (changed) grass.instanceMatrix.needsUpdate = true;
  };

  const tint = new Color();
  const PEBBLE = new Color("#9c9684");
  for (let g = 0; g < pebbleSpots.length; g++) {
    const t = pebbleSpots[g]!;
    q.setFromAxisAngle(up, t.rot);
    p3.set(t.x, field.heightAt(t.x, t.z) + 0.004, t.z);
    s3.set(t.s, t.s, t.s);
    pebbles.setMatrixAt(g, m4.compose(p3, q, s3));
    pebbles.setColorAt(g, tint.copy(PEBBLE).multiplyScalar(t.shade));
  }
  pebbles.instanceMatrix.needsUpdate = true;
  if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
  const writeItem = (v: NodeVisual, ratio: number): void => {
    for (const it of v.items) {
      const layer = layers[it.layer]!;
      const key = layerKeys[it.layer]!;
      let scale = it.scale;
      if (it.threshold >= 0) {
        // this element exists only while stock is above its threshold; it shrinks as it is used up
        const span = key === "berry" ? 1 / 8 : key === "trunk" || key === "trunkTall" || key === "canopyA" || key === "canopyB" || key === "canopyC" || key === "conifer" ? 1 / 3 : 1 / 4;
        const local = Math.max(0, Math.min(1, (ratio - it.threshold) / span));
        const isTrunk = key === "trunk" || key === "trunkTall";
        scale *= isTrunk ? (ratio <= it.threshold ? 0.28 : 1) : local <= 0 ? 0 : 0.55 + 0.45 * local;
        if (isTrunk && ratio <= it.threshold) scale = it.scale; // a stump remains
      } else if (key === "bush") {
        scale *= 0.82 + 0.18 * Math.min(1, ratio * 1.5);
      } else if (key === "clay") {
        scale *= 0.35 + 0.65 * ratio;
      }
      q.setFromAxisAngle(up, it.rot);
      p3.set(it.x, it.y, it.z);
      const isStump = (key === "trunk" || key === "trunkTall") && it.threshold >= 0 && ratio <= it.threshold;
      s3.set(scale, isStump ? scale * 0.22 : scale, scale);
      layer.mesh.setMatrixAt(it.index, m4.compose(p3, q, s3));
    }
  };

  let seasonKey = -1;
  const setSeason = (yearPos: number, snow: number): void => {
    const key = Math.floor(yearPos * 80) * 10 + Math.round(snow * 8);
    if (key === seasonKey) return;
    seasonKey = key;
    const f = yearPos * 4;
    const s0 = Math.floor(f) % 4;
    const s1 = (s0 + 1) % 4;
    const t = f - Math.floor(f);
    // hold each season's colour, then cross-fade over its last third
    const blend = t < 0.66 ? 0 : (t - 0.66) / 0.34;
    const canopy = new Color().copy(CANOPY_BY_SEASON[s0]!).lerp(CANOPY_BY_SEASON[s1]!, blend);
    const conifer = new Color().copy(CONIFER_BY_SEASON[s0]!).lerp(CONIFER_BY_SEASON[s1]!, blend);
    const grassTint = new Color().copy(GRASS_BY_SEASON[s0]!).lerp(GRASS_BY_SEASON[s1]!, blend);
    const frost = new Color("#e9eef0");
    canopy.lerp(frost, snow * 0.55);
    conifer.lerp(frost, snow * 0.45);
    grassTint.lerp(frost, snow * 0.7);
    for (const v of visuals) {
      for (const it of v.items) {
        const k = layerKeys[it.layer]!;
        const vary = 0.74 + 0.5 * rand01(it.index * 17 + it.layer, 3);
        if (k === "canopyA" || k === "canopyB" || k === "canopyC") {
          // each tree leans a little toward yellow or blue-green so a wood is never one flat colour
          const hue = rand01(it.index * 29 + it.layer, 9);
          tint.copy(canopy).lerp(hue < 0.5 ? YELLOWISH : BLUISH, Math.abs(hue - 0.5) * 0.5).multiplyScalar(vary);
        }
        else if (k === "conifer") tint.copy(conifer).multiplyScalar(vary);
        else if (k === "bush") tint.copy(canopy).lerp(conifer, 0.45).multiplyScalar(vary);
        else if (k === "root") tint.copy(grassTint).multiplyScalar(0.9 * vary);
        else if (k === "reed") tint.copy(grassTint).lerp(new Color("#c9b97a"), 0.2).multiplyScalar(vary);
        else continue;
        layers[it.layer]!.mesh.setColorAt(it.index, tint);
      }
    }
    for (const layer of layers) if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
    for (let g = 0; g < grassTiles.length; g++) {
      tint.copy(grassTint).multiplyScalar(0.82 + 0.26 * rand01(g, 5));
      grass.setColorAt(g, tint);
    }
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  };

  const setAmounts = (amounts: Int16Array): void => {
    const dirty = new Set<number>();
    for (let n = 0; n < visuals.length; n++) {
      const v = visuals[n]!;
      const amount = amounts[n] as number;
      if (amount === v.last) continue;
      v.last = amount;
      writeItem(v, Math.max(0, Math.min(1, amount / v.cap)));
      for (const it of v.items) dirty.add(it.layer);
    }
    for (const l of dirty) layers[l]!.mesh.instanceMatrix.needsUpdate = true;
  };

  // neutral colours for layers that are not seasonally tinted
  for (const v of visuals) {
    for (const it of v.items) {
      const k = layerKeys[it.layer]!;
      if (k === "trunk" || k === "trunkTall" || k === "rock" || k === "rock2" || k === "clay" || k === "berry") {
        tint.setScalar(0.88 + 0.24 * rand01(it.index * 13 + it.layer, 7));
        layers[it.layer]!.mesh.setColorAt(it.index, tint);
      }
    }
  }
  setSeason(0, 0);

  return {
    objects: [...layers.map((l) => l.mesh), grass, pebbles],
    uniforms,
    setAmounts,
    setSeason,
    nodeAnchor(node: number) {
      const v = visuals[node];
      return v ? { x: v.x, y: v.y, z: v.z } : { x: 0, y: 0, z: 0 };
    },
    spotAt: (tile: number) => spots.get(tile) ?? null,
    setTraffic,
    dispose() {
      for (const g of Object.values(geoms)) g.dispose();
      for (const m of [foliage, wood, stiff, grassMat, berryMat]) m.dispose();
      for (const l of layers) l.mesh.dispose();
      grass.dispose();
      pebbleGeometry.dispose();
      pebbles.dispose();
    },
  };
}
