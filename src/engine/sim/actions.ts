/**
 * Actions: the only way anything an agent wants becomes a fact.
 *
 *   intent ──► position check ──► validation ──► duration ──► completion ──► events
 *
 * Each intent has explicit prerequisites and failure outcomes. A failed intent emits a
 * `rejected` event with a reason code and clears the agent's plan so it must re-decide.
 * Agents are processed in a keyed random order each tick, so simultaneous claims on the
 * same units are settled fairly and deterministically.
 */
import { clampInt } from "../core/math";
import { cleanText } from "../core/text";
import { Stream, below, chance, stochasticDiv } from "../core/rng";
import {
  Craft,
  FIELD_GROW_DAYS,
  FIELD_RESOW_LABOR,
  FIELD_RESOW_ROOTS,
  FIELD_YIELD,
  FIRE_MAX_FUEL,
  FIRE_TICKS_PER_WOOD,
  FIRST_WORK_KIND,
  ITEM_COUNT,
  ITEM_SPECS,
  Item,
  NEED_MAX,
  NODE_SPECS,
  PLOT_GROW_DAYS,
  PLOT_YIELD,
  Phys,
  RECIPES,
  SKILL_MAX,
  STRUCTURE_SPECS,
  Skill,
  StructureKind,
  TICKS_PER_DAY,
  Water,
  craftFor,
} from "../model/constants";
import { Activity, type Agent, type Intent, type Structure, type WorldState } from "../model/types";
import { droughtActive, hearingRadius, sightRadius } from "../world/climate";
import { noteFeedback } from "../mind/feedback";
import { believedDrinkable, remember, structureStateCode, untold } from "../mind/knowledge";
import { notePromiseMade, noteTaking, settleGift } from "../mind/social";
import { gathered, institutionalIntent, storeAccess, supplied, withdrawLimit } from "../institutions/hooks";
import { emit, parentsOf, type EventOut } from "./events";
import { carriedWeight, carryCapacity, dropOnGround, emptyInv, roomFor, sink, source } from "./inventory";
import { checkIntent } from "./intents";
import { findPath, isFrontier, nearestKnown } from "./pathfind";
import { pileAt, structureAt, type Scratch } from "./scratch";
import { bedsOf, demonstrate, goodsCapacity, holdsGoods, isRemedy, knows, layUpCare, mayFound, visitRecords } from "./works";

const WEAR_THRESHOLD = 24;
const MAX_TEXT = 200;

// ───────────────────────── helpers

function cheb(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax > bx ? ax - bx : bx - ax;
  const dy = ay > by ? ay - by : by - ay;
  return dx > dy ? dx : dy;
}

function clearPlan(a: Agent): void {
  a.queue.length = 0;
  a.path.length = 0;
  a.pathKey = -1;
  a.progress = 0;
}

export function wake(world: WorldState, a: Agent, out: EventOut | null): void {
  if (!a.asleep) return;
  a.asleep = false;
  if (a.shelter >= 0) {
    const s = world.structures[a.shelter];
    if (s && s.occupants > 0) s.occupants--;
    a.shelter = -1;
  }
  if (out) emit(world, out, "wake", a.id);
}

/** Abort whatever the agent is doing and drop its plan (used by interrupts and rejections). */
export function interrupt(world: WorldState, a: Agent, out: EventOut | null): void {
  if (a.act && a.act.k !== "step") {
    if (a.act.k === "rest") wake(world, a, out);
    a.act = null;
  }
  clearPlan(a);
}

function reject(world: WorldState, a: Agent, out: EventOut, intent: Intent, reason: string): void {
  const kind = intent && typeof (intent as { k?: unknown }).k === "string" ? String((intent as { k: string }).k).slice(0, 24) : "?";
  emit(world, out, "rejected", a.id, { r: reason, d: { k: kind }, p: parentsOf(a.mind.decisionEvent) });
  a.stats.rejected++;
  world.metrics.rejectedIntents++;
  noteFeedback(world, a, kind, reason);
  if (a.act && a.act.k === "rest") wake(world, a, out);
  a.act = null;
  // a door that would not open is remembered, so that it is not tried again every hour
  if (reason === "not_permitted" && intent && intent.k === "withdraw") {
    remember(world, a, "refused", { ref: intent.structure, salience: 420 });
  }
  clearPlan(a);
  // a deliberate plan that the world refused is not immediately re-proposed (slot 6 = planner back-off)
  a.mind.cool[6] = world.tick + 5;
}

function popIntent(a: Agent): void {
  a.queue.shift();
  a.progress = 0;
}

/** Ticks needed for `base` ticks of work at a given skill, slowed by illness. */
function workTicks(a: Agent, base: number, skill: number): number {
  let t = (base * (1000 - Math.floor(skill * 0.35))) / 1000;
  if (a.ill > 0) t *= 1.5;
  return Math.max(1, Math.round(t));
}

function gainSkill(world: WorldState, a: Agent, skill: number, salt: number): void {
  const cur = a.skills[skill] as number;
  if (cur >= SKILL_MAX) return;
  const gain = stochasticDiv(7 * (SKILL_MAX - cur) * world.config.learningRate, 1_000_000, world.config.seed, Stream.Gather, world.tick, a.id, 100 + salt);
  a.skills[skill] = clampInt(cur + gain, 0, SKILL_MAX);
}

function wearTool(world: WorldState, a: Agent, tool: number, out: EventOut): void {
  let uses = a.toolUses[tool] as number;
  if (uses <= 0) uses = ITEM_SPECS[tool]!.uses;
  uses--;
  if (uses <= 0) {
    a.inv[tool] = (a.inv[tool] as number) - 1;
    sink(world, tool, 1);
    emit(world, out, "tool_broke", a.id, { i: tool });
    uses = (a.inv[tool] as number) > 0 ? ITEM_SPECS[tool]!.uses : 0;
  }
  a.toolUses[tool] = uses;
}

/** Spoken words as they are stored: cleaned and bounded here whatever door they came through. */
function sanitizeText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const out = cleanText(text, MAX_TEXT);
  return out.length > 0 ? out : undefined;
}

/** Awake agents within sight of a tile, excluding `except`. */
function witnesses(world: WorldState, x: number, y: number, except: number): Agent[] {
  const r = sightRadius(world);
  const r2 = r * r + r;
  const list: Agent[] = [];
  for (const o of world.agents) {
    if (!o.alive || o.asleep || o.id === except) continue;
    const dx = o.x - x;
    const dy = o.y - y;
    if (dx * dx + dy * dy <= r2) list.push(o);
  }
  return list;
}

function structureIfUsable(world: WorldState, id: number): Structure | null {
  const s = world.structures[id];
  if (!s || s.removed) return null;
  return s;
}

function storeLoad(s: Structure): number {
  let wgt = 0;
  for (let i = 0; i < ITEM_COUNT; i++) wgt += (s.inv[i] as number) * ITEM_SPECS[i]!.weight;
  return wgt;
}

// ───────────────────────── movement

function stepDuration(world: WorldState, a: Agent, from: number, to: number, w: number): number {
  let base = world.terrain.moveCost[to] as number;
  if ((world.traffic[to] as number) >= WEAR_THRESHOLD && base > 1) base -= 1;
  const fx = from % w;
  const tx = to % w;
  const diagonal = fx !== tx && Math.floor(from / w) !== Math.floor(to / w);
  let dur = diagonal ? Math.floor((base * 14 + 9) / 10) : base;
  if (carriedWeight(a) * 5 > carryCapacity(a) * 4) dur += 1;
  if (a.ill > 0) dur += 1;
  return dur;
}

/**
 * Begin (or continue) walking toward within `near` of (tx, ty).
 * Returns "arrived", "moving", or a rejection reason.
 */
function approach(world: WorldState, sc: Scratch, a: Agent, tx: number, ty: number, near: number): "arrived" | "moving" | string {
  if (cheb(a.x, a.y, tx, ty) <= near) return "arrived";
  const w = sc.w;
  const key = (ty * w + tx) * 8 + near;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (a.pathKey !== key || a.path.length === 0) {
      const path = findPath(world, sc, a, tx, ty, near);
      if (path === null) {
        a.path.length = 0;
        a.pathKey = -1;
        return "unreachable";
      }
      if (path.length === 0) return "arrived";
      a.path = path;
      a.pathKey = key;
    }
    const next = a.path[a.path.length - 1] as number;
    const from = a.y * w + a.x;
    const nx = next % w;
    const ny = (next - nx) / w;
    // the next step must be adjacent and actually walkable; otherwise re-plan once
    if (cheb(a.x, a.y, nx, ny) !== 1 || (world.terrain.moveCost[next] as number) === 0) {
      a.path.length = 0;
      a.pathKey = -1;
      continue;
    }
    const dur = stepDuration(world, a, from, next, w);
    a.act = { k: "step", t: dur, dur, x: nx, y: ny };
    return "moving";
  }
  return "unreachable";
}

function finishStep(world: WorldState, sc: Scratch, a: Agent): void {
  const act = a.act!;
  a.px = a.x;
  a.py = a.y;
  a.x = act.x;
  a.y = act.y;
  a.path.pop();
  const tile = a.y * sc.w + a.x;
  if ((world.traffic[tile] as number) < 60000) world.traffic[tile] = (world.traffic[tile] as number) + 1;
  a.stats.distance++;
  a.act = null;
}

// ───────────────────────── starting an intent

function begin(a: Agent, k: Intent["k"], dur: number): void {
  a.act = { k, t: dur, dur, x: a.x, y: a.y };
}

/**
 * Start the next action for an agent with no action in progress.
 * Consumes zero-duration bookkeeping (e.g. finished gotos) until an action starts or the plan is empty.
 */
export function startNext(world: WorldState, sc: Scratch, a: Agent, out: EventOut): void {
  const cfg = world.config;
  const w = sc.w;
  for (let guard = 0; guard < 8 && a.act === null && a.queue.length > 0; guard++) {
    const intent = a.queue[0]!;
    // structural gate: no handler ever sees a malformed intent
    const malformed = checkIntent(world, intent);
    if (malformed) {
      reject(world, a, out, intent, malformed);
      return;
    }
    switch (intent.k) {
      case "goto": {
        if (!Number.isInteger(intent.x) || !Number.isInteger(intent.y) || intent.x < 0 || intent.y < 0 || intent.x >= w || intent.y >= sc.h) {
          reject(world, a, out, intent, "bad_tile");
          return;
        }
        const r = approach(world, sc, a, intent.x, intent.y, clampInt(intent.near, 0, 6));
        if (r === "arrived") {
          popIntent(a);
          continue;
        }
        if (r !== "moving") reject(world, a, out, intent, r);
        return;
      }
      case "explore": {
        const m = a.mind;
        const target = nearestKnown(world, sc, a, 48, m.heading, (tile) => isFrontier(sc, m.seen, tile));
        if (target < 0 || target === a.y * w + a.x) {
          // nothing left to discover from here: turn and idle briefly
          m.heading = (m.heading + 3) & 7;
          popIntent(a);
          if (target < 0) {
            a.queue.unshift({ k: "wait", ticks: 4 });
          } else {
            // standing on the frontier: step in the heading direction if possible
            a.queue.unshift({ k: "wait", ticks: 1 });
          }
          continue;
        }
        const tx = target % w;
        a.queue[0] = { k: "goto", x: tx, y: (target - tx) / w, near: 0 };
        continue;
      }
      case "gather": {
        const n = intent.node;
        if (!Number.isInteger(n) || n < 0 || n >= world.nodes.count) {
          reject(world, a, out, intent, "no_target");
          return;
        }
        const spec = NODE_SPECS[world.nodes.kind[n] as number]!;
        const nx = world.nodes.x[n] as number;
        const ny = world.nodes.y[n] as number;
        const r = approach(world, sc, a, nx, ny, spec.standOn ? 0 : 1);
        if (r === "moving") return;
        if (r !== "arrived") {
          reject(world, a, out, intent, r);
          return;
        }
        if ((world.nodes.amount[n] as number) <= 0) {
          a.mind.nodeAmt[n] = 0;
          a.mind.nodeTick[n] = world.tick;
          a.mind.nodeSrc[n] = -1;
          remember(world, a, "empty", { ref: n, salience: 300 });
          reject(world, a, out, intent, "nothing_to_gather");
          return;
        }
        if (roomFor(a, spec.yields) <= 0) {
          reject(world, a, out, intent, "no_capacity");
          return;
        }
        begin(a, "gather", workTicks(a, spec.work, a.skills[spec.skill] as number));
        return;
      }
      case "eat": {
        if (!Number.isInteger(intent.item) || intent.item < 0 || intent.item >= ITEM_COUNT || ITEM_SPECS[intent.item]!.cls !== "food") {
          reject(world, a, out, intent, "not_food");
          return;
        }
        if ((a.inv[intent.item] as number) <= 0) {
          reject(world, a, out, intent, "no_item");
          return;
        }
        begin(a, "eat", 1);
        return;
      }
      case "drink":
      case "fill": {
        const tile = a.y * w + a.x;
        const here = world.terrain.fresh[tile] as number;
        const usable = here === 2 || (here === 1 && !droughtActive(world));
        if (intent.k === "drink" && (a.inv[Item.water] as number) > 0 && !usable) {
          begin(a, "drink", 1);
          return;
        }
        if (intent.k === "fill" && (a.inv[Item.pot] as number) <= 0) {
          reject(world, a, out, intent, "no_item");
          return;
        }
        if (usable) {
          begin(a, intent.k, 2);
          return;
        }
        if (here === 1) {
          // standing at a stream that has run dry: learn it, then look elsewhere
          a.mind.droughtSeen = world.tick;
        }
        const target = nearestKnown(world, sc, a, 60, a.mind.heading, (t) => believedDrinkable(world, a, t));
        if (target < 0 || target === tile) {
          reject(world, a, out, intent, target < 0 ? "no_water_known" : "not_fresh");
          return;
        }
        const tx = target % w;
        a.queue.unshift({ k: "goto", x: tx, y: (target - tx) / w, near: 0 });
        continue;
      }
      case "rest": {
        const ticks = clampInt(intent.ticks, 1, 64);
        a.asleep = true;
        // Enter a dwelling on or beside this tile if there is room and access: the first found, unless a
        // better kind stands beside it (a stone house over a shelter; for the ill or hurt, a healing
        // house over both, and only they are taken in there). Where every dwelling is a shelter, as in
        // any world without crafts, this is the first shelter found, as it always was.
        const needy = a.ill > 0 || a.health < 700;
        let bed = -1;
        let rank = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = a.x + dx;
            const yy = a.y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= sc.h) continue;
            const sid = structureAt(world, sc, yy * w + xx);
            if (sid < 0) continue;
            const s = world.structures[sid]!;
            const beds = bedsOf(s.kind);
            if (beds === 0 || !s.complete) continue;
            const r = s.kind === StructureKind.healing_house ? (needy ? 3 : 0) : s.kind === StructureKind.house ? 2 : 1;
            if (r <= rank) continue;
            if (s.occupants >= beds) continue;
            if (!storeAccess(world, a, s, "shelter", 0, 0)) continue;
            bed = sid;
            rank = r;
          }
        }
        if (bed >= 0) {
          world.structures[bed]!.occupants++;
          a.shelter = bed;
        }
        begin(a, "rest", ticks);
        emit(world, out, "sleep", a.id, a.shelter >= 0 ? { s: a.shelter, p: parentsOf(a.mind.decisionEvent) } : { p: parentsOf(a.mind.decisionEvent) });
        return;
      }
      case "wait": {
        begin(a, "wait", clampInt(intent.ticks, 1, 48));
        return;
      }
      case "craft": {
        const recipe = RECIPES[intent.recipe];
        if (!recipe) {
          reject(world, a, out, intent, "unknown_recipe");
          return;
        }
        for (const [item, qty] of recipe.inputs) {
          if ((a.inv[item] as number) < qty) {
            reject(world, a, out, intent, "no_materials");
            return;
          }
        }
        if (recipe.needsFire && !sc.warm[a.y * w + a.x]) {
          reject(world, a, out, intent, "no_fire");
          return;
        }
        const dex = a.phys[Phys.dexterity] as number;
        const base = Math.max(1, Math.round((recipe.work * (125 - dex / 2)) / 100));
        begin(a, "craft", workTicks(a, base, a.skills[Skill.craft] as number));
        return;
      }
      case "build": {
        const spec = STRUCTURE_SPECS[intent.kind];
        if (!spec || !Number.isInteger(intent.x) || !Number.isInteger(intent.y) || intent.x < 0 || intent.y < 0 || intent.x >= w || intent.y >= sc.h) {
          reject(world, a, out, intent, "bad_tile");
          return;
        }
        if (spec.kind === StructureKind.plot && !cfg.planting) {
          reject(world, a, out, intent, "disabled");
          return;
        }
        const r = approach(world, sc, a, intent.x, intent.y, 1);
        if (r === "moving") return;
        if (r !== "arrived") {
          reject(world, a, out, intent, r);
          return;
        }
        const tile = intent.y * w + intent.x;
        const sid = structureAt(world, sc, tile);
        if (sid < 0) {
          // found a new site
          const terrain = world.terrain;
          if ((terrain.moveCost[tile] as number) === 0 || terrain.water[tile] !== Water.none || (world.nodes.atTile[tile] as number) >= 0) {
            reject(world, a, out, intent, "bad_tile");
            return;
          }
          if (spec.kind === StructureKind.plot && (terrain.fertility[tile] as number) < 35) {
            reject(world, a, out, intent, "infertile");
            return;
          }
          const barred = mayFound(world, sc, a, spec.kind, intent.x, intent.y);
          if (barred) {
            reject(world, a, out, intent, barred);
            return;
          }
          begin(a, "build", 1);
          return;
        }
        const s = world.structures[sid]!;
        if (s.kind !== spec.kind) {
          reject(world, a, out, intent, "occupied");
          return;
        }
        if (s.complete) {
          popIntent(a);
          continue;
        }
        // contribute carried materials first, then labour
        let supplies = false;
        for (let i = 0; i < ITEM_COUNT; i++) {
          if ((s.missing[i] as number) > 0 && (a.inv[i] as number) > 0) {
            supplies = true;
            break;
          }
        }
        if (supplies) {
          begin(a, "supply", 1);
          a.act!.x = s.x;
          a.act!.y = s.y;
          return;
        }
        let missing = 0;
        for (let i = 0; i < ITEM_COUNT; i++) missing += s.missing[i] as number;
        if (missing > 0) {
          // nothing more this agent can add right now; the site waits
          popIntent(a);
          continue;
        }
        begin(a, "work", Math.max(1, Math.min(12, s.laborNeeded - s.laborDone)));
        a.act!.x = s.x;
        a.act!.y = s.y;
        return;
      }
      case "supply":
      case "work":
      case "refuel":
      case "harvest":
      case "deposit":
      case "withdraw":
      case "inspect": {
        const s = structureIfUsable(world, intent.structure);
        if (!s) {
          reject(world, a, out, intent, "no_target");
          return;
        }
        const r = approach(world, sc, a, s.x, s.y, 1);
        if (r === "moving") return;
        if (r !== "arrived") {
          reject(world, a, out, intent, r);
          return;
        }
        const reason = validateStructureIntent(world, a, s, intent);
        if (reason) {
          reject(world, a, out, intent, reason);
          return;
        }
        if (intent.k === "work") {
          begin(a, "work", clampInt(Math.min(intent.ticks, s.laborNeeded - s.laborDone), 1, 24));
        } else if (intent.k === "harvest") {
          begin(a, "harvest", workTicks(a, 4, a.skills[Skill.farm] as number));
        } else {
          begin(a, intent.k, 1);
        }
        a.act!.x = s.x;
        a.act!.y = s.y;
        return;
      }
      case "give": {
        const t = world.agents[intent.to];
        if (!t || !t.alive || t.id === a.id) {
          reject(world, a, out, intent, t && t.id === a.id ? "self_target" : "no_target");
          return;
        }
        if (!Number.isInteger(intent.item) || intent.item < 0 || intent.item >= ITEM_COUNT || !(intent.qty >= 1)) {
          reject(world, a, out, intent, "bad_quantity");
          return;
        }
        if ((a.inv[intent.item] as number) <= 0) {
          reject(world, a, out, intent, "no_item");
          return;
        }
        // walk toward where the recipient is believed to be; when in sight, their true position is perceived
        const inSight = cheb(a.x, a.y, t.x, t.y) <= sightRadius(world) && !a.asleep;
        const gx = inSight ? t.x : (a.mind.metX[t.id] as number);
        const gy = inSight ? t.y : (a.mind.metY[t.id] as number);
        if (!inSight && (a.mind.metTick[t.id] as number) < 0) {
          reject(world, a, out, intent, "target_unknown");
          return;
        }
        const r = approach(world, sc, a, gx, gy, 1);
        if (r === "moving") return;
        if (r !== "arrived") {
          reject(world, a, out, intent, r);
          return;
        }
        if (cheb(a.x, a.y, t.x, t.y) > 1) {
          reject(world, a, out, intent, "target_missing");
          return;
        }
        begin(a, "give", 1);
        return;
      }
      case "drop": {
        if (!Number.isInteger(intent.item) || intent.item < 0 || intent.item >= ITEM_COUNT || (a.inv[intent.item] as number) <= 0 || !(intent.qty >= 1)) {
          reject(world, a, out, intent, "no_item");
          return;
        }
        begin(a, "drop", 1);
        return;
      }
      case "pickup": {
        const k = pileAt(world, sc, a.y * w + a.x);
        if (k < 0 || !Number.isInteger(intent.item) || intent.item < 0 || intent.item >= ITEM_COUNT || (world.piles[k]!.inv[intent.item] as number) <= 0) {
          reject(world, a, out, intent, "nothing_here");
          return;
        }
        if (roomFor(a, intent.item) <= 0) {
          reject(world, a, out, intent, "no_capacity");
          return;
        }
        begin(a, "pickup", 1);
        return;
      }
      case "say": {
        if (intent.to >= 0) {
          const t = world.agents[intent.to];
          if (!t || !t.alive || t.id === a.id) {
            reject(world, a, out, intent, "no_target");
            return;
          }
          if (cheb(a.x, a.y, t.x, t.y) > Math.max(1, hearingRadius(world))) {
            reject(world, a, out, intent, "too_far");
            return;
          }
        }
        // a person can tell only of what they know (whoever or whatever is deciding for them)
        const gap = untold(world, a, intent.act);
        if (gap) {
          reject(world, a, out, intent, gap);
          return;
        }
        begin(a, "say", 1);
        return;
      }
      default: {
        // institutional acts are validated and executed by the institution module
        const handled = institutionalIntent(world, sc, a, intent, out);
        if (handled === "done") {
          popIntent(a);
          continue;
        }
        if (handled === "busy") {
          begin(a, intent.k, 1);
          return;
        }
        reject(world, a, out, intent, handled);
        return;
      }
    }
  }
}

function validateStructureIntent(world: WorldState, a: Agent, s: Structure, intent: Intent): string | null {
  switch (intent.k) {
    case "supply": {
      if (s.complete) return "already_complete";
      if (!Number.isInteger(intent.item) || intent.item < 0 || intent.item >= ITEM_COUNT) return "bad_quantity";
      if ((s.missing[intent.item] as number) <= 0) return "not_needed";
      if ((a.inv[intent.item] as number) <= 0) return "no_item";
      return null;
    }
    case "work": {
      if (s.complete) return "already_complete";
      for (let i = 0; i < ITEM_COUNT; i++) if ((s.missing[i] as number) > 0) return "no_materials";
      return null;
    }
    case "refuel": {
      if (!s.complete || s.kind !== StructureKind.campfire) return "not_a_fire";
      if ((a.inv[Item.wood] as number) <= 0) return "no_item";
      if (s.fuel + FIRE_TICKS_PER_WOOD > FIRE_MAX_FUEL) return "fire_full";
      return null;
    }
    case "harvest": {
      if (!s.complete || (s.kind !== StructureKind.plot && s.kind !== StructureKind.field)) return "not_a_plot";
      if (s.ripeTick < 0 || world.tick < s.ripeTick) return "not_ripe";
      return null;
    }
    case "deposit": {
      if (s.complete && s.kind === StructureKind.healing_house) {
        // care is laid up there from berries or fibre, by someone who knows which plants heal
        if (!Number.isInteger(intent.item) || !isRemedy(intent.item) || !(intent.qty >= 1)) return "not_a_remedy";
        if (!knows(a, Craft.herb_lore)) return "unknown_craft";
        if ((a.inv[intent.item] as number) <= 0) return "no_item";
        return null;
      }
      if (!s.complete || !holdsGoods(s.kind)) return "not_a_store";
      if (!Number.isInteger(intent.item) || intent.item < 0 || intent.item >= ITEM_COUNT || !(intent.qty >= 1)) return "bad_quantity";
      if ((a.inv[intent.item] as number) <= 0) return "no_item";
      if (storeLoad(s) + ITEM_SPECS[intent.item]!.weight > goodsCapacity(s.kind)) return "store_full";
      if (!storeAccess(world, a, s, "deposit", intent.item, intent.qty)) return "not_permitted";
      return null;
    }
    case "withdraw": {
      if (!s.complete || !holdsGoods(s.kind)) return "not_a_store";
      if (!Number.isInteger(intent.item) || intent.item < 0 || intent.item >= ITEM_COUNT || !(intent.qty >= 1)) return "bad_quantity";
      if ((s.inv[intent.item] as number) <= 0) return "nothing_here";
      if (roomFor(a, intent.item) <= 0) return "no_capacity";
      if (!storeAccess(world, a, s, "withdraw", intent.item, intent.qty)) return "not_permitted";
      return null;
    }
    case "inspect":
      return null;
    default:
      return "unsupported";
  }
}

// ───────────────────────── completing actions

function completeStructure(world: WorldState, sc: Scratch, a: Agent, s: Structure, out: EventOut): void {
  s.complete = true;
  // a field is completed every time it is sown: its first sowing is when it was made
  const resown = s.kind === StructureKind.field && s.builtTick >= 0;
  if (!resown) s.builtTick = world.tick;
  if (s.kind === StructureKind.campfire) s.fuel = 2 * FIRE_TICKS_PER_WOOD;
  if (s.kind === StructureKind.field) s.ripeTick = world.tick + FIELD_GROW_DAYS * TICKS_PER_DAY;
  if (resown) {
    gainSkill(world, a, Skill.farm, 3);
    emit(world, out, "plant", a.id, { s: s.id, x: s.x, y: s.y, r: "field", p: parentsOf(a.mind.decisionEvent) });
  } else if (s.kind === StructureKind.plot) {
    s.ripeTick = world.tick + PLOT_GROW_DAYS * TICKS_PER_DAY;
    gainSkill(world, a, Skill.farm, 3);
    emit(world, out, "plant", a.id, { s: s.id, x: s.x, y: s.y, p: parentsOf(a.mind.decisionEvent) });
  } else {
    gainSkill(world, a, Skill.build, 4);
    world.metrics.projectsCompleted++;
    emit(world, out, "built", a.id, {
      s: s.id,
      x: s.x,
      y: s.y,
      d: { kind: s.kind, contributors: s.contributors.slice() },
      p: parentsOf(a.mind.decisionEvent),
    });
    for (const id of s.contributors) {
      const c = world.agents[id];
      if (c && c.alive) remember(world, c, "built", { ref: s.id, salience: 500 });
    }
  }
  sc.structDirty = true;
}

function contribute(s: Structure, agentId: number, amount: number, building = false): void {
  if (building && !s.builders.includes(agentId)) s.builders.push(agentId);
  const k = s.contributors.indexOf(agentId);
  if (k >= 0) s.contributions[k] = (s.contributions[k] as number) + amount;
  else {
    s.contributors.push(agentId);
    s.contributions.push(amount);
  }
}

/** Apply the effect of the action that has just finished. */
function complete(world: WorldState, sc: Scratch, a: Agent, out: EventOut): void {
  const act = a.act!;
  const cfg = world.config;
  const w = sc.w;
  const intent = a.queue[0];
  a.act = null;
  if (act.k === "step") return; // handled by finishStep
  if (!intent) return;
  const parents = parentsOf(a.mind.decisionEvent);

  switch (act.k) {
    case "gather": {
      if (intent.k !== "gather") return;
      const n = intent.node;
      const kind = world.nodes.kind[n] as number;
      const spec = NODE_SPECS[kind]!;
      const cls = spec.skill === Skill.fish ? Activity.fish : spec.skill === Skill.wood ? Activity.wood : spec.skill === Skill.mine ? Activity.mine : Activity.forage;
      a.stats.activity[cls] = (a.stats.activity[cls] as number) + act.dur;
      world.metrics.workTicks += act.dur;
      const avail = world.nodes.amount[n] as number;
      if (avail <= 0) {
        a.mind.nodeAmt[n] = 0;
        a.mind.nodeTick[n] = world.tick;
        reject(world, a, out, intent, "contested");
        return;
      }
      const skill = a.skills[spec.skill] as number;
      let y = spec.baseYield;
      if (skill > 400 && chance(skill - 400, 600, cfg.seed, Stream.Gather, world.tick, a.id, 1)) y += 1;
      if (spec.skill === Skill.fish) {
        const p = clampInt(250 + Math.floor((550 * avail) / (world.nodes.cap[n] as number)) + Math.floor(skill / 4), 50, 950);
        if (!chance(p, 1000, cfg.seed, Stream.Gather, world.tick, a.id, 2)) y = 0;
      }
      if (y > 0 && spec.tool >= 0 && (a.inv[spec.tool] as number) > 0) {
        y *= 2;
        wearTool(world, a, spec.tool, out);
      }
      const want = Math.max(1, Math.floor(intent.qty)) - a.progress;
      y = Math.min(y, avail, roomFor(a, spec.yields), want);
      if (y > 0) {
        world.nodes.amount[n] = avail - y;
        source(world, spec.yields, y);
        a.inv[spec.yields] = (a.inv[spec.yields] as number) + y;
        a.stats.gathered[spec.yields] = (a.stats.gathered[spec.yields] as number) + y;
        world.metrics.gatheredUnits += y;
        a.progress += y;
      }
      gainSkill(world, a, spec.skill, 1);
      const ev = emit(world, out, "gather", a.id, { n, i: spec.yields, q: y, p: parents });
      if (y > 0) gathered(world, sc, a, n, y, out);
      if (y > 0 && avail - y === 0) emit(world, out, "depleted", a.id, { n, p: [ev] });
      a.mind.nodeAmt[n] = world.nodes.amount[n] as number;
      a.mind.nodeTick[n] = world.tick;
      a.mind.nodeSrc[n] = -1;
      if (a.progress >= Math.max(1, Math.floor(intent.qty)) || (world.nodes.amount[n] as number) === 0 || roomFor(a, spec.yields) <= 0) {
        popIntent(a);
      }
      return;
    }
    case "eat": {
      if (intent.k !== "eat") return;
      const item = intent.item;
      if ((a.inv[item] as number) <= 0) {
        reject(world, a, out, intent, "no_item");
        return;
      }
      const spec = ITEM_SPECS[item]!;
      a.inv[item] = (a.inv[item] as number) - 1;
      sink(world, item, 1);
      a.energy = clampInt(a.energy + spec.energy, 0, NEED_MAX);
      a.hydration = clampInt(a.hydration + spec.hydration, 0, NEED_MAX);
      a.progress++;
      emit(world, out, "eat", a.id, { i: item, q: 1, p: parents });
      if (a.progress >= Math.max(1, Math.floor(intent.qty)) || (a.inv[item] as number) <= 0 || a.energy >= 940) popIntent(a);
      return;
    }
    case "drink": {
      if (intent.k !== "drink") return;
      const tile = a.y * w + a.x;
      const here = world.terrain.fresh[tile] as number;
      const usable = here === 2 || (here === 1 && !droughtActive(world));
      if (!usable) {
        if ((a.inv[Item.water] as number) <= 0) {
          reject(world, a, out, intent, "not_fresh");
          return;
        }
        a.inv[Item.water] = (a.inv[Item.water] as number) - 1;
        sink(world, Item.water, 1);
      }
      a.hydration = clampInt(a.hydration + ITEM_SPECS[Item.water]!.hydration, 0, NEED_MAX);
      emit(world, out, "drink", a.id, { p: parents });
      if (a.hydration >= 900 || (!usable && (a.inv[Item.water] as number) <= 0)) popIntent(a);
      return;
    }
    case "fill": {
      const room = roomFor(a, Item.water);
      if (room > 0) {
        a.inv[Item.water] = (a.inv[Item.water] as number) + room;
        source(world, Item.water, room);
        emit(world, out, "fill", a.id, { q: room, p: parents });
      }
      popIntent(a);
      return;
    }
    case "rest": {
      wake(world, a, out);
      popIntent(a);
      return;
    }
    case "wait": {
      popIntent(a);
      return;
    }
    case "craft": {
      if (intent.k !== "craft") return;
      const recipe = RECIPES[intent.recipe]!;
      for (const [item, qty] of recipe.inputs) {
        if ((a.inv[item] as number) < qty) {
          reject(world, a, out, intent, "no_materials");
          return;
        }
      }
      if (recipe.needsFire && !sc.warm[a.y * w + a.x]) {
        reject(world, a, out, intent, "no_fire");
        return;
      }
      for (const [item, qty] of recipe.inputs) {
        a.inv[item] = (a.inv[item] as number) - qty;
        sink(world, item, qty);
      }
      source(world, recipe.out, recipe.outQty);
      const room = roomFor(a, recipe.out);
      const kept = Math.min(room, recipe.outQty);
      a.inv[recipe.out] = (a.inv[recipe.out] as number) + kept;
      if (kept < recipe.outQty) dropOnGround(world, sc, a.x, a.y, recipe.out, recipe.outQty - kept);
      if (ITEM_SPECS[recipe.out]!.uses > 0 && (a.toolUses[recipe.out] as number) <= 0) {
        a.toolUses[recipe.out] = ITEM_SPECS[recipe.out]!.uses;
      }
      world.metrics.workTicks += act.dur;
      gainSkill(world, a, Skill.craft, 2);
      emit(world, out, "craft", a.id, { i: recipe.out, q: recipe.outQty, d: { recipe: recipe.id }, p: parents });
      popIntent(a);
      return;
    }
    case "build": {
      if (intent.k !== "build") return;
      const tile = intent.y * w + intent.x;
      if (structureAt(world, sc, tile) >= 0) return; // someone founded here first; re-evaluate next tick
      const spec = STRUCTURE_SPECS[intent.kind]!;
      const missing = emptyInv();
      for (const [item, qty] of spec.materials) missing[item] = qty;
      const s: Structure = {
        id: world.structures.length,
        kind: spec.kind,
        x: intent.x,
        y: intent.y,
        foundedTick: world.tick,
        builtTick: -1,
        founder: a.id,
        contributors: [],
        contributions: [],
        builders: [a.id],
        missing,
        laborDone: 0,
        laborNeeded: spec.labor,
        complete: false,
        fuel: 0,
        inv: emptyInv(),
        open: emptyInv(),
        ripeTick: -1,
        occupants: 0,
        bound: -1,
        integrity: 1000,
        removed: false,
        lore: 0,
      };
      world.structures.push(s);
      world.nextStructure = world.structures.length;
      sc.structDirty = true;
      if (spec.kind !== StructureKind.plot) world.metrics.projectsStarted++;
      emit(world, out, "found", a.id, { s: s.id, x: s.x, y: s.y, d: { kind: s.kind }, p: parents });
      return; // the build intent stays at the head: next tick it supplies and works
    }
    case "supply": {
      // reached through either a `build` intent (supply everything useful) or an explicit `supply`
      const sid = structureAt(world, sc, act.y * w + act.x);
      const s = sid >= 0 ? world.structures[sid]! : null;
      if (!s || s.complete) {
        if (intent.k === "supply") popIntent(a);
        return;
      }
      let moved = false;
      for (let i = 0; i < ITEM_COUNT; i++) {
        if (intent.k === "supply" && i !== intent.item) continue;
        const need = s.missing[i] as number;
        if (need <= 0) continue;
        let q = Math.min(need, a.inv[i] as number);
        if (intent.k === "supply") q = Math.min(q, Math.max(1, Math.floor(intent.qty)));
        if (q <= 0) continue;
        a.inv[i] = (a.inv[i] as number) - q;
        sink(world, i, q);
        s.missing[i] = need - q;
        contribute(s, a.id, q * ITEM_SPECS[i]!.worth, true);
        supplied(world, a, s, q * ITEM_SPECS[i]!.worth);
        emit(world, out, "supply", a.id, { s: s.id, i, q, p: parents });
        moved = true;
      }
      if (intent.k === "supply") popIntent(a);
      else if (!moved) popIntent(a);
      return;
    }
    case "work": {
      const sid = structureAt(world, sc, act.y * w + act.x);
      const s = sid >= 0 ? world.structures[sid]! : null;
      world.metrics.workTicks += act.dur;
      if (!s) {
        popIntent(a);
        return;
      }
      if (!s.complete && s.laborDone >= s.laborNeeded) completeStructure(world, sc, a, s, out);
      // whoever knows the craft of a work and labours at it shows those watching how it is done
      if (s.kind >= FIRST_WORK_KIND) demonstrate(world, a, craftFor(s.kind), out);
      if (s.complete || intent.k === "work") popIntent(a);
      return;
    }
    case "refuel": {
      if (intent.k !== "refuel") return;
      const s = structureIfUsable(world, intent.structure);
      if (!s || !s.complete || s.kind !== StructureKind.campfire) {
        reject(world, a, out, intent, "no_target");
        return;
      }
      const room = Math.floor((FIRE_MAX_FUEL - s.fuel) / FIRE_TICKS_PER_WOOD);
      const q = Math.min(Math.max(1, Math.floor(intent.qty)), a.inv[Item.wood] as number, room);
      if (q <= 0) {
        reject(world, a, out, intent, "fire_full");
        return;
      }
      a.inv[Item.wood] = (a.inv[Item.wood] as number) - q;
      sink(world, Item.wood, q);
      s.fuel += q * FIRE_TICKS_PER_WOOD;
      contribute(s, a.id, q * ITEM_SPECS[Item.wood]!.worth);
      supplied(world, a, s, q * ITEM_SPECS[Item.wood]!.worth);
      emit(world, out, "refuel", a.id, { s: s.id, q, p: parents });
      popIntent(a);
      return;
    }
    case "harvest": {
      if (intent.k !== "harvest") return;
      const s = structureIfUsable(world, intent.structure);
      if (!s || (s.kind !== StructureKind.plot && s.kind !== StructureKind.field) || !s.complete || s.ripeTick < 0 || world.tick < s.ripeTick) {
        reject(world, a, out, intent, "contested");
        return;
      }
      const tile = s.y * w + s.x;
      const isField = s.kind === StructureKind.field;
      let y = isField ? FIELD_YIELD : PLOT_YIELD;
      if ((world.terrain.fertility[tile] as number) >= 70) y += isField ? 2 : 1;
      if ((a.skills[Skill.farm] as number) >= 500) y += isField ? 2 : 1;
      source(world, Item.root, y);
      const kept = Math.min(y, roomFor(a, Item.root));
      a.inv[Item.root] = (a.inv[Item.root] as number) + kept;
      if (kept < y) dropOnGround(world, sc, a.x, a.y, Item.root, y - kept);
      a.stats.gathered[Item.root] = (a.stats.gathered[Item.root] as number) + y;
      world.metrics.gatheredUnits += y;
      world.metrics.workTicks += act.dur;
      if (isField) {
        // a reaped field stands, unsown: seed and the labour of sowing make it bear again
        s.complete = false;
        s.ripeTick = -1;
        s.missing[Item.root] = FIELD_RESOW_ROOTS;
        s.laborDone = 0;
        s.laborNeeded = FIELD_RESOW_LABOR;
        world.metrics.fieldHarvests++;
      } else {
        s.removed = true;
      }
      sc.structDirty = true;
      gainSkill(world, a, Skill.farm, 5);
      emit(world, out, "harvest", a.id, isField ? { s: s.id, q: y, b: s.founder, r: "field", p: parents } : { s: s.id, q: y, b: s.founder, p: parents });
      if (isField) demonstrate(world, a, Craft.tillage, out);
      if (s.founder !== a.id) {
        // the planter, if watching, notices someone else reaping what they sowed
        for (const o of witnesses(world, s.x, s.y, a.id)) {
          if (o.id === s.founder) {
            remember(world, o, "took", { who: a.id, ref: s.id, item: Item.root, qty: y, salience: 700 });
            noteTaking(o, a.id, true);
          }
        }
      }
      popIntent(a);
      return;
    }
    case "give": {
      if (intent.k !== "give") return;
      const t = world.agents[intent.to];
      if (!t || !t.alive || cheb(a.x, a.y, t.x, t.y) > 1) {
        reject(world, a, out, intent, "target_missing");
        return;
      }
      const item = intent.item;
      const q = Math.min(Math.max(1, Math.floor(intent.qty)), a.inv[item] as number, roomFor(t, item));
      if (q <= 0) {
        reject(world, a, out, intent, (a.inv[item] as number) <= 0 ? "no_item" : "no_capacity");
        return;
      }
      a.inv[item] = (a.inv[item] as number) - q;
      t.inv[item] = (t.inv[item] as number) + q;
      if (ITEM_SPECS[item]!.uses > 0 && (t.toolUses[item] as number) <= 0) t.toolUses[item] = ITEM_SPECS[item]!.uses;
      const worth = q * ITEM_SPECS[item]!.worth;
      a.stats.givenUnits += q;
      a.stats.givenWorth += worth;
      t.stats.receivedUnits += q;
      t.stats.receivedWorth += worth;
      a.mind.gave[t.id] = (a.mind.gave[t.id] as number) + worth;
      t.mind.got[a.id] = (t.mind.got[a.id] as number) + worth;
      t.mind.trust[a.id] = clampInt((t.mind.trust[a.id] as number) + Math.min(140, 20 + worth * 2), 0, 1000);
      t.mind.metX[a.id] = a.x;
      t.mind.metY[a.id] = a.y;
      t.mind.metTick[a.id] = world.tick;
      remember(world, t, "got", { who: a.id, item, qty: q, salience: clampInt(260 + worth * 6, 0, 900) });
      remember(world, a, "gave", { who: t.id, item, qty: q, salience: 240 });
      world.metrics.gives++;
      world.metrics.giveUnits += q;
      const gift = emit(world, out, "give", a.id, { b: t.id, i: item, q, p: parents });
      settleGift(world, a, t, item, q, out, [gift]);
      popIntent(a);
      return;
    }
    case "drop": {
      if (intent.k !== "drop") return;
      const q = Math.min(Math.max(1, Math.floor(intent.qty)), a.inv[intent.item] as number);
      if (q > 0) {
        a.inv[intent.item] = (a.inv[intent.item] as number) - q;
        dropOnGround(world, sc, a.x, a.y, intent.item, q);
        emit(world, out, "drop", a.id, { i: intent.item, q, x: a.x, y: a.y, p: parents });
      }
      popIntent(a);
      return;
    }
    case "pickup": {
      if (intent.k !== "pickup") return;
      const k = pileAt(world, sc, a.y * w + a.x);
      const pile = k >= 0 ? world.piles[k]! : null;
      const q = pile ? Math.min(Math.max(1, Math.floor(intent.qty)), pile.inv[intent.item] as number, roomFor(a, intent.item)) : 0;
      if (!pile || q <= 0) {
        reject(world, a, out, intent, "contested");
        return;
      }
      pile.inv[intent.item] = (pile.inv[intent.item] as number) - q;
      a.inv[intent.item] = (a.inv[intent.item] as number) + q;
      if (ITEM_SPECS[intent.item]!.uses > 0 && (a.toolUses[intent.item] as number) <= 0) a.toolUses[intent.item] = ITEM_SPECS[intent.item]!.uses;
      emit(world, out, "pickup", a.id, { i: intent.item, q, x: a.x, y: a.y, p: parents });
      popIntent(a);
      return;
    }
    case "deposit": {
      if (intent.k !== "deposit") return;
      const s = structureIfUsable(world, intent.structure);
      if (!s || !s.complete) {
        reject(world, a, out, intent, "no_target");
        return;
      }
      if (s.kind === StructureKind.healing_house) {
        if (!isRemedy(intent.item) || !knows(a, Craft.herb_lore)) {
          reject(world, a, out, intent, "unknown_craft");
          return;
        }
        if (layUpCare(world, a, s, intent.item, Math.max(1, Math.floor(intent.qty)), out, parents) <= 0) {
          reject(world, a, out, intent, (a.inv[intent.item] as number) <= 0 ? "no_item" : "store_full");
          return;
        }
        popIntent(a);
        return;
      }
      const cap = goodsCapacity(s.kind);
      const roomUnits = Math.floor((cap - storeLoad(s)) / ITEM_SPECS[intent.item]!.weight);
      const q = Math.min(Math.max(1, Math.floor(intent.qty)), a.inv[intent.item] as number, roomUnits);
      if (q <= 0 || !storeAccess(world, a, s, "deposit", intent.item, q)) {
        reject(world, a, out, intent, q <= 0 ? "store_full" : "not_permitted");
        return;
      }
      a.inv[intent.item] = (a.inv[intent.item] as number) - q;
      s.inv[intent.item] = (s.inv[intent.item] as number) + q;
      contribute(s, a.id, q * ITEM_SPECS[intent.item]!.worth);
      const ev = emit(world, out, "deposit", a.id, { s: s.id, i: intent.item, q, p: parents });
      storeAccess(world, a, s, "deposited", intent.item, q, ev, out);
      popIntent(a);
      return;
    }
    case "withdraw": {
      if (intent.k !== "withdraw") return;
      const s = structureIfUsable(world, intent.structure);
      if (!s || !s.complete) {
        reject(world, a, out, intent, "no_target");
        return;
      }
      const wanted = Math.min(Math.max(1, Math.floor(intent.qty)), s.inv[intent.item] as number, roomFor(a, intent.item));
      if (wanted <= 0) {
        reject(world, a, out, intent, "contested");
        return;
      }
      // a controlled store opens only as far as its charter allows this person, this period
      const q = Math.min(wanted, withdrawLimit(world, a, s, intent.item));
      if (q <= 0 || !storeAccess(world, a, s, "withdraw", intent.item, q)) {
        reject(world, a, out, intent, "not_permitted");
        return;
      }
      s.inv[intent.item] = (s.inv[intent.item] as number) - q;
      a.inv[intent.item] = (a.inv[intent.item] as number) + q;
      if (ITEM_SPECS[intent.item]!.uses > 0 && (a.toolUses[intent.item] as number) <= 0) a.toolUses[intent.item] = ITEM_SPECS[intent.item]!.uses;
      const ev = emit(world, out, "withdraw", a.id, { s: s.id, i: intent.item, q, p: parents });
      storeAccess(world, a, s, "withdrew", intent.item, q, ev, out);
      // anyone who stocked this store and is watching will remember who took from it
      if (s.bound < 0) {
        for (const o of witnesses(world, s.x, s.y, a.id)) {
          if (s.contributors.includes(o.id) && !s.contributors.includes(a.id)) {
            remember(world, o, "took", { who: a.id, ref: s.id, item: intent.item, qty: q, salience: 650 });
            noteTaking(o, a.id, false);
          }
        }
      }
      popIntent(a);
      return;
    }
    case "say": {
      if (intent.k !== "say") return;
      const text = sanitizeText(intent.text);
      const id = world.nextUtterance++;
      const utterance = { id, tick: world.tick, from: a.id, to: intent.to, x: a.x, y: a.y, act: intent.act, ...(text ? { text } : {}) };
      world.speech.push(utterance);
      notePromiseMade(world, a, utterance);
      a.stats.said++;
      world.metrics.utterances++;
      emit(world, out, "say", a.id, {
        ...(intent.to >= 0 ? { b: intent.to } : {}),
        x: a.x,
        y: a.y,
        d: text ? { u: id, act: intent.act, text } : { u: id, act: intent.act },
        p: parents,
      });
      popIntent(a);
      return;
    }
    case "inspect": {
      if (intent.k !== "inspect") return;
      const s = structureIfUsable(world, intent.structure);
      if (s) {
        let ks = a.mind.structs.find((k) => k.id === s.id);
        if (!ks) {
          ks = { id: s.id, kind: s.kind, x: s.x, y: s.y, tick: world.tick, state: 0, bound: -1 };
          a.mind.structs.push(ks);
        }
        ks.tick = world.tick;
        ks.state = structureStateCode(s, world.tick);
        ks.bound = s.bound;
        if (s.complete) delete ks.missing;
        else ks.missing = s.missing.slice();
        emit(world, out, "inspect", a.id, { s: s.id, p: parents });
        if (s.kind === StructureKind.record_house) {
          visitRecords(world, a, s, out);
          ks.state = structureStateCode(s, world.tick);
        }
      }
      popIntent(a);
      return;
    }
    default: {
      // institutional acts complete inside the institution module
      popIntent(a);
      return;
    }
  }
}

/** Advance the action in progress by one tick; complete it when its time is up. */
export function advance(world: WorldState, sc: Scratch, a: Agent, out: EventOut): void {
  const act = a.act;
  if (!act) return;
  act.t--;
  if (act.k === "work") {
    // labour accrues every tick so that several workers add up
    const sid = structureAt(world, sc, act.y * sc.w + act.x);
    if (sid >= 0) {
      const s = world.structures[sid]!;
      if (!s.complete) {
        let labour = 1;
        if (chance(a.skills[Skill.build] as number, 2000, world.config.seed, Stream.Gather, world.tick, a.id, 9)) labour++;
        if (a.ill > 0 && world.tick % 2 === 0) labour = 0;
        s.laborDone += labour;
        contribute(s, a.id, labour, true);
        if (labour > 0) supplied(world, a, s, labour);
        if (s.laborDone >= s.laborNeeded) act.t = 0;
      } else {
        act.t = 0;
      }
    } else {
      act.t = 0;
    }
  } else if (act.k === "rest") {
    // wake early when fully rested in daylight, or when a need becomes pressing
    const light = world.climate.light;
    if ((a.rest >= 985 && light > 300) || a.hydration < 150 || a.energy < 110 || (a.warmth < 170 && a.shelter < 0)) act.t = 0;
  }
  if (act.t > 0) return;
  if (act.k === "step") {
    finishStep(world, sc, a);
    return;
  }
  complete(world, sc, a, out);
}

/** Used by tests and the planner: random helper kept here so the Stream ids stay in one place. */
export function tieBreak(world: WorldState, a: Agent, n: number, salt: number): number {
  return below(n, world.config.seed, Stream.Policy, world.tick, a.id, salt);
}
