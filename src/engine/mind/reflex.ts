/**
 * Reflex policy: a competent survival floor.
 *
 * It looks only at the agent's own body, its beliefs and what it currently perceives,
 * and serves the most pressing need with the best option it knows about. It is the
 * whole policy of `reflex` agents, the urgent-need layer of `planner` agents, and the
 * labelled fallback for externally controlled (model-driven) agents with no valid plan.
 *
 * Nothing in here refers to other agents' private state or to anything the agent has
 * not seen, heard or felt.
 */
import { ITEM_SPECS, Item, NodeKind, StructureKind, TICKS_PER_DAY, Trait, Water } from "../model/constants";
import type { Agent, Intent, WorldState } from "../model/types";
import { calendarAt, daylight } from "../world/climate";
import { foodUnits, roomFor } from "../sim/inventory";
import { hasSeen, isFrontier, nearestKnown } from "../sim/pathfind";
import { pileAt, structureAt, type Scratch } from "../sim/scratch";
import { FOOD_NODE_KINDS, believedDrinkable, bestKnownNode, nearestKnownStructure } from "./knowledge";

export interface Plan {
  intents: Intent[];
  goal: string;
  why: string;
}

/** Need levels below which the reflex layer pre-empts whatever else was planned. */
export const URGENT = { hydration: 170, energy: 140, warmth: 210, rest: 70 } as const;

export function urgentNeed(a: Agent): "" | "drink" | "eat" | "warm" | "sleep" {
  if (a.hydration < URGENT.hydration) return "drink";
  if (a.warmth < URGENT.warmth) return "warm";
  if (a.energy < URGENT.energy) return "eat";
  if (a.rest < URGENT.rest) return "sleep";
  return "";
}

/** Ticks until daylight returns (bounded), from the agent's innate sense of the day. */
export function ticksUntilMorning(world: WorldState): number {
  const cal = calendarAt(world.config, world.tick);
  for (let t = 1; t <= 60; t++) {
    if (daylight(cal.yearPos, (cal.tickOfDay + t) % TICKS_PER_DAY) >= 350) return t;
  }
  return 60;
}

/** The most perishable food the agent carries (eat that first), or -1. */
export function mostPerishableFood(a: Agent): number {
  const order = [Item.fish, Item.berry, Item.root, Item.ration];
  for (const item of order) if ((a.inv[item] as number) > 0) return item;
  return -1;
}

export function knowsWater(world: WorldState, sc: Scratch, a: Agent): boolean {
  if ((a.inv[Item.water] as number) > 0) return true;
  return nearestKnown(world, sc, a, 60, a.mind.heading, (t) => believedDrinkable(world, a, t)) >= 0;
}

/** A tile on or beside the agent where a structure could be founded, or -1. */
export function freeBuildTile(world: WorldState, sc: Scratch, a: Agent): number {
  const { w, h } = sc;
  const t = world.terrain;
  const order = [0, 0, 1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, 1, 1, -1, -1, -1];
  for (let k = 0; k < order.length; k += 2) {
    const x = a.x + (order[k] as number);
    const y = a.y + (order[k + 1] as number);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const tile = y * w + x;
    if (!hasSeen(a.mind.seen, tile)) continue;
    if ((t.moveCost[tile] as number) === 0 || t.water[tile] !== Water.none) continue;
    if ((world.nodes.atTile[tile] as number) >= 0) continue;
    if (structureAt(world, sc, tile) >= 0) continue;
    return tile;
  }
  return -1;
}

function eatPlan(a: Agent): Intent[] | null {
  const item = mostPerishableFood(a);
  if (item < 0) return null;
  const per = ITEM_SPECS[item]!.energy;
  const qty = Math.max(1, Math.min(a.inv[item] as number, Math.ceil((940 - a.energy) / per)));
  return [{ k: "eat", item, qty }];
}

function warmthPlan(world: WorldState, sc: Scratch, a: Agent, night: boolean): Plan | null {
  const tile = a.y * sc.w + a.x;
  if (sc.warm[tile]) {
    return { intents: [night ? { k: "rest", ticks: Math.min(40, ticksUntilMorning(world)) } : { k: "wait", ticks: 6 }], goal: "warm", why: "by_fire" };
  }
  const lit = nearestKnownStructure(a, StructureKind.campfire, 14, (k) => k.state === 2);
  if (lit) return { intents: [{ k: "goto", x: lit.x, y: lit.y, near: 1 }, { k: "wait", ticks: 4 }], goal: "warm", why: "go_to_fire" };
  const wood = a.inv[Item.wood] as number;
  const stone = a.inv[Item.stone] as number;
  const cold = nearestKnownStructure(a, StructureKind.campfire, 10, (k) => k.state === 1);
  if (cold && wood >= 1) {
    return { intents: [{ k: "refuel", structure: cold.id, qty: Math.min(wood, 4) }, { k: "wait", ticks: 4 }], goal: "warm", why: "relight" };
  }
  if (wood >= 3 && stone >= 2) {
    const spot = freeBuildTile(world, sc, a);
    if (spot >= 0) {
      const x = spot % sc.w;
      return { intents: [{ k: "build", kind: StructureKind.campfire, x, y: (spot - x) / sc.w }], goal: "warm", why: "build_fire" };
    }
  }
  const shelter = nearestKnownStructure(a, StructureKind.shelter, 10, (k) => k.state >= 1);
  if (shelter && night) {
    return { intents: [{ k: "goto", x: shelter.x, y: shelter.y, near: 1 }, { k: "rest", ticks: Math.min(40, ticksUntilMorning(world)) }], goal: "warm", why: "shelter" };
  }
  if (wood < 3) {
    const tree = bestKnownNode(world, a, [NodeKind.tree]);
    if (tree.node >= 0 && roomFor(a, Item.wood) > 0) {
      return { intents: [{ k: "gather", node: tree.node, qty: Math.min(4, 4 - wood + 1) }], goal: "warm", why: "fetch_wood" };
    }
  }
  if (stone < 2) {
    const rock = bestKnownNode(world, a, [NodeKind.stone_outcrop]);
    if (rock.node >= 0 && roomFor(a, Item.stone) > 0) {
      return { intents: [{ k: "gather", node: rock.node, qty: 2 - stone }], goal: "warm", why: "fetch_stone" };
    }
  }
  return null;
}

function hungerPlan(world: WorldState, sc: Scratch, a: Agent, tile: number, why: string): Plan {
  const eat = eatPlan(a);
  if (eat) return { intents: eat, goal: "eat", why };
  const k = pileAt(world, sc, tile);
  if (k >= 0) {
    for (const item of [Item.ration, Item.fish, Item.root, Item.berry]) {
      if ((world.piles[k]!.inv[item] as number) > 0 && roomFor(a, item) > 0) {
        return { intents: [{ k: "pickup", item, qty: 3 }], goal: "eat", why: "found_food" };
      }
    }
  }
  const food = bestKnownNode(world, a, FOOD_NODE_KINDS);
  if (food.node >= 0) return { intents: [{ k: "gather", node: food.node, qty: 3 }], goal: "forage", why };
  return { intents: [{ k: "explore" }], goal: "seek_food", why: "no_food_known" };
}

function sleepPlan(world: WorldState, sc: Scratch, a: Agent, tile: number, night: boolean): Plan {
  // the short nights of summer do not restore a hard day's work: the tired sleep in
  const ticks = night ? Math.min(56, ticksUntilMorning(world) + (a.rest < 450 ? 12 : 2)) : 16;
  const intents: Intent[] = [];
  const shelter = nearestKnownStructure(a, StructureKind.shelter, 8, (k) => k.state >= 1);
  const fire = sc.warm[tile] ? undefined : nearestKnownStructure(a, StructureKind.campfire, 6, (k) => k.state === 2);
  if (shelter) intents.push({ k: "goto", x: shelter.x, y: shelter.y, near: 1 });
  else if (fire) intents.push({ k: "goto", x: fire.x, y: fire.y, near: 1 });
  intents.push({ k: "rest", ticks });
  return { intents, goal: "sleep", why: night ? "night" : "tired" };
}

function thirstPlan(world: WorldState, sc: Scratch, a: Agent, freshHere: boolean, why: string): Plan {
  if (freshHere || knowsWater(world, sc, a)) return { intents: [{ k: "drink" }], goal: "drink", why };
  return { intents: [{ k: "explore" }], goal: "seek_water", why: "no_water_known" };
}

/** Decide what to do next from needs and beliefs alone. Always returns a non-empty plan. */
export function reflexDecide(world: WorldState, sc: Scratch, a: Agent): Plan {
  const m = a.mind;
  const w = sc.w;
  const tile = a.y * w + a.x;
  const night = world.climate.light < 250;
  const freshHere = believedDrinkable(world, a, tile);

  // ── the single most dangerous deficit, if any, is served first
  const urgent = urgentNeed(a);
  if (urgent === "drink") return thirstPlan(world, sc, a, freshHere, "parched");
  if (urgent === "warm") {
    const plan = warmthPlan(world, sc, a, night);
    if (plan) return plan;
  }
  if (urgent === "eat") return hungerPlan(world, sc, a, tile, "starving");
  if (urgent === "sleep") return sleepPlan(world, sc, a, tile, night);

  // ── thirst
  if (a.hydration < 430 || (a.hydration < 740 && freshHere)) {
    return thirstPlan(world, sc, a, freshHere, a.hydration < 430 ? "thirsty" : "passing_water");
  }

  // ── cold comes before hunger when it is the more dangerous deficit
  if (a.warmth < 470 && a.warmth <= a.energy) {
    const plan = warmthPlan(world, sc, a, night);
    if (plan) return plan;
  }

  // ── hunger
  if (a.energy < 540) return hungerPlan(world, sc, a, tile, "hungry");

  if (a.warmth < 470) {
    const plan = warmthPlan(world, sc, a, night);
    if (plan) return plan;
  }

  // ── sleep: at night, or as the light fails for those already weary
  const dim = world.climate.light < 420;
  if (a.rest < 270 || (night && a.rest < 830) || (dim && a.rest < 520)) return sleepPlan(world, sc, a, tile, night || dim);

  // ── top up while it is cheap
  if (a.energy < 780) {
    const eat = eatPlan(a);
    if (eat) return { intents: eat, goal: "eat", why: "peckish" };
  }
  if (a.hydration < 600 && knowsWater(world, sc, a)) return { intents: [{ k: "drink" }], goal: "drink", why: "top_up" };

  // ── keep a small buffer of food in hand
  const target = 2 + Math.floor((a.traits[Trait.prudence] as number) / 25);
  const have = foodUnits(a.inv);
  if (have < target) {
    const food = bestKnownNode(world, a, FOOD_NODE_KINDS, 2);
    if (food.node >= 0 && food.score > 6) {
      return { intents: [{ k: "gather", node: food.node, qty: target - have + 1 }], goal: "forage", why: "buffer" };
    }
  }

  // ── nothing pressing: look around
  const frontier = nearestKnown(world, sc, a, 40, m.heading, (t) => isFrontier(sc, m.seen, t));
  if (frontier >= 0 && frontier !== tile && !night) return { intents: [{ k: "explore" }], goal: "explore", why: "curious" };
  return { intents: [{ k: "wait", ticks: night ? 8 : 5 }], goal: "idle", why: "content" };
}
