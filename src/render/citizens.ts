/**
 * Citizens: small articulated figures whose pose is driven entirely by simulation state.
 *
 * Each figure is seven instanced parts (tunic, head, hair, two arms, two legs) posed on
 * the CPU every frame from the action the engine says the agent is performing. Position
 * is interpolated between ticks; nothing here invents behaviour.
 */
import {
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { ACTION_CODES, AF, AGENT_STRIDE, type StaticAgentView, type ViewFrame } from "@/worker/protocol";
import type { HeightField } from "./heightfield";
import { HAIRS, SKINS, TUNICS, rand01 } from "./palette";

const A = Object.fromEntries(ACTION_CODES.map((name, i) => [name, i])) as Record<(typeof ACTION_CODES)[number], number>;

const ITEM_COLORS = ["#b3273f", "#c9a66b", "#9fb7c4", "#8a5a36", "#7a5a3a", "#8f897b", "#b9c27a", "#a8623f", "#7fd6cf", "#8f897b", "#8f897b", "#c9a66b", "#a8623f"].map((c) => new Color(c));

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
  count(): number;
  dispose(): void;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function targetPose(action: number, phase: number, load: number, time: number, id: number, out: Pose): Pose {
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
      const carry = load > 0.45;
      out.legL = s * 0.75;
      out.legR = -s * 0.75;
      out.armL = carry ? -0.95 : -s * 0.55;
      out.armR = carry ? -0.95 : s * 0.55;
      out.bob = Math.abs(c) * 0.022;
      out.lean = 0.07 + (carry ? 0.1 : 0);
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
      const jab = Math.max(0, Math.sin(phase * 0.8)) ** 6;
      out.armR = -1.9 + jab * 1.1;
      out.armL = -0.4;
      out.lean = 0.12 + jab * 0.25;
      out.twist = 0.3;
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
      out.armL = -0.95;
      out.armR = -0.95;
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
  return out;
}

export function buildCitizens(field: HeightField, capacity: number, quality: "low" | "medium" | "high"): CitizenParts {
  const cap = Math.max(8, capacity);
  const skinMat = new MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
  const clothMat = new MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const hairMat = new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });

  // Parts are modelled around their pivot so a single rotation poses them.
  const body = new CylinderGeometry(0.095, 0.165, 0.36, 8).translate(0, 0.18, 0); // pivot: hips
  const head = new SphereGeometry(0.1, 10, 8);
  const hair = new SphereGeometry(0.108, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const arm = new CapsuleGeometry(0.03, 0.2, 2, 6).translate(0, -0.125, 0); // pivot: shoulder
  const leg = new CapsuleGeometry(0.038, 0.16, 2, 6).translate(0, -0.11, 0); // pivot: hip
  const bundleGeom = new IcosahedronGeometry(0.085, 0);

  const mk = (g: BufferGeometry, m: MeshStandardMaterial, name: string, shadow: boolean) => {
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
    body: mk(body, clothMat, "citizen-body", true),
    head: mk(head, skinMat, "citizen-head", true),
    hair: mk(hair, hairMat, "citizen-hair", false),
    armL: mk(arm, skinMat, "citizen-arm-l", false),
    armR: mk(arm, skinMat, "citizen-arm-r", false),
    legL: mk(leg, clothMat, "citizen-leg-l", false),
    legR: mk(leg, clothMat, "citizen-leg-r", false),
    bundle: mk(bundleGeom, clothMat, "citizen-bundle", false),
  };

  const figures: Figure[] = [];
  let rosterSize = 0;
  const colour = new Color();

  const setRoster = (roster: StaticAgentView[]): void => {
    rosterSize = Math.min(cap, roster.length);
    for (let i = 0; i < rosterSize; i++) {
      const r = roster[i]!;
      if (!figures[i]) {
        figures[i] = {
          x: 0, z: 0, y: 0, facing: rand01(r.id, 1) * Math.PI * 2, pose: zeroPose(), phase: rand01(r.id, 2) * 6.28,
          scale: 1.25 + ((r.phys[0] ?? 50) / 100) * 0.3, offsetX: (rand01(r.id, 3) - 0.5) * 0.46, offsetZ: (rand01(r.id, 4) - 0.5) * 0.46, visible: -1, moving: 0,
        };
      }
      const tunic = TUNICS[Math.floor(rand01(r.id, 5) * TUNICS.length)]!;
      const skin = SKINS[Math.floor(rand01(r.id, 6) * SKINS.length)]!;
      const hairC = HAIRS[Math.floor(rand01(r.id, 7) * HAIRS.length)]!;
      meshes.body.setColorAt(i, colour.copy(tunic).multiplyScalar(0.9 + 0.2 * rand01(r.id, 8)));
      meshes.legL.setColorAt(i, colour.copy(tunic).multiplyScalar(0.55));
      meshes.legR.setColorAt(i, colour.copy(tunic).multiplyScalar(0.55));
      meshes.head.setColorAt(i, skin);
      meshes.armL.setColorAt(i, skin);
      meshes.armR.setColorAt(i, skin);
      meshes.hair.setColorAt(i, hairC);
      meshes.bundle.setColorAt(i, colour.set("#8a5a36"));
    }
    for (const m of Object.values(meshes)) {
      m.count = rosterSize;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  };

  const root = new Matrix4();
  const partM = new Matrix4();
  const outM = new Matrix4();
  const q = new Quaternion();
  const qa = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const Z = new Vector3(0, 0, 1);
  const ZERO = new Matrix4().makeScale(0, 0, 0);
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
      let wx = ax + 0.5 - halfW + f.offsetX;
      let wz = ay + 0.5 - halfH + f.offsetZ;
      let moving = 0;
      if (action === A.step && dur > 0) {
        const progress = Math.max(0, Math.min(1, (dur - remaining + tickFraction) / dur));
        wx += (tx - ax) * progress;
        wz += (ty - ay) * progress;
        moving = 1;
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

      // facing: along travel, or toward what is being worked on
      let wantFacing = f.facing;
      if (action === A.step && (tx !== ax || ty !== ay)) wantFacing = Math.atan2(tx - ax, ty - ay);
      else {
        const target = buf[o + AF.target] as number;
        if (target >= 0) {
          const gx = (target % field.w) + 0.5 - halfW;
          const gz = Math.floor(target / field.w) + 0.5 - halfH;
          if (Math.abs(gx - f.x) + Math.abs(gz - f.z) > 0.05) wantFacing = Math.atan2(gx - f.x, gz - f.z);
        }
      }
      f.facing = lerpAngle(f.facing, wantFacing, 1 - Math.exp(-dt * 9));

      // animation phase advances with simulated time so that motion slows and stops with the clock
      const rate = action === A.step ? 9.5 : action === A.gather_wood || action === A.gather_mine ? 5.5 : 4.2;
      f.phase += dt * rate * (frame.tps > 0 ? Math.min(2.2, 0.55 + frame.tps / 6) : 0);
      const load = buf[o + AF.load] as number;
      const want = targetPose(action, f.phase, load, time, i, tmpPose);
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
      s.set(1, 1, 1);
      partM.compose(p, q, s);
      outM.multiplyMatrices(root, partM);
      meshes.body.setMatrixAt(i, outM);
      const torso = outM.clone();

      // head sits on top of the tunic
      q.setFromAxisAngle(Y, pose.head);
      p.set(0, 0.45, 0.005);
      partM.compose(p, q, s);
      outM.multiplyMatrices(torso, partM);
      meshes.head.setMatrixAt(i, outM);
      p.set(0, 0.462, -0.004);
      partM.compose(p, q, s);
      outM.multiplyMatrices(torso, partM);
      meshes.hair.setMatrixAt(i, outM);

      // arms hang from the shoulders
      q.setFromAxisAngle(X, pose.armL);
      qa.setFromAxisAngle(Z, -0.12);
      q.premultiply(qa);
      p.set(-0.125, 0.33, 0);
      partM.compose(p, q, s);
      outM.multiplyMatrices(torso, partM);
      meshes.armL.setMatrixAt(i, outM);
      q.setFromAxisAngle(X, pose.armR);
      qa.setFromAxisAngle(Z, 0.12);
      q.premultiply(qa);
      p.set(0.125, 0.33, 0);
      partM.compose(p, q, s);
      outM.multiplyMatrices(torso, partM);
      meshes.armR.setMatrixAt(i, outM);

      // a bundle in the arms when carrying a real load
      if (load > 0.3 && pose.lie < 0.3) {
        const item = buf[o + AF.carry] as number;
        const size = 0.7 + load * 0.9;
        p.set(0, 0.2, 0.15);
        q.identity();
        s.set(size, size * 0.85, size);
        partM.compose(p, q, s);
        outM.multiplyMatrices(torso, partM);
        meshes.bundle.setMatrixAt(i, outM);
        if (item >= 0 && item < ITEM_COLORS.length) meshes.bundle.setColorAt(i, ITEM_COLORS[item]!);
        s.set(1, 1, 1);
      } else {
        meshes.bundle.setMatrixAt(i, ZERO);
      }

      // legs swing from the hips (in root space, so they stay planted when the torso leans)
      q.setFromAxisAngle(X, pose.legL - pose.crouch * 0.5);
      p.set(-0.058, hip + 0.02, 0);
      partM.compose(p, q, s);
      outM.multiplyMatrices(root, partM);
      meshes.legL.setMatrixAt(i, outM);
      q.setFromAxisAngle(X, pose.legR - pose.crouch * 0.5);
      p.set(0.058, hip + 0.02, 0);
      partM.compose(p, q, s);
      outM.multiplyMatrices(root, partM);
      meshes.legR.setMatrixAt(i, outM);
      f.visible = 1;
    }
    for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;
    if (meshes.bundle.instanceColor) meshes.bundle.instanceColor.needsUpdate = true;
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
    count: () => rosterSize,
    dispose() {
      for (const m of Object.values(meshes)) m.dispose();
      for (const g of [body, head, hair, arm, leg, bundleGeom]) g.dispose();
      for (const m of [skinMat, clothMat, hairMat]) m.dispose();
    },
  };
}
