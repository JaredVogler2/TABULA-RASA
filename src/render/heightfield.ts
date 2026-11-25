/**
 * Continuous render-space surface derived from the simulation's tile data.
 *
 * The simulation knows one integer height per tile and which tiles are sea, stream or
 * pond. For rendering we:
 *   - interpolate tile-centre elevations with a Catmull-Rom spline (it passes exactly
 *     through them, so every land tile centre stays above the waterline),
 *   - shape the sea floor from distance to shore (a luminous shelf, then deep water),
 *   - carve stream beds along the lines joining neighbouring stream tiles,
 *   - add sculpting noise and ridged crags that grow with elevation.
 * Nothing here feeds back into the engine.
 *
 * World space: one tile is one unit; tile (tx, ty) is centred at (tx + 0.5 − w/2, ·, ty + 0.5 − h/2).
 */
import type { StaticWorldView } from "@/worker/protocol";

export const HEIGHT_SCALE = 10.5;
export const DEPTH_SCALE = 3.4;
export const SUBDIV = 4;
export const SLAB_BOTTOM = -7.2;

const WATER_SEA = 1;
const WATER_STREAM = 2;
const WATER_POND = 3;

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm2(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Ridged noise in [0,1]: sharp crests. */
export function ridge2(x: number, y: number, seed: number, octaves = 3): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(x * freq, y * freq, seed + o * 53);
    const r = 1 - Math.abs(2 * n - 1);
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Land tile integer height → world-space elevation: gentle lowlands, steep high ground. */
export function landHeightToWorld(hv: number): number {
  const t = Math.max(0, hv) / 1000;
  return 0.07 + (0.35 * t + 0.65 * Math.pow(t, 1.9)) * HEIGHT_SCALE;
}

export class HeightField {
  readonly w: number;
  readonly h: number;
  /** Samples per side: tiles × SUBDIV + 1. */
  readonly sw: number;
  readonly sh: number;
  /** World-space elevation of the ground (carved) at each sample. */
  readonly ground: Float32Array;
  /** World-space elevation of fresh water surfaces at each sample (NaN where none). */
  readonly fresh: Float32Array;
  /** 0..1 how strongly a sample belongs to a stream bed or pond. */
  readonly wetMask: Float32Array;
  /** 0..1 ambient occlusion estimate per sample (1 = open). */
  readonly occlusion: Float32Array;
  /** Distance to the shore in tiles for sea tiles (0 on land). */
  readonly shoreDistance: Float32Array;
  private readonly tileY: Float32Array;

  constructor(view: StaticWorldView) {
    const { w, h } = view;
    this.w = w;
    this.h = h;
    this.sw = w * SUBDIV + 1;
    this.sh = h * SUBDIV + 1;
    const seed = view.config.seed;
    const N = w * h;

    // ── distance from every sea tile to the nearest land tile (two-pass chamfer)
    const dist = new Float32Array(N);
    for (let i = 0; i < N; i++) dist[i] = view.water[i] === WATER_SEA ? 1e6 : 0;
    const relax = (i: number, j: number, cost: number) => {
      const v = (dist[j] as number) + cost;
      if (v < (dist[i] as number)) dist[i] = v;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x > 0) relax(i, i - 1, 1);
        if (y > 0) relax(i, i - w, 1);
        if (x > 0 && y > 0) relax(i, i - w - 1, 1.414);
        if (x < w - 1 && y > 0) relax(i, i - w + 1, 1.414);
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (x < w - 1) relax(i, i + 1, 1);
        if (y < h - 1) relax(i, i + w, 1);
        if (x < w - 1 && y < h - 1) relax(i, i + w + 1, 1.414);
        if (x > 0 && y < h - 1) relax(i, i + w - 1, 1.414);
      }
    }
    this.shoreDistance = dist;

    // ── per-tile elevation in world units
    const tileY = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (view.water[i] === WATER_SEA) {
        // a bright shelf near the shore that falls away into deep water
        const d = dist[i] as number;
        const shelf = Math.min(1, d / 9);
        const x = i % w;
        const y = (i - x) / w;
        const wobble = 0.75 + 0.5 * fbm2(x * 0.21, y * 0.21, seed + 5, 3);
        tileY[i] = -(0.1 + DEPTH_SCALE * Math.pow(shelf, 1.35) * wobble);
      } else {
        tileY[i] = landHeightToWorld(view.height[i] as number);
      }
    }
    this.tileY = tileY;

    const at = (tx: number, ty: number): number => {
      const x = tx < 0 ? 0 : tx >= w ? w - 1 : tx;
      const y = ty < 0 ? 0 : ty >= h ? h - 1 : ty;
      return tileY[y * w + x] as number;
    };
    const isFresh = (tx: number, ty: number): boolean => {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
      const wv = view.water[ty * w + tx] as number;
      return wv === WATER_STREAM || wv === WATER_POND;
    };
    const isPond = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < w && ty < h && view.water[ty * w + tx] === WATER_POND;
    const isSea = (tx: number, ty: number): boolean => tx < 0 || ty < 0 || tx >= w || ty >= h || view.water[ty * w + tx] === WATER_SEA;

    /**
     * Distance (in tiles) from a point to the stream network: the segments joining each
     * stream/pond tile centre to its neighbouring stream/pond or sea tile centres. Using
     * segments rather than tile squares keeps diagonal reaches continuous and lets streams
     * run all the way into the sea.
     */
    const channelDistance = (px: number, py: number): { d: number; pond: number } => {
      const cx = Math.floor(px);
      const cy = Math.floor(py);
      let best = 9;
      let pond = 0;
      for (let ty = cy - 1; ty <= cy + 1; ty++) {
        for (let tx = cx - 1; tx <= cx + 1; tx++) {
          if (!isFresh(tx, ty)) continue;
          const ax = tx + 0.5;
          const ay = ty + 0.5;
          const pondHere = isPond(tx, ty);
          // the tile's own centre (ponds are discs, streams are thin)
          const d0 = Math.hypot(px - ax, py - ay) - (pondHere ? 0.42 : 0);
          if (d0 < best) {
            best = d0;
            pond = pondHere ? 1 : 0;
          }
          for (let ny = ty - 1; ny <= ty + 1; ny++) {
            for (let nx = tx - 1; nx <= tx + 1; nx++) {
              if (nx === tx && ny === ty) continue;
              const fresh = isFresh(nx, ny);
              if (!fresh && !isSea(nx, ny)) continue;
              // only link diagonally when no orthogonal link already joins the two tiles' rows/columns
              if (nx !== tx && ny !== ty && (isFresh(nx, ty) || isFresh(tx, ny))) continue;
              if (!fresh && nx !== tx && ny !== ty) continue;
              const bx = nx + 0.5;
              const by = ny + 0.5;
              const vx = bx - ax;
              const vy = by - ay;
              const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
              const d = Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
              if (d < best) {
                best = d;
                pond = pondHere && isPond(nx, ny) ? 1 : 0;
              }
            }
          }
        }
      }
      return { d: best, pond };
    };

    const n = this.sw * this.sh;
    this.ground = new Float32Array(n);
    this.fresh = new Float32Array(n).fill(Number.NaN);
    this.wetMask = new Float32Array(n);
    this.occlusion = new Float32Array(n).fill(1);
    const uncarved = new Float32Array(n);

    for (let sy = 0; sy < this.sh; sy++) {
      for (let sx = 0; sx < this.sw; sx++) {
        // continuous tile coordinates of this sample, in units where tile centres are integers
        const cx = sx / SUBDIV - 0.5;
        const cy = sy / SUBDIV - 0.5;
        const ix = Math.floor(cx);
        const iy = Math.floor(cy);
        const fx = cx - ix;
        const fy = cy - iy;
        const r0 = catmull(at(ix - 1, iy - 1), at(ix, iy - 1), at(ix + 1, iy - 1), at(ix + 2, iy - 1), fx);
        const r1 = catmull(at(ix - 1, iy), at(ix, iy), at(ix + 1, iy), at(ix + 2, iy), fx);
        const r2 = catmull(at(ix - 1, iy + 1), at(ix, iy + 1), at(ix + 1, iy + 1), at(ix + 2, iy + 1), fx);
        const r3 = catmull(at(ix - 1, iy + 2), at(ix, iy + 2), at(ix + 1, iy + 2), at(ix + 2, iy + 2), fx);
        let y = catmull(r0, r1, r2, r3, fy);

        const wx = sx / SUBDIV;
        const wy = sy / SUBDIV;
        if (y > 0.03) {
          // sculpting: soft undulation everywhere, crags that sharpen with elevation
          const fade = Math.min(1, y / 0.9);
          y += (fbm2(wx * 0.8, wy * 0.8, seed + 11, 3) - 0.5) * 0.4 * fade;
          y += (valueNoise(wx * 2.9, wy * 2.9, seed + 17) - 0.5) * 0.08 * fade;
          const high = Math.max(0, Math.min(1, (y - 2.2) / 4.5));
          if (high > 0) {
            const crag = ridge2(wx * 0.42, wy * 0.42, seed + 29, 4);
            y += (crag - 0.42) * 2.4 * high * high;
            y += (ridge2(wx * 1.6, wy * 1.6, seed + 37, 2) - 0.4) * 0.5 * high;
          }
          if (y < 0.05) y = 0.05;
        } else {
          y += (fbm2(wx * 0.6, wy * 0.6, seed + 23, 2) - 0.5) * 0.22 * Math.min(1, -y);
        }

        const i = sy * this.sw + sx;
        uncarved[i] = y;
        if (y > 0.03) {
          const ch = channelDistance(wx, wy);
          const width = 0.3 + 0.16 * ch.pond;
          const m = ch.d >= width + 0.3 ? 0 : ch.d <= width - 0.14 ? 1 : 1 - (ch.d - (width - 0.14)) / 0.44;
          const smooth = m * m * (3 - 2 * m);
          this.wetMask[i] = smooth;
          if (smooth > 0) {
            const depth = 0.24 + 0.3 * ch.pond;
            const surface = y - 0.07;
            y -= depth * smooth;
            this.fresh[i] = surface - 0.05 * (1 - smooth);
          }
        }
        this.ground[i] = y;
      }
    }

    // ── ambient occlusion: how much lower a sample sits than its surroundings
    const g = this.ground;
    const sw = this.sw;
    const sh = this.sh;
    const R = 3;
    for (let sy = 0; sy < sh; sy++) {
      for (let sx = 0; sx < sw; sx++) {
        const i = sy * sw + sx;
        const here = g[i] as number;
        if (here < -0.2) continue;
        let sum = 0;
        let cnt = 0;
        for (let dy = -R; dy <= R; dy += R) {
          for (let dx = -R; dx <= R; dx += R) {
            if (dx === 0 && dy === 0) continue;
            const x = sx + dx < 0 ? 0 : sx + dx >= sw ? sw - 1 : sx + dx;
            const y = sy + dy < 0 ? 0 : sy + dy >= sh ? sh - 1 : sy + dy;
            sum += Math.max(0, g[y * sw + x] as number);
            cnt++;
          }
        }
        const delta = sum / cnt - Math.max(0, here);
        this.occlusion[i] = Math.max(0.55, Math.min(1.12, 1 - delta * 0.55));
      }
    }
  }

  /** Bilinear ground elevation at world coordinates. */
  heightAt(worldX: number, worldZ: number): number {
    const gx = (worldX + this.w / 2) * SUBDIV;
    const gz = (worldZ + this.h / 2) * SUBDIV;
    const x = gx < 0 ? 0 : gx > this.sw - 1.001 ? this.sw - 1.001 : gx;
    const z = gz < 0 ? 0 : gz > this.sh - 1.001 ? this.sh - 1.001 : gz;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const g = this.ground;
    const i = iz * this.sw + ix;
    const a = g[i] as number;
    const b = g[i + 1] as number;
    const c = g[i + this.sw] as number;
    const d = g[i + this.sw + 1] as number;
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  /** Elevation an agent or object stands at: the ground, never below the waterline. */
  standAt(worldX: number, worldZ: number): number {
    return Math.max(this.heightAt(worldX, worldZ), 0.02);
  }

  /** Unit surface normal at world coordinates. */
  normalAt(worldX: number, worldZ: number, out: { x: number; y: number; z: number }): void {
    const e = 0.3;
    const dx = this.heightAt(worldX + e, worldZ) - this.heightAt(worldX - e, worldZ);
    const dz = this.heightAt(worldX, worldZ + e) - this.heightAt(worldX, worldZ - e);
    const nx = -dx / (2 * e);
    const nz = -dz / (2 * e);
    const len = Math.sqrt(nx * nx + 1 + nz * nz);
    out.x = nx / len;
    out.y = 1 / len;
    out.z = nz / len;
  }

  tileCentre(tx: number, ty: number): { x: number; z: number } {
    return { x: tx + 0.5 - this.w / 2, z: ty + 0.5 - this.h / 2 };
  }

  tileElevation(tx: number, ty: number): number {
    return this.tileY[ty * this.w + tx] as number;
  }
}
