/**
 * The civic side of the BASELINE mind: how a planner agent deals with charters that exist
 * or are on offer — weighing whether to sign, voting, paying dues, drawing a ration,
 * telling others, walking away — and, where the treatment allows it, searching the rule
 * grammar for a charter worth proposing.
 *
 * Nothing here knows what an institution is "for". Signing, voting and proposing all run
 * through one estimate of what living under a given set of rules would be worth to this
 * agent (`institutions/judge.ts`). The only source of a proposal is `searchCharter`: there
 * is no hand-written charter anywhere in the baseline mind.
 */
import { FOOD_ITEMS, ITEM_SPECS, Item, StructureKind, TICKS_PER_DAY, Trait } from "../model/constants";
import type { Agent, Intent, WorldState } from "../model/types";
import { activeMemberships, institutionById, memberOf, proposalById, withdrawAllowance } from "../institutions/engine";
import { duesOutstanding, judgeCharter, judgeMotion, signingBar, supplyOutstanding } from "../institutions/judge";
import { bestKnownNode } from "./knowledge";
import { NodeKind } from "../model/constants";
import { searchCharter } from "../institutions/search";
import { foodEnergy, roomFor } from "../sim/inventory";
import { sensesCold } from "./social";
import type { Scratch } from "../sim/scratch";
import { recall, remember } from "./knowledge";
import type { Plan } from "./reflex";
import type { SeenAgent } from "./senses";

/** Extra slots of `mind.cool` used by the civic layer. */
export const CIVIC_COOL = { announce: 8, search: 9, trade: 10 } as const;

const DAILY = 310;

const cheb = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax > bx ? ax - bx : bx - ax;
  const dy = ay > by ? ay - by : by - ay;
  return dx > dy ? dx : dy;
};

function plan(goal: string, why: string, ...intents: Intent[]): Plan {
  return { goal, why, intents };
}

function foodOf(inv: readonly number[]): number {
  let n = 0;
  for (const f of FOOD_ITEMS) n += inv[f] as number;
  return n;
}

/** Draw what the charter allows from a store this agent's institution controls. */
export function drawRation(world: WorldState, a: Agent, hungry: boolean): Plan | null {
  if (a.memberships === 0) return null;
  const have = foodEnergy(a.inv);
  if (have >= (hungry ? 200 : DAILY * 0.7)) return null;
  for (const inst of activeMemberships(world, a.id)) {
    for (const sid of inst.stores) {
      const s = world.structures[sid];
      if (!s || s.removed || !s.complete || s.kind !== StructureKind.store) continue;
      const d = cheb(s.x, s.y, a.x, a.y);
      if (d > (hungry ? 16 : 8)) continue;
      const known = a.mind.structs.find((k) => k.id === sid);
      if (!known || known.state < 2) continue; // believed empty
      for (const item of [Item.fish, Item.berry, Item.root, Item.ration]) {
        // what is inside is in plain view at the door; from further off, try the staples
        if (d <= 1 ? (s.inv[item] as number) <= 0 : item !== Item.root && item !== Item.ration) continue;
        const allowed = withdrawAllowance(world, a, s, item);
        if (allowed < 1 || roomFor(a, item) < 1) continue;
        return plan("draw_ration", hungry ? "hungry_and_entitled" : "entitled", { k: "withdraw", structure: sid, item, qty: Math.min(allowed, 3) });
      }
    }
  }
  return null;
}

/** Obligations a member takes seriously before its own projects: votes and dues. */
export function civicDuty(world: WorldState, _sc: Scratch, a: Agent): Plan | null {
  if (a.memberships === 0) return null;
  const mine = activeMemberships(world, a.id);
  if (mine.length === 0) return null;
  const t = a.traits;

  for (const mo of world.inst.motions) {
    if (mo.state !== "open" || mo.yes.includes(a.id) || mo.no.includes(a.id)) continue;
    const inst = mine.find((x) => x.id === mo.institution);
    if (!inst) continue;
    const me = memberOf(inst, a.id)!;
    if (me.joined > mo.tick) continue;
    const yes = judgeMotion(world, a, inst.charter, inst.members.map((m) => m.id), mo.body);
    if (yes === null) continue;
    return plan("vote", yes ? "for" : "against", { k: "vote", motion: mo.id, yes });
  }

  const foodE = foodEnergy(a.inv);
  for (const inst of mine) {
    const me = memberOf(inst, a.id)!;
    const owed = duesOutstanding(world, a, inst.charter, foodOf(me.dep), inst.members.length);
    if (owed <= 0) continue;
    const store = inst.stores.map((sid) => world.structures[sid]).find((s) => s && !s.removed && s.complete && s.kind === StructureKind.store);
    if (!store || cheb(store.x, store.y, a.x, a.y) > 12) continue;
    // dues are paid from what one can spare; the conforming pay even when it pinches
    for (const item of [Item.berry, Item.fish, Item.root, Item.ration]) {
      const have = a.inv[item] as number;
      if (have <= 0) continue;
      const q = Math.min(have, owed);
      const after = foodE - q * ITEM_SPECS[item]!.energy;
      if (after < DAILY * 0.5 && (t[Trait.conformity] as number) < 50) continue;
      return plan("pay_dues", "undertook_to", { k: "deposit", structure: store.id, item, qty: q });
    }
  }

  for (const inst of mine) {
    const me = memberOf(inst, a.id)!;
    for (const [sid, owed] of supplyOutstanding(world, a, inst.charter, me.supplied, inst.members.length)) {
      const s = world.structures[sid]!;
      if (cheb(s.x, s.y, a.x, a.y) > 14) continue;
      if (s.kind !== StructureKind.campfire || !s.complete) {
        return plan("build_together", "undertook_to", { k: "build", kind: s.kind, x: s.x, y: s.y });
      }
      // fuel: a unit of wood is worth 8
      const need = Math.max(1, Math.ceil(owed / ITEM_SPECS[Item.wood]!.worth));
      const wood = a.inv[Item.wood] as number;
      if (wood >= 1) return plan("feed_hearth", "undertook_to", { k: "refuel", structure: sid, qty: Math.min(wood, need) });
      const tree = bestKnownNode(world, a, [NodeKind.tree]);
      if (tree.node >= 0 && roomFor(a, Item.wood) > 0) {
        return plan("feed_hearth", "undertook_to", { k: "gather", node: tree.node, qty: Math.min(need + 1, 4) }, { k: "refuel", structure: sid, qty: need });
      }
    }
  }

  // someone repeatedly sanctioned under rules they now rate badly walks away
  for (const inst of mine) {
    const me = memberOf(inst, a.id)!;
    if (me.breaches < 2) continue;
    if (judgeCharter(world, a, inst.charter, inst.members.map((m) => m.id)).score < -200) return plan("leave", "not_worth_it", { k: "leave", institution: inst.id });
  }
  return null;
}

/** Charters on offer are weighed once, and again only if more people have signed since. */
function consider(world: WorldState, a: Agent): Plan | null {
  const m = a.mind;
  for (let k = m.charters.length - 1; k >= 0; k--) {
    const id = m.charters[k] as number;
    const p = proposalById(world, id);
    if (!p || p.state === "lapsed") continue;
    const inst = p.state === "ratified" ? institutionById(world, id) : undefined;
    if (p.state === "ratified" && (!inst || inst.ended >= 0)) continue;
    const signed = inst ? inst.members.map((x) => x.id) : p.endorsers;
    if (signed.includes(a.id)) continue;
    if (inst && inst.charter.entry === "closed" && world.tick > p.expires) continue;
    if (inst && inst.members.length >= inst.charter.maxMembers) continue;
    const seenBefore = m.mem.find((x) => x.kind === "proposal" && x.ref === id);
    if (seenBefore && seenBefore.qty >= signed.length) continue;
    if (seenBefore) seenBefore.qty = signed.length;
    else remember(world, a, "proposal", { ref: id, who: p.proposer, qty: signed.length, salience: 380 });
    const charter = inst ? inst.charter : p.charter;
    if (charter.bond && (a.inv[charter.bond.item] as number) < charter.bond.qty) continue;
    const j = judgeCharter(world, a, charter, signed);
    if (j.score < signingBar(a)) continue;
    return plan("sign", j.why, { k: "endorse", proposal: id });
  }
  return null;
}

/** Tell those in earshot about a charter one has put forward, or an institution one belongs to that is open to joiners. */
function announce(world: WorldState, a: Agent, seen: readonly SeenAgent[]): Plan | null {
  const m = a.mind;
  if (world.tick < (m.cool[CIVIC_COOL.announce] as number)) return null;
  const listeners = seen.filter((s) => s.audible && !s.asleep);
  if (listeners.length === 0) return null;
  const mineOpen = world.inst.proposals.find((p) => p.state === "open" && p.proposer === a.id);
  if (mineOpen && listeners.some((s) => !mineOpen.endorsers.includes(s.id))) {
    m.cool[CIVIC_COOL.announce] = world.tick + 16;
    return plan("announce", "seeking_founders", { k: "say", to: -1, act: { t: "announce", proposal: mineOpen.id } });
  }
  if ((a.traits[Trait.sociability] as number) < 45) return null;
  for (const inst of activeMemberships(world, a.id)) {
    if (inst.charter.entry === "closed" || inst.members.length >= inst.charter.maxMembers) continue;
    if (!listeners.some((s) => !memberOf(inst, s.id))) continue;
    m.cool[CIVIC_COOL.announce] = world.tick + TICKS_PER_DAY;
    return plan("announce", "seeking_members", { k: "say", to: -1, act: { t: "invite", institution: inst.id } });
  }
  return null;
}

/** Has this agent a recurring trouble of the kind an agreement might address? */
function troubled(world: WorldState, a: Agent): string {
  const m = a.mind;
  if (recall(world, a, "took", 6 * TICKS_PER_DAY) >= 1) return "was_taken_from";
  if (m.hungerDays >= 1) return "has_gone_hungry";
  if (recall(world, a, "empty", 6 * TICKS_PER_DAY) >= 3) return "found_places_bare";
  if (m.coldNights >= 2) return "has_been_cold";
  return "";
}

function search(world: WorldState, a: Agent): Plan | null {
  const mode = world.config.institutions;
  if (mode !== "grammar_search" && mode !== "open") return null;
  const m = a.mind;
  if (world.tick < (m.cool[CIVIC_COOL.search] as number)) return null;
  const trouble = troubled(world, a);
  if (!trouble) return null;
  // putting a charter to one's neighbours takes some nerve and some liking for company
  if ((a.traits[Trait.sociability] as number) + (a.traits[Trait.boldness] as number) < 85) return null;
  if (activeMemberships(world, a.id).length >= 2) return null;
  if (world.inst.proposals.some((p) => p.state === "open" && p.proposer === a.id)) return null;
  m.cool[CIVIC_COOL.search] = world.tick + 3 * TICKS_PER_DAY;
  const found = searchCharter(world, a);
  if (!found) return null;
  return plan("propose", trouble, { k: "propose", charter: found.charter });
}

// ───────────────────────── exchange

const TRADEABLE: readonly number[] = [Item.berry, Item.root, Item.fish, Item.ration, Item.wood, Item.stone, Item.fiber];

/**
 * What one more unit of an item is worth to this agent now, and how many it could part with.
 * This is the agent's own rough reckoning from its needs — there is no price anywhere in the
 * world, and two agents will usually value the same thing differently. That difference is
 * the only reason an exchange ever happens.
 */
export function valuation(a: Agent, item: number): { value: number; spare: number } {
  const have = a.inv[item] as number;
  const spec = ITEM_SPECS[item]!;
  if (spec.energy > 0) {
    const foodE = foodEnergy(a.inv);
    const base = spec.energy / 10;
    const m = foodE < DAILY * 0.5 ? 2.4 : foodE < DAILY * 1.5 ? 1.3 : foodE < DAILY * 3 ? 0.9 : 0.55;
    // food can be spared only out of what exceeds a day and a half of eating
    const spareE = Math.max(0, foodE - Math.round(DAILY * 1.5));
    return { value: base * m, spare: Math.min(have, Math.floor(spareE / spec.energy)) };
  }
  const cold = sensesCold(a);
  if (item === Item.wood) {
    const want = cold > 0 ? 4 : 1;
    return { value: spec.worth * (have < want ? (cold > 0 ? 2.6 : 1.2) : 0.6), spare: Math.max(0, have - want) };
  }
  if (item === Item.stone) {
    const want = (a.inv[Item.spear] as number) === 0 || (a.inv[Item.axe] as number) === 0 ? 1 : 0;
    return { value: spec.worth * (have < want ? 1.7 : 0.6), spare: Math.max(0, have - want) };
  }
  if (item === Item.fiber) {
    const want = (a.inv[Item.basket] as number) === 0 ? 5 : 1;
    return { value: spec.worth * (have < want ? 1.7 : 0.6), spare: Math.max(0, have - want) };
  }
  return { value: spec.worth, spare: 0 };
}

/** Take up an offer one has heard, if by one's own reckoning it leaves one better off. */
function takeOffer(world: WorldState, a: Agent): Plan | null {
  const m = a.mind;
  for (const id of m.pacts) {
    const p = world.inst.pacts.find((x) => x.id === id);
    if (!p || p.state !== "open" || p.a === a.id || (p.b >= 0 && p.b !== a.id)) continue;
    if ((a.inv[p.want] as number) < p.wantQty) continue;
    const giveUp = valuation(a, p.want);
    if (giveUp.spare < p.wantQty) continue;
    const gain = valuation(a, p.give).value * p.giveQty - giveUp.value * p.wantQty;
    if (gain <= 4) continue;
    // go to where the offerer was last seen; the offer was made within earshot, so it is near
    if ((m.metTick[p.a] as number) < 0) continue;
    return plan("trade", "better_off", { k: "goto", x: m.metX[p.a] as number, y: m.metY[p.a] as number, near: 1 }, { k: "pact_accept", pact: id });
  }
  return null;
}

/**
 * Offer what one can spare for what one lacks, to whoever is in earshot. Returned with a
 * score so that the planner can weigh it against getting the thing oneself: an exchange is
 * worth proposing when fetching it would cost more than the offer does.
 */
export function offerCandidate(world: WorldState, a: Agent, seen: readonly SeenAgent[]): { score: number; plan: Plan } | null {
  if (world.config.institutions === "off") return null;
  const m = a.mind;
  if (world.tick < (m.cool[CIVIC_COOL.trade] as number)) return null;
  if (!seen.some((s) => s.audible && !s.asleep)) return null;
  if (world.inst.pacts.some((p) => p.state === "open" && p.a === a.id)) return null;
  let best: { give: number; giveQty: number; want: number; wantQty: number; gain: number } | null = null;
  for (const want of TRADEABLE) {
    // ask for the foods anyone might be carrying, not the rarer ones
    if (want === Item.fish || want === Item.ration) continue;
    const w = valuation(a, want);
    const wSpec = ITEM_SPECS[want]!;
    const wBase = wSpec.energy > 0 ? wSpec.energy / 10 : wSpec.worth;
    if (w.value <= wBase * 1.25) continue; // only ask for what is actually wanted
    const wantQty = wSpec.energy > 0 ? 2 : want === Item.fiber ? 3 : 1;
    if (roomFor(a, want) < wantQty) continue;
    for (const give of TRADEABLE) {
      if (give === want) continue;
      const g = valuation(a, give);
      const gSpec = ITEM_SPECS[give]!;
      const gBase = gSpec.energy > 0 ? gSpec.energy / 10 : gSpec.worth;
      if (g.spare < 1 || g.value >= gBase) continue; // only offer what is in surplus
      // offer a little more than an even swap at plain worth, so that it is worth someone's walk —
      // but never tie up more than half of what can be spared in one offer
      const giveQty = Math.min(Math.max(1, Math.floor(g.spare / 2)), Math.max(1, Math.ceil((wBase * wantQty * 1.15) / gBase)));
      const gain = w.value * wantQty - g.value * giveQty;
      if (gain > 4 && (!best || gain > best.gain)) best = { give, giveQty, want, wantQty, gain };
    }
  }
  if (!best) {
    m.cool[CIVIC_COOL.trade] = world.tick + 24;
    return null;
  }
  // the gain is in the agent's own units of worth (about a tenth of an energy unit); an offer costs a moment
  // and is taken up perhaps one time in four
  return { score: best.gain * 0.5, plan: plan("offer", "has_spare_and_lacks", { k: "pact_offer", to: -1, give: best.give, giveQty: best.giveQty, want: best.want, wantQty: best.wantQty }) };
}

/** Called when the planner adopts an offer, so that it is not repeated at once. */
export function offerMade(world: WorldState, a: Agent): void {
  // one offer a day: an offer nobody takes is not shouted again every few hours
  a.mind.cool[CIVIC_COOL.trade] = world.tick + TICKS_PER_DAY;
}

/** Civic acts that come before one's own projects: weighing what is on offer and finding founders. */
export function civicBusiness(world: WorldState, a: Agent, seen: readonly SeenAgent[]): Plan | null {
  if (world.config.institutions === "off") return null;
  return consider(world, a) ?? takeOffer(world, a) ?? announce(world, a, seen);
}

/** With nothing better to do: offer an exchange, or look for an agreement worth proposing. */
export function civicLeisure(world: WorldState, a: Agent, seen: readonly SeenAgent[]): Plan | null {
  if (world.config.institutions === "off") return null;
  const offer = offerCandidate(world, a, seen);
  if (offer) {
    offerMade(world, a);
    return offer.plan;
  }
  return search(world, a);
}
