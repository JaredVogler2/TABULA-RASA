/**
 * What one agent can perceive of other people right now.
 *
 * This is the single boundary through which any mind — baseline planner or language
 * model — learns about others at a glance: where they are, whether they are asleep or
 * visibly unwell, a coarse band for how hungry and how cold they look, and whether they
 * are carrying a load. Exact needs, inventories, plans, beliefs and trust are never visible.
 */
import { needBand } from "../model/constants";
import type { Agent, WorldState } from "../model/types";
import { hearingRadius, sightRadius } from "../world/climate";
import { carriedWeight } from "../sim/inventory";
import { pileAt, type Scratch } from "../sim/scratch";

export interface SeenAgent {
  id: number;
  x: number;
  y: number;
  /** Chebyshev distance from the observer. */
  dist: number;
  /** 0 fine · 1 uneasy · 2 suffering · 3 critical */
  hunger: 0 | 1 | 2 | 3;
  cold: 0 | 1 | 2 | 3;
  asleep: boolean;
  ill: boolean;
  /** Visibly carrying a substantial load. */
  laden: boolean;
  /** Within earshot right now. */
  audible: boolean;
}

/** Other living agents within sight, nearest first (ties by id). Sleeping observers see no one. */
export function visibleAgents(world: WorldState, sc: Scratch, a: Agent): SeenAgent[] {
  if (a.asleep) return [];
  const r = sightRadius(world);
  const hear = hearingRadius(world);
  const { w, h } = sc;
  const out: SeenAgent[] = [];
  const y0 = a.y - r < 0 ? 0 : a.y - r;
  const y1 = a.y + r >= h ? h - 1 : a.y + r;
  const x0 = a.x - r < 0 ? 0 : a.x - r;
  const x1 = a.x + r >= w ? w - 1 : a.x + r;
  const r2 = r * r + r;
  for (let y = y0; y <= y1; y++) {
    const dy = y - a.y;
    for (let x = x0; x <= x1; x++) {
      const dx = x - a.x;
      if (dx * dx + dy * dy > r2) continue;
      for (let id = sc.head[y * w + x] as number; id !== -1; id = sc.next[id] as number) {
        if (id === a.id) continue;
        const o = world.agents[id]!;
        if (!o.alive) continue;
        const adx = dx < 0 ? -dx : dx;
        const ady = dy < 0 ? -dy : dy;
        const dist = adx > ady ? adx : ady;
        out.push({
          id,
          x,
          y,
          dist,
          hunger: needBand(o.energy),
          cold: needBand(o.warmth),
          asleep: o.asleep,
          ill: o.ill > 0,
          laden: carriedWeight(o) >= 12,
          audible: dist <= hear,
        });
      }
    }
  }
  out.sort((p, q) => p.dist - q.dist || p.id - q.id);
  return out;
}

export interface SeenPile {
  x: number;
  y: number;
  dist: number;
  /** Units per item id lying there (things on the ground are plainly visible). */
  inv: readonly number[];
}

/** Piles of goods on the ground within sight, nearest first. */
export function visiblePiles(world: WorldState, sc: Scratch, a: Agent): SeenPile[] {
  if (a.asleep || world.piles.length === 0) return [];
  const r = sightRadius(world);
  const r2 = r * r + r;
  const out: SeenPile[] = [];
  for (const p of world.piles) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    if (dx * dx + dy * dy > r2) continue;
    if (pileAt(world, sc, p.y * sc.w + p.x) < 0) continue;
    const adx = dx < 0 ? -dx : dx;
    const ady = dy < 0 ? -dy : dy;
    out.push({ x: p.x, y: p.y, dist: adx > ady ? adx : ady, inv: p.inv });
  }
  out.sort((p, q) => p.dist - q.dist || p.y - q.y || p.x - q.x);
  return out;
}
