/**
 * Path-finding over what an agent knows.
 *
 * Agents plan routes through tiles they have seen; tiles they have never seen are
 * optimistically assumed walkable, and the route is re-planned when reality disagrees.
 * No agent ever reads terrain it has not observed.
 */
import { octile10 } from "../core/math";
import type { Agent, WorldState } from "../model/types";
import type { Scratch } from "./scratch";

const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

export function hasSeen(seen: Uint8Array, tile: number): boolean {
  return ((seen[tile >> 3] as number) & (1 << (tile & 7))) !== 0;
}
export function markSeen(seen: Uint8Array, tile: number): void {
  seen[tile >> 3] = (seen[tile >> 3] as number) | (1 << (tile & 7));
}

/** Cost for an agent to enter a tile given its knowledge: 0 = known impassable. */
function knownCost(world: WorldState, sc: Scratch, seen: Uint8Array, tile: number): number {
  if (!hasSeen(seen, tile)) return sc.minCost > 3 ? sc.minCost : 3;
  return world.terrain.moveCost[tile] as number;
}

function heapPush(sc: Scratch, size: number, key: number, val: number): number {
  const K = sc.heapKey;
  const V = sc.heapVal;
  let i = size;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if ((K[p] as number) <= key) break;
    K[i] = K[p] as number;
    V[i] = V[p] as number;
    i = p;
  }
  K[i] = key;
  V[i] = val;
  return size + 1;
}

function heapPop(sc: Scratch, size: number): number {
  const K = sc.heapKey;
  const V = sc.heapVal;
  const n = size - 1;
  const lastK = K[n] as number;
  const lastV = V[n] as number;
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= n) break;
    if (c + 1 < n && (K[c + 1] as number) < (K[c] as number)) c++;
    if (lastK <= (K[c] as number)) break;
    K[i] = K[c] as number;
    V[i] = V[c] as number;
    i = c;
  }
  K[i] = lastK;
  V[i] = lastV;
  return n;
}

/**
 * A* from the agent's tile to any tile within `near` (Chebyshev) of (tx, ty).
 * Returns the route as tile indices with the NEXT step LAST (so callers can pop),
 * an empty array if already there, or null if no route is known.
 */
export function findPath(world: WorldState, sc: Scratch, agent: Agent, tx: number, ty: number, near: number): number[] | null {
  const { w, h, n } = sc;
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
  const seen = agent.mind.seen;
  const start = agent.y * w + agent.x;
  const target = ty * w + tx;
  const dx0 = agent.x > tx ? agent.x - tx : tx - agent.x;
  const dy0 = agent.y > ty ? agent.y - ty : ty - agent.y;
  if ((dx0 > dy0 ? dx0 : dy0) <= near) return [];
  if (near === 0 && knownCost(world, sc, seen, target) === 0) return null;

  const gen = ++sc.gen;
  const hScale = sc.minCost;
  let size = 0;
  sc.g[start] = 0;
  sc.came[start] = -1;
  sc.stamp[start] = gen;
  // key packs f (major) and tile index (minor) so ties break deterministically
  size = heapPush(sc, size, octile10(agent.x, agent.y, tx, ty) * hScale * 32768 + start, start);
  let expansions = 0;
  const maxKey = sc.heapKey.length - 9;

  while (size > 0) {
    const cur = sc.heapVal[0] as number;
    size = heapPop(sc, size);
    if (sc.closed[cur] === gen) continue;
    sc.closed[cur] = gen;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const ddx = cx > tx ? cx - tx : tx - cx;
    const ddy = cy > ty ? cy - ty : ty - cy;
    if ((ddx > ddy ? ddx : ddy) <= near && (cur === start || knownCost(world, sc, seen, cur) > 0)) {
      const path: number[] = [];
      let p = cur;
      while (p !== start && p !== -1) {
        path.push(p);
        p = sc.came[p] as number;
      }
      return path;
    }
    if (++expansions > n) break;
    const gCur = sc.g[cur] as number;
    for (let d = 0; d < 8; d++) {
      const nx = cx + (DX8[d] as number);
      const ny = cy + (DY8[d] as number);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (sc.closed[ni] === gen) continue;
      const cost = knownCost(world, sc, seen, ni);
      if (cost === 0) continue;
      const diagonal = (d & 1) === 1;
      if (diagonal) {
        // no cutting corners around known obstacles
        if (knownCost(world, sc, seen, cy * w + nx) === 0 || knownCost(world, sc, seen, ny * w + cx) === 0) continue;
      }
      const ng = gCur + cost * (diagonal ? 14 : 10);
      if (sc.stamp[ni] === gen && ng >= (sc.g[ni] as number)) continue;
      sc.stamp[ni] = gen;
      sc.g[ni] = ng;
      sc.came[ni] = cur;
      if (size >= maxKey) return null;
      size = heapPush(sc, size, (ng + octile10(nx, ny, tx, ty) * hScale) * 32768 + ni, ni);
    }
  }
  return null;
}

/**
 * Breadth-first search outward from the agent over tiles it knows to be walkable.
 * Returns the first tile for which `accept(tile)` is true, or -1. Neighbour expansion
 * starts at `heading` so that ties are broken toward the agent's current bearing.
 */
export function nearestKnown(
  world: WorldState,
  sc: Scratch,
  agent: Agent,
  maxDist: number,
  heading: number,
  accept: (tile: number) => boolean,
): number {
  const { w, h } = sc;
  const seen = agent.mind.seen;
  const gen = ++sc.bfsGen;
  const start = agent.y * w + agent.x;
  let qh = 0;
  let qt = 0;
  sc.bfsQueue[qt++] = start;
  sc.bfsStamp[start] = gen;
  sc.bfsDist[start] = 0;
  while (qh < qt) {
    const cur = sc.bfsQueue[qh++] as number;
    if (accept(cur)) return cur;
    const dist = sc.bfsDist[cur] as number;
    if (dist >= maxDist) continue;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let k = 0; k < 8; k++) {
      const d = (heading + k) & 7;
      const nx = cx + (DX8[d] as number);
      const ny = cy + (DY8[d] as number);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (sc.bfsStamp[ni] === gen) continue;
      if (!hasSeen(seen, ni) || (world.terrain.moveCost[ni] as number) === 0) continue;
      sc.bfsStamp[ni] = gen;
      sc.bfsDist[ni] = dist + 1;
      sc.bfsQueue[qt++] = ni;
    }
  }
  return -1;
}

/** True if any of the 8 neighbours of `tile` (in bounds) has not been seen. */
export function isFrontier(sc: Scratch, seen: Uint8Array, tile: number): boolean {
  const { w, h } = sc;
  const x = tile % w;
  const y = (tile - x) / w;
  for (let d = 0; d < 8; d++) {
    const nx = x + (DX8[d] as number);
    const ny = y + (DY8[d] as number);
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (!hasSeen(seen, ny * w + nx)) return true;
  }
  return false;
}

export { DX8, DY8 };
