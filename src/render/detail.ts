/**
 * Fine surface detail, as three small repeating textures made once in the browser (D-054).
 *
 * Nothing is downloaded and nothing is stored: each texture is 256 × 256 texels computed from a
 * fixed formula the first time a world is drawn, and kept for the next. They replace noise that
 * the ground, the water and the leaves used to compute afresh for every pixel of every frame,
 * and they carry something that noise could not: the slope of the surface they describe, so
 * that grass, gravel, ripples and leaves catch the light like relief and not like paint.
 *
 * Each texture has the same four channels:
 *   R, G  the slope of the surface across the texture (0.5 = level); the texture's own x and y
 *   B     its height (0 low .. 1 high)
 *   A     something slower or rarer, different for each texture (see below)
 *
 * They are scenery. No count on screen is read from them and nothing in the simulation knows
 * that they exist.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from "three";

export const DETAIL_SIZE = 256;

/** A lattice value that repeats every `period` cells in both directions. */
function lattice(ix: number, iy: number, period: number, seed: number): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth noise with `cells` cells across the texture; `u`, `v` in [0, 1); repeats exactly. */
function tileNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(x0, y0, cells, seed);
  const b = lattice(x0 + 1, y0, cells, seed);
  const c = lattice(x0, y0 + 1, cells, seed);
  const d = lattice(x0 + 1, y0 + 1, cells, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Several octaves of it, each twice as fine, so the sum repeats where its first octave does. */
export function tileFbm(u: number, v: number, cells: number, octaves: number, seed: number, gain = 0.5): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let c = cells;
  for (let o = 0; o < octaves; o++) {
    sum += amp * tileNoise(u, v, c, seed + o * 37);
    norm += amp;
    amp *= gain;
    c *= 2;
  }
  return sum / norm;
}

/**
 * Distance to the nearest of a set of scattered points, one per cell of a `cells` × `cells` grid
 * (0 at a point, about 1 at the farthest), and a number that belongs to that point.
 */
export function tileCells(u: number, v: number, cells: number, seed: number): { d: number; id: number } {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  let best = 9;
  let id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = x0 + dx;
      const cy = y0 + dy;
      const px = cx + 0.15 + 0.7 * lattice(cx, cy, cells, seed);
      const py = cy + 0.15 + 0.7 * lattice(cx, cy, cells, seed + 101);
      const d = Math.hypot(x - px, y - py);
      if (d < best) {
        best = d;
        id = lattice(cx, cy, cells, seed + 211);
      }
    }
  }
  return { d: Math.min(1, best), id };
}

/** Texels of a texture from a height and a fourth value for each (u, v); the slope is taken from the height. */
function bake(height: (u: number, v: number) => number, extra: (u: number, v: number) => number, relief: number): Uint8Array<ArrayBuffer> {
  const n = DETAIL_SIZE;
  const h = new Float32Array(n * n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const value = height((x + 0.5) / n, (y + 0.5) / n);
      h[y * n + x] = value;
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
  }
  const span = hi - lo || 1;
  const data = new Uint8Array(new ArrayBuffer(n * n * 4));
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const l = h[y * n + ((x + n - 1) % n)] as number;
      const r = h[y * n + ((x + 1) % n)] as number;
      const d = h[((y + n - 1) % n) * n + x] as number;
      const u = h[((y + 1) % n) * n + x] as number;
      data[i * 4] = byte(0.5 + ((r - l) / span) * relief);
      data[i * 4 + 1] = byte(0.5 + ((u - d) / span) * relief);
      data[i * 4 + 2] = byte(((h[i] as number) - lo) / span);
      data[i * 4 + 3] = byte(extra((x + 0.5) / n, (y + 0.5) / n));
    }
  }
  return data;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Texels = Uint8Array<ArrayBuffer>;
/** The mean of each channel of a texture, 0..1: what a look at it from far away returns. */
export type ChannelMeans = readonly [number, number, number, number];

let cache: { ground: Texels; leaves: Texels; ripples: Texels } | null = null;
let means: { ground: ChannelMeans; leaves: ChannelMeans; ripples: ChannelMeans } | null = null;

function meansOf(data: Texels): ChannelMeans {
  const sum = [0, 0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 4; c++) sum[c]! += data[i + c] as number;
  const n = (data.length / 4) * 255;
  return [sum[0]! / n, sum[1]! / n, sum[2]! / n, sum[3]! / n];
}

/**
 * The mean of every channel of every texture. A shader that wants "how far above or below the
 * ordinary" subtracts this, so that where the texture is seen from too far to resolve (and the
 * renderer reads its averaged copy) the detail comes out as exactly nothing.
 */
export function detailMeans(): { ground: ChannelMeans; leaves: ChannelMeans; ripples: ChannelMeans } {
  if (!means) {
    const t = detailTexels();
    means = { ground: meansOf(t.ground), leaves: meansOf(t.leaves), ripples: meansOf(t.ripples) };
  }
  return means;
}

/** The texels of the three textures (computed on first use, about a quarter of a megabyte each). */
export function detailTexels(): { ground: Texels; leaves: Texels; ripples: Texels } {
  if (cache) return cache;
  // Ground: a mottled grain with small rounded lumps in it (tufts, crumbs, gravel).
  //   A: broad, soft variation, sixteen cells across — for patches of colour a third of a tile wide.
  const ground = bake(
    (u, v) => 0.55 * tileFbm(u, v, 24, 4, 3) + 0.45 * (1 - smooth(0.05, 0.75, tileCells(u, v, 40, 9).d)),
    (u, v) => tileFbm(u, v, 16, 4, 17),
    1.6,
  );
  // Leaves: foliage as it masses — rounded sprays, each made of smaller ones, with a sharp dark
  // crease wherever two meet (noise folded about its middle, at three sizes), and leaflets on top.
  //   A: slow variation — for the lean of the colour toward yellow or toward blue-green.
  const leaves = bake(
    (u, v) => {
      let sprays = 0;
      let amp = 0.5;
      for (let o = 0, cells = 5; o < 3; o++, cells *= 2, amp *= 0.5) sprays += amp * Math.abs(2 * tileNoise(u, v, cells, 23 + o * 13) - 1);
      return sprays / 0.875 + 0.16 * (1 - smooth(0.0, 0.7, tileCells(u, v, 34, 31).d));
    },
    (u, v) => tileFbm(u, v, 5, 3, 41),
    1.9,
  );
  // Ripples: the surface of moving water, a few scales of rounded swell.
  //   A: fine, sharp speckle — where a glint may fall.
  const ripples = bake(
    (u, v) => tileFbm(u, v, 7, 4, 53, 0.55),
    (u, v) => tileFbm(u, v, 56, 2, 67),
    1.5,
  );
  cache = { ground, leaves, ripples };
  return cache;
}

export interface DetailParts {
  ground: DataTexture;
  leaves: DataTexture;
  ripples: DataTexture;
  dispose(): void;
}

/**
 * The three textures for one renderer. `anisotropy` would sharpen them on ground seen at a slant; it is
 * left off (1), because it is paid for with several reads of the texture where one is made now, and the
 * ground seen at a slant is the far ground, which the lens blurs anyway.
 */
export function buildDetail(anisotropy = 1): DetailParts {
  const texels = detailTexels();
  const make = (data: Uint8Array<ArrayBuffer>): DataTexture => {
    const t = new DataTexture(data, DETAIL_SIZE, DETAIL_SIZE, RGBAFormat, UnsignedByteType);
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    return t;
  };
  const ground = make(texels.ground);
  const leaves = make(texels.leaves);
  const ripples = make(texels.ripples);
  return {
    ground,
    leaves,
    ripples,
    dispose() {
      ground.dispose();
      leaves.dispose();
      ripples.dispose();
    },
  };
}
