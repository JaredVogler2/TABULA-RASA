/**
 * Ambient life: smoke, fish rising, and birds.
 *
 * Two of the three are readings of simulation state: smoke rises only from fires that are
 * actually lit, and fish rise only over fishing water that still holds stock, more often
 * where there is more of it — a fished-out water goes still. Birds are scenery: they follow
 * the light and the weather and say nothing about the world's state.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Points,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from "three";
import type { StaticWorldView } from "@/worker/protocol";
import type { HeightField } from "./heightfield";
import { rand01 } from "./palette";

const FISHING_WATER = 6;
const PUFFS_PER_FIRE = 12;
const MAX_FIRES = 48;
const RISES = 10;

export interface AmbientEnv {
  /** 0 (night) .. 1 (day) */
  daylight: number;
  /** 0 clear · 1 overcast · 2 rain · 3 storm · 4 snow */
  weather: number;
  /** Tint of the light falling on smoke. */
  light: Color;
  /** False while simulated time is stopped: nothing new rises. */
  running: boolean;
  reducedMotion: boolean;
}

export interface AmbientParts {
  objects: Object3D[];
  /** Fires that are lit right now; smoke rises from these and from nothing else. */
  setFires(fires: readonly { x: number; y: number; z: number }[]): void;
  /** Current stock of every node; fish rise in proportion to what a water still holds. */
  setAmounts(amounts: Int16Array): void;
  /** `pointScale` converts a world-space diameter at unit depth into pixels for this camera and canvas. */
  update(dt: number, time: number, env: AmbientEnv, pointScale: number): void;
  dispose(): void;
}

function birdGeometry(side: -1 | 0 | 1): BufferGeometry {
  const g = new BufferGeometry();
  // body: a slim diamond along +Z; wings: one triangle each, hinged on the body's axis
  const v =
    side === 0
      ? [0, 0, 0.16, 0.022, 0, 0, -0.022, 0, 0, 0, 0, -0.15, -0.022, 0, 0, 0.022, 0, 0]
      : [0, 0, 0.07, side * 0.26, 0, -0.02, 0, 0, -0.07];
  g.setAttribute("position", new BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}

export function buildAmbient(view: StaticWorldView, field: HeightField, quality: "low" | "medium" | "high"): AmbientParts {
  // ── smoke: soft sprites that rise, spread and drift downwind
  const smokeCount = MAX_FIRES * PUFFS_PER_FIRE;
  const smokePos = new Float32Array(smokeCount * 3);
  const smokeSeed = new Float32Array(smokeCount);
  for (let i = 0; i < smokeCount; i++) smokeSeed[i] = (i * 0.61803398875) % 1;
  const smokeGeometry = new BufferGeometry();
  const smokePosAttr = new BufferAttribute(smokePos, 3);
  smokePosAttr.setUsage(DynamicDrawUsage);
  smokeGeometry.setAttribute("position", smokePosAttr);
  smokeGeometry.setAttribute("aSeed", new BufferAttribute(smokeSeed, 1));
  smokeGeometry.setDrawRange(0, 0);
  const smokeUniforms: Record<string, IUniform<unknown>> = {
    uTime: { value: 0 },
    uWind: { value: 1 },
    uScale: { value: 600 },
    uColor: { value: new Color("#d9d3c6") },
  };
  const smoke = new Points(
    smokeGeometry,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: smokeUniforms,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uWind;
        uniform float uScale;
        varying float vAge;
        void main() {
          float age = fract(uTime * (0.085 + 0.03 * fract(aSeed * 7.31)) + aSeed);
          vAge = age;
          vec3 p = position;
          p.y += 0.3 + age * (2.6 + 1.4 * fract(aSeed * 3.17));
          // each puff wanders on its own; all of them lean downwind as they climb
          float drift = age * age * 1.7 * uWind;
          float wander = 0.14 + 0.5 * age;
          p.x += drift + sin(uTime * 0.5 + aSeed * 40.0) * wander * age + (fract(aSeed * 11.3) - 0.5) * 0.5 * age;
          p.z += drift * 0.35 + cos(uTime * 0.43 + aSeed * 31.0) * wander * age + (fract(aSeed * 5.9) - 0.5) * 0.5 * age;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * (0.2 + age * (0.8 + 0.7 * fract(aSeed * 13.7))) / max(0.5, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor;
        varying float vAge;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * (1.0 - vAge) * (1.0 - vAge) * smoothstep(0.0, 0.12, vAge) * 0.42;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    }),
  );
  smoke.frustumCulled = false;
  smoke.renderOrder = 5;
  smoke.name = "smoke";

  // ── fish rises: thin rings spreading on the water over nodes that still hold fish
  const waters: { node: number; x: number; z: number; y: number; cap: number }[] = [];
  for (let n = 0; n < view.nodeKind.length; n++) {
    if (view.nodeKind[n] !== FISHING_WATER) continue;
    const c = field.tileCentre(view.nodeX[n] as number, view.nodeY[n] as number);
    waters.push({ node: n, x: c.x, z: c.z, y: field.waterAt(c.x, c.z) + 0.035, cap: Math.max(1, view.nodeCap[n] as number) });
  }
  const ringGeometry = new RingGeometry(0.86, 1, 28).rotateX(-Math.PI / 2);
  const ringMaterial = new MeshBasicMaterial({ color: "#ffffff", transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
  const rings = new InstancedMesh(ringGeometry, ringMaterial, RISES);
  rings.instanceMatrix.setUsage(DynamicDrawUsage);
  rings.frustumCulled = false;
  rings.renderOrder = 4;
  rings.name = "fish-rises";
  const rises: { x: number; z: number; y: number; t0: number; life: number }[] = Array.from({ length: RISES }, () => ({ x: 0, z: 0, y: 0, t0: -100, life: 1 }));
  let stock: Int16Array | null = null;
  let cursor = 0;
  let spawnSeed = 1;

  // ── birds: a loose flock circling over the island by day
  const flock = quality === "low" ? 4 : 7;
  const birdMaterial = new MeshStandardMaterial({ color: "#2e2a26", roughness: 0.9, metalness: 0, side: DoubleSide, flatShading: true });
  const bodies = new InstancedMesh(birdGeometry(0), birdMaterial, flock);
  const wingsL = new InstancedMesh(birdGeometry(-1), birdMaterial, flock);
  const wingsR = new InstancedMesh(birdGeometry(1), birdMaterial, flock);
  for (const m of [bodies, wingsL, wingsR]) {
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = false;
    m.name = "birds";
  }
  const span = Math.max(view.w, view.h);
  let aloft = 0;

  const m4 = new Matrix4();
  const body = new Matrix4();
  const q = new Quaternion();
  const qa = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const Y = new Vector3(0, 1, 0);
  const Z = new Vector3(0, 0, 1);
  const ZERO = new Matrix4().makeScale(0, 0, 0);
  const tint = new Color();
  for (let i = 0; i < RISES; i++) rings.setMatrixAt(i, ZERO);

  let fireCount = 0;
  const setFires = (fires: readonly { x: number; y: number; z: number }[]): void => {
    fireCount = Math.min(MAX_FIRES, fires.length);
    for (let f = 0; f < fireCount; f++) {
      const fire = fires[f]!;
      for (let k = 0; k < PUFFS_PER_FIRE; k++) {
        const i = (f * PUFFS_PER_FIRE + k) * 3;
        smokePos[i] = fire.x;
        smokePos[i + 1] = fire.y;
        smokePos[i + 2] = fire.z;
      }
    }
    smokePosAttr.needsUpdate = true;
    smokeGeometry.setDrawRange(0, fireCount * PUFFS_PER_FIRE);
  };

  const update = (dt: number, time: number, env: AmbientEnv, pointScale: number): void => {
    // smoke: thinner and bluer at night, pushed harder by a storm
    smokeUniforms.uTime!.value = time;
    smokeUniforms.uWind!.value = env.weather === 3 ? 2.6 : env.weather === 2 ? 1.6 : 0.9;
    smokeUniforms.uScale!.value = pointScale;
    (smokeUniforms.uColor!.value as Color).set("#d9d3c6").multiply(env.light).multiplyScalar(0.35 + 0.65 * env.daylight);

    // fish rises
    if (env.running && stock && waters.length > 0 && !env.reducedMotion) {
      // on average one rise every few seconds over a water at full stock
      const tries = Math.min(3, Math.floor(dt * waters.length * 0.05 + rand01(spawnSeed++, 1)));
      for (let k = 0; k < tries; k++) {
        const w = waters[Math.floor(rand01(spawnSeed++, 2) * waters.length)]!;
        const ratio = Math.max(0, (stock[w.node] as number) / w.cap);
        if (rand01(spawnSeed++, 3) > ratio) continue;
        const r = rises[cursor]!;
        cursor = (cursor + 1) % RISES;
        r.x = w.x + (rand01(spawnSeed++, 4) - 0.5) * 0.7;
        r.z = w.z + (rand01(spawnSeed++, 5) - 0.5) * 0.7;
        r.y = w.y;
        r.t0 = time;
        r.life = 1.6 + rand01(spawnSeed++, 6) * 0.8;
      }
    }
    for (let i = 0; i < RISES; i++) {
      const r = rises[i]!;
      const k = (time - r.t0) / r.life;
      if (k < 0 || k >= 1) {
        rings.setMatrixAt(i, ZERO);
        continue;
      }
      const size = 0.05 + 0.3 * Math.sqrt(k);
      p.set(r.x, r.y, r.z);
      s.set(size, 1, size);
      q.identity();
      rings.setMatrixAt(i, m4.compose(p, q, s));
      // additive: fading to black is fading away
      rings.setColorAt(i, tint.setScalar((1 - k) * (1 - k) * 0.5 * (0.25 + 0.75 * env.daylight)));
    }
    rings.instanceMatrix.needsUpdate = true;
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;

    // birds leave the sky at dusk and in a storm, and come back with the light
    const want = env.daylight > 0.3 && env.weather !== 3 && !env.reducedMotion ? 1 : 0;
    aloft += (want - aloft) * Math.min(1, dt * 0.5);
    for (let i = 0; i < flock; i++) {
      if (aloft < 0.02) {
        bodies.setMatrixAt(i, ZERO);
        wingsL.setMatrixAt(i, ZERO);
        wingsR.setMatrixAt(i, ZERO);
        continue;
      }
      // each bird rides its own ellipse around a slowly wandering centre
      const a = time * (0.16 + 0.05 * rand01(i, 1)) + rand01(i, 2) * 6.28;
      const cx = Math.sin(time * 0.021 + 1.3) * span * 0.16;
      const cz = Math.cos(time * 0.017) * span * 0.16;
      const rx = span * (0.14 + 0.1 * rand01(i, 3));
      const rz = span * (0.1 + 0.1 * rand01(i, 4));
      const x = cx + Math.cos(a) * rx;
      const z = cz + Math.sin(a) * rz;
      const y = 7.5 + 2.5 * rand01(i, 5) + Math.sin(time * 0.3 + i) * 0.6;
      const heading = Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz);
      p.set(x, y, z);
      q.setFromAxisAngle(Y, heading);
      qa.setFromAxisAngle(Z, -0.35);
      q.multiply(qa);
      const size = 1.5 * aloft * (0.85 + 0.3 * rand01(i, 6));
      s.set(size, size, size);
      body.compose(p, q, s);
      bodies.setMatrixAt(i, body);
      // wings beat about the body's long axis, with glides in between
      const beat = Math.sin(time * 7 + i * 1.9) * (0.35 + 0.35 * Math.max(0, Math.sin(time * 0.6 + i)));
      qa.setFromAxisAngle(Z, beat);
      m4.makeRotationFromQuaternion(qa);
      wingsR.setMatrixAt(i, m4.premultiply(body));
      qa.setFromAxisAngle(Z, -beat);
      m4.makeRotationFromQuaternion(qa);
      wingsL.setMatrixAt(i, m4.premultiply(body));
    }
    for (const m of [bodies, wingsL, wingsR]) m.instanceMatrix.needsUpdate = true;
  };

  return {
    objects: [smoke, rings, bodies, wingsL, wingsR],
    setFires,
    setAmounts(amounts: Int16Array) {
      stock = amounts;
    },
    update,
    dispose() {
      smokeGeometry.dispose();
      (smoke.material as ShaderMaterial).dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      for (const m of [bodies, wingsL, wingsR]) {
        m.geometry.dispose();
        m.dispose();
      }
      rings.dispose();
      birdMaterial.dispose();
    },
  };
}
