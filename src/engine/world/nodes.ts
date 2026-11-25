/**
 * Resource node placement. One node per tile at most; placement is a pure function of
 * the config and terrain. Capacities scale with `richness`, counts with `nodeDensity`.
 */
import { clampInt } from "../core/math";
import { Stream, between, u32, unit } from "../core/rng";
import type { WorldConfig } from "../model/config";
import { Biome, NODE_SPECS, NodeKind, Water } from "../model/constants";
import type { Nodes, Terrain } from "../model/types";

/** Probability (permille) of each node kind on a land tile of a given biome. */
const LAND_TABLE: Record<number, readonly (readonly [number, number])[]> = {
  [Biome.shore]: [
    [NodeKind.clay_bank, 28],
    [NodeKind.reed_bed, 40],
    [NodeKind.root_patch, 18],
  ],
  [Biome.wetland]: [
    [NodeKind.reed_bed, 300],
    [NodeKind.root_patch, 70],
    [NodeKind.clay_bank, 45],
    [NodeKind.berry_bush, 25],
  ],
  [Biome.meadow]: [
    [NodeKind.root_patch, 62],
    [NodeKind.berry_bush, 34],
    [NodeKind.tree, 22],
  ],
  [Biome.forest]: [
    [NodeKind.tree, 470],
    [NodeKind.berry_bush, 62],
    [NodeKind.root_patch, 22],
  ],
  [Biome.scrub]: [
    [NodeKind.berry_bush, 95],
    [NodeKind.root_patch, 40],
    [NodeKind.stone_outcrop, 26],
    [NodeKind.tree, 30],
  ],
  [Biome.highland]: [
    [NodeKind.stone_outcrop, 120],
    [NodeKind.tree, 70],
    [NodeKind.berry_bush, 14],
  ],
};

/** Minimum viable counts so that every generated world contains every material. */
const MINIMUMS: readonly (readonly [number, number])[] = [
  [NodeKind.berry_bush, 14],
  [NodeKind.root_patch, 10],
  [NodeKind.tree, 24],
  [NodeKind.reed_bed, 8],
  [NodeKind.stone_outcrop, 5],
  [NodeKind.clay_bank, 4],
  [NodeKind.fishing_water, 8],
];

/**
 * The two shores of a world with a strait: for every tile, 1 if it lies on shore A, 2 if on
 * shore B, 0 if on neither (water, the ford, an islet). The shores are the two largest land
 * regions. When the scenario endows them unevenly (`shoreSplit` > 0), A is the shore that is
 * poor in timber and food and rich in stone and clay, and which side of the strait that is
 * depends on the seed; otherwise A is simply the western one. A world with no second shore
 * worth the name (under a twentieth of the land) has none.
 */
export function shoreSides(cfg: WorldConfig, terrain: Terrain): { side: Uint8Array; shores: boolean } {
  const N = terrain.w * terrain.h;
  const side = new Uint8Array(N);
  const size = new Map<number, number>();
  const sumX = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    const r = terrain.region[i] as number;
    if (r === 255) continue;
    size.set(r, (size.get(r) ?? 0) + 1);
    sumX.set(r, (sumX.get(r) ?? 0) + (i % terrain.w));
  }
  const largest = [...size.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  const first = largest[0];
  const second = largest[1];
  if (!cfg.strait || !first || !second || second[1] * 20 < terrain.landCount) return { side, shores: false };
  const meanX = (r: number): number => (sumX.get(r) as number) / (size.get(r) as number);
  const west = meanX(first[0]) <= meanX(second[0]) ? first[0] : second[0];
  const east = west === first[0] ? second[0] : first[0];
  const westIsA = cfg.shoreSplit > 0 ? u32(cfg.seed, Stream.Nodes, 0, 90) % 2 === 0 : true;
  const a = westIsA ? west : east;
  const b = westIsA ? east : west;
  for (let i = 0; i < N; i++) {
    const r = terrain.region[i] as number;
    if (r === a) side[i] = 1;
    else if (r === b) side[i] = 2;
  }
  return { side, shores: true };
}

/**
 * How a shore's endowment scales the chance of each kind of node, in permille of the usual
 * chance, for a split of `s` permille.
 *
 * What one shore loses the other gains, so that the island as a whole holds about what an
 * undivided island would: shore A has (1000 − ¾s) of the usual berries and roots and
 * (1000 + s) of the usual stone and clay; shore B has the reverse. Timber is the exception:
 * shore A keeps only (1000 − s) of its trees and shore B gains none, because a forest tile
 * that is nearly always a tree leaves no room for the bushes that grow among them. Reeds and
 * fishing water are the same on both.
 *
 * (A split that only took away — the first version of this — left the island a third short of
 * food: on development seeds half the people on both shores starved in their second year.
 * See scripts/shores.ts and D-041.)
 */
function shoreScale(side: number, kind: number, s: number): number {
  const food = kind === NodeKind.berry_bush || kind === NodeKind.root_patch;
  const mineral = kind === NodeKind.stone_outcrop || kind === NodeKind.clay_bank;
  const part = Math.round((s * 3) / 4);
  if (side === 1) {
    if (kind === NodeKind.tree) return 1000 - s;
    if (food) return 1000 - part;
    if (mineral) return 1000 + s;
  } else if (side === 2) {
    if (food) return 1000 + part;
    if (mineral) return 1000 - s;
  }
  return 1000;
}

export function placeNodes(cfg: WorldConfig, terrain: Terrain): Nodes {
  const { w: W, h: H } = terrain;
  const N = W * H;
  const seed = cfg.seed;
  const density = cfg.nodeDensity;
  const kindAt = new Int8Array(N).fill(-1);
  const split = cfg.shoreSplit > 0 ? shoreSides(cfg, terrain) : null;
  const sideOf = (i: number): number => (split && split.shores ? (split.side[i] as number) : 0);

  const isLand = (i: number) => terrain.water[i] !== Water.sea && terrain.water[i] !== Water.pond;
  const neighbours4 = (i: number, fn: (j: number) => void) => {
    const x = i % W;
    const y = (i - x) / W;
    if (x > 0) fn(i - 1);
    if (x < W - 1) fn(i + 1);
    if (y > 0) fn(i - W);
    if (y < H - 1) fn(i + W);
  };

  for (let i = 0; i < N; i++) {
    const wat = terrain.water[i] as number;
    if (wat === Water.stream) continue; // nothing grows in the stream bed itself
    if (wat === Water.sea) {
      // fishing water: sea tiles directly beside walkable land
      let coast = false;
      neighbours4(i, (j) => {
        if (isLand(j) && (terrain.moveCost[j] as number) > 0) coast = true;
      });
      if (coast && u32(seed, Stream.Nodes, i, 1) % 1000 < Math.round((70 * density) / 1000)) {
        kindAt[i] = NodeKind.fishing_water;
      }
      continue;
    }
    if (wat === Water.pond) {
      if (u32(seed, Stream.Nodes, i, 1) % 1000 < Math.min(900, Math.round((550 * density) / 1000))) {
        kindAt[i] = NodeKind.fishing_water;
      }
      continue;
    }
    const b = terrain.biome[i] as number;
    const table = LAND_TABLE[b];
    if (!table) continue;
    // stream banks and forest edges are richer
    let bank = false;
    let edge = false;
    neighbours4(i, (j) => {
      if (terrain.water[j] === Water.stream || terrain.water[j] === Water.pond) bank = true;
      if (b === Biome.forest && isLand(j) && terrain.biome[j] !== Biome.forest) edge = true;
    });
    const roll = u32(seed, Stream.Nodes, i, 1) % 1000;
    let cum = 0;
    for (const [kind, p0] of table) {
      let p = p0;
      if (bank && (kind === NodeKind.reed_bed || kind === NodeKind.clay_bank)) p = p * 3 + 60;
      if (edge && kind === NodeKind.berry_bush) p = p * 3;
      const scale = split ? shoreScale(sideOf(i), kind, cfg.shoreSplit) : 1000;
      // (with no split the arithmetic is exactly what it was: worlds without one are unchanged)
      cum += scale === 1000 ? Math.round((p * density) / 1000) : Math.round((p * density * scale) / 1_000_000);
      if (roll < cum) {
        kindAt[i] = kind;
        break;
      }
    }
  }

  // enforce minimum counts with deterministic forced placement on the best free tiles
  for (const [kind, min] of MINIMUMS) {
    let count = 0;
    for (let i = 0; i < N; i++) if (kindAt[i] === kind) count++;
    if (count >= min) continue;
    const candidates: { i: number; score: number }[] = [];
    for (let i = 0; i < N; i++) {
      if (kindAt[i] !== -1) continue;
      const wat = terrain.water[i] as number;
      let ok = false;
      if (kind === NodeKind.fishing_water) {
        if (wat === Water.sea) {
          neighbours4(i, (j) => {
            if (isLand(j) && (terrain.moveCost[j] as number) > 0) ok = true;
          });
        }
      } else if (wat === Water.none && (terrain.moveCost[i] as number) > 0) {
        const b = terrain.biome[i] as number;
        const table = LAND_TABLE[b];
        ok = Boolean(table?.some(([k]) => k === kind));
        // any walkable land is acceptable as a last resort
        if (!ok) ok = unit(seed, Stream.Nodes, i, 7) < 0.02;
      }
      if (ok) candidates.push({ i, score: u32(seed, Stream.Nodes, i, 2 + kind) });
    }
    candidates.sort((a, b) => a.score - b.score || a.i - b.i);
    for (let k = 0; k < candidates.length && count < min; k++, count++) {
      kindAt[(candidates[k] as { i: number }).i] = kind;
    }
  }

  let count = 0;
  for (let i = 0; i < N; i++) if (kindAt[i] !== -1) count++;
  const nodes: Nodes = {
    count,
    kind: new Uint8Array(count),
    x: new Uint8Array(count),
    y: new Uint8Array(count),
    cap: new Int16Array(count),
    amount: new Int16Array(count),
    atTile: new Int16Array(N).fill(-1),
  };
  // renewables start between 60% and 100% full; stone and clay, which do not grow back, start full
  let id = 0;
  for (let i = 0; i < N; i++) {
    const kind = kindAt[i] as number;
    if (kind === -1) continue;
    const spec = NODE_SPECS[kind]!;
    const x = i % W;
    const capBase = between(spec.capMin, spec.capMax, seed, Stream.Nodes, i, 20);
    const cap = clampInt(Math.round((capBase * cfg.richness) / 1000), 1, 30000);
    const startPermille = spec.renewable ? 600 + (u32(seed, Stream.Nodes, i, 21) % 401) : 1000;
    nodes.kind[id] = kind;
    nodes.x[id] = x;
    nodes.y[id] = (i - x) / W;
    nodes.cap[id] = cap;
    nodes.amount[id] = clampInt(Math.round((cap * startPermille) / 1000), 0, cap);
    nodes.atTile[i] = id;
    id++;
  }
  return nodes;
}
