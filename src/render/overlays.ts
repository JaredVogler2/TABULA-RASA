/**
 * Observer overlays: views of what one citizen knows, laid over the world everyone shares.
 *
 * The knowledge veil washes out every place the selected citizen has never seen, leaving
 * the land they know in full colour: the observer sees the whole island, the citizen only
 * part of it, and this shows which part. The ties overlay draws an arc from the selected
 * citizen to each person they have dealt with, warm where they trust and cool where they
 * do not. Both read simulation state through the inspector; neither changes anything.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  type MeshStandardMaterial,
  RedFormat,
  UnsignedByteType,
  Vector2,
  type Vector3,
  type IUniform,
} from "three";

export interface KnowledgeUniforms {
  uKnown: IUniform<DataTexture>;
  uKnownMix: IUniform<number>;
  uKnownWorld: IUniform<Vector2>;
  /** The wash laid over unknown land: a parchment tone scaled to the light of the hour. */
  uKnownTone: IUniform<Color>;
  [key: string]: IUniform<unknown>;
}

/** GLSL that greys a finished fragment toward dry parchment where the tile is unknown. `uv` is the tile-space coordinate. */
export const VEIL_GLSL = /* glsl */ `
  float kUnknown = uKnownMix * (1.0 - smoothstep(0.25, 0.75, texture2D(uKnown, kuv).r));
  float kLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(kLum) * 0.42 + uKnownTone, kUnknown * 0.94);
`;

export interface Knowledge {
  uniforms: KnowledgeUniforms;
  /** A bit per tile (1 = seen by the selected citizen), or null to show the world as the observer sees it. */
  set(seen: Uint8Array | null): void;
  /** Ease the veil in and out; `brightness` (0 night .. 1 day) keeps the wash from glowing in the dark. */
  update(dt: number, brightness: number): void;
  active(): boolean;
  dispose(): void;
}

export function buildKnowledge(w: number, h: number): Knowledge {
  const data = new Uint8Array(w * h).fill(255);
  const texture = new DataTexture(data, w, h, RedFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  const uniforms: KnowledgeUniforms = { uKnown: { value: texture }, uKnownMix: { value: 0 }, uKnownWorld: { value: new Vector2(w, h) }, uKnownTone: { value: new Color(0.27, 0.255, 0.22) } };
  let want = 0;
  return {
    uniforms,
    set(seen: Uint8Array | null) {
      if (!seen) {
        want = 0;
        return;
      }
      want = 1;
      for (let t = 0; t < w * h; t++) data[t] = ((seen[t >> 3] as number) >> (t & 7)) & 1 ? 255 : 0;
      texture.needsUpdate = true;
    },
    update(dt: number, brightness: number) {
      uniforms.uKnownTone.value.setRGB(0.27, 0.255, 0.22).multiplyScalar(0.2 + 0.8 * brightness);
      const k = Math.min(1, dt * 5);
      uniforms.uKnownMix.value += (want - uniforms.uKnownMix.value) * k;
      if (Math.abs(want - uniforms.uKnownMix.value) < 0.004) uniforms.uKnownMix.value = want;
    },
    active: () => want > 0,
    dispose() {
      texture.dispose();
    },
  };
}

/** Make a lit material fade to the veil over unknown tiles. Chains onto whatever the material already compiles. */
export function veil(material: MeshStandardMaterial, uniforms: KnowledgeUniforms): void {
  const before = material.onBeforeCompile.bind(material);
  const keyBefore = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec2 uKnownWorld;\nvarying vec2 vKnownUv;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
{
  vec4 kw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  kw = instanceMatrix * kw;
#endif
  kw = modelMatrix * kw;
  vKnownUv = (kw.xz + uKnownWorld * 0.5) / uKnownWorld;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uKnown;\nuniform float uKnownMix;\nuniform vec3 uKnownTone;\nvarying vec2 vKnownUv;")
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>\n{\n  vec2 kuv = vKnownUv;\n${VEIL_GLSL}\n}`);
  };
  material.customProgramCacheKey = () => `${keyBefore()}|veil`;
}

const MAX_TIES = 12;
const SEGMENTS = 18;

export interface Ties {
  object: LineSegments;
  /** The selected citizen and the people they have dealt with (`trust` in thousandths, about -1000..1000), or null for none. */
  set(from: number, ties: readonly { id: number; trust: number }[] | null): void;
  /** Redraw the arcs between where those people stand now. */
  update(positionOf: (id: number, out: Vector3) => boolean, scratchA: Vector3, scratchB: Vector3): void;
  dispose(): void;
}

export function buildTies(): Ties {
  const vertices = MAX_TIES * SEGMENTS * 2;
  const positions = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const geometry = new BufferGeometry();
  const posAttr = new BufferAttribute(positions, 3);
  posAttr.setUsage(DynamicDrawUsage);
  const colAttr = new BufferAttribute(colors, 3);
  colAttr.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", posAttr);
  geometry.setAttribute("color", colAttr);
  geometry.setDrawRange(0, 0);
  const material = new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false });
  const object = new LineSegments(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = 19;
  object.name = "ties";

  let from = -1;
  let list: { id: number; trust: number }[] = [];
  const WARM = new Color("#f6c57e");
  const COOL = new Color("#7fb6d6");
  const c = new Color();

  return {
    object,
    set(who: number, ties: readonly { id: number; trust: number }[] | null) {
      from = ties ? who : -1;
      list = ties ? ties.slice(0, MAX_TIES) : [];
      if (!ties) geometry.setDrawRange(0, 0);
    },
    update(positionOf, a, b) {
      if (from < 0 || !positionOf(from, a)) {
        geometry.setDrawRange(0, 0);
        return;
      }
      let v = 0;
      for (const tie of list) {
        if (!positionOf(tie.id, b)) continue;
        const span = Math.hypot(b.x - a.x, b.z - a.z);
        const lift = 0.8 + Math.min(4, span * 0.22);
        // brighter for a stronger feeling either way; a stranger's arc is faint
        const strength = 0.25 + 0.75 * Math.min(1, Math.abs(tie.trust) / 600);
        c.copy(tie.trust >= 0 ? WARM : COOL).multiplyScalar(strength);
        for (let s = 0; s < SEGMENTS; s++) {
          for (const k of [s / SEGMENTS, (s + 1) / SEGMENTS]) {
            const o = v * 3;
            positions[o] = a.x + (b.x - a.x) * k;
            positions[o + 1] = a.y + 0.75 + (b.y - a.y) * k + Math.sin(Math.PI * k) * lift;
            positions[o + 2] = a.z + (b.z - a.z) * k;
            // fade toward the far end so the arc reads as leading from the selected person
            const fade = 1 - 0.55 * k;
            colors[o] = c.r * fade;
            colors[o + 1] = c.g * fade;
            colors[o + 2] = c.b * fade;
            v++;
          }
        }
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      geometry.setDrawRange(0, v);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
