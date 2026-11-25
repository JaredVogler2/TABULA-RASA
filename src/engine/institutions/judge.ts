/**
 * How a BASELINE agent judges a charter: is living under these rules worth it to me?
 *
 * This is a hand-written estimate, in rough energy units over a ten-day horizon, of what
 * the rules would cost this agent and what they would give it, from its own experience
 * (how often it has gone hungry or cold, whether it has found places stripped bare), its
 * temperament and its trust in the people already signed up. It is a designer prior about
 * how a boundedly rational person weighs an agreement, disclosed as such. It is used to
 * decide whether to endorse, how to vote, and — in the grammar-search treatment — which of
 * several randomly generated charters to put forward.
 *
 * It reads the charter and the agent's own mind. It reads no other agent's private state.
 */
import { ITEM_SPECS, Item, StructureKind, TICKS_PER_DAY, Trait } from "../model/constants";
import type { Agent, WorldState } from "../model/types";
import { calendarAt } from "../world/climate";
import { recall } from "../mind/knowledge";
import { sensesCold } from "../mind/social";
import { evalExpr, type Facts } from "./expr";
import type { Charter, MotionBody, Rule } from "./types";

const HORIZON_DAYS = 10;
/** Energy value of a typical unit of stored food. */
const FOOD_E = 180;

/** The facts as they would be for this agent as an ordinary member, in a given state of hunger and season. */
function imagined(world: WorldState, charter: Charter, members: number, hunger: number, season: number, stock: number): Facts {
  return {
    members,
    day: 5,
    season,
    night: 0,
    stock: () => stock,
    tenure: 3,
    bond: charter.bond?.qty ?? 0,
    breaches: 0,
    deposited: () => 0,
    withdrawn: () => 0,
    hunger,
    roles: 0,
  };
}

const ordinary = (rule: Rule): boolean => rule.who.t === "all" || rule.who.t === "others";

export interface Judgement {
  score: number;
  /** The largest single consideration, for the decision record. */
  why: string;
}

/**
 * Estimated net value to `agent` of being a member of an institution with this charter.
 * `signed` are the people known to have endorsed it so far.
 */
export function judgeCharter(world: WorldState, agent: Agent, charter: Charter, signed: readonly number[]): Judgement {
  // a larder or a roof half a day's walk away is of little use: how far is what this charter controls?
  let far = 0;
  for (const id of charter.stores) {
    const s = world.structures[id];
    if (!s) continue;
    const hx = agent.mind.homeX >= 0 ? agent.mind.homeX : agent.x;
    const hy = agent.mind.homeX >= 0 ? agent.mind.homeY : agent.y;
    const dx = s.x > hx ? s.x - hx : hx - s.x;
    const dy = s.y > hy ? s.y - hy : hy - s.y;
    far = Math.max(far, dx > dy ? dx : dy);
  }
  const reach = far <= 6 ? 1 : Math.max(0, 1 - (far - 6) / 10);
  const t = agent.traits;
  const m = agent.mind;
  const prudence = t[Trait.prudence] as number;
  const season = calendarAt(world.config, world.tick).season;
  const members = Math.max(charter.minFounders, signed.length + 1);
  const periods = Math.max(1, Math.round((HORIZON_DAYS * TICKS_PER_DAY) / charter.period));
  const daysLived = Math.floor(world.tick / TICKS_PER_DAY) + 1;
  const cold = sensesCold(agent);
  // how likely am I to be visibly hungry in a given period, by my own record?
  const pHungry = Math.min(0.6, m.hungerDays / daysLived + (cold === 2 ? 0.25 : cold === 1 ? 0.12 : 0.04));
  // a unit of food when hungry is worth more than a unit given up when fed; the prudent feel this more
  const relief = 1.6 + prudence / 50;
  const fuel = { left: 4000 };
  const hasStore = charter.stores.some((id) => world.structures[id]?.kind === StructureKind.store);
  const hasShelter = charter.stores.some((id) => world.structures[id]?.kind === StructureKind.shelter);

  let dues = 0; // units of food per period I would owe
  let supply = 0;
  let hearthCost = 0;
  let hearthFed = 0;
  let hearthNear = 0;
  let restraintCost = 0;
  let restraintGain = 0;
  let harsh = 0;
  for (const rule of charter.rules) {
    if (!ordinary(rule)) continue;
    if (rule.r === "must_deposit") {
      const f = imagined(world, charter, members, 0, season, 10);
      if (rule.when && evalExpr(rule.when, f, fuel) === 0) continue;
      const q = Math.max(0, Math.min(50, evalExpr(rule.qty, f, fuel)));
      dues += q * (rule.item < 0 ? 1 : ITEM_SPECS[rule.item]!.energy > 0 ? 1 : 0.4);
      if (rule.else.t === "expel") harsh += 1;
      else if (rule.else.t === "forfeit") harsh += 0.5;
    } else if (rule.r === "must_supply") {
      const f = imagined(world, charter, members, 0, cold === 2 ? 3 : season, 10);
      const s = world.structures[rule.structure];
      if (s && s.kind === StructureKind.campfire) {
        // keeping a hearth: a recurring cost in wood, and a fire that others are bound to feed too
        const inWinter = imagined(world, charter, members, 0, 3, 10);
        const owedNow = rule.when && evalExpr(rule.when, f, fuel) === 0 ? 0 : Math.max(0, Math.min(2000, evalExpr(rule.worth, f, fuel)));
        const owedCold = rule.when && evalExpr(rule.when, inWinter, fuel) === 0 ? 0 : Math.max(0, Math.min(2000, evalExpr(rule.worth, inWinter, fuel)));
        const owed = cold > 0 ? Math.max(owedNow, owedCold) : owedNow;
        hearthCost += owed * 5; // a unit of wood is worth 8 and takes the better part of an hour to fetch
        hearthFed += owedCold * (members - 1);
        const hx = agent.mind.homeX >= 0 ? agent.mind.homeX : agent.x;
        const hy = agent.mind.homeX >= 0 ? agent.mind.homeY : agent.y;
        const dx = s.x > hx ? s.x - hx : hx - s.x;
        const dy = s.y > hy ? s.y - hy : hy - s.y;
        hearthNear = Math.max(0, 1 - Math.max(0, (dx > dy ? dx : dy) - 4) / 8);
      } else {
        supply += Math.max(0, Math.min(2000, evalExpr(rule.worth, f, fuel)));
      }
    } else if (rule.r === "must_not_gather") {
      const f = imagined(world, charter, members, 0, season, 10);
      if (rule.when && evalExpr(rule.when, f, fuel) === 0) continue;
      const allowed = Math.max(0, Math.min(200, evalExpr(rule.over, f, fuel)));
      const usual = (6 * charter.period) / TICKS_PER_DAY; // what a forager takes of one kind near home in a period
      const cut = Math.max(0, usual - allowed);
      restraintCost += cut * 110 * 0.5;
      // having found places stripped bare is what makes others' restraint worth something to me
      const scarred = Math.min(4, recall(world, agent, "empty", 6 * TICKS_PER_DAY));
      restraintGain += cut > 0 ? scarred * (members - 1) * 30 : 0;
    }
  }

  // what could I draw when I need it, and what when I do not?
  let drawHungry = 0;
  let drawFed = 0;
  for (const rule of charter.rules) {
    if (rule.r !== "may_withdraw" || !ordinary(rule)) continue;
    if (rule.item >= 0 && ITEM_SPECS[rule.item]!.energy === 0) continue;
    const stock = Math.max(4, dues * members * 2);
    for (const [hunger, into] of [[2, "h"], [0, "f"]] as const) {
      const f = imagined(world, charter, members, hunger, cold === 2 ? 3 : season, stock);
      if (rule.when && evalExpr(rule.when, f, fuel) === 0) continue;
      const q = Math.max(0, Math.min(200, evalExpr(rule.quota, f, fuel)));
      if (into === "h") drawHungry = Math.max(drawHungry, q);
      else drawFed = Math.max(drawFed, q);
    }
  }

  const considerations: [string, number][] = [];
  if (hasStore) {
    // nobody can draw more than was put in: expected draws are capped by expected dues (plus what the builders stocked)
    const pool = dues * members + 2;
    const expectedDraw = Math.min(pool / members + dues, pHungry * drawHungry + (1 - pHungry) * drawFed);
    const insurance = Math.min(drawHungry, pool) * pHungry * FOOD_E * relief * periods;
    const routine = Math.max(0, expectedDraw - pHungry * drawHungry) * FOOD_E * periods;
    considerations.push(["food_when_hungry", (insurance + routine * 0.5) * reach]);
    // food behind a lock keeps longer and is not there for strangers to take
    if (dues > 0) considerations.push(["safe_keeping", dues * FOOD_E * periods * 0.2 * reach]);
  }
  if (dues > 0) considerations.push(["dues", -dues * FOOD_E * periods * (hasStore ? 1 : 1.3) * (2 - reach)]);
  if (reach === 0 && (hasStore || charter.stores.length > 0)) considerations.push(["too_far", -400]);
  if (supply > 0) considerations.push(["labour_owed", -supply * 6 * Math.min(periods, 3)]);
  if (hearthCost > 0 || hearthFed > 0) {
    considerations.push(["fuel_owed", -hearthCost * periods * (2 - hearthNear)]);
    // a fire that burns through the night because others are bound to feed it: worth most to those who have been cold
    const want = (m.coldNights * 260 + cold * 650) * hearthNear;
    considerations.push(["a_kept_fire", Math.min(want, hearthFed * 12 * periods)]);
  }
  if (hasShelter) {
    const need = m.coldNights * 250 + cold * 700;
    const have = m.structs.some((k) => k.kind === StructureKind.shelter && k.state >= 1 && k.bound < 0);
    considerations.push(["a_roof", (have ? need * 0.2 : need) * reach]);
  }
  if (restraintCost > 0) considerations.push(["harvest_limits", -restraintCost * periods * (1.3 - (t[Trait.patience] as number) / 100)]);
  if (restraintGain > 0) considerations.push(["others_restraint", restraintGain * periods]);
  if (charter.bond) {
    const value = charter.bond.qty * Math.max(ITEM_SPECS[charter.bond.item]!.energy, ITEM_SPECS[charter.bond.item]!.worth * 8);
    considerations.push(["bond_at_risk", -value * (0.15 + harsh * 0.2)]);
  }
  if (harsh > 0) considerations.push(["harsh_terms", -harsh * 90 * (1.2 - (t[Trait.boldness] as number) / 100)]);

  let score = 0;
  let top = "nothing_in_it";
  let topAbs = 0;
  for (const [name, v] of considerations) {
    score += v;
    if (Math.abs(v) > topAbs) {
      topAbs = Math.abs(v);
      top = name;
    }
  }
  // company matters: trust in those already in, and the pull of numbers on the conforming
  if (signed.length > 0) {
    let trust = 0;
    for (const id of signed) trust += id === agent.id ? 600 : (m.trust[id] as number);
    const mean = trust / signed.length;
    score = score >= 0 ? score * (0.5 + mean / 1000) : score * (1.5 - mean / 1000);
    score += signed.length * (t[Trait.conformity] as number) * 0.6;
  }
  if (fuel.left < 0) return { score: -1, why: "too_tangled_to_judge" };
  return { score: Math.round(score), why: top };
}

/** The bar a charter must clear before this agent signs it. The cautious and the unsociable ask for more. */
export function signingBar(agent: Agent): number {
  return 220 - (agent.traits[Trait.sociability] as number) * 1.2 + (agent.traits[Trait.prudence] as number) * 0.6;
}

/** How a member votes on a motion. Returns null to abstain. */
export function judgeMotion(world: WorldState, agent: Agent, charter: Charter, memberIds: readonly number[], body: MotionBody): boolean | null {
  const m = agent.mind;
  switch (body.m) {
    case "amend": {
      const now = judgeCharter(world, agent, charter, memberIds).score;
      const then = judgeCharter(world, agent, { ...charter, rules: body.rules }, memberIds).score;
      if (then === now) return null;
      return then > now;
    }
    case "admit":
      return (m.trust[body.agent] as number) >= 420 && (m.broke[body.agent] as number) === 0;
    case "expel":
      if (body.agent === agent.id) return false;
      return (m.trust[body.agent] as number) < 320 || (m.broke[body.agent] as number) > 0;
    case "assign":
      return body.agent === agent.id || (m.trust[body.agent] as number) >= 520;
    case "grant": {
      if (body.agent === agent.id) return true;
      const generous = (agent.traits[Trait.generosity] as number) + ((m.trust[body.agent] as number) - 500) / 8;
      return generous >= 50;
    }
    case "bind":
      return true;
    case "release":
      return false;
    case "dissolve":
      return judgeCharter(world, agent, charter, memberIds).score < 0;
  }
}

/** Units of food this member still owes for the current period under the charter's dues, as far as they can tell. */
export function duesOutstanding(world: WorldState, agent: Agent, charter: Charter, deposited: number, members: number): number {
  const season = calendarAt(world.config, world.tick).season;
  const fuel = { left: 2000 };
  let owed = 0;
  for (const rule of charter.rules) {
    if (rule.r !== "must_deposit" || !ordinary(rule)) continue;
    if (rule.item >= 0 && rule.item !== Item.root && rule.item !== Item.ration && rule.item !== Item.berry && rule.item !== Item.fish) continue;
    const f = imagined(world, charter, members, 0, season, 10);
    if (rule.when && evalExpr(rule.when, f, fuel) === 0) continue;
    owed = Math.max(owed, Math.max(0, Math.min(50, evalExpr(rule.qty, f, fuel))));
  }
  return Math.max(0, owed - deposited);
}

/** A member's unmet undertakings to supply structures this period: [structure id, worth still owed]. */
export function supplyOutstanding(world: WorldState, agent: Agent, charter: Charter, supplied: number, members: number): [number, number][] {
  const season = calendarAt(world.config, world.tick).season;
  const fuel = { left: 2000 };
  const out: [number, number][] = [];
  for (const rule of charter.rules) {
    if (rule.r !== "must_supply" || !ordinary(rule)) continue;
    const s = world.structures[rule.structure];
    if (!s || s.removed || (s.complete && s.kind !== StructureKind.campfire)) continue;
    const f = imagined(world, charter, members, 0, season, 10);
    if (rule.when && evalExpr(rule.when, f, fuel) === 0) continue;
    const owed = Math.max(0, Math.min(2000, evalExpr(rule.worth, f, fuel))) - supplied;
    if (owed > 0) out.push([s.id, owed]);
  }
  return out;
}

