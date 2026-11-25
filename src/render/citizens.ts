/**
 * Citizens: small articulated figures whose pose is driven entirely by simulation state.
 *
 * Each figure is seven instanced body parts posed on the CPU every frame from the action
 * the engine says the agent is performing, plus props that exist only when the state says
 * so: an axe, a spear or a basket only for someone who owns one, and a load shaped like
 * what is actually being carried. A hat is part of who a person is (stable by id), not a
 * state. Position is interpolated between ticks; someone working on a thing stands beside
 * it and faces it, and someone speaking or giving faces the person concerned. Nothing here
 * invents behaviour.
 */
import {
  AlwaysStencilFunc,
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  GreaterDepth,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NotEqualStencilFunc,
  type Object3D,
  Quaternion,
  ReplaceStencilOp,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ACTION_CODES, AF, AGENT_STRIDE, TOOL_BIT, type StaticAgentView, type ViewFrame } from "@/worker/protocol";
import type { HeightField } from "./heightfield";
import { HAIRS, SKINS, TUNICS, rand01 } from "./palette";

const A = Object.fromEntries(ACTION_CODES.map((name, i) => [name, i])) as Record<(typeof ACTION_CODES)[number], number>;

const ITEM_COLORS = ["#b3273f", "#c9a66b", "#9fb7c4", "#8a5a36", "#7a5a3a", "#8f897b", "#b9c27a", "#a8623f", "#7fd6cf", "#8f897b", "#8f897b", "#c9a66b", "#a8623f"].map((c) => new Color(c));
const ITEM = { fish: 2, wood: 4, stone: 5, clay: 7 } as const;
/** Actions that need the hands: whatever was being carried in the arms is set down for them. */
const HANDS_BUSY = new Set([A.gather_forage, A.gather_fish, A.gather_wood, A.gather_mine, A.eat, A.drink, A.rest, A.craft, A.build, A.harvest, A.store]);

/** Where the visible thing on a tile stands and how wide it is: a person working on it stands beside it. */
export interface WorkSpot {
  x: number;
  z: number;
  r: number;
}
export type SpotLookup = (tile: number) => WorkSpot | null;

interface Pose {
  lean: number;
  twist: number;
  bob: number;
  armL: number;
  armR: number;
  legL: number;
  legR: number;
  head: number;
  lie: number;
  crouch: number;
}

function zeroPose(): Pose {
  return { lean: 0, twist: 0, bob: 0, armL: 0, armR: 0, legL: 0, legR: 0, head: 0, lie: 0, crouch: 0 };
}

interface Figure {
  x: number;
  z: number;
  y: number;
  facing: number;
  pose: Pose;
  phase: number;
  scale: number;
  offsetX: number;
  offsetZ: number;
  /** Which side of a thing this person works from, and how far to one side of a line of approach. */
  workAngle: number;
  side: number;
  hat: boolean;
  visible: number;
  moving: number;
}

export interface CitizenParts {
  objects: Object3D[];
  /** Update all figures for the current render time. `tickFraction` is 0..1 progress through the current tick. */
  update(frame: ViewFrame, tickFraction: number, dt: number, time: number): void;
  setRoster(roster: StaticAgentView[]): void;
  /** Smoothed world position of an agent (for camera follow, labels and picking). */
  positionOf(id: number, out: Vector3): boolean;
  /** How strongly a hidden citizen's shape shows through what hides them (0..1). */
  setGhost(opacity: number): void;
  count(): number;
  dispose(): void;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** `inArms`: a load is being held in both arms (not in a basket, and not set down to work). */
function targetPose(action: number, phase: number, inArms: boolean, time: number, id: number, out: Pose): Pose {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  out.lean = 0;
  out.twist = 0;
  out.bob = 0;
  out.armL = 0;
  out.armR = 0;
  out.legL = 0;
  out.legR = 0;
  out.head = 0;
  out.lie = 0;
  out.crouch = 0;
  switch (action) {
    case A.step: {
      out.legL = s * 0.75;
      out.legR = -s * 0.75;
      out.armL = inArms ? -0.95 : -s * 0.55;
      out.armR = inArms ? -0.95 : s * 0.55;
      out.bob = Math.abs(c) * 0.022;
      out.lean = 0.07 + (inArms ? 0.1 : 0);
      break;
    }
    case A.gather_forage:
    case A.harvest:
    case A.store: {
      out.lean = 0.62 + Math.sin(phase * 1.2) * 0.1;
      out.armL = -1.25 + Math.sin(phase * 2.4) * 0.3;
      out.armR = -1.1 - Math.sin(phase * 2.4) * 0.3;
      out.crouch = 0.35;
      out.head = 0.25;
      break;
    }
    case A.gather_wood: {
      // a chopping swing: slow raise, quick strike
      const k = (phase / (Math.PI * 2)) % 1;
      const swing = k < 0.7 ? k / 0.7 : 1 - (k - 0.7) / 0.3;
      out.armR = -0.4 - swing * 2.1;
      out.armL = -0.5 - swing * 1.7;
      out.twist = (swing - 0.5) * 0.5;
      out.lean = 0.12 + (1 - swing) * 0.22;
      break;
    }
    case A.gather_mine: {
      const k = (phase / (Math.PI * 2)) % 1;
      const swing = k < 0.65 ? k / 0.65 : 1 - (k - 0.65) / 0.35;
      out.armR = -0.3 - swing * 2.4;
      out.armL = -0.3 - swing * 2.4;
      out.lean = 0.2 + (1 - swing) * 0.4;
      out.crouch = 0.15;
      break;
    }
    case A.gather_fish: {
      // poised over the water, then a short lunge from the shoulder and the waist
      const jab = Math.max(0, Math.sin(phase * 0.8)) ** 6;
      out.armR = -1.2 + jab * 0.3;
      out.armL = -0.55 - jab * 0.3;
      out.lean = 0.16 + jab * 0.34;
      out.twist = 0.32 - jab * 0.2;
      out.crouch = 0.1 + jab * 0.2;
      out.head = 0.1;
      break;
    }
    case A.eat: {
      out.armR = -2.0 + Math.sin(phase * 2.2) * 0.28;
      out.head = 0.12 * Math.sin(phase * 2.2);
      out.armL = -0.2;
      break;
    }
    case A.drink: {
      out.lean = 0.95;
      out.crouch = 0.55;
      out.armL = -1.5;
      out.armR = -1.5;
      out.head = 0.3;
      break;
    }
    case A.rest: {
      out.lie = 1;
      break;
    }
    case A.craft:
    case A.build: {
      const k = (phase * 1.4) % (Math.PI * 2);
      const hit = Math.max(0, Math.sin(k)) ** 3;
      out.lean = 0.4;
      out.crouch = 0.3;
      out.armR = -1.7 + hit * 1.1;
      out.armL = -0.9;
      out.head = 0.2;
      break;
    }
    case A.give: {
      out.armL = -1.35;
      out.armR = -1.35;
      out.lean = 0.12;
      break;
    }
    case A.say: {
      out.armR = -1.0 + Math.sin(phase * 3.0) * 0.45;
      out.armL = -0.25 + Math.sin(phase * 2.1 + 1) * 0.15;
      out.head = Math.sin(phase * 2.6) * 0.12;
      break;
    }
    case A.carry: {
      out.head = Math.sin(time * 0.5 + id) * 0.15;
      break;
    }
    default: {
      // idle / wait: a little weight-shifting and looking about
      const slow = time * 0.7 + id * 1.7;
      out.armL = Math.sin(slow) * 0.06;
      out.armR = -Math.sin(slow) * 0.06;
      out.twist = Math.sin(slow * 0.6) * 0.12;
      out.head = Math.sin(slow * 0.45) * 0.3;
      break;
    }
  }
  // whatever else the body is doing, arms that hold something stay around it
  if (inArms && action !== A.step) {
    out.armL = -0.95;
    out.armR = -0.95;
  }
  return out;
}

/** Give every vertex one colour so that small props can share a single vertex-coloured material. */
function coloured(g: BufferGeometry, hex: string): BufferGeometry {
  const geometry = g.index ? g.toNonIndexed() : g;
  const n = geometry.getAttribute("position").count;
  const c = new Color(hex);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.deleteAttribute("uv");
  return geometry;
}

/** Modelled in grip space: the hand is at the origin and the haft runs forward along +Z. */
function axeGeometry(): BufferGeometry {
  const haft = new CylinderGeometry(0.011, 0.014, 0.33, 5).rotateX(Math.PI / 2).translate(0, 0, 0.115);
  const head = new BoxGeometry(0.024, 0.09, 0.062).translate(0, -0.032, 0.245);
  return mergeGeometries([coloured(haft, "#6b4a2e"), coloured(head, "#a39d90")])!;
}

/** Modelled in grip space: the shaft continues the arm (-Y), its point beyond the hand. */
function spearGeometry(): BufferGeometry {
  const shaft = new CylinderGeometry(0.008, 0.011, 0.86, 5).translate(0, -0.2, 0);
  const point = new ConeGeometry(0.021, 0.1, 5).rotateX(Math.PI).translate(0, -0.675, 0);
  return mergeGeometries([coloured(shaft, "#7a5a3a"), coloured(point, "#c2bcae")])!;
}

function basketGeometry(): BufferGeometry {
  const body = new CylinderGeometry(0.078, 0.056, 0.16, 7).translate(0, 0.08, 0);
  const rim = new CylinderGeometry(0.084, 0.084, 0.022, 7).translate(0, 0.16, 0);
  return mergeGeometries([coloured(body, "#b08d4f"), coloured(rim, "#8a6a38")])!;
}

function hatGeometry(): BufferGeometry {
  return coloured(new ConeGeometry(0.165, 0.08, 9).translate(0, 0.04, 0), "#d8bd74");
}

function logsGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const at: [number, number, string][] = [[-0.03, 0, "#7a5a3a"], [0.03, 0.004, "#6b4a2e"], [0, 0.05, "#85653f"]];
  for (const [z, y, colour] of at) parts.push(coloured(new CylinderGeometry(0.028, 0.03, 0.32, 6).rotateZ(Math.PI / 2).translate(0, y, z), colour));
  return mergeGeometries(parts)!;
}

function fishGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const [y, z, turn] of [[0, 0, 0.2], [0.035, 0.02, -0.25]] as const) {
    const body = new SphereGeometry(0.04, 7, 5).scale(2.3, 0.85, 0.55).rotateY(turn).translate(0, y, z);
    const tail = new ConeGeometry(0.032, 0.05, 4).rotateZ(-Math.PI / 2).scale(1, 1, 0.35).translate(-0.105, 0, 0).rotateY(turn).translate(0, y, z);
    parts.push(coloured(body, "#ffffff"), coloured(tail, "#dfe6ea"));
  }
  return mergeGeometries(parts)!;
}

export function buildCitizens(field: HeightField, capacity: number, quality: "low" | "medium" | "high", spots: SpotLookup = () => null): CitizenParts {
  const cap = Math.max(8, capacity);
  const skinMat = new MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
  const clothMat = new MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const hairMat = new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const propMat = new MeshStandardMaterial({ roughness: 0.88, metalness: 0, vertexColors: true, flatShading: true });
  const tunicMat = new MeshStandardMaterial({ roughness: 0.92, metalness: 0, vertexColors: true });
  // Someone hidden behind a tree, a roof or a ridge still shows as a faint shape, so nobody is ever lost from
  // view. Every drawn part of a person marks the stencil; the faint shape is drawn only where something
  // stands in front of the person (depth) and no person's own surface is showing (stencil).
  for (const m of [skinMat, clothMat, hairMat, propMat, tunicMat]) {
    m.stencilWrite = true;
    m.stencilRef = 1;
    m.stencilFunc = AlwaysStencilFunc;
    m.stencilZPass = ReplaceStencilOp;
  }
  const ghostMat = new MeshBasicMaterial({ color: "#f6c57e", transparent: true, opacity: 0.3, depthFunc: GreaterDepth, depthWrite: false, toneMapped: false });
  ghostMat.stencilWrite = true;
  ghostMat.stencilRef = 1;
  ghostMat.stencilFunc = NotEqualStencilFunc;

  // Parts are modelled around their pivot so a single rotation poses them.
  // The tunic takes each person's colour; its belt and hem are a darker shade of the same cloth.
  const body = mergeGeometries([
    coloured(new CylinderGeometry(0.095, 0.165, 0.36, 8).translate(0, 0.18, 0), "#ffffff"), // pivot: hips
    coloured(new CylinderGeometry(0.129, 0.137, 0.034, 8).translate(0, 0.2, 0), "#6e6e6e"),
    coloured(new CylinderGeometry(0.166, 0.171, 0.03, 8).translate(0, 0.016, 0), "#9a9a9a"),
  ])!;
  const sleeve = new CapsuleGeometry(0.039, 0.07, 2, 6).translate(0, -0.05, 0); // rides on the shoulder end of the arm
  const head = new SphereGeometry(0.1, 10, 8);
  const hair = new SphereGeometry(0.108, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const arm = new CapsuleGeometry(0.03, 0.2, 2, 6).translate(0, -0.125, 0); // pivot: shoulder
  const leg = new CapsuleGeometry(0.038, 0.16, 2, 6).translate(0, -0.11, 0); // pivot: hip
  const propGeoms = {
    sack: coloured(new IcosahedronGeometry(0.085, 1).scale(1, 0.9, 0.85), "#ffffff"),
    rock: coloured(new IcosahedronGeometry(0.078, 0).scale(1.1, 0.8, 0.9), "#ffffff"),
    logs: logsGeometry(),
    fish: fishGeometry(),
    axe: axeGeometry(),
    spear: spearGeometry(),
    basket: basketGeometry(),
    hat: hatGeometry(),
  };

  const mk = (g: BufferGeometry, m: MeshStandardMaterial | MeshBasicMaterial, name: string, shadow: boolean) => {
    const mesh = new InstancedMesh(g, m, cap);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = shadow && quality !== "low";
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.name = name;
    mesh.count = 0;
    return mesh;
  };
  const meshes = {
    body: mk(body, tunicMat, "citizen-body", true),
    head: mk(head, skinMat, "citizen-head", true),
    hair: mk(hair, hairMat, "citizen-hair", false),
    armL: mk(arm, skinMat, "citizen-arm-l", false),
    armR: mk(arm, skinMat, "citizen-arm-r", false),
    legL: mk(leg, clothMat, "citizen-leg-l", false),
    legR: mk(leg, clothMat, "citizen-leg-r", false),
    sack: mk(propGeoms.sack, propMat, "citizen-load-sack", false),
    rock: mk(propGeoms.rock, propMat, "citizen-load-rock", false),
    logs: mk(propGeoms.logs, propMat, "citizen-load-logs", false),
    fish: mk(propGeoms.fish, propMat, "citizen-load-fish", false),
    axe: mk(propGeoms.axe, propMat, "citizen-axe", false),
    spear: mk(propGeoms.spear, propMat, "citizen-spear", true),
    basket: mk(propGeoms.basket, propMat, "citizen-basket", false),
    hat: mk(propGeoms.hat, propMat, "citizen-hat", true),
    sleeveL: mk(sleeve, clothMat, "citizen-sleeve-l", false),
    sleeveR: mk(sleeve, clothMat, "citizen-sleeve-r", false),
    ghostBody: mk(body, ghostMat, "citizen-ghost-body", false),
    ghostHead: mk(head, ghostMat, "citizen-ghost-head", false),
  };
  // sleeves ride on the arms and the faint shapes on the body and head: they share those parts' placement outright
  meshes.sleeveL.instanceMatrix = meshes.armL.instanceMatrix;
  meshes.sleeveR.instanceMatrix = meshes.armR.instanceMatrix;
  meshes.ghostBody.instanceMatrix = meshes.body.instanceMatrix;
  meshes.ghostHead.instanceMatrix = meshes.head.instanceMatrix;
  meshes.ghostBody.renderOrder = 18;
  meshes.ghostHead.renderOrder = 18;
  const loadMeshes = [meshes.sack, meshes.rock, meshes.logs, meshes.fish] as const;
  const LOAD = { sack: 0, rock: 1, logs: 2, fish: 3 } as const;

  const figures: Figure[] = [];
  let rosterSize = 0;
  const colour = new Color();
  const WHITE = new Color("#ffffff");

  const setRoster = (roster: StaticAgentView[]): void => {
    rosterSize = Math.min(cap, roster.length);
    for (let i = 0; i < rosterSize; i++) {
      const r = roster[i]!;
      if (!figures[i]) {
        figures[i] = {
          x: 0, z: 0, y: 0, facing: rand01(r.id, 1) * Math.PI * 2, pose: zeroPose(), phase: rand01(r.id, 2) * 6.28,
          scale: 1.25 + ((r.phys[0] ?? 50) / 100) * 0.3, offsetX: (rand01(r.id, 3) - 0.5) * 0.46, offsetZ: (rand01(r.id, 4) - 0.5) * 0.46,
          workAngle: rand01(r.id, 9) * Math.PI * 2, side: (rand01(r.id, 10) - 0.5) * 0.34, hat: rand01(r.id, 13) < 0.3, visible: -1, moving: 0,
        };
      }
      const tunic = TUNICS[Math.floor(rand01(r.id, 5) * TUNICS.length)]!;
      const skin = SKINS[Math.floor(rand01(r.id, 6) * SKINS.length)]!;
      const hairC = HAIRS[Math.floor(rand01(r.id, 7) * HAIRS.length)]!;
      meshes.body.setColorAt(i, colour.copy(tunic).multiplyScalar(0.9 + 0.2 * rand01(r.id, 8)));
      meshes.legL.setColorAt(i, colour.copy(tunic).multiplyScalar(0.55));
      meshes.legR.setColorAt(i, colour.copy(tunic).multiplyScalar(0.55));
      meshes.sleeveL.setColorAt(i, colour.copy(tunic).multiplyScalar(0.84));
      meshes.sleeveR.setColorAt(i, colour.copy(tunic).multiplyScalar(0.84));
      meshes.head.setColorAt(i, skin);
      meshes.armL.setColorAt(i, skin);
      meshes.armR.setColorAt(i, skin);
      meshes.hair.setColorAt(i, hairC);
      for (const m of loadMeshes) m.setColorAt(i, WHITE);
      for (const m of [meshes.axe, meshes.spear, meshes.basket]) m.setColorAt(i, WHITE);
      meshes.hat.setColorAt(i, colour.setScalar(0.86 + 0.22 * rand01(r.id, 14)));
    }
    for (const m of Object.values(meshes)) {
      m.count = rosterSize;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  };

  const root = new Matrix4();
  const torso = new Matrix4();
  const headM = new Matrix4();
  const armRM = new Matrix4();
  const partM = new Matrix4();
  const outM = new Matrix4();
  const q = new Quaternion();
  const qa = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const ONE = new Vector3(1, 1, 1);
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const Z = new Vector3(0, 0, 1);
  const ZERO = new Matrix4().makeScale(0, 0, 0);
  // fixed carrying poses for tools on the back: haft up and across for the axe, point up for the spear
  const AXE_BACK = new Matrix4().compose(new Vector3(0.045, 0.16, -0.112), new Quaternion().setFromAxisAngle(Z, 0.5).multiply(new Quaternion().setFromAxisAngle(X, -Math.PI / 2)), ONE);
  const SPEAR_BACK = new Matrix4().compose(new Vector3(-0.05, 0.1, -0.115), new Quaternion().setFromAxisAngle(Z, Math.PI - 0.22), ONE);
  const BASKET_BACK = new Matrix4().compose(new Vector3(0, 0.15, -0.135), new Quaternion(), ONE);
  const HAND = new Matrix4().makeTranslation(0, -0.245, 0);
  const tmpPose = zeroPose();

  const update = (frame: ViewFrame, tickFraction: number, dt: number, time: number): void => {
    const n = Math.min(rosterSize, frame.agentCount);
    const buf = frame.agents;
    const halfW = field.w / 2;
    const halfH = field.h / 2;
    const k = 1 - Math.exp(-dt * 12);
    for (let i = 0; i < n; i++) {
      const o = i * AGENT_STRIDE;
      const f = figures[i]!;
      const alive = (buf[o + AF.alive] as number) > 0.5;
      if (!alive) {
        if (f.visible !== 0) {
          for (const m of Object.values(meshes)) m.setMatrixAt(i, ZERO);
          f.visible = 0;
        }
        continue;
      }
      const ax = buf[o + AF.x] as number;
      const ay = buf[o + AF.y] as number;
      const tx = buf[o + AF.tx] as number;
      const ty = buf[o + AF.ty] as number;
      const action = buf[o + AF.action] as number;
      const dur = buf[o + AF.dur] as number;
      const remaining = buf[o + AF.t] as number;
      const target = buf[o + AF.target] as number;
      const partner = buf[o + AF.partner] as number;
      const cx = ax + 0.5 - halfW;
      const cz = ay + 0.5 - halfH;
      let wx = cx + f.offsetX;
      let wz = cz + f.offsetZ;
      let moving = 0;
      // what to face while standing still: the thing worked on, the person addressed, or nothing in particular
      let faceX = Number.NaN;
      let faceZ = 0;
      if (action === A.step && dur > 0) {
        const progress = Math.max(0, Math.min(1, (dur - remaining + tickFraction) / dur));
        wx += (tx - ax) * progress;
        wz += (ty - ay) * progress;
        moving = 1;
      } else if (partner >= 0 && partner !== i && figures[partner]?.visible === 1) {
        faceX = figures[partner]!.x;
        faceZ = figures[partner]!.z;
      } else if (target >= 0) {
        const spot = spots(target);
        const ownTile = target === ay * field.w + ax;
        if (spot && ownTile) {
          // beside it, each person from a side of their own, leaning toward the middle of the tile
          // so that nobody works from the far side of a thing that stands at the tile's edge
          const reach = spot.r + 0.15;
          const ix = (cx - spot.x) * 1.6 + Math.sin(f.workAngle) * 0.5;
          const iz = (cz - spot.z) * 1.6 + Math.cos(f.workAngle) * 0.5;
          const il = Math.hypot(ix, iz) || 1;
          wx = Math.max(cx - 0.7, Math.min(cx + 0.7, spot.x + (ix / il) * reach));
          wz = Math.max(cz - 0.7, Math.min(cz + 0.7, spot.z + (iz / il) * reach));
          faceX = spot.x;
          faceZ = spot.z;
        } else {
          // on a neighbouring tile: come to its near edge, a little to one side, and face it
          const gx = spot ? spot.x : (target % field.w) + 0.5 - halfW;
          const gz = spot ? spot.z : Math.floor(target / field.w) + 0.5 - halfH;
          const dx = gx - cx;
          const dz = gz - cz;
          const d = Math.hypot(dx, dz);
          if (d > 0.05) {
            const go = spot ? Math.min(0.6, Math.max(0, d - (spot.r + 0.17))) : 0.36;
            wx = cx + (dx / d) * go - (dz / d) * f.side;
            wz = cz + (dz / d) * go + (dx / d) * f.side;
            faceX = gx;
            faceZ = gz;
          }
        }
      }
      // critically damped follow: removes tick-boundary pops without lagging behind
      if (f.visible !== 1) {
        f.x = wx;
        f.z = wz;
      } else {
        f.x += (wx - f.x) * k;
        f.z += (wz - f.z) * k;
      }
      f.y = field.standAt(f.x, f.z);
      f.moving += (moving - f.moving) * k;

      let wantFacing = f.facing;
      if (action === A.step && (tx !== ax || ty !== ay)) wantFacing = Math.atan2(tx - ax, ty - ay);
      else if (!Number.isNaN(faceX) && Math.abs(faceX - f.x) + Math.abs(faceZ - f.z) > 0.05) wantFacing = Math.atan2(faceX - f.x, faceZ - f.z);
      f.facing = lerpAngle(f.facing, wantFacing, 1 - Math.exp(-dt * 9));

      // what is owned and what is carried decide the props; a basket takes a loose load off the arms
      const tools = buf[o + AF.tools] as number;
      const hasAxe = (tools & TOOL_BIT.axe) !== 0;
      const hasSpear = (tools & TOOL_BIT.spear) !== 0;
      const hasBasket = (tools & TOOL_BIT.basket) !== 0;
      const load = buf[o + AF.load] as number;
      const item = buf[o + AF.carry] as number;
      const loadKind = item === ITEM.wood ? LOAD.logs : item === ITEM.stone || item === ITEM.clay ? LOAD.rock : item === ITEM.fish ? LOAD.fish : LOAD.sack;
      const upright = (buf[o + AF.action] as number) !== A.rest;
      const showLoad = load > 0.3 && item >= 0 && upright;
      const inBasket = hasBasket && loadKind === LOAD.sack;
      const inArms = showLoad && !inBasket && !HANDS_BUSY.has(action);

      // animation phase advances with simulated time so that motion slows and stops with the clock
      const rate = action === A.step ? 9.5 : action === A.gather_wood || action === A.gather_mine ? 5.5 : 4.2;
      f.phase += dt * rate * (frame.tps > 0 ? Math.min(2.2, 0.55 + frame.tps / 6) : 0);
      const want = targetPose(action, f.phase, inArms, time, i, tmpPose);
      const pk = 1 - Math.exp(-dt * 10);
      const pose = f.pose;
      pose.lean += (want.lean - pose.lean) * pk;
      pose.twist += (want.twist - pose.twist) * pk;
      pose.bob += (want.bob - pose.bob) * pk;
      pose.armL += (want.armL - pose.armL) * pk;
      pose.armR += (want.armR - pose.armR) * pk;
      pose.legL += (want.legL - pose.legL) * pk;
      pose.legR += (want.legR - pose.legR) * pk;
      pose.head += (want.head - pose.head) * pk;
      pose.lie += (want.lie - pose.lie) * pk;
      pose.crouch += (want.crouch - pose.crouch) * pk;

      const ill = (buf[o + AF.ill] as number) > 0.5;
      const sc = f.scale;
      const hip = 0.24 * (1 - 0.35 * pose.crouch);
      const standing = pose.lie < 0.4;
      // root: position, facing, then lie down by tipping backwards about the feet
      q.setFromAxisAngle(Y, f.facing);
      if (pose.lie > 0.01) {
        qa.setFromAxisAngle(X, -pose.lie * (Math.PI / 2) * 0.96);
        q.multiply(qa);
      }
      p.set(f.x, f.y + pose.bob + pose.lie * 0.07, f.z);
      s.set(sc, sc, sc);
      root.compose(p, q, s);

      // tunic (pivot at the hips)
      q.setFromAxisAngle(X, pose.lean + (ill ? 0.18 : 0));
      qa.setFromAxisAngle(Y, pose.twist);
      q.multiply(qa);
      p.set(0, hip, 0);
      partM.compose(p, q, ONE);
      torso.multiplyMatrices(root, partM);
      meshes.body.setMatrixAt(i, torso);

      // head sits on top of the tunic
      q.setFromAxisAngle(Y, pose.head);
      p.set(0, 0.45, 0.005);
      partM.compose(p, q, ONE);
      headM.multiplyMatrices(torso, partM);
      meshes.head.setMatrixAt(i, headM);
      p.set(0, 0.462, -0.004);
      partM.compose(p, q, ONE);
      outM.multiplyMatrices(torso, partM);
      meshes.hair.setMatrixAt(i, outM);
      if (f.hat) {
        partM.makeTranslation(0, 0.07, 0);
        outM.multiplyMatrices(headM, partM);
        meshes.hat.setMatrixAt(i, outM);
      } else {
        meshes.hat.setMatrixAt(i, ZERO);
      }

      // arms hang from the shoulders
      q.setFromAxisAngle(X, pose.armL);
      qa.setFromAxisAngle(Z, -0.12);
      q.premultiply(qa);
      p.set(-0.125, 0.33, 0);
      partM.compose(p, q, ONE);
      outM.multiplyMatrices(torso, partM);
      meshes.armL.setMatrixAt(i, outM);
      q.setFromAxisAngle(X, pose.armR);
      qa.setFromAxisAngle(Z, 0.12);
      q.premultiply(qa);
      p.set(0.125, 0.33, 0);
      partM.compose(p, q, ONE);
      armRM.multiplyMatrices(torso, partM);
      meshes.armR.setMatrixAt(i, armRM);

      // tools: in the hand while they are being used, on the back otherwise; put down to sleep
      if (hasAxe && standing) {
        if (action === A.gather_wood) outM.multiplyMatrices(armRM, HAND);
        else outM.multiplyMatrices(torso, AXE_BACK);
        meshes.axe.setMatrixAt(i, outM);
      } else {
        meshes.axe.setMatrixAt(i, ZERO);
      }
      if (hasSpear && standing) {
        if (action === A.gather_fish) outM.multiplyMatrices(armRM, HAND);
        else outM.multiplyMatrices(torso, SPEAR_BACK);
        meshes.spear.setMatrixAt(i, outM);
      } else {
        meshes.spear.setMatrixAt(i, ZERO);
      }
      if (hasBasket && standing) {
        outM.multiplyMatrices(torso, BASKET_BACK);
        meshes.basket.setMatrixAt(i, outM);
      } else {
        meshes.basket.setMatrixAt(i, ZERO);
      }

      // the load, shaped by what it mostly is: in the basket if there is one, in the arms otherwise
      const shown = standing && (inArms || (showLoad && inBasket));
      for (let l = 0; l < loadMeshes.length; l++) {
        const mesh = loadMeshes[l]!;
        if (!shown || l !== loadKind) {
          mesh.setMatrixAt(i, ZERO);
          continue;
        }
        const size = 0.75 + load * 0.75;
        if (inBasket) {
          p.set(0, 0.31, -0.135);
          s.set(size * 0.72, size * 0.6, size * 0.72);
        } else {
          p.set(0, 0.2, 0.15);
          s.set(size, size * 0.9, size);
        }
        q.identity();
        partM.compose(p, q, s);
        outM.multiplyMatrices(torso, partM);
        mesh.setMatrixAt(i, outM);
        // logs keep their bark; everything else takes the colour of what it is
        mesh.setColorAt(i, l === LOAD.logs ? WHITE : (ITEM_COLORS[item] ?? WHITE));
      }

      // legs swing from the hips (in root space, so they stay planted when the torso leans)
      q.setFromAxisAngle(X, pose.legL - pose.crouch * 0.5);
      p.set(-0.058, hip + 0.02, 0);
      partM.compose(p, q, ONE);
      outM.multiplyMatrices(root, partM);
      meshes.legL.setMatrixAt(i, outM);
      q.setFromAxisAngle(X, pose.legR - pose.crouch * 0.5);
      p.set(0.058, hip + 0.02, 0);
      partM.compose(p, q, ONE);
      outM.multiplyMatrices(root, partM);
      meshes.legR.setMatrixAt(i, outM);
      f.visible = 1;
    }
    for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;
    for (const m of loadMeshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };

  return {
    objects: Object.values(meshes),
    update,
    setRoster,
    positionOf(id: number, out: Vector3): boolean {
      const f = figures[id];
      if (!f || f.visible !== 1) return false;
      out.set(f.x, f.y, f.z);
      return true;
    },
    setGhost(opacity: number) {
      ghostMat.opacity = opacity;
    },
    count: () => rosterSize,
    dispose() {
      for (const m of Object.values(meshes)) m.dispose();
      for (const g of [body, head, hair, arm, leg, sleeve, ...Object.values(propGeoms)]) g.dispose();
      for (const m of [skinMat, clothMat, hairMat, propMat, tunicMat, ghostMat]) m.dispose();
    },
  };
}
