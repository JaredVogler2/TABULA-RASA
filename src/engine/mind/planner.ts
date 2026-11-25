/**
 * Bounded-rational planner: the deliberate layer of the non-LLM BASELINE mind.
 *
 * What it is. Each time an agent with no pressing need has nothing queued, it weighs a
 * fixed repertoire of projects — provision, preserve, make a tool, light or feed a fire,
 * raise a shelter or a store, plant, reap, give, repay, tell — by expected benefit per
 * tick from what it believes, and adopts the best one as a short queue of intents.
 *
 * What bounds it. It sees only its own body, its beliefs, its memories and the people in
 * sight (`senses.ts`). It looks one project ahead. It estimates travel by straight-line
 * distance and yields by rule of thumb. It senses the season only through the temperatures
 * it has lived through. It never reads another agent's state and never reads the world's
 * true stocks.
 *
 * Why two agents differ. Every threshold below is shifted by a named trait, skill or
 * experience counter, so a difference in behaviour traces to a difference in the agent:
 *   industry      → how small a return is still worth working for
 *   prudence      → how many days of food to hold; whether to build before the cold bites
 *   patience      → how much stock to leave on a bush; appetite for slow investments
 *   generosity    → willingness to give and to answer requests
 *   sociability   → telling others where food is, passing on news of others
 *   conformity    → repaying promises when it hurts; leaving others' crops alone
 *   curiosity     → exploring when nothing presses
 *   trust, debts  → who gets help; what second-hand reports are worth
 *
 * What it is not. It contains no institutions: no group, role, rule, vote or pact is ever
 * proposed here. Anything collective that appears under this policy (a shared fire, a
 * shelter several people built) is the by-product of individual choices.
 */
import { chance, Stream } from "../core/rng";
import {
  FOOD_ITEMS,
  ITEM_SPECS,
  Item,
  NODE_SPECS,
  NodeKind,
  RECIPES,
  STRUCTURE_SPECS,
  Skill,
  StructureKind,
  TICKS_PER_DAY,
  Trait,
  Water,
} from "../model/constants";
import type { Agent, Intent, KnownStructure, Mind, WorldState } from "../model/types";
import { calendarAt } from "../world/climate";
import { carriedWeight, carryCapacity, foodEnergy, roomFor } from "../sim/inventory";
import { hasSeen, isFrontier, nearestKnown } from "../sim/pathfind";
import type { Scratch } from "../sim/scratch";
import { FOOD_NODE_KINDS, bestKnownNode, recall } from "./knowledge";
import type { Plan } from "./reflex";
import { visibleAgents, visiblePiles, type SeenAgent } from "./senses";
import { sensesCold } from "./social";
import { civicBusiness, civicDuty, civicLeisure, drawRation, offerCandidate, offerMade } from "./civic";

/** Slots of `mind.cool` (ticks until which a kind of act is held back). */
export const COOL = { inform: 0, ask: 1, give: 2, gossip: 3, promise: 4, explore: 5, backoff: 6, rehome: 7 } as const;

/** Energy an adult burns in a day of mixed work (the planner's rule of thumb, not an engine constant). */
export const DAILY_ENERGY = 310;
/** Longest plan the planner will queue. */
export const MAX_PLAN = 6;

interface Candidate {
  score: number;
  plan: Plan;
}

interface Ctx {
  world: WorldState;
  sc: Scratch;
  a: Agent;
  m: Mind;
  tick: number;
  tile: number;
  cold: 0 | 1 | 2;
  dusk: boolean;
  foodE: number;
  targetE: number;
  seen: SeenAgent[];
  industry: number;
  prudence: number;
  patience: number;
  generosity: number;
  sociability: number;
  conformity: number;
  curiosity: number;
}

const cheb = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax > bx ? ax - bx : bx - ax;
  const dy = ay > by ? ay - by : by - ay;
  return dx > dy ? dx : dy;
};

/** Rule-of-thumb ticks to walk a straight-line distance. */
const walk = (d: number): number => d * 3;

const NODE_FOR_ITEM: Record<number, number> = {
  [Item.wood]: NodeKind.tree,
  [Item.stone]: NodeKind.stone_outcrop,
  [Item.fiber]: NodeKind.reed_bed,
  [Item.clay]: NodeKind.clay_bank,
};

function workTime(a: Agent, kind: number): number {
  const spec = NODE_SPECS[kind]!;
  return Math.max(1, Math.round((spec.work * (1000 - Math.floor((a.skills[spec.skill] as number) * 0.35))) / 1000));
}

/**
 * The share of a renewable patch this agent chooses to leave standing, in permille of the
 * fullest it has seen that patch (restraint is individual: the impatient strip a bush bare).
 */
export function restraintShare(a: Agent, world: WorldState): number {
  if (a.energy < 420) return 0; // necessity overrides
  const patience = a.traits[Trait.patience] as number;
  let share = patience >= 62 ? 400 : patience >= 38 ? 300 : patience >= 16 ? 150 : 0;
  // having found patches stripped bare teaches the prudent to leave more
  if ((a.traits[Trait.prudence] as number) >= 45 && recall(world, a, "empty", 6 * TICKS_PER_DAY) >= 2) share += 100;
  return share;
}

/** Units to leave on a particular node. */
export function restraint(a: Agent, world: WorldState, node: number): number {
  const share = restraintShare(a, world);
  if (share === 0) return 0;
  if (!NODE_SPECS[world.nodes.kind[node] as number]!.renewable) return 0;
  return Math.ceil(((a.mind.nodeMax[node] as number) * share) / 1000);
}

/** Days of food this agent wants to hold, from temperament and from what its own winters taught it. */
export function stockDays(a: Agent): number {
  const prudence = a.traits[Trait.prudence] as number;
  let days = 1 + prudence / 34;
  const cold = sensesCold(a);
  if (cold > 0) days += 1.5 + prudence / 28 + Math.min(3, a.mind.wintersSeen * 2) + Math.min(2, a.mind.hungerDays / 4);
  return days;
}

function ctxOf(world: WorldState, sc: Scratch, a: Agent): Ctx {
  const cal = calendarAt(world.config, world.tick);
  const light = world.climate.light;
  const t = a.traits;
  // what can be held is bounded by what can be carried: roughly 85 energy per unit of weight
  const carryE = Math.floor(carryCapacity(a) * 0.62) * 85;
  return {
    world,
    sc,
    a,
    m: a.mind,
    tick: world.tick,
    tile: a.y * sc.w + a.x,
    cold: sensesCold(a),
    dusk: cal.tickOfDay > 26 && light < 460,
    foodE: foodEnergy(a.inv),
    targetE: Math.min(carryE, Math.round(DAILY_ENERGY * stockDays(a))),
    seen: visibleAgents(world, sc, a),
    industry: t[Trait.industry] as number,
    prudence: t[Trait.prudence] as number,
    patience: t[Trait.patience] as number,
    generosity: t[Trait.generosity] as number,
    sociability: t[Trait.sociability] as number,
    conformity: t[Trait.conformity] as number,
    curiosity: t[Trait.curiosity] as number,
  };
}

function plan(goal: string, why: string, ...intents: Intent[]): Plan {
  return { goal, why, intents: intents.slice(0, MAX_PLAN) };
}

// ───────────────────────── beliefs about places

function known(c: Ctx, kind: number, maxDist: number, cx: number, cy: number, ok: (k: KnownStructure) => boolean = () => true): KnownStructure | undefined {
  let best: KnownStructure | undefined;
  let bestD = maxDist + 1;
  for (const ks of c.m.structs) {
    if (ks.kind !== kind || !ok(ks)) continue;
    const d = cheb(ks.x, ks.y, cx, cy);
    if (d < bestD || (d === bestD && best !== undefined && ks.id < best.id)) {
      bestD = d;
      best = ks;
    }
  }
  return best;
}

/** A seen, free, buildable tile within `radius` of a point (nearest first), or -1. */
function siteNear(c: Ctx, cx: number, cy: number, radius: number, minFertility: number): number {
  const { w, h } = c.sc;
  const terrain = c.world.terrain;
  let best = -1;
  let bestD = 1 << 30;
  for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x++) {
      const tile = y * w + x;
      if (!hasSeen(c.m.seen, tile)) continue;
      if ((terrain.moveCost[tile] as number) === 0 || terrain.water[tile] !== Water.none) continue;
      if ((c.world.nodes.atTile[tile] as number) >= 0) continue;
      if ((terrain.fertility[tile] as number) < minFertility) continue;
      if (c.m.structs.some((k) => k.x === x && k.y === y)) continue;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestD) {
        bestD = d;
        best = tile;
      }
    }
  }
  return best;
}

function hasHome(c: Ctx): boolean {
  return c.m.homeX >= 0;
}

/** Settle on a base: beside a fire someone has already made if one is known, else here if water is near. */
function chooseHome(c: Ctx): void {
  const { a, m, world, sc } = c;
  if (m.homeX >= 0) {
    // a home with nothing to eat for days is abandoned
    if (c.tick >= (m.cool[COOL.rehome] as number) && m.hungerDays > 0 && c.foodE < DAILY_ENERGY / 2) {
      let food = false;
      for (let n = 0; n < world.nodes.count && !food; n++) {
        if ((m.nodeAmt[n] as number) <= 0 || !FOOD_NODE_KINDS.includes(world.nodes.kind[n] as number)) continue;
        if (cheb(world.nodes.x[n] as number, world.nodes.y[n] as number, m.homeX, m.homeY) <= 12) food = true;
      }
      if (!food) {
        m.homeX = -1;
        m.homeY = -1;
      }
      m.cool[COOL.rehome] = c.tick + 2 * TICKS_PER_DAY;
    }
    return;
  }
  const fire = known(c, StructureKind.campfire, 16, a.x, a.y);
  if (fire) {
    m.homeX = fire.x;
    m.homeY = fire.y;
    return;
  }
  const water = nearestKnown(world, sc, a, 6, m.heading, (t) => (world.terrain.fresh[t] as number) > 0 && hasSeen(m.seen, t));
  if (water >= 0 && siteNear(c, a.x, a.y, 1, 0) >= 0) {
    m.homeX = a.x;
    m.homeY = a.y;
  }
}

// ───────────────────────── gathering

interface Fetch {
  intent: Intent;
  time: number;
  units: number;
}

/** Plan to obtain `qty` of a raw material from the best node this agent knows. */
function fetch(c: Ctx, item: number, qty: number): Fetch | null {
  const kind = NODE_FOR_ITEM[item];
  if (kind === undefined) return null;
  const choice = bestKnownNode(c.world, c.a, [kind]);
  if (choice.node < 0) return null;
  const n = choice.node;
  const room = roomFor(c.a, item);
  const units = Math.min(qty, room, c.m.nodeAmt[n] as number);
  if (units <= 0) return null;
  const spec = NODE_SPECS[kind]!;
  const per = spec.baseYield * (spec.tool >= 0 && (c.a.inv[spec.tool] as number) > 0 ? 2 : 1);
  const d = cheb(c.world.nodes.x[n] as number, c.world.nodes.y[n] as number, c.a.x, c.a.y);
  return { intent: { k: "gather", node: n, qty: units }, time: walk(d) + Math.ceil(units / per) * workTime(c.a, kind) + 1, units };
}

function provision(c: Ctx): Candidate | null {
  const deficit = c.targetE - c.foodE;
  if (deficit <= 0) return null;
  const { world, a, m } = c;
  const nodes = world.nodes;
  const horizon = Math.min(4, stockDays(a));
  // What rots within days is gathered for today only; a stock is built of what keeps. Fish
  // counts as keeping when there is a fire to smoke it over.
  const freshE = (a.inv[Item.berry] as number) * ITEM_SPECS[Item.berry]!.energy + (a.inv[Item.fish] as number) * ITEM_SPECS[Item.fish]!.energy;
  const freshRoom = Math.max(0, Math.round(DAILY_ENERGY * 1.1) - freshE);
  const canSmoke = known(c, StructureKind.campfire, 12, a.x, a.y, (k) => k.state >= 1) !== undefined;
  let best = -1;
  let bestScore = 0;
  let bestTake = 0;
  for (let n = 0; n < nodes.count; n++) {
    const amt = m.nodeAmt[n] as number;
    if (amt < 1) continue;
    const kind = nodes.kind[n] as number;
    if (!FOOD_NODE_KINDS.includes(kind)) continue;
    const spec = NODE_SPECS[kind]!;
    const avail = amt - restraint(a, world, n);
    if (avail <= 0) continue;
    const item = spec.yields;
    const unitE = ITEM_SPECS[item]!.energy;
    const perishable = ITEM_SPECS[item]!.spoil >= 100 && !(item === Item.fish && canSmoke);
    const wantE = perishable ? Math.min(deficit, freshRoom) : deficit;
    if (wantE < unitE / 2) continue;
    const take = Math.min(avail, roomFor(a, item), Math.max(1, Math.ceil(wantE / unitE)), 8);
    if (take <= 0) continue;
    let per = spec.baseYield * (spec.tool >= 0 && (a.inv[spec.tool] as number) > 0 ? 2 : 1);
    if (kind === NodeKind.fishing_water) per *= 0.55 + (a.skills[Skill.fish] as number) / 2500;
    const d = cheb(nodes.x[n] as number, nodes.y[n] as number, a.x, a.y);
    const time = walk(d) + Math.ceil(take / per) * workTime(a, kind) + 2;
    // food that will spoil before it is eaten is worth less as stock; the first day's worth is not discounted
    const spoil = ITEM_SPECS[item]!.spoil / 1000;
    const soon = Math.min(take * unitE, Math.max(0, DAILY_ENERGY - c.foodE));
    const later = take * unitE - soon;
    const kept = soon + later * Math.max(0.12, 1 - spoil * horizon * 0.6);
    const ageDays = (c.tick - (m.nodeTick[n] as number)) / TICKS_PER_DAY;
    const conf = 1 / (1 + ageDays / 3);
    const src = m.nodeSrc[n] as number;
    const faith = src >= 0 ? (m.trust[src] as number) / 1000 : 1;
    const score = (kept * (0.4 + 0.6 * conf) * faith) / time;
    if (score > bestScore) {
      bestScore = score;
      best = n;
      bestTake = take;
    }
  }
  if (best < 0) return null;
  return { score: bestScore, plan: plan("provision", c.cold > 0 ? "cold_coming" : "stock", { k: "gather", node: best, qty: bestTake }) };
}

/** Turn fresh fish into rations at a fire so that it keeps. */
function preserve(c: Ctx): Candidate | null {
  const { a } = c;
  const fish = a.inv[Item.fish] as number;
  if (fish < 2) return null;
  const fire = known(c, StructureKind.campfire, 12, a.x, a.y, (k) => k.state === 2);
  if (!fire) return null;
  const intents: Intent[] = [];
  let time = walk(cheb(fire.x, fire.y, a.x, a.y));
  let wood = a.inv[Item.wood] as number;
  if (wood < 1) {
    const f = fetch(c, Item.wood, 2);
    if (!f) return null;
    intents.push(f.intent);
    time += f.time;
    wood = f.units;
  }
  const batches = Math.min(Math.floor(fish / 2), wood, 3);
  if (batches <= 0) return null;
  intents.push({ k: "goto", x: fire.x, y: fire.y, near: 1 });
  for (let b = 0; b < batches; b++) intents.push({ k: "craft", recipe: 4 });
  time += batches * RECIPES[4]!.work + 2;
  // value: what would otherwise rot (a third of fresh fish is lost each day)
  const saved = batches * 2 * ITEM_SPECS[Item.fish]!.energy * 0.55;
  return { score: (saved * (0.7 + c.prudence / 160)) / time, plan: plan("preserve", "fish_spoils", ...intents) };
}

// ───────────────────────── tools

function craftPlan(c: Ctx, recipeId: number, value: number, goal: string, why: string): Candidate | null {
  const recipe = RECIPES[recipeId]!;
  if (recipe.needsFire) return null;
  const { a } = c;
  const intents: Intent[] = [];
  let time = recipe.work;
  let weight = 0;
  for (const [item, qty] of recipe.inputs) {
    const lack = qty - (a.inv[item] as number);
    if (lack <= 0) continue;
    const f = fetch(c, item, lack);
    if (!f || f.units < lack) return null;
    intents.push(f.intent);
    time += f.time;
    weight += lack * ITEM_SPECS[item]!.weight;
  }
  if (weight > carryCapacity(a) - carriedWeight(a)) return null;
  intents.push({ k: "craft", recipe: recipeId });
  return { score: value / (time + 2), plan: plan(goal, why, ...intents) };
}

function tools(c: Ctx): Candidate | null {
  const { a, m, world } = c;
  const drive = 0.6 + c.industry / 125;
  let best: Candidate | null = null;
  const consider = (cand: Candidate | null) => {
    if (cand && (!best || cand.score > best.score)) best = cand;
  };
  if ((a.inv[Item.basket] as number) === 0) consider(craftPlan(c, 2, 700 * drive, "make_basket", "carry_more"));
  if ((a.inv[Item.spear] as number) === 0) {
    let fishing = false;
    for (let n = 0; n < world.nodes.count && !fishing; n++) {
      if ((m.nodeAmt[n] as number) > 0 && world.nodes.kind[n] === NodeKind.fishing_water) fishing = true;
    }
    if (fishing) consider(craftPlan(c, 1, 900 * drive * (0.8 + (a.skills[Skill.fish] as number) / 2000), "make_spear", "fish_better"));
  }
  if ((a.inv[Item.axe] as number) === 0 && (c.cold > 0 || c.m.coldNights > 0)) consider(craftPlan(c, 0, 520 * drive, "make_axe", "need_wood"));
  return best;
}

// ───────────────────────── fire, shelter, store, plot

/** Bring what a site lacks, then build. Works for founding a new site and for joining one. */
function buildProject(c: Ctx, kind: number, x: number, y: number, missing: readonly number[], value: number, goal: string, why: string): Candidate | null {
  const { a } = c;
  const spec = STRUCTURE_SPECS[kind]!;
  const intents: Intent[] = [];
  let time = walk(cheb(x, y, a.x, a.y)) + 2;
  let lacking = false;
  let carrying = false;
  let free = carryCapacity(a) - carriedWeight(a);
  for (const [item] of spec.materials) {
    const need = missing[item] as number;
    if (need <= 0) continue;
    const have = a.inv[item] as number;
    if (have > 0) carrying = true;
    const lack = need - have;
    if (lack <= 0) continue;
    lacking = true;
    const can = Math.min(lack, Math.floor(free / ITEM_SPECS[item]!.weight));
    if (can <= 0) continue;
    const f = fetch(c, item, can);
    if (!f) continue;
    intents.push(f.intent);
    time += f.time;
    free -= f.units * ITEM_SPECS[item]!.weight;
    if (intents.length >= 2) break; // one trip: at most two kinds of material
  }
  // nothing in hand to add, nothing obtainable: the project is out of reach for now
  if (lacking && intents.length === 0 && !carrying) return null;
  intents.push({ k: "build", kind, x, y });
  let total = 0;
  for (const [item] of spec.materials) total += Math.max(0, (missing[item] as number) - (a.inv[item] as number));
  // remaining trips and the labour itself
  time += total * 5 + spec.labor;
  return { score: value / time, plan: plan(goal, why, ...intents) };
}

function fullNeeds(kind: number): number[] {
  const need = new Array<number>(ITEM_SPECS.length).fill(0);
  for (const [item, qty] of STRUCTURE_SPECS[kind]!.materials) need[item] = qty;
  return need;
}

function fire(c: Ctx): Candidate | null {
  const { a, m } = c;
  const cx = hasHome(c) ? m.homeX : a.x;
  const cy = hasHome(c) ? m.homeY : a.y;
  const near = known(c, StructureKind.campfire, 8, cx, cy);
  const wantsCook = (a.inv[Item.fish] as number) >= 2;
  const worth = ([120, 700, 1500][c.cold] as number) + (wantsCook ? 300 : 0) + Math.min(600, m.coldNights * 150);
  if (near) {
    if (near.state === 0) {
      return buildProject(c, StructureKind.campfire, near.x, near.y, near.missing ?? fullNeeds(StructureKind.campfire), worth, "build_fire", "finish_fire");
    }
    // an unlit hearth is relit when warmth or cooking is wanted; a burning one is fed at dusk in the cold
    const relight = near.state === 1 && (c.cold > 0 || wantsCook || c.dusk);
    const feed = near.state === 2 && c.dusk && c.cold > 0 && c.tick - near.tick > 8;
    if (!relight && !feed) return null;
    const intents: Intent[] = [];
    let time = walk(cheb(near.x, near.y, a.x, a.y)) + 2;
    let wood = a.inv[Item.wood] as number;
    if (wood < 2) {
      const f = fetch(c, Item.wood, 4 - wood);
      if (!f && wood === 0) return null;
      if (f) {
        intents.push(f.intent);
        time += f.time;
        wood += f.units;
      }
    }
    intents.push({ k: "refuel", structure: near.id, qty: Math.min(wood, 4) });
    const value = relight ? ([90, 520, 1100][c.cold] as number) + (wantsCook ? 300 : 0) : 420 * c.cold;
    return { score: value / time, plan: plan("tend_fire", relight ? "relight" : "feed_for_night", ...intents) };
  }
  if (c.cold === 0 && !wantsCook && m.coldNights === 0 && c.prudence < 70) return null;
  const site = siteNear(c, cx, cy, 2, 0);
  if (site < 0) return null;
  const x = site % c.sc.w;
  return buildProject(c, StructureKind.campfire, x, (site - x) / c.sc.w, fullNeeds(StructureKind.campfire), worth * (0.7 + c.prudence / 160), "build_fire", c.cold > 0 ? "cold_coming" : "hearth");
}

function shelter(c: Ctx): Candidate | null {
  const { m } = c;
  if (!hasHome(c)) return null;
  if (c.cold === 0 && m.coldNights < 2 && m.wintersSeen === 0) return null;
  if (known(c, StructureKind.shelter, 6, m.homeX, m.homeY, (k) => k.state >= 1)) return null;
  const worth = (([300, 1000, 2600][c.cold] as number) + Math.min(900, m.coldNights * 220)) * (0.5 + c.patience / 100);
  const site = known(c, StructureKind.shelter, 10, m.homeX, m.homeY, (k) => k.state === 0);
  if (site) {
    // an unfinished shelter nearby is cheaper to finish than a new one is to start, whoever began it
    return buildProject(c, StructureKind.shelter, site.x, site.y, site.missing ?? fullNeeds(StructureKind.shelter), worth * 1.5, "build_shelter", "join_work");
  }
  if (c.patience < 22) return null;
  const tile = siteNear(c, m.homeX, m.homeY, 2, 0);
  if (tile < 0) return null;
  const x = tile % c.sc.w;
  return buildProject(c, StructureKind.shelter, x, (tile - x) / c.sc.w, fullNeeds(StructureKind.shelter), worth, "build_shelter", c.cold > 0 ? "cold_coming" : "cold_nights");
}

function store(c: Ctx): Candidate | null {
  const { m } = c;
  if (!hasHome(c) || c.prudence < 52) return null;
  if (known(c, StructureKind.store, 8, m.homeX, m.homeY, (k) => k.state >= 1)) return null;
  const pressed = c.cold > 0 || c.foodE > 2.5 * DAILY_ENERGY;
  if (!pressed) return null;
  const worth = (900 * c.prudence) / 70;
  const site = known(c, StructureKind.store, 10, m.homeX, m.homeY, (k) => k.state === 0);
  if (site) return buildProject(c, StructureKind.store, site.x, site.y, site.missing ?? fullNeeds(StructureKind.store), worth * 1.5, "build_store", "join_work");
  const tile = siteNear(c, m.homeX, m.homeY, 2, 0);
  if (tile < 0) return null;
  const x = tile % c.sc.w;
  return buildProject(c, StructureKind.store, x, (tile - x) / c.sc.w, fullNeeds(StructureKind.store), worth, "build_store", "keep_food");
}

/** Put by what would otherwise spoil in the hand, in a store this agent helped to build (or trusts by habit). */
function stash(c: Ctx): Candidate | null {
  const { a, m, world } = c;
  if (!hasHome(c)) return null;
  const st = known(c, StructureKind.store, 6, m.homeX, m.homeY, (k) => k.state >= 1 && k.bound < 0);
  if (!st) return null;
  const mine = world.structures[st.id]?.contributors.includes(a.id) ?? false;
  if (!mine && c.conformity < 60) return null;
  const surplus = c.foodE - Math.round(1.2 * DAILY_ENERGY);
  if (surplus < 200) return null;
  const intents: Intent[] = [];
  let left = surplus;
  for (const item of [Item.ration, Item.root, Item.fish, Item.berry]) {
    const have = a.inv[item] as number;
    if (have <= 0 || left <= 0) continue;
    const q = Math.min(have, Math.floor(left / ITEM_SPECS[item]!.energy));
    if (q <= 0) continue;
    intents.push({ k: "deposit", structure: st.id, item, qty: q });
    left -= q * ITEM_SPECS[item]!.energy;
    if (intents.length >= 3) break;
  }
  if (intents.length === 0) return null;
  const time = walk(cheb(st.x, st.y, a.x, a.y)) + intents.length + 1;
  return { score: ((surplus - left) * 0.25 * (0.6 + c.prudence / 120)) / time, plan: plan("stash", "keeps_longer", ...intents) };
}

function ownPlots(c: Ctx): number {
  let n = 0;
  for (const ks of c.m.structs) {
    if (ks.kind === StructureKind.plot && c.world.structures[ks.id]?.founder === c.a.id) n++;
  }
  return n;
}

function plot(c: Ctx): Candidate | null {
  const { a, m, world } = c;
  if (!world.config.planting || !hasHome(c) || c.patience < 28) return null;
  // nothing sown once the days begin to cool would ripen before the cold stops it growing
  if (c.cold > 0) return null;
  const roots = a.inv[Item.root] as number;
  if (roots < 1 || c.foodE - ITEM_SPECS[Item.root]!.energy < DAILY_ENERGY * 0.5) return null;
  if (ownPlots(c) >= 3 + Math.floor(c.industry / 25) + Math.floor(c.prudence / 50)) return null;
  const tile = siteNear(c, m.homeX, m.homeY, 4, 35);
  if (tile < 0) return null;
  const x = tile % c.sc.w;
  const y = (tile - x) / c.sc.w;
  const time = walk(cheb(x, y, a.x, a.y)) + STRUCTURE_SPECS[StructureKind.plot]!.labor + 3;
  // five roots in twelve days for one today; the patient discount the wait less
  const value = 5 * ITEM_SPECS[Item.root]!.energy * (0.25 + c.patience / 110) - ITEM_SPECS[Item.root]!.energy;
  if (value <= 0) return null;
  return { score: value / time, plan: plan("plant", "sow_for_later", { k: "build", kind: StructureKind.plot, x, y }) };
}

function reap(c: Ctx): Candidate | null {
  const { a, world } = c;
  let best: KnownStructure | undefined;
  let bestD = 99;
  for (const ks of c.m.structs) {
    if (ks.kind !== StructureKind.plot || ks.state !== 2) continue;
    const mine = world.structures[ks.id]?.founder === a.id;
    // another's ripe crop is left alone unless this agent is hungry and little bound by custom
    if (!mine && !(a.energy < 450 && c.conformity < 50)) continue;
    const d = cheb(ks.x, ks.y, a.x, a.y);
    if (d < bestD) {
      bestD = d;
      best = ks;
    }
  }
  if (!best || bestD > 14 || roomFor(a, Item.root) <= 0) return null;
  const mine = world.structures[best.id]?.founder === a.id;
  const time = walk(bestD) + 5;
  return { score: (5 * ITEM_SPECS[Item.root]!.energy) / time, plan: plan("reap", mine ? "my_crop" : "others_crop", { k: "harvest", structure: best.id }) };
}

// ───────────────────────── other people

function spareFood(c: Ctx): { item: number; units: number } | null {
  const reserve = Math.round(DAILY_ENERGY * (0.5 + c.prudence / 200));
  const spare = c.foodE - reserve;
  if (spare <= 0) return null;
  for (const item of [Item.fish, Item.berry, Item.root, Item.ration]) {
    const have = c.a.inv[item] as number;
    if (have <= 0) continue;
    const units = Math.min(have, Math.floor(spare / ITEM_SPECS[item]!.energy));
    if (units > 0) return { item, units };
  }
  return null;
}

/** How inclined this agent is to help a particular other (0..100+), from temperament, trust and the balance of past favours. */
export function goodwill(a: Agent, other: number): number {
  const m = a.mind;
  const trust = m.trust[other] as number;
  const owed = (m.got[other] as number) - (m.gave[other] as number); // positive: I have received more than I gave
  let w = (a.traits[Trait.generosity] as number) + (trust - 500) / 8 + Math.max(-25, Math.min(25, owed / 8));
  if ((m.broke[other] as number) > 0) w -= 25;
  return w;
}

/** Tier 1: debts, requests and visible distress come before one's own projects. */
function socialDuty(c: Ctx): Plan | null {
  const { a, m, tick } = c;

  // 1. a promise falling due is honoured if it can be — by the conforming even when it hurts
  for (const k of m.commitments) {
    if (k.done || k.dir !== "owe") continue;
    const have = a.inv[k.item] as number;
    if (have <= 0) continue;
    const after = c.foodE - Math.min(have, k.qty) * ITEM_SPECS[k.item]!.energy;
    if (after < DAILY_ENERGY * 0.4 && c.conformity < 50) continue;
    const there = c.seen.find((s) => s.id === k.to);
    if (!there && ((m.metTick[k.to] as number) < 0 || tick - (m.metTick[k.to] as number) > TICKS_PER_DAY)) continue;
    return plan("repay", "promised", { k: "give", to: k.to, item: k.item, qty: Math.min(have, k.qty) });
  }

  if (tick < (m.cool[COOL.give] as number)) return null;
  const spare = spareFood(c);

  // 2. someone asked
  if (spare) {
    for (const h of m.inbox) {
      if (h.act.t !== "request" || tick - h.tick > 12) continue;
      if (!FOOD_ITEMS.includes(h.act.item)) continue;
      const who = c.seen.find((s) => s.id === h.from);
      if (!who) continue;
      const bar = h.direct ? 45 : 58;
      if (goodwill(a, h.from) + (who.hunger >= 2 ? 20 : 0) < bar) continue;
      m.cool[COOL.give] = tick + 8;
      return plan("give", "asked", { k: "give", to: h.from, item: spare.item, qty: Math.min(spare.units, h.act.qty, 3) });
    }
    // 3. someone nearby is visibly starving
    for (const s of c.seen) {
      if (s.hunger < 2 || s.dist > 6 || s.asleep) continue;
      if (goodwill(a, s.id) + (s.hunger === 3 ? 15 : 0) < 62) continue;
      m.cool[COOL.give] = tick + 12;
      return plan("give", "they_look_hungry", { k: "give", to: s.id, item: spare.item, qty: Math.min(spare.units, 2) });
    }
  }
  return null;
}

/** Having been fed when in need, some promise to return it. */
function pledge(c: Ctx): Plan | null {
  const { a, m, tick } = c;
  if (tick < (m.cool[COOL.promise] as number)) return null;
  if (c.conformity + (a.traits[Trait.trustfulness] as number) < 105) return null;
  for (let k = m.mem.length - 1; k >= 0; k--) {
    const item = m.mem[k]!;
    if (item.kind !== "got" || tick - item.tick > 16 || item.who < 0) continue;
    if (!FOOD_ITEMS.includes(item.item)) continue;
    if (m.commitments.some((x) => x.dir === "owe" && x.to === item.who && !x.done)) return null;
    const giver = c.seen.find((s) => s.id === item.who && s.audible);
    if (!giver) return null;
    // only a gift received while actually short of food calls for a pledge
    if (c.foodE - item.qty * ITEM_SPECS[item.item]!.energy > DAILY_ENERGY) return null;
    m.cool[COOL.promise] = tick + TICKS_PER_DAY;
    return plan("pledge", "was_helped", { k: "say", to: item.who, act: { t: "promise", item: item.item, qty: item.qty, due: tick + 3 * TICKS_PER_DAY } });
  }
  return null;
}

function audible(c: Ctx, except = -1): number {
  let n = 0;
  for (const s of c.seen) if (s.audible && !s.asleep && s.id !== except) n++;
  return n;
}

/** Tier 4: with nothing better to do, the sociable talk. */
function talk(c: Ctx): Plan | null {
  const { m, tick, world } = c;
  if (audible(c) === 0) return null;

  // pass on what one has learned about a person
  if (c.sociability >= 50 && tick >= (m.cool[COOL.gossip] as number)) {
    let pick = -1;
    for (let k = m.mem.length - 1; k >= 0; k--) {
      const item = m.mem[k]!;
      if (item.who < 0 || item.src >= 0 || tick - item.tick > 2 * TICKS_PER_DAY) continue;
      if (item.kind !== "broke" && item.kind !== "took" && item.kind !== "kept" && item.kind !== "got") continue;
      if (audible(c, item.who) === 0) continue;
      if (pick < 0 || item.salience > m.mem[pick]!.salience) pick = k;
    }
    if (pick >= 0) {
      const item = m.mem[pick]!;
      const claim = item.kind === "got" ? "gave" : (item.kind as "broke" | "took" | "kept");
      m.cool[COOL.gossip] = tick + TICKS_PER_DAY;
      return plan("tell", claim === "broke" || claim === "took" ? "warn_about_someone" : "speak_well", { k: "say", to: -1, act: { t: "inform_agent", about: item.who, claim, tick: item.tick } });
    }
  }

  if (tick < (m.cool[COOL.inform] as number)) return null;

  // a bush found bare is worth a word of warning
  if (c.sociability >= 55) {
    for (let k = m.mem.length - 1; k >= 0; k--) {
      const item = m.mem[k]!;
      if (item.kind !== "empty" || tick - item.tick > 10 || item.ref < 0) continue;
      m.cool[COOL.inform] = tick + 24;
      return plan("tell", "it_is_bare", { k: "say", to: -1, act: { t: "warn", node: item.ref } });
    }
  }

  // tell where food is — unless it is the patch by one's own door and one is not the giving kind
  if (c.sociability >= 40 && c.foodE >= c.targetE * 0.8) {
    let best = -1;
    let bestAmt = 5;
    for (let n = 0; n < world.nodes.count; n++) {
      const amt = m.nodeAmt[n] as number;
      if (amt <= bestAmt || (m.nodeSrc[n] as number) >= 0) continue;
      if (!FOOD_NODE_KINDS.includes(world.nodes.kind[n] as number)) continue;
      if (tick - (m.nodeTick[n] as number) > TICKS_PER_DAY) continue;
      if (c.generosity < 40 && hasHome(c) && cheb(world.nodes.x[n] as number, world.nodes.y[n] as number, m.homeX, m.homeY) <= 3) continue;
      best = n;
      bestAmt = amt;
    }
    if (best >= 0) {
      m.cool[COOL.inform] = tick + 48;
      return plan("tell", "food_is_there", { k: "say", to: -1, act: { t: "inform_node", node: best, amount: bestAmt, tick: m.nodeTick[best] as number } });
    }
  }
  return null;
}

// ───────────────────────── needs the reflex layer does not know how to meet

/**
 * Draw food from a store. `hungry` is the reflex situation (little in hand, belly emptying);
 * otherwise this is the unhurried restocking of someone at home with less than a day's food.
 */
function withdrawFood(c: Ctx, hungry: boolean): Plan | null {
  const { a, world } = c;
  if (c.foodE >= (hungry ? 200 : DAILY_ENERGY * 0.6)) return null;
  const refusedAt = (id: number): boolean => c.m.mem.some((x) => x.kind === "refused" && x.ref === id && c.tick - x.tick < 2 * TICKS_PER_DAY);
  const st = known(c, StructureKind.store, hungry ? 14 : 6, a.x, a.y, (k) => k.state >= 2 && !refusedAt(k.id));
  if (!st) return null;
  const mine = world.structures[st.id]?.contributors.includes(a.id) ?? false;
  // the conforming leave a store they had no hand in until they are truly starving
  if (!mine && (!hungry || (c.conformity >= 60 && a.energy > 260))) return null;
  // what exactly is inside is not known from afar: ask for each kind, most perishable first
  // (a kind that is not there is simply refused, which ends the plan and prompts a rethink)
  const intents: Intent[] = [];
  const inside = world.structures[st.id];
  const atDoor = cheb(st.x, st.y, a.x, a.y) <= 1;
  for (const item of [Item.fish, Item.berry, Item.root, Item.ration]) {
    // standing at the store its contents are in plain view; from a distance try the staples
    if (atDoor && inside && (inside.inv[item] as number) <= 0) continue;
    if (!atDoor && item !== Item.root && item !== Item.ration) continue;
    intents.push({ k: "withdraw", structure: st.id, item, qty: 3 });
    if (intents.length >= 2) break;
  }
  if (intents.length === 0) return null;
  return plan("eat", mine ? "from_my_store" : "from_a_store", ...intents);
}

/** Food lying on the ground in view is picked up by the hungry. */
function scavenge(c: Ctx): Plan | null {
  const { a } = c;
  if (c.foodE >= 200) return null;
  for (const p of visiblePiles(c.world, c.sc, a)) {
    if (p.dist > 8) break;
    for (const item of [Item.ration, Item.root, Item.fish, Item.berry]) {
      if ((p.inv[item] as number) <= 0 || roomFor(a, item) <= 0) continue;
      return plan("eat", "found_on_ground", { k: "goto", x: p.x, y: p.y, near: 0 }, { k: "pickup", item, qty: Math.min(p.inv[item] as number, 4) });
    }
  }
  return null;
}

function ask(c: Ctx): Plan | null {
  const { a, m, tick, world } = c;
  if (a.energy >= 480 || c.foodE > 0 || a.energy < 150 || tick < (m.cool[COOL.ask] as number)) return null;
  if (bestKnownNode(world, a, FOOD_NODE_KINDS).score > 12) return null;
  const someone = c.seen.find((s) => s.audible && !s.asleep);
  if (!someone) return null;
  if (c.sociability + (a.traits[Trait.boldness] as number) < 70) return null;
  m.cool[COOL.ask] = tick + 16;
  return plan("ask", "hungry_and_empty_handed", { k: "say", to: -1, act: { t: "request", item: Item.berry, qty: 2 } });
}

/** Head for home as the light fails, carrying fuel if the night will be cold. */
function evening(c: Ctx): Plan | null {
  const { a, m } = c;
  if (!c.dusk || !hasHome(c)) return null;
  const d = cheb(m.homeX, m.homeY, a.x, a.y);
  if (d <= 2 || d > 14) return null;
  return plan("go_home", "night_is_coming", { k: "goto", x: m.homeX, y: m.homeY, near: 1 });
}

// ───────────────────────── entry point

/**
 * Deliberate. Returns a plan, or null to let the reflex layer act (it handles the body's
 * ordinary needs and is never bypassed when a need is pressing).
 */
export function planDecide(world: WorldState, sc: Scratch, a: Agent): Plan | null {
  const m = a.mind;
  if (world.tick < (m.cool[COOL.backoff] as number)) return null;
  const c = ctxOf(world, sc, a);
  const night = world.climate.light < 250;

  // The body first. The reflex layer serves thirst, cold, sleep and eating what is in hand;
  // the planner adds what reflexes cannot do when hungry: draw on a store, pick food up
  // off the ground, and ask.
  const dim = world.climate.light < 420;
  if (a.hydration < 430 || a.energy < 540 || a.warmth < 470 || a.rest < 270 || (night && a.rest < 830) || (dim && a.rest < 520)) {
    if (a.energy < 540 && a.hydration >= 170 && a.warmth >= 210) return drawRation(world, a, true) ?? withdrawFood(c, true) ?? scavenge(c) ?? ask(c);
    return null;
  }
  // eating and drinking a little before it is urgent costs a moment and is left to the reflex layer
  if (a.energy < 780 && c.foodE > 0) return null;
  if (a.hydration < 600) return null;

  chooseHome(c);

  const restock = drawRation(world, a, false) ?? withdrawFood(c, false);
  if (restock) return restock;

  const duty = socialDuty(c) ?? civicDuty(world, sc, a) ?? civicBusiness(world, a, c.seen) ?? pledge(c);
  if (duty) return duty;

  const home = evening(c);
  if (home) return home;

  let best: Candidate | null = null;
  const consider = (cand: Candidate | null) => {
    if (cand && cand.plan.intents.length > 0 && (!best || cand.score > best.score)) best = cand;
  };
  consider(provision(c));
  consider(preserve(c));
  consider(reap(c));
  consider(fire(c));
  if (!night) {
    consider(tools(c));
    consider(shelter(c));
    consider(store(c));
    consider(stash(c));
    consider(plot(c));
  }
  // getting something by exchange is weighed against getting it oneself
  const offer = offerCandidate(world, a, c.seen);
  consider(offer);
  // the industrious will work for a smaller return than the idle
  const floor = 13 - c.industry / 10;
  const chosen = best as Candidate | null;
  if (chosen && chosen.score >= floor) {
    if (offer && chosen.plan === offer.plan) offerMade(world, a);
    return chosen.plan;
  }

  const civic = civicLeisure(world, a, c.seen);
  if (civic) return civic;

  const said = talk(c);
  if (said) return said;

  if (!night && world.tick >= (m.cool[COOL.explore] as number)) {
    const frontier = nearestKnown(world, sc, a, 40, m.heading, (t) => isFrontier(sc, m.seen, t));
    if (frontier >= 0 && frontier !== c.tile && chance(15 + c.curiosity, 160, world.config.seed, Stream.Policy, world.tick, a.id, 7)) {
      m.cool[COOL.explore] = world.tick + 12;
      return plan("explore", "curious", { k: "explore" });
    }
  }
  if (chosen) return chosen.plan; // nothing better to do than a low-return task
  return null;
}
