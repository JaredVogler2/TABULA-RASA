/**
 * What an agent knows: perception into beliefs, bounded episodic memory, and the
 * queries policies use. Policies read ONLY through this module and the agent's own
 * body state — never the true world.
 */
import { clampInt } from "../core/math";
import { NODE_SPECS, NodeKind, StructureKind } from "../model/constants";
import type { Agent, KnownStructure, MemoryItem, MemoryKind, Structure, WorldState } from "../model/types";
import { droughtActive, sightRadius } from "../world/climate";
import { hasSeen, markSeen } from "../sim/pathfind";
import type { Scratch } from "../sim/scratch";
import { structureAt } from "../sim/scratch";

/** Summary state of a structure as an observer on site would see it. */
export function structureStateCode(s: Structure): number {
  if (!s.complete) return 0;
  if (s.kind === StructureKind.campfire) return s.fuel > 0 ? 2 : 1;
  if (s.kind === StructureKind.store) {
    let total = 0;
    for (const q of s.inv) total += q;
    return total === 0 ? 1 : total < 20 ? 2 : 3;
  }
  if (s.kind === StructureKind.plot) return s.ripeTick >= 0 ? 1 : 2; // 1 growing, 2 ripe
  return 1;
}

export function knownStructure(a: Agent, id: number): KnownStructure | undefined {
  const list = a.mind.structs;
  for (let k = 0; k < list.length; k++) if (list[k]!.id === id) return list[k];
  return undefined;
}

function noteStructure(a: Agent, s: Structure, tick: number): void {
  const list = a.mind.structs;
  let k = knownStructure(a, s.id);
  if (s.removed) {
    if (k) list.splice(list.indexOf(k), 1);
    return;
  }
  if (!k) {
    k = { id: s.id, kind: s.kind, x: s.x, y: s.y, tick, state: 0, bound: -1 };
    list.push(k);
  }
  k.tick = tick;
  k.state = structureStateCode(s);
  k.bound = s.bound;
}

/** Add an episodic memory, evicting the least salient/oldest item when full. */
export function remember(
  world: WorldState,
  a: Agent,
  kind: MemoryKind,
  fields: { who?: number; ref?: number; item?: number; qty?: number; salience: number; src?: number },
): void {
  const mem = a.mind.mem;
  const item: MemoryItem = {
    tick: world.tick,
    kind,
    who: fields.who ?? -1,
    ref: fields.ref ?? -1,
    item: fields.item ?? -1,
    qty: fields.qty ?? 0,
    salience: clampInt(fields.salience, 0, 1000),
    src: fields.src ?? -1,
  };
  const cap = world.config.memoryCapacity;
  if (mem.length >= cap) {
    // retention score = salience decayed by age (half-life ≈ 6 days); evict the weakest
    let worst = 0;
    let worstScore = Infinity;
    for (let k = 0; k < mem.length; k++) {
      const m = mem[k]!;
      const ageDays = (world.tick - m.tick) / 96;
      const score = m.salience / (1 + ageDays / 6);
      if (score < worstScore) {
        worstScore = score;
        worst = k;
      }
    }
    mem.splice(worst, 1);
  }
  mem.push(item);
}

/** Count memories of a kind within the last `window` ticks. */
export function recall(world: WorldState, a: Agent, kind: MemoryKind, window: number): number {
  let n = 0;
  const since = world.tick - window;
  for (const m of a.mind.mem) if (m.kind === kind && m.tick >= since) n++;
  return n;
}

/**
 * Perception: update beliefs from everything within sight. Sleeping agents perceive nothing.
 */
export function perceive(world: WorldState, sc: Scratch, a: Agent): void {
  if (a.asleep) return;
  const { w, h } = sc;
  const m = a.mind;
  const r = sightRadius(world);
  const r2 = r * r + r;
  const tick = world.tick;
  const nodes = world.nodes;
  const drought = droughtActive(world);
  const terrain = world.terrain;
  const y0 = a.y - r < 0 ? 0 : a.y - r;
  const y1 = a.y + r >= h ? h - 1 : a.y + r;
  const x0 = a.x - r < 0 ? 0 : a.x - r;
  const x1 = a.x + r >= w ? w - 1 : a.x + r;
  for (let y = y0; y <= y1; y++) {
    const dy = y - a.y;
    for (let x = x0; x <= x1; x++) {
      const dx = x - a.x;
      if (dx * dx + dy * dy > r2) continue;
      const tile = y * w + x;
      markSeen(m.seen, tile);
      const node = nodes.atTile[tile] as number;
      if (node >= 0) {
        const amount = nodes.amount[node] as number;
        const before = m.nodeAmt[node] as number;
        if (before === -1 && amount > 0) {
          // first sighting of a resource
          remember(world, a, "found", { ref: node, qty: amount, salience: 220 });
        }
        m.nodeAmt[node] = amount;
        m.nodeTick[node] = tick;
        m.nodeSrc[node] = -1;
      }
      const sid = structureAt(world, sc, tile);
      if (sid >= 0) noteStructure(a, world.structures[sid]!, tick);
      if (drought && terrain.fresh[tile] === 1) m.droughtSeen = tick;
      for (let other = sc.head[tile] as number; other !== -1; other = sc.next[other] as number) {
        if (other === a.id) continue;
        m.metX[other] = x;
        m.metY[other] = y;
        m.metTick[other] = tick;
      }
    }
  }
  // structures believed to be nearby but no longer there are forgotten when their tile is in view
  for (let k = m.structs.length - 1; k >= 0; k--) {
    const ks = m.structs[k]!;
    const dx = ks.x - a.x;
    const dy = ks.y - a.y;
    if (dx * dx + dy * dy > r2) continue;
    const s = world.structures[ks.id];
    if (!s || s.removed) m.structs.splice(k, 1);
  }
}

/** Does this agent currently believe a drought is on? (Belief lapses after four days without evidence.) */
export function believesDrought(world: WorldState, a: Agent): boolean {
  return a.mind.droughtSeen >= 0 && world.tick - a.mind.droughtSeen < 4 * 96;
}

/** Is tile a place where this agent believes it can drink? */
export function believedDrinkable(world: WorldState, a: Agent, tile: number): boolean {
  if (!hasSeen(a.mind.seen, tile)) return false;
  const level = world.terrain.fresh[tile] as number;
  if (level === 0) return false;
  return believesDrought(world, a) ? level === 2 : true;
}

export interface NodeChoice {
  node: number;
  score: number;
}

/**
 * Best known node among `kinds` for this agent: believed stock discounted by distance
 * and by how stale the belief is. Returns -1 if nothing worthwhile is known.
 */
export function bestKnownNode(world: WorldState, a: Agent, kinds: readonly number[], minAmount = 1): NodeChoice {
  const nodes = world.nodes;
  const m = a.mind;
  const tick = world.tick;
  let best = -1;
  let bestScore = 0;
  for (let n = 0; n < nodes.count; n++) {
    const amt = m.nodeAmt[n] as number;
    if (amt < minAmount) continue;
    const kind = nodes.kind[n] as number;
    if (!kinds.includes(kind)) continue;
    const dx = (nodes.x[n] as number) - a.x;
    const dy = (nodes.y[n] as number) - a.y;
    const dist = (dx < 0 ? -dx : dx) > (dy < 0 ? -dy : dy) ? (dx < 0 ? -dx : dx) : dy < 0 ? -dy : dy;
    const ageDays = (tick - (m.nodeTick[n] as number)) / 96;
    const spec = NODE_SPECS[kind]!;
    // expected units obtainable, discounted for staleness (renewables may have been eaten or regrown)
    const confidence = spec.renewable ? 1 / (1 + ageDays / 3) : 1 / (1 + ageDays / 30);
    const expected = Math.min(amt, 8) * (0.35 + 0.65 * confidence);
    // second-hand information is discounted by trust in the source
    const src = m.nodeSrc[n] as number;
    const trust = src >= 0 ? (m.trust[src] as number) / 1000 : 1;
    const score = (expected * trust * 100) / (6 + dist * 2.2 + spec.work);
    if (score > bestScore || (score === bestScore && best >= 0 && n < best)) {
      bestScore = score;
      best = n;
    }
  }
  return { node: best, score: bestScore };
}

export const FOOD_NODE_KINDS: readonly number[] = [NodeKind.berry_bush, NodeKind.root_patch, NodeKind.fishing_water];

/** Nearest known complete structure of a kind satisfying `ok`, by Chebyshev distance. */
export function nearestKnownStructure(
  a: Agent,
  kind: number,
  maxDist: number,
  ok: (k: KnownStructure) => boolean = () => true,
): KnownStructure | undefined {
  let best: KnownStructure | undefined;
  let bestD = maxDist + 1;
  for (const ks of a.mind.structs) {
    if (ks.kind !== kind || !ok(ks)) continue;
    const dx = ks.x > a.x ? ks.x - a.x : a.x - ks.x;
    const dy = ks.y > a.y ? ks.y - a.y : a.y - ks.y;
    const d = dx > dy ? dx : dy;
    if (d < bestD || (d === bestD && best !== undefined && ks.id < best.id)) {
      bestD = d;
      best = ks;
    }
  }
  return best;
}
