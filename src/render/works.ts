/**
 * The works: fields, granaries, stone houses, healing houses, mills and record houses
 * (worlds with crafts). Like everything else here they are drawn from the simulation's own
 * state and say only what it says: a field's crop stands as tall as it is ripe and is gone
 * when it has been reaped; a granary and a mill show sacks for what they hold; a healing house
 * hangs herbs only while care is laid up in it; a mill's wheel turns only while its stream
 * runs; a record house sets out one slab for each craft written in it.
 *
 * Geometry is in the same hand as the first toolkit (structures.ts): faceted timber, stone and
 * thatch, vertex colours, one shared material. Each kind is one instanced mesh, so a hundred
 * fields are one draw call.
 */
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  type Material,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { StructureView } from "@/worker/protocol";
import type { HeightField } from "./heightfield";
import { rand01 } from "./palette";

/** Structure kinds drawn here (the engine's ids; see StructureKind in src/engine/model/constants.ts). */
export const WORK = { field: 4, granary: 5, house: 6, healing_house: 7, mill: 8, record_house: 9 } as const;
export const FIRST_WORK = 4;

/** How far from its centre each work reaches: where someone working on it stands. */
export const WORK_REACH: Record<number, number> = { 4: 0.5, 5: 0.5, 6: 0.56, 7: 0.56, 8: 0.6, 9: 0.54 };

const CAP = { field: 400, crop: 400, granary: 96, house: 160, healing: 64, herbs: 64, mill: 48, wheel: 48, record: 32, slab: 32 * 6, sack: 96 * 6 + 48 * 4 };

function tinted(g: BufferGeometry, color: string, jitter = 0.12, seed = 1): BufferGeometry {
  const geometry = g.index ? g.toNonIndexed() : g;
  const pos = geometry.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const base = new Color(color);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const face = Math.floor(i / 3);
    c.copy(base).multiplyScalar(1 - jitter + 2 * jitter * rand01(face + seed * 97, 3));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.deleteAttribute("uv");
  geometry.computeVertexNormals();
  return geometry;
}

const STONE = "#9a9384";
const STONE_DARK = "#7d776b";
const TIMBER = "#5a3f2a";
const TIMBER_LIGHT = "#7a5a3a";
const THATCH = "#b89a5a";
const THATCH_DARK = "#8d7444";
const DAUB = "#d2c2a0";
const EARTH = "#4f3a26";
const SLATE = "#5b6a78";

/** A pitched roof over a rectangle: two slabs meeting at a ridge along Z. */
function pitchedRoof(halfW: number, halfL: number, eaves: number, rise: number, color: string, seed: number, thickness = 0.05): BufferGeometry[] {
  const a = Math.atan2(rise, halfW);
  const slope = Math.hypot(halfW, rise) + 0.08;
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1] as const) {
    const slab = new BoxGeometry(slope, thickness, halfL * 2 + 0.12);
    slab.rotateZ(side === -1 ? a : -a);
    slab.translate(side * (halfW / 2 + 0.02), eaves + rise / 2, 0);
    parts.push(tinted(slab, color, 0.13, seed + (side === 1 ? 5 : 0)));
  }
  const ridge = new BoxGeometry(0.08, 0.05, halfL * 2 + 0.14);
  ridge.translate(0, eaves + rise + 0.02, 0);
  parts.push(tinted(ridge, color === THATCH ? THATCH_DARK : STONE_DARK, 0.1, seed + 9));
  return parts;
}

/** The two triangular ends under a pitched roof. */
function gableEnds(halfW: number, halfL: number, eaves: number, rise: number, color: string, seed: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (const z of [-halfL, halfL]) {
    const g = new ConeGeometry(halfW, rise, 3, 1, true);
    // a three-sided cone seen end on is a triangle: flatten it into the gable
    g.scale(1, 1, 0.04);
    g.rotateY(Math.PI / 2);
    g.translate(0, eaves + rise / 2, z);
    parts.push(tinted(g, color, 0.1, seed + (z > 0 ? 3 : 0)));
  }
  return parts;
}

function fieldGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // six furrows of turned earth, and four corner stakes
  for (let r = 0; r < 6; r++) {
    const row = new BoxGeometry(0.9, 0.045, 0.1);
    row.translate(0, 0.02, -0.375 + r * 0.15);
    parts.push(tinted(row, r % 2 === 0 ? EARTH : "#5b4430", 0.16, 110 + r));
  }
  for (const [x, z] of [[-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46]] as const) {
    const stake = new CylinderGeometry(0.016, 0.02, 0.2, 4);
    stake.translate(x, 0.1, z);
    parts.push(tinted(stake, TIMBER, 0.1, 117));
  }
  return mergeGeometries(parts)!;
}

function cropGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let r = 0; r < 6; r++) {
    for (let k = 0; k < 6; k++) {
      const blade = new ConeGeometry(0.034, 0.2, 4, 1, true);
      blade.translate(-0.39 + k * 0.156 + (rand01(r * 6 + k, 5) - 0.5) * 0.05, 0.13, -0.375 + r * 0.15 + (rand01(r * 6 + k, 6) - 0.5) * 0.03);
      parts.push(tinted(blade, "#ffffff", 0.16, 130 + r * 6 + k));
    }
  }
  return mergeGeometries(parts)!;
}

function granaryGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // a round, daubed bin raised on a ring of stones, under a pointed cap of thatch
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const stone = new IcosahedronGeometry(0.09, 0);
    stone.scale(1, 0.7, 1);
    stone.translate(Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3);
    parts.push(tinted(stone, STONE, 0.14, 140 + k));
  }
  const bin = new CylinderGeometry(0.34, 0.38, 0.5, 9);
  bin.translate(0, 0.36, 0);
  parts.push(tinted(bin, DAUB, 0.08, 150));
  const band = new CylinderGeometry(0.385, 0.385, 0.035, 9, 1, true);
  band.translate(0, 0.3, 0);
  parts.push(tinted(band, TIMBER, 0.1, 151));
  const hatch = new BoxGeometry(0.16, 0.18, 0.04);
  hatch.translate(0, 0.42, 0.355);
  parts.push(tinted(hatch, TIMBER, 0.1, 152));
  const cap = new ConeGeometry(0.5, 0.44, 9);
  cap.translate(0, 0.83, 0);
  parts.push(tinted(cap, THATCH, 0.14, 153));
  return mergeGeometries(parts)!;
}

function houseGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const hw = 0.4;
  const hl = 0.34;
  // dry-stone walls in three courses, each a little in from the one below
  for (let k = 0; k < 3; k++) {
    const course = new BoxGeometry(hw * 2 - k * 0.02, 0.15, hl * 2 - k * 0.02);
    course.translate(0, 0.075 + k * 0.15, 0);
    parts.push(tinted(course, k === 1 ? STONE_DARK : STONE, 0.15, 160 + k));
  }
  const door = new BoxGeometry(0.17, 0.3, 0.03);
  door.translate(0.1, 0.15, hl + 0.005);
  parts.push(tinted(door, "#2c2017", 0.06, 164));
  const lintel = new BoxGeometry(0.24, 0.045, 0.05);
  lintel.translate(0.1, 0.32, hl + 0.005);
  parts.push(tinted(lintel, TIMBER_LIGHT, 0.1, 165));
  parts.push(...gableEnds(hw - 0.02, hl - 0.01, 0.45, 0.3, STONE, 166));
  parts.push(...pitchedRoof(hw + 0.04, hl, 0.44, 0.32, SLATE, 170));
  const chimney = new BoxGeometry(0.11, 0.3, 0.11);
  chimney.translate(-0.22, 0.72, -0.12);
  parts.push(tinted(chimney, STONE_DARK, 0.14, 180));
  return mergeGeometries(parts)!;
}

function healingGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const hw = 0.38;
  const hl = 0.4;
  // pale daubed walls in a timber frame, a low reed roof, an open doorway and a bench
  const walls = new BoxGeometry(hw * 2, 0.36, hl * 2);
  walls.translate(0, 0.18, 0);
  parts.push(tinted(walls, "#e4dbc6", 0.05, 190));
  for (const [x, z] of [[-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl]] as const) {
    const post = new CylinderGeometry(0.026, 0.03, 0.4, 5);
    post.translate(x, 0.2, z);
    parts.push(tinted(post, TIMBER, 0.1, 191));
  }
  const sill = new BoxGeometry(hw * 2 + 0.05, 0.035, hl * 2 + 0.05);
  sill.translate(0, 0.37, 0);
  parts.push(tinted(sill, TIMBER_LIGHT, 0.1, 192));
  const door = new BoxGeometry(0.2, 0.28, 0.03);
  door.translate(0, 0.14, hl + 0.005);
  parts.push(tinted(door, "#2c2017", 0.06, 193));
  parts.push(...gableEnds(hw - 0.01, hl, 0.38, 0.22, "#e4dbc6", 194));
  parts.push(...pitchedRoof(hw + 0.05, hl, 0.37, 0.24, "#a9a06a", 196));
  const bench = new BoxGeometry(0.3, 0.05, 0.1);
  bench.translate(-0.2, 0.1, hl + 0.1);
  parts.push(tinted(bench, TIMBER_LIGHT, 0.1, 205));
  return mergeGeometries(parts)!;
}

/** Bundles of herbs hung under the eaves: drawn only while care is laid up. */
function herbsGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const bundle = new ConeGeometry(0.035, 0.12, 5);
    bundle.rotateX(Math.PI);
    bundle.translate(-0.3 + k * 0.15, 0.3, 0.435);
    parts.push(tinted(bundle, k % 2 === 0 ? "#6f9a4e" : "#8aa85a", 0.16, 210 + k));
  }
  return mergeGeometries(parts)!;
}

function millGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const hw = 0.3;
  const hl = 0.3;
  // a stone foot, a timber upper storey jettied over it, a steep roof; the wheel hangs on +X
  const foot = new BoxGeometry(hw * 2, 0.34, hl * 2);
  foot.translate(-0.08, 0.17, 0);
  parts.push(tinted(foot, STONE, 0.15, 220));
  const upper = new BoxGeometry(hw * 2 + 0.06, 0.26, hl * 2 + 0.06);
  upper.translate(-0.08, 0.47, 0);
  parts.push(tinted(upper, TIMBER_LIGHT, 0.12, 221));
  for (const z of [-hl - 0.03, hl + 0.03]) {
    const brace = new BoxGeometry(0.04, 0.26, 0.03);
    brace.rotateZ(0.5);
    brace.translate(-0.08, 0.47, z);
    parts.push(tinted(brace, TIMBER, 0.1, 222));
  }
  const door = new BoxGeometry(0.16, 0.26, 0.03);
  door.translate(-0.12, 0.13, hl + 0.005);
  parts.push(tinted(door, "#2c2017", 0.06, 223));
  const roofParts = [...gableEnds(hw + 0.02, hl + 0.03, 0.6, 0.3, TIMBER_LIGHT, 224), ...pitchedRoof(hw + 0.08, hl + 0.03, 0.59, 0.32, THATCH, 226)];
  for (const g of roofParts) g.translate(-0.08, 0, 0);
  parts.push(...roofParts);
  // the axle and its bearing post
  const axle = new CylinderGeometry(0.03, 0.03, 0.3, 5);
  axle.rotateZ(Math.PI / 2);
  axle.translate(0.32, 0.3, 0);
  parts.push(tinted(axle, TIMBER, 0.1, 236));
  const post = new BoxGeometry(0.05, 0.36, 0.05);
  post.translate(0.56, 0.18, 0);
  parts.push(tinted(post, TIMBER, 0.1, 237));
  return mergeGeometries(parts)!;
}

/** The wheel: a rim of eight spokes and eight paddles turning about X (its own origin is the axle). */
function wheelGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const r = 0.3;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const spoke = new BoxGeometry(0.035, r, 0.03);
    spoke.translate(0, r / 2, 0);
    spoke.rotateX(a);
    parts.push(tinted(spoke, TIMBER, 0.1, 240 + k));
    const paddle = new BoxGeometry(0.15, 0.03, 0.12);
    paddle.translate(0, r, 0);
    paddle.rotateX(a);
    parts.push(tinted(paddle, TIMBER_LIGHT, 0.14, 250 + k));
  }
  const hub = new CylinderGeometry(0.05, 0.05, 0.16, 6);
  hub.rotateZ(Math.PI / 2);
  parts.push(tinted(hub, TIMBER, 0.1, 260));
  return mergeGeometries(parts)!;
}

function recordGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const hw = 0.3;
  const hl = 0.36;
  // a small hall of dressed stone on a plinth, slate over it, and a porch on two posts
  const plinth = new BoxGeometry(hw * 2 + 0.2, 0.07, hl * 2 + 0.32);
  plinth.translate(0, 0.035, 0.06);
  parts.push(tinted(plinth, STONE_DARK, 0.12, 270));
  const walls = new BoxGeometry(hw * 2, 0.4, hl * 2);
  walls.translate(0, 0.27, 0);
  parts.push(tinted(walls, "#b0a898", 0.09, 271));
  const door = new BoxGeometry(0.18, 0.28, 0.03);
  door.translate(0, 0.21, hl + 0.005);
  parts.push(tinted(door, "#2c2017", 0.06, 272));
  parts.push(...gableEnds(hw - 0.01, hl, 0.47, 0.24, "#b0a898", 273));
  parts.push(...pitchedRoof(hw + 0.05, hl + 0.14, 0.46, 0.26, SLATE, 275));
  for (const x of [-0.22, 0.22]) {
    const post = new CylinderGeometry(0.03, 0.035, 0.4, 6);
    post.translate(x, 0.27, hl + 0.2);
    parts.push(tinted(post, "#c3bcae", 0.08, 285));
  }
  return mergeGeometries(parts)!;
}

/** One upright slab: a craft written down. */
function slabGeometry(): BufferGeometry {
  const slab = new BoxGeometry(0.085, 0.2, 0.03);
  slab.translate(0, 0.17, 0);
  return tinted(slab, "#cfc8b8", 0.08, 290);
}

function sackGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(0.085, 1);
  g.scale(1, 0.85, 1);
  return tinted(g, "#c9b58a", 0.1, 295);
}

export interface WorksParts {
  objects: Object3D[];
  /** Lay out every work in the list (structures of other kinds are ignored). */
  set(list: StructureView[]): void;
  /** Turn the wheels of mills whose stream runs. */
  animate(time: number): void;
  dispose(): void;
}

/** Everything is laid out from the structure views alone: what stands, how far built, how ripe, how full, whether a mill's stream runs. */
export function buildWorks(field: HeightField, quality: "low" | "medium" | "high", solid: Material): WorksParts {
  const geoms = {
    field: fieldGeometry(),
    crop: cropGeometry(),
    granary: granaryGeometry(),
    house: houseGeometry(),
    healing: healingGeometry(),
    herbs: herbsGeometry(),
    mill: millGeometry(),
    wheel: wheelGeometry(),
    record: recordGeometry(),
    slab: slabGeometry(),
    sack: sackGeometry(),
  };
  const mk = (key: keyof typeof geoms, name: string): InstancedMesh => {
    const m = new InstancedMesh(geoms[key], solid, CAP[key]);
    m.count = 0;
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.castShadow = quality !== "low" && key !== "crop";
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.name = name;
    return m;
  };
  const meshes = {
    field: mk("field", "fields"),
    crop: mk("crop", "crops"),
    granary: mk("granary", "granaries"),
    house: mk("house", "houses"),
    healing: mk("healing", "healing-houses"),
    herbs: mk("herbs", "healing-herbs"),
    mill: mk("mill", "mills"),
    wheel: mk("wheel", "mill-wheels"),
    record: mk("record", "record-houses"),
    slab: mk("slab", "record-slabs"),
    sack: mk("sack", "work-sacks"),
  };

  const m4 = new Matrix4();
  const q = new Quaternion();
  const qw = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const axis = new Vector3(1, 0, 0);
  const p3 = new Vector3();
  const s3 = new Vector3();
  const tint = new Color();
  const GREEN = new Color("#74a54c");
  const GOLD = new Color("#d9bb55");
  /** Mills as laid out: where each wheel hangs, which way it faces, and whether it turns. */
  const wheels: { x: number; y: number; z: number; yaw: number; turns: boolean; phase: number }[] = [];

  /** The direction (a quarter turn at a time) in which the most water lies beside a tile. */
  const towardWater = (cx: number, cz: number): number => {
    let best = 0;
    let bestW = -1;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      // +X of the model is where the wheel hangs; rotating by `a` about Y carries +X to (cos a, −sin a)
      const wet = field.waterAt(cx + Math.cos(a) * 0.9, cz - Math.sin(a) * 0.9) + 0.5 * field.waterAt(cx + Math.cos(a) * 0.6, cz - Math.sin(a) * 0.6);
      if (wet > bestW) {
        bestW = wet;
        best = a;
      }
    }
    return best;
  };

  const set = (list: StructureView[]): void => {
    const n = { field: 0, crop: 0, granary: 0, house: 0, healing: 0, herbs: 0, mill: 0, wheel: 0, record: 0, slab: 0, sack: 0 };
    wheels.length = 0;
    const sacksAt = (sv: StructureView, cx: number, y: number, cz: number, yaw: number, most: number, ring: number): void => {
      // what a store holds is set out beside it: one sack for each tenth or so of its fill
      const sacks = sv.complete ? Math.min(most, Math.ceil(sv.fill / 170)) : 0;
      for (let k = 0; k < sacks && n.sack < CAP.sack; k++) {
        const a = yaw + 2.2 + k * 0.62;
        p3.set(cx + Math.cos(a) * ring, y + 0.07, cz + Math.sin(a) * ring);
        s3.set(1, 1, 1);
        meshes.sack.setMatrixAt(n.sack, m4.compose(p3, q, s3));
        meshes.sack.setColorAt(n.sack, tint.setScalar(0.9 + 0.2 * rand01(sv.id * 9 + k, 2)));
        n.sack++;
      }
    };
    for (const sv of list) {
      if (sv.kind < FIRST_WORK) continue;
      const c = field.tileCentre(sv.x, sv.y);
      const y = field.standAt(c.x, c.z);
      const built = sv.complete ? 1 : 0.25 + 0.75 * (sv.progress / 1000);
      const dim = sv.complete ? 1 : 0.8;
      const quarter = Math.round(rand01(sv.id, 4) * 3) * (Math.PI / 2);
      const yaw = rand01(sv.id, 1) * Math.PI * 2;
      p3.set(c.x, y - 0.01, c.z);
      if (sv.kind === WORK.field && n.field < CAP.field) {
        q.setFromAxisAngle(up, quarter);
        s3.set(1, 1, 1);
        meshes.field.setMatrixAt(n.field, m4.compose(p3, q, s3));
        // an unsown field is paler: turned earth gone dry
        meshes.field.setColorAt(n.field, tint.setScalar(sv.complete ? 1 : 1.25));
        n.field++;
        if (sv.complete && n.crop < CAP.crop) {
          const grow = 0.15 + 0.85 * (sv.ripe / 1000);
          s3.set(1, grow * 1.7, 1);
          meshes.crop.setMatrixAt(n.crop, m4.compose(p3, q, s3));
          meshes.crop.setColorAt(n.crop, sv.ripe >= 1000 ? tint.copy(GOLD) : tint.copy(GREEN).lerp(GOLD, Math.max(0, sv.ripe / 1000 - 0.6) * 1.2));
          n.crop++;
        }
      } else if (sv.kind === WORK.granary && n.granary < CAP.granary) {
        q.setFromAxisAngle(up, yaw);
        s3.set(1, built, 1);
        meshes.granary.setMatrixAt(n.granary, m4.compose(p3, q, s3));
        meshes.granary.setColorAt(n.granary, tint.setScalar(dim));
        n.granary++;
        sacksAt(sv, c.x, y, c.z, yaw, 6, 0.5);
      } else if (sv.kind === WORK.house && n.house < CAP.house) {
        q.setFromAxisAngle(up, quarter + (rand01(sv.id, 6) - 0.5) * 0.3);
        s3.set(1, built, 1);
        meshes.house.setMatrixAt(n.house, m4.compose(p3, q, s3));
        meshes.house.setColorAt(n.house, tint.setScalar(dim * (0.94 + 0.12 * rand01(sv.id, 7))));
        n.house++;
      } else if (sv.kind === WORK.healing_house && n.healing < CAP.healing) {
        q.setFromAxisAngle(up, quarter + (rand01(sv.id, 6) - 0.5) * 0.3);
        s3.set(1, built, 1);
        meshes.healing.setMatrixAt(n.healing, m4.compose(p3, q, s3));
        meshes.healing.setColorAt(n.healing, tint.setScalar(dim));
        n.healing++;
        if (sv.complete && sv.fuel > 0 && n.herbs < CAP.herbs) {
          s3.set(1, 1, 1);
          meshes.herbs.setMatrixAt(n.herbs, m4.compose(p3, q, s3));
          meshes.herbs.setColorAt(n.herbs, tint.setScalar(1));
          n.herbs++;
        }
      } else if (sv.kind === WORK.mill && n.mill < CAP.mill) {
        const face = towardWater(c.x, c.z);
        q.setFromAxisAngle(up, face);
        s3.set(1, built, 1);
        meshes.mill.setMatrixAt(n.mill, m4.compose(p3, q, s3));
        meshes.mill.setColorAt(n.mill, tint.setScalar(dim));
        n.mill++;
        if (sv.complete) {
          // the wheel hangs on the model's +X, which the mill's turn has carried toward the water
          wheels.push({ x: c.x + Math.cos(face) * 0.44, y: y + 0.29, z: c.z - Math.sin(face) * 0.44, yaw: face, turns: sv.running !== false, phase: rand01(sv.id, 8) * 6.28 });
          n.wheel++;
        }
        sacksAt(sv, c.x, y, c.z, face + Math.PI, 4, 0.52);
      } else if (sv.kind === WORK.record_house && n.record < CAP.record) {
        q.setFromAxisAngle(up, quarter);
        s3.set(1, built, 1);
        meshes.record.setMatrixAt(n.record, m4.compose(p3, q, s3));
        meshes.record.setColorAt(n.record, tint.setScalar(dim));
        n.record++;
        // one slab for each craft written in it, in a row beside the porch
        let slabs = 0;
        for (let bit = 0; bit < 6; bit++) if ((sv.lore ?? 0) & (1 << bit)) slabs++;
        const cs = Math.cos(quarter);
        const sn = Math.sin(quarter);
        for (let k = 0; k < slabs && n.slab < CAP.slab; k++) {
          const lx = 0.46;
          const lz = -0.3 + k * 0.13;
          p3.set(c.x + lx * cs + lz * sn, y - 0.01, c.z - lx * sn + lz * cs);
          s3.set(1, 1, 1);
          meshes.slab.setMatrixAt(n.slab, m4.compose(p3, q, s3));
          meshes.slab.setColorAt(n.slab, tint.setScalar(0.92 + 0.14 * rand01(sv.id * 7 + k, 3)));
          n.slab++;
        }
      }
    }
    meshes.field.count = n.field;
    meshes.crop.count = n.crop;
    meshes.granary.count = n.granary;
    meshes.house.count = n.house;
    meshes.healing.count = n.healing;
    meshes.herbs.count = n.herbs;
    meshes.mill.count = n.mill;
    meshes.wheel.count = wheels.length;
    meshes.record.count = n.record;
    meshes.slab.count = n.slab;
    meshes.sack.count = n.sack;
    for (const m of Object.values(meshes)) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    placeWheels(0);
  };

  const placeWheels = (time: number): void => {
    for (let i = 0; i < wheels.length; i++) {
      const wh = wheels[i]!;
      q.setFromAxisAngle(up, wh.yaw);
      qw.setFromAxisAngle(axis, wh.phase + (wh.turns ? time * 1.1 : 0));
      q.multiply(qw);
      p3.set(wh.x, wh.y, wh.z);
      s3.set(1, 1, 1);
      meshes.wheel.setMatrixAt(i, m4.compose(p3, q, s3));
      meshes.wheel.setColorAt(i, tint.setScalar(1));
    }
    if (wheels.length) {
      meshes.wheel.instanceMatrix.needsUpdate = true;
      if (meshes.wheel.instanceColor) meshes.wheel.instanceColor.needsUpdate = true;
    }
  };

  return {
    objects: Object.values(meshes),
    set,
    animate: placeWheels,
    dispose() {
      for (const g of Object.values(geoms)) g.dispose();
      for (const m of Object.values(meshes)) m.dispose();
    },
  };
}
