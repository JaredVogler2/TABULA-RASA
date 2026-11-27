/**
 * The institution interpreter: lifecycle, consent, membership, bonds, controlled structures,
 * quotas, obligations, sanctions, motions and votes.
 *
 * It is a notary and a lock, not an actor. It records who consented to what; it lets a
 * member through a door when the charter they signed says they may pass; at the end of each
 * accounting period it compares what members did with what they undertook to do and applies
 * the sanction the charter names. It never moves goods except between a member and the
 * custody of an institution that member chose to join, and every such movement is logged.
 *
 * Lifecycle:  proposed → (validated) → open for endorsement → ratified → [amended]* → ended
 *                                      └→ lapsed
 */
import { FOOD_ITEMS, ITEM_COUNT, NODE_KINDS, StructureKind, TICKS_PER_DAY, needBand } from "../model/constants";
import type { Agent, Structure, WorldState } from "../model/types";
import { calendarAt, sightRadius } from "../world/climate";
import { noteFeedback } from "../mind/feedback";
import { emit, type EventOut } from "../sim/events";
import { dropOnGround, emptyInv, roomFor } from "../sim/inventory";
import type { Scratch } from "../sim/scratch";
import { holdsGoods } from "../sim/works";
import { evalExpr, type Facts, type Fuel } from "./expr";
import { LIMITS, type Charter, type Institution, type Member, type Motion, type Origin, type Proposal, type Rule, type Sanction, type Who } from "./types";
import { hasStanding, validateCharter, validateMotion } from "./validate";

const KNOWN_CAP = 12;

/** An agent comes to know that a charter (proposal or institution) exists. Its text is then public to them. */
export function learnCharter(a: Agent, id: number): void {
  const list = a.mind.charters;
  if (list.includes(id)) return;
  if (list.length >= KNOWN_CAP) list.shift();
  list.push(id);
}

export function institutionById(world: WorldState, id: number): Institution | undefined {
  return world.inst.institutions.find((x) => x.id === id);
}

export function proposalById(world: WorldState, id: number): Proposal | undefined {
  return world.inst.proposals.find((x) => x.id === id);
}

export function memberOf(inst: Institution, agentId: number): Member | undefined {
  return inst.members.find((m) => m.id === agentId);
}

export function activeMemberships(world: WorldState, agentId: number): Institution[] {
  return world.inst.institutions.filter((x) => x.ended < 0 && x.members.some((m) => m.id === agentId));
}

function newMember(id: number, tick: number): Member {
  return { id, joined: tick, bond: 0, breaches: 0, suspendedUntil: 0, roles: 0, dep: emptyInv(), wd: emptyInv(), supplied: 0, gathered: new Array<number>(NODE_KINDS.length).fill(0), flagged: 0, grants: emptyInv(), uses: 0 };
}

const sumItem = (inv: readonly number[], item: number): number => {
  if (item >= 0) return inv[item] as number;
  let n = 0;
  for (const f of FOOD_ITEMS) n += inv[f] as number;
  return n;
};

/** Units of `item` in a controlled store that are still open to everyone (they were there before the lock). */
function openPart(s: Structure, item: number): number {
  const o = s.open[item] as number;
  const have = s.inv[item] as number;
  return o < have ? o : have;
}

/** The common stock: what members have put into the structures the institution controls. */
function stockOf(world: WorldState, inst: Institution, item: number): number {
  let n = 0;
  for (const sid of inst.stores) {
    const s = world.structures[sid];
    if (!s || s.removed || !holdsGoods(s.kind)) continue;
    if (item >= 0) n += (s.inv[item] as number) - openPart(s, item);
    else for (const f of FOOD_ITEMS) n += (s.inv[f] as number) - openPart(s, f);
  }
  return n;
}

function factsFor(world: WorldState, inst: Institution, m: Member): Facts {
  const agent = world.agents[m.id]!;
  const cal = calendarAt(world.config, world.tick);
  return {
    members: inst.members.length,
    day: Math.floor((world.tick - inst.ratified) / TICKS_PER_DAY),
    season: cal.season,
    night: world.climate.light < 250 ? 1 : 0,
    stock: (item) => stockOf(world, inst, item),
    tenure: Math.floor((world.tick - m.joined) / TICKS_PER_DAY),
    bond: m.bond,
    breaches: m.breaches,
    deposited: (item) => sumItem(m.dep, item),
    withdrawn: (item) => sumItem(m.wd, item),
    hunger: needBand(agent.energy),
    roles: m.roles,
  };
}

function inScope(who: Who, m: Member): boolean {
  if (who.t === "all") return true;
  const holds = (m.roles & (1 << who.role)) !== 0;
  return who.t === "role" ? holds : !holds;
}

const clampInt = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// ───────────────────────── custody

function collectBond(world: WorldState, inst: Institution, agent: Agent, m: Member, out: EventOut): boolean {
  const bond = inst.charter.bond;
  if (!bond) return true;
  if ((agent.inv[bond.item] as number) < bond.qty) return false;
  agent.inv[bond.item] = (agent.inv[bond.item] as number) - bond.qty;
  inst.custody[bond.item] = (inst.custody[bond.item] as number) + bond.qty;
  m.bond = bond.qty;
  emit(world, out, "transfer", agent.id, { i: bond.item, q: bond.qty, r: "bond_posted", d: { inst: inst.id } });
  return true;
}

function releaseBond(world: WorldState, sc: Scratch, inst: Institution, m: Member, why: "refund" | "forfeit", qty: number, out: EventOut): void {
  const bond = inst.charter.bond;
  if (!bond || m.bond <= 0) return;
  const q = Math.min(qty, m.bond, inst.custody[bond.item] as number);
  if (q <= 0) return;
  m.bond -= q;
  inst.custody[bond.item] = (inst.custody[bond.item] as number) - q;
  const agent = world.agents[m.id]!;
  if (why === "refund" && agent.alive) {
    const kept = Math.min(q, roomFor(agent, bond.item));
    agent.inv[bond.item] = (agent.inv[bond.item] as number) + kept;
    if (kept < q) dropOnGround(world, sc, agent.x, agent.y, bond.item, q - kept);
  } else {
    // a forfeited bond (or one whose owner has died) passes to the common stock, or lies at the seat
    const store = inst.stores.map((sid) => world.structures[sid]).find((s) => s && !s.removed && s.complete && holdsGoods(s.kind));
    if (store) store.inv[bond.item] = (store.inv[bond.item] as number) + q;
    else dropOnGround(world, sc, inst.seatX, inst.seatY, bond.item, q);
  }
  emit(world, out, "transfer", m.id, { i: bond.item, q, r: why === "refund" ? "bond_returned" : "bond_forfeited", d: { inst: inst.id } });
}

// ───────────────────────── lifecycle

function originOf(agent: Agent): Origin {
  const src = agent.mind.src;
  return src === "live" || src === "replay" ? "llm" : src === "mock" ? "mock" : "grammar_search";
}

function membershipCount(world: WorldState, agentId: number): number {
  return activeMemberships(world, agentId).length;
}

/** An agent proposes a charter. Returns "done" or a reason code; a refusal is logged with its diagnostics. */
export function propose(world: WorldState, agent: Agent, rawCharter: unknown, out: EventOut, origin?: Origin): string {
  const mode = world.config.institutions;
  if (mode === "off") return "disabled";
  if (mode === "scripted_control" && origin !== "scripted") return "not_permitted";
  const st = world.inst;
  if (st.proposals.filter((p) => p.state === "open" && p.proposer === agent.id).length >= LIMITS.openProposalsPerAgent) return "proposal_pending";
  if (membershipCount(world, agent.id) >= LIMITS.membershipsPerAgent) return "too_many_memberships";
  const v = validateCharter(world, agent.id, rawCharter);
  if (!v.ok) {
    emit(world, out, "proposal_rejected", agent.id, { r: v.diagnostics[0]?.code ?? "invalid", d: { diagnostics: v.diagnostics.slice(0, 6) } });
    for (const g of v.diagnostics.slice(0, 3)) noteFeedback(world, agent, "propose", g.code, `${g.path}: ${g.message}`);
    return "invalid_charter";
  }
  // consent is backed at once: whoever signs, the proposer first, posts the bond when they sign
  const bond = v.value.bond;
  if (bond && (agent.inv[bond.item] as number) < bond.qty) return "no_bond";
  const p: Proposal = { id: st.nextId++, charter: v.value, origin: origin ?? originOf(agent), proposer: agent.id, tick: world.tick, expires: world.tick + LIMITS.proposalTicks, endorsers: [agent.id], held: 0, state: "open" };
  postToProposal(world, p, agent, out);
  st.proposals.push(p);
  learnCharter(agent, p.id);
  emit(world, out, "proposal", agent.id, { x: agent.x, y: agent.y, d: { inst: p.id, name: p.charter.name, origin: p.origin, rules: p.charter.rules.length } });
  world.metrics.proposals++;
  return "done";
}

function postToProposal(world: WorldState, p: Proposal, agent: Agent, out: EventOut): void {
  const bond = p.charter.bond;
  if (!bond) return;
  agent.inv[bond.item] = (agent.inv[bond.item] as number) - bond.qty;
  p.held += bond.qty;
  emit(world, out, "transfer", agent.id, { i: bond.item, q: bond.qty, r: "bond_posted", d: { inst: p.id } });
}

/** Give back what the endorsers of a proposal posted (it lapsed, or they could not all be seated). */
function refundProposal(world: WorldState, sc: Scratch, p: Proposal, ids: readonly number[], out: EventOut): void {
  const bond = p.charter.bond;
  if (!bond) return;
  for (const id of ids) {
    const q = Math.min(bond.qty, p.held);
    if (q <= 0) break;
    p.held -= q;
    const agent = world.agents[id]!;
    const kept = agent.alive ? Math.min(q, roomFor(agent, bond.item)) : 0;
    agent.inv[bond.item] = (agent.inv[bond.item] as number) + kept;
    if (kept < q) dropOnGround(world, sc, agent.x, agent.y, bond.item, q - kept);
    emit(world, out, "transfer", id, { i: bond.item, q, r: "bond_returned", d: { inst: p.id } });
  }
}

function bindStructure(world: WorldState, inst: Institution, s: Structure, out: EventOut): boolean {
  // consent: everyone who raised it must be a member, or it stays open. (What others left inside an
  // open store was already anyone's to take; a lock changes who may take it, not whose it was.)
  const builders = new Set<number>([s.founder, ...s.builders]);
  for (const b of builders) {
    if (world.agents[b]?.alive && !memberOf(inst, b)) {
      emit(world, out, "rule", -3, { s: s.id, r: "not_bound_builder_outside", b, d: { inst: inst.id } });
      return false;
    }
  }
  if (s.bound >= 0 || s.removed) return false;
  s.bound = inst.id;
  // what is inside was put there by people who agreed to nothing: it stays open to all
  s.open = s.inv.slice();
  inst.stores.push(s.id);
  let left = 0;
  for (const q of s.open) left += q;
  emit(world, out, "rule", -3, { s: s.id, r: "bound", q: left, d: { inst: inst.id } });
  return true;
}

function ratify(world: WorldState, sc: Scratch, p: Proposal, out: EventOut): void {
  const st = world.inst;
  const proposer = world.agents[p.proposer]!;
  const inst: Institution = {
    id: p.id,
    charter: p.charter,
    origin: p.origin,
    proposer: p.proposer,
    ratified: world.tick,
    seatX: proposer.x,
    seatY: proposer.y,
    members: [],
    stores: [],
    custody: emptyInv(),
    periodStart: world.tick,
    cursor: 0,
    ended: -1,
    endedWhy: "",
    uses: 0,
  };
  // founders are the endorsers still alive and free to join; their bonds are already posted
  const seated = p.endorsers.filter((id) => world.agents[id]!.alive && membershipCount(world, id) < LIMITS.membershipsPerAgent);
  const unseated = p.endorsers.filter((id) => !seated.includes(id));
  if (unseated.length > 0) {
    refundProposal(world, sc, p, unseated, out);
    p.endorsers = seated;
  }
  if (seated.length < p.charter.minFounders) return; // keep waiting for more signatures
  const bond = p.charter.bond;
  for (const id of seated) {
    const m = newMember(id, world.tick);
    if (bond) {
      m.bond = bond.qty;
      inst.custody[bond.item] = (inst.custody[bond.item] as number) + bond.qty;
      p.held -= bond.qty;
    }
    inst.members.push(m);
  }
  p.state = "ratified";
  st.institutions.push(inst);
  // founder roles go to the proposer first, then to endorsers in the order they consented
  p.charter.roles.forEach((role, r) => {
    if (role.by !== "founder") return;
    inst.members.slice(0, role.seats).forEach((m) => (m.roles |= 1 << r));
  });
  for (const sid of p.charter.stores) {
    const s = world.structures[sid];
    if (s && !s.removed) bindStructure(world, inst, s, out);
  }
  const first = inst.stores.length ? world.structures[inst.stores[0] as number] : undefined;
  if (first) {
    inst.seatX = first.x;
    inst.seatY = first.y;
  }
  const ev = emit(world, out, "ratified", p.proposer, { x: inst.seatX, y: inst.seatY, d: { inst: inst.id, name: inst.charter.name, origin: inst.origin, members: inst.members.map((m) => m.id) } });
  for (const m of inst.members) {
    learnCharter(world.agents[m.id]!, inst.id);
    world.agents[m.id]!.memberships++;
    emit(world, out, "joined", m.id, { d: { inst: inst.id, founder: true }, p: [ev] });
  }
  world.metrics.ratified++;
}

function admit(world: WorldState, inst: Institution, agent: Agent, out: EventOut): string {
  if (inst.ended >= 0) return "ended";
  if (memberOf(inst, agent.id)) return "already_member";
  if (inst.members.length >= inst.charter.maxMembers) return "full";
  if (membershipCount(world, agent.id) >= LIMITS.membershipsPerAgent) return "too_many_memberships";
  const m = newMember(agent.id, world.tick);
  if (!collectBond(world, inst, agent, m, out)) return "no_bond";
  inst.members.push(m);
  agent.memberships++;
  learnCharter(agent, inst.id);
  emit(world, out, "joined", agent.id, { d: { inst: inst.id, founder: false } });
  // a structure the charter named but could not yet control may now have all its builders inside
  for (const sid of inst.charter.stores) {
    const s = world.structures[sid];
    if (s && !s.removed && s.bound < 0 && !inst.stores.includes(sid) && (s.founder === agent.id || s.builders.includes(agent.id))) {
      if (bindStructure(world, inst, s, out) && inst.stores.length === 1) {
        inst.seatX = s.x;
        inst.seatY = s.y;
      }
    }
  }
  return "done";
}

/** Consent to a proposal; or, once it is ratified, ask to join on the charter's entry terms. */
export function endorse(world: WorldState, sc: Scratch, agent: Agent, id: number, out: EventOut): string {
  if (world.config.institutions === "off") return "disabled";
  if (!agent.mind.charters.includes(id)) return "unknown_charter";
  const p = proposalById(world, id);
  if (!p) return "unknown_charter";
  if (p.state === "lapsed") return "lapsed";
  if (p.state === "open") {
    if (p.endorsers.includes(agent.id)) return "already_endorsed";
    if (membershipCount(world, agent.id) >= LIMITS.membershipsPerAgent) return "too_many_memberships";
    if (p.charter.bond && (agent.inv[p.charter.bond.item] as number) < p.charter.bond.qty) return "no_bond";
    p.endorsers.push(agent.id);
    postToProposal(world, p, agent, out);
    emit(world, out, "endorse", agent.id, { b: p.proposer, d: { inst: p.id, n: p.endorsers.length } });
    if (p.endorsers.length >= p.charter.minFounders) ratify(world, sc, p, out);
    return "done";
  }
  const inst = institutionById(world, id);
  if (!inst || inst.ended >= 0) return "ended";
  if (memberOf(inst, agent.id)) return "already_member";
  // during the founding window anyone who knows the charter may still sign it as it stands
  const founding = world.tick <= p.expires;
  if (founding || inst.charter.entry === "open") {
    const r = admit(world, inst, agent, out);
    if (r === "done") emit(world, out, "endorse", agent.id, { b: p.proposer, d: { inst: p.id, n: inst.members.length } });
    return r;
  }
  if (inst.charter.entry === "closed") return "closed";
  // entry by vote: the application becomes a motion, moved on the applicant's behalf
  if (world.inst.motions.some((mo) => mo.state === "open" && mo.institution === inst.id && mo.body.m === "admit" && mo.body.agent === agent.id)) return "application_pending";
  if (inst.charter.bond && (agent.inv[inst.charter.bond.item] as number) < inst.charter.bond.qty) return "no_bond";
  openMotion(world, inst, agent.id, { m: "admit", agent: agent.id }, out);
  return "done";
}

function removeMember(world: WorldState, sc: Scratch, inst: Institution, m: Member, how: "left" | "expelled" | "died", forfeit: boolean, out: EventOut): void {
  if (m.bond > 0) releaseBond(world, sc, inst, m, forfeit || how === "died" ? "forfeit" : "refund", m.bond, out);
  inst.members.splice(inst.members.indexOf(m), 1);
  const agent = world.agents[m.id]!;
  if (agent.memberships > 0) agent.memberships--;
  if (how !== "died") emit(world, out, how, m.id, { d: { inst: inst.id } });
  if (inst.members.length < 2 && inst.ended < 0) end(world, sc, inst, "too_few_members", out);
}

/** Leaving is unconditional: no rule, vote or debt can prevent it, and the bond comes back. */
export function leave(world: WorldState, sc: Scratch, agent: Agent, id: number, out: EventOut): string {
  const inst = institutionById(world, id);
  if (!inst || inst.ended >= 0) return "ended";
  const m = memberOf(inst, agent.id);
  if (!m) return "not_a_member";
  removeMember(world, sc, inst, m, "left", false, out);
  return "done";
}

function end(world: WorldState, sc: Scratch, inst: Institution, why: string, out: EventOut): void {
  if (inst.ended >= 0) return;
  inst.ended = world.tick;
  inst.endedWhy = why;
  for (const m of inst.members.slice()) {
    if (m.bond > 0) releaseBond(world, sc, inst, m, world.agents[m.id]!.alive ? "refund" : "forfeit", m.bond, out);
    const agent = world.agents[m.id]!;
    if (agent.memberships > 0) agent.memberships--;
  }
  // whatever was under common control becomes open again; its contents stay where they are
  for (const sid of inst.stores) {
    const s = world.structures[sid];
    if (s && s.bound === inst.id) {
      s.bound = -1;
      s.open.fill(0);
    }
  }
  inst.stores = [];
  for (let i = 0; i < ITEM_COUNT; i++) {
    const q = inst.custody[i] as number;
    if (q > 0) {
      dropOnGround(world, sc, inst.seatX, inst.seatY, i, q);
      inst.custody[i] = 0;
    }
  }
  for (const mo of world.inst.motions) if (mo.institution === inst.id && mo.state === "open") mo.state = "failed";
  emit(world, out, "dissolved", -3, { r: why, x: inst.seatX, y: inst.seatY, d: { inst: inst.id, name: inst.charter.name } });
}

// ───────────────────────── motions and votes

function openMotion(world: WorldState, inst: Institution, by: number, body: Motion["body"], out: EventOut): Motion {
  const mo: Motion = { id: world.inst.nextId++, institution: inst.id, by, body, tick: world.tick, closes: world.tick + LIMITS.motionTicks, yes: [], no: [], state: "open" };
  // a member who moves a motion is taken to support it; an outsider applying to join has no vote
  if (memberOf(inst, by)) mo.yes.push(by);
  world.inst.motions.push(mo);
  emit(world, out, "motion", by, { d: { inst: inst.id, motion: mo.id, m: body.m } });
  return mo;
}

export function moveMotion(world: WorldState, sc: Scratch, agent: Agent, instId: number, rawBody: unknown, out: EventOut): string {
  if (world.config.institutions === "off") return "disabled";
  const inst = institutionById(world, instId);
  if (!inst || inst.ended >= 0) return "ended";
  if (!memberOf(inst, agent.id)) return "not_a_member";
  if (world.inst.motions.filter((mo) => mo.state === "open" && mo.institution === inst.id).length >= LIMITS.openMotionsPerInstitution) return "too_many_motions";
  const v = validateMotion(
    world,
    inst.charter,
    inst.members.map((m) => m.id),
    rawBody,
  );
  if (!v.ok) {
    emit(world, out, "proposal_rejected", agent.id, { r: v.diagnostics[0]?.code ?? "invalid", d: { inst: inst.id, diagnostics: v.diagnostics.slice(0, 6) } });
    for (const g of v.diagnostics.slice(0, 3)) noteFeedback(world, agent, "motion", g.code, `${g.path}: ${g.message}`);
    return "invalid_motion";
  }
  const body = v.value;
  if (body.m === "bind" && !hasStanding(world, agent.id, body.structure)) return "no_standing";
  if (body.m === "release" && !inst.stores.includes(body.structure)) return "not_controlled";
  const mo = openMotion(world, inst, agent.id, body, out);
  inst.uses++;
  tryClose(world, sc, inst, mo, out);
  return "done";
}

export function vote(world: WorldState, sc: Scratch, agent: Agent, motionId: number, yes: boolean, out: EventOut): string {
  if (world.config.institutions === "off") return "disabled";
  const mo = world.inst.motions.find((x) => x.id === motionId);
  if (!mo || mo.state !== "open") return "no_such_motion";
  const inst = institutionById(world, mo.institution);
  if (!inst || inst.ended >= 0) return "ended";
  const m = memberOf(inst, agent.id);
  if (!m) return "not_a_member";
  if (m.joined > mo.tick) return "joined_after";
  if (mo.yes.includes(agent.id) || mo.no.includes(agent.id)) return "already_voted";
  (yes ? mo.yes : mo.no).push(agent.id);
  m.uses++;
  inst.uses++;
  emit(world, out, "vote", agent.id, { d: { inst: inst.id, motion: mo.id, yes } });
  tryClose(world, sc, inst, mo, out);
  return "done";
}

function tryClose(world: WorldState, sc: Scratch, inst: Institution, mo: Motion, out: EventOut): void {
  const eligible = inst.members.filter((m) => m.joined <= mo.tick);
  const ids = new Set(eligible.map((m) => m.id));
  const yes = mo.yes.filter((id) => ids.has(id)).length;
  const no = mo.no.filter((id) => ids.has(id)).length;
  const voters = yes + no;
  const due = world.tick >= mo.closes;
  const rule = inst.charter.decide;
  let outcome: boolean | null = null;
  if (rule.rule === "role") {
    // whoever holds the deciding role settles it with their vote
    const bit = 1 << (rule.role ?? 0);
    const decider = [...mo.yes, ...mo.no].find((id) => ((memberOf(inst, id)?.roles ?? 0) & bit) !== 0);
    if (decider !== undefined) outcome = mo.yes.includes(decider);
    else if (due) outcome = false;
  } else if (rule.rule === "unanimity") {
    if (no > 0) outcome = false;
    else if (yes === eligible.length && eligible.length > 0) outcome = true;
    else if (due) outcome = false;
  } else {
    const n = eligible.length;
    const all = voters === n;
    const quorate = voters * 1000 >= rule.quorum * n && voters > 0;
    if (all || due) {
      outcome = quorate && (rule.rule === "majority" ? yes > no : yes * 3 >= voters * 2);
    } else if (rule.rule === "majority") {
      // settled early once no later vote could change it
      if (quorate && yes * 2 > n) outcome = true;
      else if (no * 2 >= n) outcome = false;
    } else if (quorate && yes * 3 >= n * 2) {
      outcome = true;
    } else if (no * 3 > n) {
      outcome = false;
    }
  }
  if (outcome === null) return;
  mo.state = outcome ? "passed" : "failed";
  const ev = emit(world, out, "motion_result", -3, { r: outcome ? "passed" : "failed", d: { inst: inst.id, motion: mo.id, m: mo.body.m, yes, no, eligible: eligible.length } });
  if (!outcome) return;
  const b = mo.body;
  switch (b.m) {
    case "amend":
      // an amendment replaces the regulative rules; the terms people joined on (bond, entry, how to decide) stand
      inst.charter = { ...inst.charter, rules: b.rules };
      for (const m of inst.members) m.flagged = 0;
      emit(world, out, "rule", -3, { r: "amended", d: { inst: inst.id, rules: b.rules.length }, p: [ev] });
      break;
    case "admit": {
      const agent = world.agents[b.agent];
      if (agent?.alive) admit(world, inst, agent, out);
      break;
    }
    case "expel": {
      const m = memberOf(inst, b.agent);
      if (m) removeMember(world, sc, inst, m, "expelled", false, out);
      break;
    }
    case "assign": {
      const m = memberOf(inst, b.agent);
      const role = inst.charter.roles[b.role];
      if (m && role) {
        const bit = 1 << b.role;
        const holders = inst.members.filter((x) => (x.roles & bit) !== 0);
        // a full bench gives up its longest-standing seat
        if (holders.length >= role.seats && holders[0]) holders[0].roles &= ~bit;
        m.roles |= bit;
        emit(world, out, "rule", -3, { r: "role_assigned", b: m.id, d: { inst: inst.id, role: b.role }, p: [ev] });
      }
      break;
    }
    case "grant": {
      const m = memberOf(inst, b.agent);
      if (m) {
        m.grants[b.item] = clampInt((m.grants[b.item] as number) + b.qty, 0, LIMITS.grantQty);
        emit(world, out, "rule", -3, { r: "granted", b: m.id, i: b.item, q: b.qty, d: { inst: inst.id }, p: [ev] });
      }
      break;
    }
    case "bind": {
      const s = world.structures[b.structure];
      if (s && inst.stores.length < LIMITS.stores) bindStructure(world, inst, s, out);
      break;
    }
    case "release": {
      const s = world.structures[b.structure];
      if (s && s.bound === inst.id) {
        s.bound = -1;
        s.open.fill(0);
        inst.stores.splice(inst.stores.indexOf(s.id), 1);
        emit(world, out, "rule", -3, { s: s.id, r: "released", d: { inst: inst.id }, p: [ev] });
      }
      break;
    }
    case "dissolve":
      end(world, sc, inst, "dissolved_by_members", out);
      break;
  }
}

// ───────────────────────── doors: controlled stores and shelters

const ACCESS_FUEL = LIMITS.rules * LIMITS.exprNodes * 2;

/**
 * Units of `item` this agent may take from a controlled store right now.
 * Anyone: what was already inside before the lock. Members in good standing, in addition: the
 * most generous applicable rule, less what they have drawn this period, plus any grant.
 */
export function withdrawAllowance(world: WorldState, agent: Agent, s: Structure, item: number): number {
  const inst = institutionById(world, s.bound);
  if (!inst || inst.ended >= 0) return 1 << 20;
  const open = openPart(s, item);
  const m = memberOf(inst, agent.id);
  if (!m) return open;
  if (world.tick < m.suspendedUntil) return open;
  const granted = (m.grants[item] as number) + open;
  const facts = factsFor(world, inst, m);
  const fuel: Fuel = { left: ACCESS_FUEL };
  let quota = 0;
  let any = false;
  for (const rule of inst.charter.rules) {
    if (rule.r !== "may_withdraw" || !inScope(rule.who, m)) continue;
    if (rule.item >= 0 ? rule.item !== item : !FOOD_ITEMS.includes(item)) continue;
    if (rule.when && evalExpr(rule.when, facts, fuel) === 0) continue;
    const q = clampInt(evalExpr(rule.quota, facts, fuel), 0, 200);
    // a quota on "any food" is shared across the foods drawn this period
    const used = rule.item >= 0 ? (m.wd[item] as number) : sumItem(m.wd, -1);
    quota = Math.max(quota, q - used);
    any = true;
  }
  if (fuel.left < 0) return granted;
  return (any ? Math.max(0, quota) : 0) + granted;
}

export function mayDeposit(world: WorldState, agent: Agent, s: Structure): boolean {
  const inst = institutionById(world, s.bound);
  if (!inst || inst.ended >= 0) return true;
  return memberOf(inst, agent.id) !== undefined;
}

export function mayShelter(world: WorldState, agent: Agent, s: Structure): boolean {
  const inst = institutionById(world, s.bound);
  if (!inst || inst.ended >= 0) return true;
  const m = memberOf(inst, agent.id);
  if (!m || world.tick < m.suspendedUntil) return false;
  const rules = inst.charter.rules.filter((r) => r.r === "may_shelter");
  if (rules.length === 0) return true; // members may use what they control unless the charter narrows it
  const facts = factsFor(world, inst, m);
  const fuel: Fuel = { left: ACCESS_FUEL };
  for (const rule of rules) {
    if (rule.r !== "may_shelter" || !inScope(rule.who, m)) continue;
    if (!rule.when || evalExpr(rule.when, facts, fuel) !== 0) return true;
  }
  return false;
}

/** The store's books: a deposit or withdrawal that actually happened. */
export function noteStoreUse(world: WorldState, agent: Agent, s: Structure, op: "deposited" | "withdrew", item: number, qty: number): void {
  const inst = institutionById(world, s.bound);
  if (!inst || inst.ended >= 0 || qty <= 0) return;
  let counted = qty;
  if (op === "withdrew") {
    // what was open to all goes first, and is nobody's quota
    const fromOpen = Math.min(qty, s.open[item] as number);
    s.open[item] = (s.open[item] as number) - fromOpen;
    counted = qty - fromOpen;
  }
  const m = memberOf(inst, agent.id);
  if (!m || counted <= 0) return;
  if (op === "deposited") {
    m.dep[item] = (m.dep[item] as number) + counted;
  } else {
    world.metrics.institutionTransfers++;
    // grants are spent before the period's quota
    const fromGrant = Math.min(counted, m.grants[item] as number);
    m.grants[item] = (m.grants[item] as number) - fromGrant;
    m.wd[item] = (m.wd[item] as number) + (counted - fromGrant);
  }
  m.uses++;
  inst.uses++;
}

/** Labour or materials a member put into a building site this period. */
export function noteSupply(world: WorldState, agent: Agent, s: Structure, worth: number): void {
  if (agent.memberships === 0 || worth <= 0) return;
  for (const inst of world.inst.institutions) {
    if (inst.ended >= 0) continue;
    const m = memberOf(inst, agent.id);
    if (!m) continue;
    if (inst.charter.rules.some((r) => r.r === "must_supply" && r.structure === s.id)) {
      m.supplied += worth;
      m.uses++;
      inst.uses++;
    }
  }
}

/**
 * A member gathered near their institution's seat. The books always record it; a breach of a
 * must_not_gather rule is only raised if another member was there to see it.
 */
export function noteGather(world: WorldState, sc: Scratch, agent: Agent, node: number, qty: number, out: EventOut): void {
  if (agent.memberships === 0 || qty <= 0) return;
  const kind = world.nodes.kind[node] as number;
  const nx = world.nodes.x[node] as number;
  const ny = world.nodes.y[node] as number;
  for (const inst of world.inst.institutions) {
    if (inst.ended >= 0) continue;
    const m = memberOf(inst, agent.id);
    if (!m) continue;
    let facts: Facts | null = null;
    const fuel: Fuel = { left: ACCESS_FUEL };
    let counted = false;
    inst.charter.rules.forEach((rule: Rule, index: number) => {
      if (rule.r !== "must_not_gather" || !inScope(rule.who, m)) return;
      if (rule.kind >= 0 && rule.kind !== kind) return;
      const dx = nx > inst.seatX ? nx - inst.seatX : inst.seatX - nx;
      const dy = ny > inst.seatY ? ny - inst.seatY : inst.seatY - ny;
      if ((dx > dy ? dx : dy) > rule.within) return;
      if (!counted) {
        m.gathered[kind] = (m.gathered[kind] as number) + qty;
        counted = true;
      }
      facts ??= factsFor(world, inst, m);
      if (rule.when && evalExpr(rule.when, facts, fuel) === 0) return;
      const allowed = clampInt(evalExpr(rule.over, facts, fuel), 0, 200);
      const taken = rule.kind >= 0 ? (m.gathered[kind] as number) : m.gathered.reduce((x, y) => x + y, 0);
      if (taken <= allowed || (m.flagged & (1 << index)) !== 0 || fuel.left < 0) return;
      // monitoring is by people: is another member within sight?
      const r = sightRadius(world);
      const witness = inst.members.find((o) => {
        if (o.id === agent.id) return false;
        const w = world.agents[o.id]!;
        if (!w.alive || w.asleep) return false;
        const wx = w.x > agent.x ? w.x - agent.x : agent.x - w.x;
        const wy = w.y > agent.y ? w.y - agent.y : agent.y - w.y;
        return (wx > wy ? wx : wy) <= r;
      });
      if (!witness) return;
      m.flagged |= 1 << index;
      breach(world, sc, inst, m, index, rule.else, witness.id, out);
    });
  }
}

function breach(world: WorldState, sc: Scratch, inst: Institution, m: Member, ruleIndex: number, sanction: Sanction, witness: number, out: EventOut): void {
  m.breaches++;
  inst.uses++;
  const ev = emit(world, out, "breach", m.id, { ...(witness >= 0 ? { b: witness } : {}), d: { inst: inst.id, rule: ruleIndex, form: inst.charter.rules[ruleIndex]?.r ?? "" } });
  switch (sanction.t) {
    case "note":
      return;
    case "forfeit":
      emit(world, out, "sanction", m.id, { r: "forfeit", q: Math.min(sanction.qty, m.bond), d: { inst: inst.id, rule: ruleIndex }, p: [ev] });
      releaseBond(world, sc, inst, m, "forfeit", sanction.qty, out);
      return;
    case "suspend":
      m.suspendedUntil = Math.max(m.suspendedUntil, world.tick + sanction.periods * inst.charter.period);
      emit(world, out, "sanction", m.id, { r: "suspend", q: sanction.periods, d: { inst: inst.id, rule: ruleIndex }, p: [ev] });
      return;
    case "expel":
      emit(world, out, "sanction", m.id, { r: "expel", d: { inst: inst.id, rule: ruleIndex }, p: [ev] });
      removeMember(world, sc, inst, m, "expelled", true, out);
      return;
  }
}

// ───────────────────────── the clock

/** Close one member's books for the period: check obligations, then clear the counters. */
function closeBooks(world: WorldState, sc: Scratch, inst: Institution, m: Member, fuel: Fuel, out: EventOut): boolean {
  const facts = factsFor(world, inst, m);
  const due: { index: number; sanction: Sanction }[] = [];
  let met = 0;
  inst.charter.rules.forEach((rule, index) => {
    if (!inScope(rule.who, m)) return;
    if (rule.r === "must_deposit") {
      if (rule.when && evalExpr(rule.when, facts, fuel) === 0) return;
      const owed = clampInt(evalExpr(rule.qty, facts, fuel), 0, 50);
      if (owed === 0) return;
      if (sumItem(m.dep, rule.item) >= owed) met++;
      else due.push({ index, sanction: rule.else });
    } else if (rule.r === "must_supply") {
      const s = world.structures[rule.structure];
      // built: the obligation is spent — except a hearth, which must be fed for as long as it stands
      if (!s || s.removed || (s.complete && s.kind !== StructureKind.campfire)) return;
      if (rule.when && evalExpr(rule.when, facts, fuel) === 0) return;
      const owed = clampInt(evalExpr(rule.worth, facts, fuel), 0, 2000);
      if (owed === 0) return;
      if (m.supplied >= owed) met++;
      else due.push({ index, sanction: rule.else });
    }
  });
  if (fuel.left < 0) return false; // out of fuel: nothing was applied; try again next tick
  // those who joined part-way through a period are not judged on it
  const full = m.joined <= inst.periodStart;
  if (met > 0 && full) emit(world, out, "obligation", m.id, { q: met, d: { inst: inst.id } });
  m.dep.fill(0);
  m.wd.fill(0);
  m.gathered.fill(0);
  m.supplied = 0;
  m.flagged = 0;
  if (full) {
    for (const b of due) {
      if (!inst.members.includes(m)) break; // expelled by an earlier sanction this period
      breach(world, sc, inst, m, b.index, b.sanction, -1, out);
    }
  }
  return true;
}

/** Per-tick processing: deadlines, the dead, period closings and expiry. Bounded by a fuel budget. */
export function tickInstitutions(world: WorldState, sc: Scratch, out: EventOut): void {
  const st = world.inst;
  if (st.proposals.length === 0 && st.institutions.length === 0) return;
  const tick = world.tick;
  for (const p of st.proposals) {
    if (p.state === "open" && tick > p.expires) {
      refundProposal(world, sc, p, p.endorsers, out);
      p.state = "lapsed";
      emit(world, out, "lapsed", p.proposer, { d: { inst: p.id, endorsers: p.endorsers.length } });
    }
  }
  const fuel: Fuel = { left: LIMITS.fuelPerTick };
  for (const inst of st.institutions) {
    if (inst.ended >= 0) continue;
    // the dead hold no membership
    if ((tick + inst.id) % 8 === 0) {
      for (const m of inst.members.slice()) if (!world.agents[m.id]!.alive) removeMember(world, sc, inst, m, "died", true, out);
      if (inst.ended >= 0) continue;
    }
    if (inst.charter.days > 0 && tick - inst.ratified >= inst.charter.days * TICKS_PER_DAY) {
      end(world, sc, inst, "term_expired", out);
      continue;
    }
    if (tick - inst.periodStart >= inst.charter.period) {
      // resumable: one member at a time until the fuel for this tick is spent
      while (inst.cursor < inst.members.length && fuel.left > 0) {
        const m = inst.members[inst.cursor]!;
        const size = inst.members.length;
        if (!closeBooks(world, sc, inst, m, fuel, out)) break;
        // a sanction may have removed this member (or ended the institution)
        if (inst.ended >= 0) break;
        if (inst.members.length === size) inst.cursor++;
      }
      if (inst.ended < 0 && inst.cursor >= inst.members.length) {
        inst.cursor = 0;
        inst.periodStart = tick;
      }
    }
  }
  for (const mo of st.motions) {
    if (mo.state !== "open" || tick < mo.closes) continue;
    const inst = institutionById(world, mo.institution);
    if (inst && inst.ended < 0) tryClose(world, sc, inst, mo, out);
    else mo.state = "failed";
  }
  // keep the books small: settled motions and lapsed proposals older than five days are dropped
  if (tick % TICKS_PER_DAY === 0) {
    const old = tick - 5 * TICKS_PER_DAY;
    st.motions = st.motions.filter((mo) => mo.state === "open" || mo.closes > old);
    st.proposals = st.proposals.filter((p) => p.state !== "lapsed" || p.expires > old);
  }
}

/** Goods held in institutional custody (posted bonds), per item id. */
export function custodyHoldings(world: WorldState): number[] {
  const total = emptyInv();
  for (const inst of world.inst.institutions) for (let i = 0; i < ITEM_COUNT; i++) total[i] = (total[i] as number) + (inst.custody[i] as number);
  return total;
}

/** A charter in a few plain lines (for inspectors and for observations given to minds). */
export function summarizeCharter(c: Charter): { name: string; purpose: string; entry: string; bond: Charter["bond"]; decide: string; rules: number; minFounders: number } {
  return { name: c.name, purpose: c.purpose, entry: c.entry, bond: c.bond, decide: c.decide.rule, rules: c.rules.length, minFounders: c.minFounders };
}
