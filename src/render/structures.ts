/**
 * Things agents have made or left: campfires, shelters, stores, planted plots, piles of
 * goods on the ground, and the small cairns that mark where someone died.
 * Every object corresponds to a structure, pile or death in the simulation state; build
 * progress, fuel, fill level and ripeness are read from that state.
 */
import {
  AdditiveBlending,
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
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PileView, StructureView } from "@/worker/protocol";
import type { HeightField } from "./heightfield";
import { rand01 } from "./palette";

const KIND = { campfire: 0, shelter: 1, store: 2, plot: 3 } as const;
const MAX = 512;

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

function campfireGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const stone = new IcosahedronGeometry(0.075 + 0.02 * rand01(k, 1), 0);
    stone.scale(1, 0.7, 1);
    stone.translate(Math.cos(a) * 0.24, 0.04, Math.sin(a) * 0.24);
    parts.push(tinted(stone, "#8a8478", 0.15, k));
  }
  for (let k = 0; k < 3; k++) {
    const log = new CylinderGeometry(0.035, 0.04, 0.34, 5);
    log.rotateZ(Math.PI / 2 - 0.35);
    log.rotateY((k / 3) * Math.PI * 2);
    log.translate(0, 0.09, 0);
    parts.push(tinted(log, "#4a3323", 0.2, k + 20));
  }
  return mergeGeometries(parts)!;
}

function shelterGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // an A-frame of thatch over a ridge pole
  const roofL = new BoxGeometry(0.62, 0.035, 1.05);
  roofL.rotateZ(0.92);
  roofL.translate(-0.2, 0.3, 0);
  parts.push(tinted(roofL, "#b89a5a", 0.14, 1));
  const roofR = new BoxGeometry(0.62, 0.035, 1.05);
  roofR.rotateZ(-0.92);
  roofR.translate(0.2, 0.3, 0);
  parts.push(tinted(roofR, "#a88c50", 0.14, 2));
  const ridge = new CylinderGeometry(0.025, 0.025, 1.15, 5);
  ridge.rotateX(Math.PI / 2);
  ridge.translate(0, 0.55, 0);
  parts.push(tinted(ridge, "#5a3f2a", 0.1, 3));
  for (const z of [-0.5, 0.5]) {
    for (const x of [-0.38, 0.38]) {
      const pole = new CylinderGeometry(0.022, 0.026, 0.62, 5);
      pole.rotateZ(x < 0 ? -0.62 : 0.62);
      pole.translate(x * 0.52, 0.28, z);
      parts.push(tinted(pole, "#5a3f2a", 0.1, 4));
    }
  }
  const back = new BoxGeometry(0.5, 0.42, 0.03);
  back.translate(0, 0.21, -0.5);
  parts.push(tinted(back, "#9a8048", 0.12, 5));
  return mergeGeometries(parts)!;
}

function storeGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const x of [-0.3, 0.3]) {
    for (const z of [-0.3, 0.3]) {
      const post = new CylinderGeometry(0.03, 0.035, 0.5, 5);
      post.translate(x, 0.25, z);
      parts.push(tinted(post, "#5a3f2a", 0.1, 6));
    }
  }
  const floor = new BoxGeometry(0.78, 0.05, 0.78);
  floor.translate(0, 0.3, 0);
  parts.push(tinted(floor, "#7a5a3a", 0.12, 7));
  const roof = new ConeGeometry(0.62, 0.36, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 0.72, 0);
  parts.push(tinted(roof, "#b89a5a", 0.14, 8));
  return mergeGeometries(parts)!;
}

function sackGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(0.1, 1);
  g.scale(1, 0.85, 1);
  return tinted(g, "#c9b58a", 0.1, 9);
}

function plotGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let r = 0; r < 4; r++) {
    const row = new BoxGeometry(0.74, 0.05, 0.11);
    row.translate(0, 0.02, -0.3 + r * 0.2);
    parts.push(tinted(row, "#4f3a26", 0.18, 10 + r));
  }
  return mergeGeometries(parts)!;
}

function sproutGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 4; k++) {
      const leaf = new ConeGeometry(0.035, 0.16, 4);
      leaf.translate(-0.28 + k * 0.19 + (rand01(r * 4 + k, 1) - 0.5) * 0.05, 0.12, -0.3 + r * 0.2);
      parts.push(tinted(leaf, "#6fa04a", 0.2, 30 + r * 4 + k));
    }
  }
  return mergeGeometries(parts)!;
}

function pileGeometry(): BufferGeometry {
  const parts = [new IcosahedronGeometry(0.12, 0).translate(0, 0.07, 0), new IcosahedronGeometry(0.09, 0).translate(0.12, 0.05, 0.05), new IcosahedronGeometry(0.08, 0).translate(-0.1, 0.045, -0.06)];
  return tinted(mergeGeometries(parts)!, "#ffffff", 0.14, 50);
}

function cairnGeometry(): BufferGeometry {
  const parts = [
    new IcosahedronGeometry(0.13, 0).scale(1, 0.6, 1).translate(0, 0.06, 0),
    new IcosahedronGeometry(0.095, 0).scale(1, 0.62, 1).translate(0.01, 0.16, 0.01),
    new IcosahedronGeometry(0.06, 0).scale(1, 0.7, 1).translate(-0.005, 0.235, 0),
  ];
  return tinted(mergeGeometries(parts)!, "#8f897b", 0.12, 60);
}

const PILE_COLORS = ["#b3273f", "#c9a66b", "#9fb7c4", "#8a5a36", "#7a5a3a", "#8f897b", "#b9c27a", "#a8623f", "#7fd6cf", "#8f897b", "#8f897b", "#c9a66b", "#a8623f"].map((c) => new Color(c));

export interface FireUniforms {
  uTime: IUniform<number>;
  [key: string]: IUniform<unknown>;
}

export interface StructureParts {
  objects: Object3D[];
  uniforms: FireUniforms;
  setStructures(list: StructureView[]): void;
  setPiles(list: PileView[]): void;
  setCairns(list: { x: number; y: number; id: number }[]): void;
  /** Positions of lit fires (for lights and ambience). */
  litFires(): { x: number; y: number; z: number }[];
  /** Flicker the fire lights; `night` 0..1 scales how much they contribute. */
  animate(time: number, night: number): void;
  anchorOf(id: number): { x: number; y: number; z: number } | null;
  dispose(): void;
}

export function buildStructures(field: HeightField, quality: "low" | "medium" | "high"): StructureParts {
  const solid = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
  const geoms = {
    campfire: campfireGeometry(),
    shelter: shelterGeometry(),
    store: storeGeometry(),
    sack: sackGeometry(),
    plot: plotGeometry(),
    sprout: sproutGeometry(),
    pile: pileGeometry(),
    cairn: cairnGeometry(),
  };
  const mk = (g: BufferGeometry, name: string, capacity = MAX): InstancedMesh => {
    const m = new InstancedMesh(g, solid, capacity);
    m.count = 0;
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.castShadow = quality !== "low";
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.name = name;
    return m;
  };
  const meshes = {
    campfire: mk(geoms.campfire, "campfires"),
    shelter: mk(geoms.shelter, "shelters"),
    store: mk(geoms.store, "stores"),
    sack: mk(geoms.sack, "sacks", MAX * 4),
    plot: mk(geoms.plot, "plots"),
    sprout: mk(geoms.sprout, "sprouts"),
    pile: mk(geoms.pile, "piles"),
    cairn: mk(geoms.cairn, "cairns"),
  };

  // flames: two crossed quads per fire, animated in the shader
  const flameGeometry = (() => {
    const a = new PlaneGeometry(0.42, 0.62).translate(0, 0.36, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    return mergeGeometries([a, b])!;
  })();
  const uniforms: FireUniforms = { uTime: { value: 0 } };
  const flameMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vSeed;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vSeed = origin.x * 3.1 + origin.z * 1.7;
        vec3 p = position;
        float sway = sin(uTime * 7.0 + vSeed + p.y * 5.0) * 0.045 * p.y;
        p.x += sway;
        p.z += sway * 0.6;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      varying float vSeed;
      uniform float uTime;
      float h(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), u.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), u.x), u.y); }
      void main() {
        vec2 uv = vUv;
        float t = uTime * 2.4 + vSeed;
        float shape = 1.0 - smoothstep(0.0, 0.5 - uv.y * 0.42, abs(uv.x - 0.5));
        float flick = n(vec2(uv.x * 4.0, uv.y * 3.0 - t)) * 0.7 + n(vec2(uv.x * 9.0, uv.y * 7.0 - t * 1.7)) * 0.3;
        float body = shape * smoothstep(1.0, 0.15, uv.y + (1.0 - flick) * 0.55);
        vec3 col = mix(vec3(1.0, 0.32, 0.05), vec3(1.0, 0.86, 0.45), smoothstep(0.25, 0.9, body));
        gl_FragColor = vec4(col * body * 1.7, body);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const flames = new InstancedMesh(flameGeometry, flameMaterial, MAX);
  flames.count = 0;
  flames.frustumCulled = false;
  flames.renderOrder = 5;
  flames.name = "flames";

  const lightCount = quality === "low" ? 2 : quality === "medium" ? 4 : 6;
  const lights: PointLight[] = [];
  for (let i = 0; i < lightCount; i++) {
    const l = new PointLight(new Color("#ffb060"), 0, 9, 1.6);
    l.visible = false;
    lights.push(l);
  }

  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p3 = new Vector3();
  const s3 = new Vector3();
  const tint = new Color();
  const anchors = new Map<number, { x: number; y: number; z: number }>();
  let fires: { x: number; y: number; z: number }[] = [];

  const setStructures = (list: StructureView[]): void => {
    const n = { campfire: 0, shelter: 0, store: 0, sack: 0, plot: 0, sprout: 0, flame: 0 };
    fires = [];
    anchors.clear();
    for (const sv of list) {
      const c = field.tileCentre(sv.x, sv.y);
      const y = field.standAt(c.x, c.z);
      anchors.set(sv.id, { x: c.x, y, z: c.z });
      const rot = rand01(sv.id, 1) * Math.PI * 2;
      q.setFromAxisAngle(up, rot);
      p3.set(c.x, y - 0.01, c.z);
      // construction is visible: structures rise as materials and labour arrive
      const built = sv.complete ? 1 : 0.25 + 0.75 * (sv.progress / 1000);
      if (sv.kind === KIND.campfire && n.campfire < MAX) {
        s3.set(1, sv.complete ? 1 : built, 1);
        meshes.campfire.setMatrixAt(n.campfire, m4.compose(p3, q, s3));
        meshes.campfire.setColorAt(n.campfire, tint.setScalar(sv.fuel > 0 ? 1 : 0.7));
        n.campfire++;
        if (sv.complete && sv.fuel > 0 && n.flame < MAX) {
          const size = 0.65 + Math.min(1, sv.fuel / 96) * 0.6;
          s3.set(size, size, size);
          q.identity();
          flames.setMatrixAt(n.flame++, m4.compose(p3, q, s3));
          fires.push({ x: c.x, y: y + 0.4, z: c.z });
        }
      } else if (sv.kind === KIND.shelter && n.shelter < MAX) {
        s3.set(1, built, 1);
        meshes.shelter.setMatrixAt(n.shelter, m4.compose(p3, q, s3));
        meshes.shelter.setColorAt(n.shelter, tint.setScalar(sv.complete ? 1 : 0.8));
        n.shelter++;
      } else if (sv.kind === KIND.store && n.store < MAX) {
        s3.set(1, built, 1);
        meshes.store.setMatrixAt(n.store, m4.compose(p3, q, s3));
        meshes.store.setColorAt(n.store, tint.setScalar(sv.complete ? 1 : 0.8));
        n.store++;
        // one sack per ~8% fill, stacked on the platform
        const sacks = sv.complete ? Math.min(9, Math.ceil(sv.fill / 110)) : 0;
        for (let k = 0; k < sacks && n.sack < MAX * 4; k++) {
          const col = k % 3;
          const row = Math.floor(k / 3);
          const lx = -0.2 + col * 0.2;
          const lz = -0.18 + (row % 2) * 0.22;
          const ly = 0.39 + Math.floor(row / 2) * 0.15;
          const cs = Math.cos(rot);
          const sn = Math.sin(rot);
          p3.set(c.x + lx * cs + lz * sn, y + ly, c.z - lx * sn + lz * cs);
          s3.set(1, 1, 1);
          meshes.sack.setMatrixAt(n.sack, m4.compose(p3, q, s3));
          meshes.sack.setColorAt(n.sack, tint.setScalar(0.9 + 0.2 * rand01(sv.id * 9 + k, 2)));
          n.sack++;
        }
      } else if (sv.kind === KIND.plot && n.plot < MAX) {
        q.setFromAxisAngle(up, Math.round(rand01(sv.id, 4) * 2) * (Math.PI / 2));
        s3.set(1, 1, 1);
        meshes.plot.setMatrixAt(n.plot, m4.compose(p3, q, s3));
        meshes.plot.setColorAt(n.plot, tint.setScalar(1));
        n.plot++;
        if (sv.complete && n.sprout < MAX) {
          const grow = 0.2 + 0.8 * (sv.ripe / 1000);
          s3.set(1, grow * 1.5, 1);
          meshes.sprout.setMatrixAt(n.sprout, m4.compose(p3, q, s3));
          // ripe plots turn gold
          meshes.sprout.setColorAt(n.sprout, sv.ripe >= 1000 ? tint.set("#e2c35a") : tint.set("#ffffff"));
          n.sprout++;
        }
      }
    }
    meshes.campfire.count = n.campfire;
    meshes.shelter.count = n.shelter;
    meshes.store.count = n.store;
    meshes.sack.count = n.sack;
    meshes.plot.count = n.plot;
    meshes.sprout.count = n.sprout;
    flames.count = n.flame;
    for (const m of [meshes.campfire, meshes.shelter, meshes.store, meshes.sack, meshes.plot, meshes.sprout, flames]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  };

  const setPiles = (list: PileView[]): void => {
    let n = 0;
    for (const pv of list) {
      if (n >= MAX || pv.units <= 0) continue;
      const c = field.tileCentre(pv.x, pv.y);
      const ox = (rand01(pv.x * 131 + pv.y, 1) - 0.5) * 0.4;
      const oz = (rand01(pv.x * 131 + pv.y, 2) - 0.5) * 0.4;
      p3.set(c.x + ox, field.standAt(c.x + ox, c.z + oz) - 0.01, c.z + oz);
      const size = 0.7 + Math.min(1.6, Math.sqrt(pv.units) * 0.22);
      s3.set(size, size, size);
      q.setFromAxisAngle(up, rand01(pv.x * 17 + pv.y, 3) * 6.28);
      meshes.pile.setMatrixAt(n, m4.compose(p3, q, s3));
      meshes.pile.setColorAt(n, PILE_COLORS[pv.item] ?? PILE_COLORS[4]!);
      n++;
    }
    meshes.pile.count = n;
    meshes.pile.instanceMatrix.needsUpdate = true;
    if (meshes.pile.instanceColor) meshes.pile.instanceColor.needsUpdate = true;
  };

  const setCairns = (list: { x: number; y: number; id: number }[]): void => {
    let n = 0;
    for (const cv of list) {
      if (n >= MAX) break;
      const c = field.tileCentre(cv.x, cv.y);
      const ox = (rand01(cv.id, 3) - 0.5) * 0.46;
      const oz = (rand01(cv.id, 4) - 0.5) * 0.46;
      p3.set(c.x + ox, field.standAt(c.x + ox, c.z + oz) - 0.01, c.z + oz);
      s3.set(1, 1, 1);
      q.setFromAxisAngle(up, rand01(cv.id, 11) * 6.28);
      meshes.cairn.setMatrixAt(n, m4.compose(p3, q, s3));
      meshes.cairn.setColorAt(n, tint.setScalar(0.9 + 0.2 * rand01(cv.id, 12)));
      n++;
    }
    meshes.cairn.count = n;
    meshes.cairn.instanceMatrix.needsUpdate = true;
    if (meshes.cairn.instanceColor) meshes.cairn.instanceColor.needsUpdate = true;
  };

  const animate = (time: number, night: number): void => {
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i]!;
      const f = fires[i];
      if (!f) {
        l.visible = false;
        continue;
      }
      l.visible = true;
      l.position.set(f.x, f.y + 0.2, f.z);
      const flicker = 0.82 + 0.18 * Math.sin(time * 11 + i * 2.3) * Math.sin(time * 7.3 + i);
      l.intensity = (2.2 + 9 * night) * flicker;
    }
  };

  return {
    objects: [...Object.values(meshes), flames, ...lights],
    uniforms,
    setStructures,
    setPiles,
    setCairns,
    litFires: () => fires,
    animate,
    anchorOf: (id: number) => anchors.get(id) ?? null,
    dispose() {
      for (const g of Object.values(geoms)) g.dispose();
      flameGeometry.dispose();
      flameMaterial.dispose();
      solid.dispose();
      for (const m of Object.values(meshes)) m.dispose();
      flames.dispose();
    },
  };
}
