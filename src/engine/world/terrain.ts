/**
 * Island generation: height field, sea level, drainage, streams and ponds, moisture,
 * biomes, fertility, movement cost and land regions. Pure function of the config.
 */
import { canonicalJson } from "../core/canonical";
import { sha256Text } from "../core/hash";
import { clamp, clampInt, smoothstep } from "../core/math";
import { Stream, hash3, unit } from "../core/rng";
import type { WorldConfig } from "../model/config";
import { BIOME_MOVE_COST, Biome, STREAM_MOVE_COST, Water } from "../model/constants";
import type { Terrain } from "../model/types";
import { fbm, perlin, ridged } from "./noise";

const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

/** Minimal binary min-heap over (key, value) pairs with deterministic tie-breaking on value. */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pk = k[p] as number;
      const pv = v[p] as number;
      if (pk < key || (pk === key && pv <= val)) break;
      k[i] = pk;
      v[i] = pv;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0] as number;
    const lastK = k.pop() as number;
    const lastV = v.pop() as number;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        const r = c + 1;
        if (r < n) {
          const ck = k[c] as number;
          const rk = k[r] as number;
          if (rk < ck || (rk === ck && (v[r] as number) < (v[c] as number))) c = r;
        }
        const ck = k[c] as number;
        const cv = v[c] as number;
        if (lastK < ck || (lastK === ck && lastV <= cv)) break;
        k[i] = ck;
        v[i] = cv;
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

export interface TerrainExtras {
  /** Raw continuous height in arbitrary units (sea level subtracted), for diagnostics. */
  raw: Float64Array;
  /** Filled (drainage-corrected) height. */
  filled: Float64Array;
  /** Downstream tile index for each land tile (-1 for sea / sinks at the coast). */
  downstream: Int32Array;
  /** 0..1 moisture. */
  moisture: Float32Array;
  /** Ford tiles (strait scenarios), as tile indices. */
  fords: number[];
}

export function generateTerrain(cfg: WorldConfig): { terrain: Terrain; extras: TerrainExtras } {
  const W = cfg.size;
  const H = cfg.size;
  const N = W * H;
  const seed = cfg.seed;
  const sT = hash3(seed, Stream.Terrain, 1);
  const relief = cfg.relief / 1000;

  // ── 1. raw height
  const raw = new Float64Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x + 0.5) / W - 0.5;
      const ny = (y + 0.5) / H - 0.5;
      // domain warp for an irregular coastline
      const wx = nx + 0.085 * fbm(sT + 11, nx * 3.1, ny * 3.1, 3);
      const wy = ny + 0.085 * fbm(sT + 23, nx * 3.1 + 5.2, ny * 3.1 + 1.3, 3);
      const d = Math.sqrt(wx * wx + wy * wy) * 2; // 0 centre … ~1 at edge midpoints
      const coast = d + 0.16 * fbm(sT + 37, nx * 4.3, ny * 4.3, 4);
      const mask = 1 - smoothstep(0.42, 0.98, coast);
      const base = 0.5 + 0.5 * fbm(sT + 51, nx * 3.4, ny * 3.4, 5);
      const ridge = ridged(sT + 67, nx * 2.3 + 3.7, ny * 2.3 + 9.1, 4);
      const hills = 0.5 + 0.5 * fbm(sT + 83, nx * 7.5, ny * 7.5, 3);
      let h = mask * (0.2 + 0.42 * base + 0.5 * relief * ridge * ridge * mask + 0.1 * hills) - (1 - mask) * 0.45;
      // hard falloff near the border so the island never touches the edge of the world
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (edge < 3) h -= (3 - edge) * 0.5;
      raw[y * W + x] = h;
    }
  }

  // ── 2. sea level by percentile so that land fraction matches the config
  const sorted = Float64Array.from(raw).sort();
  const seaIdx = clampInt(Math.floor(N * (1 - cfg.landFraction / 1000)), 0, N - 1);
  const sea = sorted[seaIdx] as number;
  for (let i = 0; i < N; i++) raw[i] = (raw[i] as number) - sea;

  // ── 3. optional strait with a single ford ("Two Shores")
  const fords: number[] = [];
  if (cfg.strait) {
    const fordY = clampInt(Math.floor(H * (0.35 + 0.3 * unit(seed, Stream.Terrain, 901))), 6, H - 7);
    for (let y = 0; y < H; y++) {
      const ny = y / H;
      const cx = W / 2 + W * 0.09 * perlin(sT + 97, ny * 3.0, 0.5) + W * 0.03 * perlin(sT + 98, ny * 9.0, 2.5);
      for (let x = 0; x < W; x++) {
        const dist = Math.abs(x + 0.5 - cx);
        if (dist < 1.6) {
          const i = y * W + x;
          if ((raw[i] as number) > 0) {
            if (Math.abs(y - fordY) <= 1 && dist < 1.6) {
              raw[i] = 0.004; // shallow ford: barely above water
              fords.push(i);
            } else {
              raw[i] = -0.06 - 0.02 * (1.6 - dist);
            }
          }
        }
      }
    }
  }

  // ── 4. integer heights
  let maxH = 1e-9;
  let minH = -1e-9;
  for (let i = 0; i < N; i++) {
    const v = raw[i] as number;
    if (v > maxH) maxH = v;
    if (v < minH) minH = v;
  }
  const height = new Int16Array(N);
  const isLand = new Uint8Array(N);
  let landCount = 0;
  for (let i = 0; i < N; i++) {
    const v = raw[i] as number;
    if (v > 0) {
      height[i] = clampInt(1 + Math.round((999 * v) / maxH), 1, 1000);
      isLand[i] = 1;
      landCount++;
    } else {
      height[i] = clampInt(-1 - Math.round((999 * v) / minH), -1000, -1);
    }
  }

  // ── 5. drainage: priority-flood from the sea so every land tile has a downhill route
  const filled = new Float64Array(N);
  const done = new Uint8Array(N);
  const heap = new MinHeap();
  for (let i = 0; i < N; i++) {
    if (!isLand[i]) {
      filled[i] = raw[i] as number;
      done[i] = 1;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!isLand[i]) continue;
      let coastal = false;
      for (let d = 0; d < 8 && !coastal; d++) {
        const xx = x + (DX8[d] as number);
        const yy = y + (DY8[d] as number);
        if (xx < 0 || yy < 0 || xx >= W || yy >= H || !isLand[yy * W + xx]) coastal = true;
      }
      if (coastal) {
        filled[i] = raw[i] as number;
        done[i] = 1;
        heap.push(filled[i] as number, i);
      }
    }
  }
  const EPS = 1e-5;
  while (heap.size > 0) {
    const i = heap.pop();
    const x = i % W;
    const y = (i - x) / W;
    for (let d = 0; d < 8; d++) {
      const xx = x + (DX8[d] as number);
      const yy = y + (DY8[d] as number);
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (done[j]) continue;
      done[j] = 1;
      const fj = Math.max(raw[j] as number, (filled[i] as number) + EPS);
      filled[j] = fj;
      heap.push(fj, j);
    }
  }

  // ── 6. flow direction and accumulation
  const downstream = new Int32Array(N).fill(-1);
  const order: number[] = [];
  for (let i = 0; i < N; i++) if (isLand[i]) order.push(i);
  order.sort((a, b) => (filled[b] as number) - (filled[a] as number) || a - b);
  for (const i of order) {
    const x = i % W;
    const y = (i - x) / W;
    let best = -1;
    let bestH = filled[i] as number;
    for (let d = 0; d < 8; d++) {
      const xx = x + (DX8[d] as number);
      const yy = y + (DY8[d] as number);
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      const fj = isLand[j] ? (filled[j] as number) : -1e9; // the sea always wins
      if (fj < bestH) {
        bestH = fj;
        best = j;
      }
    }
    downstream[i] = best;
  }
  const acc = new Float64Array(N);
  for (const i of order) {
    // orographic rainfall: wetter uplands
    acc[i] = (acc[i] as number) + 1 + (2.2 * (raw[i] as number)) / maxH;
    const j = downstream[i] as number;
    if (j >= 0 && isLand[j]) acc[j] = (acc[j] as number) + (acc[i] as number);
  }

  // ── 7. streams: the top share of accumulated flow
  const water = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!isLand[i]) water[i] = Water.sea;
  const accSorted = order.map((i) => acc[i] as number).sort((a, b) => a - b);
  const streamShare = 0.052;
  const thIdx = clampInt(Math.floor(accSorted.length * (1 - streamShare)), 0, Math.max(0, accSorted.length - 1));
  const streamTh = Math.max(accSorted[thIdx] ?? 1e9, 9);
  for (const i of order) {
    if ((acc[i] as number) >= streamTh && !fords.includes(i)) water[i] = Water.stream;
  }

  // ── 8. ponds: the deepest filled depressions (bounded count)
  const pondCandidates: { i: number; depth: number }[] = [];
  for (const i of order) {
    const depth = (filled[i] as number) - (raw[i] as number);
    if (depth > 0.012 * maxH && water[i] !== Water.stream) pondCandidates.push({ i, depth });
  }
  pondCandidates.sort((a, b) => b.depth - a.depth || a.i - b.i);
  const maxPonds = Math.floor(landCount * 0.014);
  for (let k = 0; k < pondCandidates.length && k < maxPonds; k++) {
    water[(pondCandidates[k] as { i: number }).i] = Water.pond;
  }
  // A world without any pond gets a small spring-fed pool at the head of its largest stream,
  // so that some fresh water always survives a drought.
  let pondCount = 0;
  for (let i = 0; i < N; i++) if (water[i] === Water.pond) pondCount++;
  if (pondCount === 0) {
    let best = -1;
    let bestScore = -1;
    for (const i of order) {
      if (water[i] !== Water.stream) continue;
      const score = (raw[i] as number) / maxH;
      if (score > 0.25 && score < 0.6 && (acc[i] as number) > bestScore) {
        bestScore = acc[i] as number;
        best = i;
      }
    }
    if (best >= 0) water[best] = Water.pond;
  }

  // ── 9. where fresh water can be drunk (2 = perennial, 1 = seasonal, 0 = none)
  const perennialTh = accSorted[clampInt(Math.floor(accSorted.length * 0.985), 0, Math.max(0, accSorted.length - 1))] ?? 1e9;
  const fresh = new Uint8Array(N);
  const markFresh = (i: number, level: number) => {
    const x = i % W;
    const y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (!isLand[j] || water[j] === Water.pond) continue;
        if ((fresh[j] as number) < level) fresh[j] = level;
      }
    }
  };
  for (let i = 0; i < N; i++) {
    if (water[i] === Water.pond) markFresh(i, 2);
    else if (water[i] === Water.stream) markFresh(i, (acc[i] as number) >= perennialTh ? 2 : 1);
  }

  // ── 10. moisture: distance to fresh water, softened by noise
  const dist = new Int16Array(N).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < N; i++) {
    if (water[i] === Water.stream || water[i] === Water.pond) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q] as number;
    const x = i % W;
    const y = (i - x) / W;
    const dcur = dist[i] as number;
    if (dcur >= 14) continue;
    for (let d = 0; d < 8; d += 2) {
      const xx = x + (DX8[d] as number);
      const yy = y + (DY8[d] as number);
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (dist[j] !== -1 || !isLand[j]) continue;
      dist[j] = dcur + 1;
      queue.push(j);
    }
  }
  const moisture = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!isLand[i]) continue;
    const x = i % W;
    const y = (i - x) / W;
    const dd = dist[i] === -1 ? 14 : (dist[i] as number);
    const near = 1 - dd / 14;
    const n = 0.5 + 0.5 * fbm(sT + 131, (x / W) * 6.5, (y / H) * 6.5, 3);
    moisture[i] = clamp(0.62 * near + 0.5 * n - 0.08, 0, 1);
  }

  // ── 11. biomes and fertility
  // Composition is set by percentile so that every seed yields a comparable mix of habitats:
  // the most rugged sixth of the land is highland, about a third of the rest is forest, and so on.
  const biome = new Uint8Array(N);
  const fertility = new Uint8Array(N);
  const slopeOf = new Float64Array(N);
  const nearSea = new Uint8Array(N);
  const forestScore = new Float64Array(N);
  const landTiles: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!isLand[i]) {
        biome[i] = Biome.sea;
        continue;
      }
      landTiles.push(i);
      let slope = 0;
      for (let d = 0; d < 8; d++) {
        const xx = x + (DX8[d] as number);
        const yy = y + (DY8[d] as number);
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (!isLand[j]) {
          nearSea[i] = 1;
          continue;
        }
        const sl = Math.abs((height[j] as number) - (height[i] as number));
        if (sl > slope) slope = sl;
      }
      slopeOf[i] = slope;
      const fn = 0.5 + 0.5 * fbm(sT + 151, (x / W) * 5.2 + 1.7, (y / H) * 5.2 + 4.1, 4);
      forestScore[i] = fn + 0.45 * (moisture[i] as number);
    }
  }
  const assigned = new Uint8Array(N);
  const takeTop = (pool: number[], share: number, score: (i: number) => number, b: number): void => {
    const sortedPool = pool.slice().sort((p, q) => score(q) - score(p) || p - q);
    const count = Math.floor(pool.length * share);
    for (let k = 0; k < count; k++) {
      const i = sortedPool[k] as number;
      biome[i] = b;
      assigned[i] = 1;
    }
  };
  // highland: the most rugged 17% (elevation plus steepness), streams excluded
  takeTop(
    landTiles.filter((i) => water[i] === Water.none),
    0.17,
    (i) => (height[i] as number) / 1000 + (slopeOf[i] as number) / 420,
    Biome.highland,
  );
  // shore: low land touching the sea
  for (const i of landTiles) {
    if (!assigned[i] && nearSea[i] && (height[i] as number) < 140) {
      biome[i] = Biome.shore;
      assigned[i] = 1;
    }
  }
  // wetland: the wettest low ground close to fresh water (at most 6% of land)
  {
    const pool = landTiles.filter((i) => !assigned[i] && (height[i] as number) < 300 && dist[i] !== -1 && (dist[i] as number) <= 2);
    const sortedPool = pool.sort((p, q) => (moisture[q] as number) - (moisture[p] as number) || p - q);
    const count = Math.min(sortedPool.length, Math.floor(landTiles.length * 0.06));
    for (let k = 0; k < count; k++) {
      const i = sortedPool[k] as number;
      biome[i] = Biome.wetland;
      assigned[i] = 1;
    }
  }
  // forest: a third of what remains, by a blend of patchy noise and moisture
  takeTop(
    landTiles.filter((i) => !assigned[i]),
    0.4,
    (i) => forestScore[i] as number,
    Biome.forest,
  );
  // scrub: the driest fifth of the rest; meadow: everything else
  takeTop(
    landTiles.filter((i) => !assigned[i]),
    0.22,
    (i) => -(moisture[i] as number),
    Biome.scrub,
  );
  for (const i of landTiles) {
    if (!assigned[i]) biome[i] = Biome.meadow;
    const b = biome[i] as number;
    const e = (height[i] as number) / 1000;
    const m = moisture[i] as number;
    const fertBase = b === Biome.highland ? 0.12 : b === Biome.shore ? 0.25 : b === Biome.scrub ? 0.4 : b === Biome.forest ? 0.55 : 0.62;
    fertility[i] = clampInt(Math.round(100 * clamp(fertBase + 0.5 * m - 0.3 * e, 0, 1)), 0, 100);
  }

  // ── 12. movement cost
  const moveCost = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!isLand[i] || water[i] === Water.pond) {
      moveCost[i] = 0;
      continue;
    }
    let base = water[i] === Water.stream ? STREAM_MOVE_COST : (BIOME_MOVE_COST[biome[i] as number] as number);
    if (fords.includes(i)) base = 5;
    moveCost[i] = clampInt(Math.round((base * cfg.movementCost) / 1000), 1, 40);
  }

  // ── 13. land regions (connected components of walkable land, fords excluded)
  const region = new Uint8Array(N).fill(255);
  let regions = 0;
  for (let start = 0; start < N; start++) {
    if (moveCost[start] === 0 || region[start] !== 255 || fords.includes(start)) continue;
    if (regions >= 250) break;
    const stack = [start];
    region[start] = regions;
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % W;
      const y = (i - x) / W;
      for (let d = 0; d < 8; d++) {
        const xx = x + (DX8[d] as number);
        const yy = y + (DY8[d] as number);
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (moveCost[j] === 0 || region[j] !== 255 || fords.includes(j)) continue;
        region[j] = regions;
        stack.push(j);
      }
    }
    regions++;
  }

  const flow = new Uint16Array(N);
  for (let i = 0; i < N; i++) flow[i] = clampInt(Math.round(acc[i] as number), 0, 65535);

  const hash = sha256Text(
    canonicalJson({ w: W, h: H, height, water, biome, fertility, moveCost, fresh, region, flow, landCount }),
  );
  const terrain: Terrain = { w: W, h: H, height, water, biome, fertility, moveCost, fresh, region, flow, landCount, hash };
  return { terrain, extras: { raw, filled, downstream, moisture, fords } };
}

/** Tile index helpers. */
export function tileIndex(t: Terrain, x: number, y: number): number {
  return y * t.w + x;
}
export function inBounds(t: Terrain, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < t.w && y < t.h;
}
