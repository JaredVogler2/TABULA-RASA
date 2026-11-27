/**
 * Transient, non-serialized working memory attached to a world: spatial indexes and
 * reusable search buffers. Everything here is derivable from WorldState and never
 * influences results beyond caching, so it is rebuilt lazily after a restore or clone.
 */
import { FIRE_RADIUS, StructureKind } from "../model/constants";
import type { WorldState } from "../model/types";
import { agentCapacity } from "../world/population";

export interface Scratch {
  w: number;
  h: number;
  n: number;
  /** Agents per tile as intrusive linked lists (head per tile, next per agent). */
  head: Int32Array;
  next: Int32Array;
  /** Tile → structure id / pile index, or -1. */
  structAt: Int32Array;
  pileAt: Int32Array;
  structDirty: boolean;
  pileDirty: boolean;
  /** 1 where a lit fire warms the tile (rebuilt every tick). */
  warm: Uint8Array;
  /** A* buffers. */
  g: Float64Array;
  came: Int32Array;
  stamp: Int32Array;
  closed: Int32Array;
  gen: number;
  heapKey: Float64Array;
  heapVal: Int32Array;
  /** BFS buffers. */
  bfsQueue: Int32Array;
  bfsStamp: Int32Array;
  bfsDist: Int16Array;
  bfsGen: number;
  /** Smallest non-zero movement cost on the map (heuristic scale). */
  minCost: number;
  /**
   * Searches for a route that are known to find none, per agent: the tile the search started
   * from, the map knowledge it had (a copy of `mind.seen`), and up to NO_ROUTE_SLOTS goals
   * (tile × 64 + nearness) it failed for with exactly those. See `findPath`: a search is a
   * function of these and of terrain that never changes, so the same question need not be
   * worked out twice. -1 means nothing is remembered for the agent.
   */
  noRouteFrom: Int32Array;
  noRouteKeys: Int32Array;
  noRouteCount: Uint8Array;
  noRouteSeen: (Uint8Array | undefined)[];
  /** Per-tick processing order (agent ids). */
  order: number[];
  orderKeys: number[];
}

/** How many goals without a route are remembered per agent (the oldest gives way to the newest). */
export const NO_ROUTE_SLOTS = 8;

const cache = new WeakMap<WorldState, Scratch>();

/**
 * How many people the per-person tables hold: everyone this world can ever have (the dead keep
 * their place), and never fewer than are there now.
 *
 * It must be the most the world can hold, not "those here and some to spare". People arrive in
 * the middle of a step, after its tables were fetched, and a table one place too short does not
 * fail loudly: reading past the end of a typed array gives `undefined`, and a walk along a tile's
 * list that ends on -1 then never ends. (Sixty-four spare places were enough while at most
 * twenty-four people could ever come; a world that draws newcomers can take in far more.)
 */
function seats(world: WorldState): number {
  return Math.max(64, world.agents.length + 64, agentCapacity(world.config));
}

/** Make the per-person tables longer, keeping what they hold (a world should never need it; see `seats`). */
function grow(world: WorldState, sc: Scratch): void {
  const size = seats(world);
  const next = new Int32Array(size).fill(-1);
  next.set(sc.next);
  sc.next = next;
  const from = new Int32Array(size).fill(-1);
  from.set(sc.noRouteFrom);
  sc.noRouteFrom = from;
  const keys = new Int32Array(size * NO_ROUTE_SLOTS);
  keys.set(sc.noRouteKeys);
  sc.noRouteKeys = keys;
  const count = new Uint8Array(size);
  count.set(sc.noRouteCount);
  sc.noRouteCount = count;
}

export function scratchOf(world: WorldState): Scratch {
  let sc = cache.get(world);
  if (sc && sc.next.length >= world.agents.length) return sc;
  const size = seats(world);
  const w = world.terrain.w;
  const h = world.terrain.h;
  const n = w * h;
  let minCost = 255;
  for (let i = 0; i < n; i++) {
    const c = world.terrain.moveCost[i] as number;
    if (c > 0 && c < minCost) minCost = c;
  }
  if (minCost === 255) minCost = 1;
  sc = {
    w,
    h,
    n,
    head: new Int32Array(n).fill(-1),
    next: new Int32Array(size).fill(-1),
    structAt: new Int32Array(n).fill(-1),
    pileAt: new Int32Array(n).fill(-1),
    structDirty: true,
    pileDirty: true,
    warm: new Uint8Array(n),
    g: new Float64Array(n),
    came: new Int32Array(n),
    stamp: new Int32Array(n),
    closed: new Int32Array(n),
    gen: 0,
    heapKey: new Float64Array(n * 4 + 16),
    heapVal: new Int32Array(n * 4 + 16),
    bfsQueue: new Int32Array(n),
    bfsStamp: new Int32Array(n),
    bfsDist: new Int16Array(n),
    bfsGen: 0,
    minCost,
    noRouteFrom: new Int32Array(size).fill(-1),
    noRouteKeys: new Int32Array(size * NO_ROUTE_SLOTS),
    noRouteCount: new Uint8Array(size),
    noRouteSeen: [],
    order: [],
    orderKeys: [],
  };
  cache.set(world, sc);
  return sc;
}

/** Rebuild the agents-per-tile index from current positions (living agents only). */
export function indexAgents(world: WorldState, sc: Scratch): void {
  if (world.agents.length > sc.next.length) grow(world, sc);
  sc.head.fill(-1);
  const w = sc.w;
  // iterate in reverse so that each tile's list is in ascending id order
  for (let k = world.agents.length - 1; k >= 0; k--) {
    const a = world.agents[k]!;
    if (!a.alive) continue;
    const i = a.y * w + a.x;
    sc.next[a.id] = sc.head[i] as number;
    sc.head[i] = a.id;
  }
}

export function structureAt(world: WorldState, sc: Scratch, tile: number): number {
  if (sc.structDirty) {
    sc.structAt.fill(-1);
    for (const s of world.structures) {
      if (!s.removed) sc.structAt[s.y * sc.w + s.x] = s.id;
    }
    sc.structDirty = false;
  }
  return sc.structAt[tile] as number;
}

export function pileAt(world: WorldState, sc: Scratch, tile: number): number {
  if (sc.pileDirty) {
    sc.pileAt.fill(-1);
    for (let k = 0; k < world.piles.length; k++) {
      const p = world.piles[k]!;
      sc.pileAt[p.y * sc.w + p.x] = k;
    }
    sc.pileDirty = false;
  }
  return sc.pileAt[tile] as number;
}

/** Mark the tiles warmed by lit campfires. */
export function indexWarmth(world: WorldState, sc: Scratch): void {
  sc.warm.fill(0);
  const { w, h } = sc;
  for (const s of world.structures) {
    if (s.removed || !s.complete || s.kind !== StructureKind.campfire || s.fuel <= 0) continue;
    for (let dy = -FIRE_RADIUS; dy <= FIRE_RADIUS; dy++) {
      const yy = s.y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -FIRE_RADIUS; dx <= FIRE_RADIUS; dx++) {
        const xx = s.x + dx;
        if (xx < 0 || xx >= w) continue;
        sc.warm[yy * w + xx] = 1;
      }
    }
  }
}
