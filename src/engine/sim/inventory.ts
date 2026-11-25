/**
 * Inventory arithmetic. Every movement of goods in the simulation goes through these
 * helpers, which never create or destroy units except through the declared sources
 * (gathering, harvesting, crafting outputs) and sinks (eating, spoilage, burning,
 * crafting inputs, construction). The property tests audit this ledger.
 */
import { BASKET_CAPACITY, ITEM_COUNT, ITEM_SPECS, Item, Phys, POT_WATER_CAPACITY } from "../model/constants";
import type { Agent, Pile, WorldState } from "../model/types";
import type { Scratch } from "./scratch";
import { pileAt } from "./scratch";

export function carriedWeight(a: Agent): number {
  let wgt = 0;
  for (let i = 0; i < ITEM_COUNT; i++) wgt += (a.inv[i] as number) * (ITEM_SPECS[i]!.weight);
  return wgt;
}

export function carryCapacity(a: Agent): number {
  const strength = a.phys[Phys.strength] as number;
  return 30 + Math.floor(strength / 4) + ((a.inv[Item.basket] as number) > 0 ? BASKET_CAPACITY : 0);
}

/** How many more units of `item` the agent can carry. */
export function roomFor(a: Agent, item: number): number {
  if (item === Item.water) {
    return Math.max(0, (a.inv[Item.pot] as number) * POT_WATER_CAPACITY - (a.inv[Item.water] as number));
  }
  const free = carryCapacity(a) - carriedWeight(a);
  if (free <= 0) return 0;
  return Math.floor(free / ITEM_SPECS[item]!.weight);
}

/** Food-equivalent worth of an inventory (a metric and a baseline heuristic, not a price). */
export function worthOf(inv: readonly number[]): number {
  let v = 0;
  for (let i = 0; i < ITEM_COUNT; i++) v += (inv[i] as number) * ITEM_SPECS[i]!.worth;
  return v;
}

export function foodUnits(inv: readonly number[]): number {
  return (inv[Item.berry] as number) + (inv[Item.root] as number) + (inv[Item.fish] as number) + (inv[Item.ration] as number);
}

export function foodEnergy(inv: readonly number[]): number {
  return (
    (inv[Item.berry] as number) * ITEM_SPECS[Item.berry]!.energy +
    (inv[Item.root] as number) * ITEM_SPECS[Item.root]!.energy +
    (inv[Item.fish] as number) * ITEM_SPECS[Item.fish]!.energy +
    (inv[Item.ration] as number) * ITEM_SPECS[Item.ration]!.energy
  );
}

export function emptyInv(): number[] {
  return new Array<number>(ITEM_COUNT).fill(0);
}

/** Add goods to the pile on a tile, creating it if needed. */
export function dropOnGround(world: WorldState, sc: Scratch, x: number, y: number, item: number, qty: number): void {
  if (qty <= 0) return;
  const tile = y * sc.w + x;
  let k = pileAt(world, sc, tile);
  if (k < 0) {
    const pile: Pile = { x, y, inv: emptyInv() };
    world.piles.push(pile);
    k = world.piles.length - 1;
    sc.pileAt[tile] = k;
  }
  const pile = world.piles[k]!;
  pile.inv[item] = (pile.inv[item] as number) + qty;
}

/** Remove piles that have become empty. */
export function pruneEmptyPiles(world: WorldState, sc: Scratch): void {
  let removed = false;
  for (let k = world.piles.length - 1; k >= 0; k--) {
    const p = world.piles[k]!;
    let any = false;
    for (let i = 0; i < ITEM_COUNT; i++) {
      if ((p.inv[i] as number) > 0) {
        any = true;
        break;
      }
    }
    if (!any) {
      world.piles.splice(k, 1);
      removed = true;
    }
  }
  if (removed) sc.pileDirty = true;
}

/** Grand total of every item in the world (agents, piles, stores, sites' delivered materials excluded). */
export function totalGoods(world: WorldState): number[] {
  const total = emptyInv();
  for (const a of world.agents) {
    for (let i = 0; i < ITEM_COUNT; i++) total[i] = (total[i] as number) + (a.inv[i] as number);
  }
  for (const p of world.piles) {
    for (let i = 0; i < ITEM_COUNT; i++) total[i] = (total[i] as number) + (p.inv[i] as number);
  }
  for (const s of world.structures) {
    if (s.removed) continue;
    for (let i = 0; i < ITEM_COUNT; i++) total[i] = (total[i] as number) + (s.inv[i] as number);
  }
  return total;
}

/** Declare that `qty` units of `item` entered the world (gathered, harvested, crafted, washed ashore). */
export function source(world: WorldState, item: number, qty: number): void {
  if (qty > 0) world.metrics.sources[item] = (world.metrics.sources[item] as number) + qty;
}

/** Declare that `qty` units of `item` left the world (eaten, spoiled, burned, built in, worn out). */
export function sink(world: WorldState, item: number, qty: number): void {
  if (qty > 0) world.metrics.sinks[item] = (world.metrics.sinks[item] as number) + qty;
}

/**
 * Conservation audit: every unit in the world must be accounted for by a declared source
 * and not yet by a declared sink, and no holding may be negative. Returns null when the
 * books balance, otherwise a description of the first discrepancy.
 */
export function auditGoods(world: WorldState): string | null {
  for (const a of world.agents) {
    for (let i = 0; i < ITEM_COUNT; i++) {
      const q = a.inv[i] as number;
      if (!Number.isInteger(q) || q < 0) return `agent ${a.id} holds ${String(q)} of item ${i}`;
    }
    if (!a.alive) {
      for (let i = 0; i < ITEM_COUNT; i++) if ((a.inv[i] as number) !== 0) return `dead agent ${a.id} still holds item ${i}`;
    }
  }
  for (const p of world.piles) {
    for (let i = 0; i < ITEM_COUNT; i++) {
      const q = p.inv[i] as number;
      if (!Number.isInteger(q) || q < 0) return `pile at ${p.x},${p.y} holds ${String(q)} of item ${i}`;
    }
  }
  for (const s of world.structures) {
    for (let i = 0; i < ITEM_COUNT; i++) {
      const q = s.inv[i] as number;
      if (!Number.isInteger(q) || q < 0) return `structure ${s.id} holds ${String(q)} of item ${i}`;
      const miss = s.missing[i] as number;
      if (!Number.isInteger(miss) || miss < 0) return `structure ${s.id} is missing ${String(miss)} of item ${i}`;
    }
    if (s.removed) {
      for (let i = 0; i < ITEM_COUNT; i++) if ((s.inv[i] as number) !== 0) return `removed structure ${s.id} still holds item ${i}`;
    }
  }
  const total = totalGoods(world);
  for (let i = 0; i < ITEM_COUNT; i++) {
    const expected = (world.metrics.sources[i] as number) - (world.metrics.sinks[i] as number);
    if (total[i] !== expected) {
      return `item ${i}: world holds ${String(total[i])} but sources − sinks = ${expected}`;
    }
  }
  for (let n = 0; n < world.nodes.count; n++) {
    const amt = world.nodes.amount[n] as number;
    if (amt < 0 || amt > (world.nodes.cap[n] as number)) return `node ${n} amount ${amt} outside [0, cap]`;
  }
  return null;
}
