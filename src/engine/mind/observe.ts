/**
 * Observation: everything an externally driven mind (a language model, a mock, a replay)
 * is given when asked to decide — and nothing else.
 *
 * It is assembled only from the agent's own body, its beliefs with their provenance, its
 * memories, what it has been told, and what is in sight right now. It never contains true
 * stocks of places the agent cannot see, other people's needs beyond a coarse visible band,
 * anyone else's inventory, plans, beliefs or trust, or speech that was not in earshot.
 * `observe.test.ts` enforces this by construction-independent checks.
 *
 * The `actions` list is the action mask: the concrete things this agent could attempt now.
 * A decision may only use what is listed; the engine still validates every intent when it
 * is executed, so the mask narrows choices without being trusted.
 */
import {
  BIOMES,
  FOOD_ITEMS,
  ITEMS,
  ITEM_SPECS,
  Item,
  NODE_KINDS,
  NODE_SPECS,
  RECIPES,
  SKILLS,
  STRUCTURE_KINDS,
  STRUCTURE_SPECS,
  StructureKind,
  TICKS_PER_DAY,
  TRAITS,
  WEATHER,
} from "../model/constants";
import type { Agent, Intent, SpeechAct, WorldState } from "../model/types";
import { calendarAt } from "../world/climate";
import { carriedWeight, carryCapacity, roomFor } from "../sim/inventory";
import { hasSeen } from "../sim/pathfind";
import { pileAt, structureAt, type Scratch } from "../sim/scratch";
import { believedDrinkable } from "./knowledge";
import { visibleAgents, visiblePiles } from "./senses";
import { sensesCold } from "./social";
import { activeMemberships, institutionById, memberOf, proposalById } from "../institutions/engine";
import { describeMotion, describeRule, describeTerms } from "../institutions/describe";
import { duesOutstanding } from "../institutions/judge";

export const OBSERVATION_VERSION = 2;

/** Hard limits on one decision. */
export const DECISION_LIMITS = { maxIntents: 6, maxRationaleChars: 240, maxTextChars: 160, maxGoalChars: 32, maxNoteChars: 200 } as const;

const MAX_NODES = 14;
const MAX_STRUCTURES = 10;
const MAX_MEMORIES = 12;
const MAX_PEOPLE = 10;

export interface ObservedPerson {
  id: number;
  name: string;
  dx: number;
  dy: number;
  dist: number;
  looksHungry: number;
  looksCold: number;
  asleep: boolean;
  ill: boolean;
  laden: boolean;
  audible: boolean;
  /** My own record of them: trust 0..1000, favours given and received (worth), promises kept and broken. */
  trust: number;
  gave: number;
  got: number;
  kept: number;
  broke: number;
}

export interface ObservedNode {
  id: number;
  kind: string;
  yields: string;
  x: number;
  y: number;
  dist: number;
  /** Believed amount, and how old that belief is in ticks. */
  amount: number;
  age: number;
  /** "seen" if first-hand, otherwise the name of whoever told me. */
  source: string;
}

export interface ObservedStructure {
  id: number;
  kind: string;
  x: number;
  y: number;
  dist: number;
  state: string;
  age: number;
  missing?: Record<string, number>;
}

export type ActionOption =
  | { k: "goto" | "explore" | "rest" | "wait" | "drink" | "fill" }
  | { k: "eat"; items: number[] }
  | { k: "gather"; nodes: number[] }
  | { k: "craft"; recipes: number[] }
  | { k: "build"; kinds: number[]; sites: number[] }
  | { k: "refuel" | "harvest" | "inspect"; structures: number[] }
  | { k: "deposit" | "withdraw"; structures: number[] }
  | { k: "give"; to: number[]; items: number[] }
  | { k: "drop"; items: number[] }
  | { k: "pickup"; items: number[] }
  | { k: "say"; to: number[]; acts: SpeechAct["t"][] }
  | { k: "propose" }
  | { k: "endorse"; proposals: number[] }
  | { k: "motion" | "leave"; institutions: number[] }
  | { k: "vote"; motions: number[] }
  | { k: "pact_offer"; to: number[]; items: number[] }
  | { k: "pact_accept"; pacts: number[] };

/** What this agent knows of agreements: charters it has heard of, its own standing, open votes and offers. */
export interface ObservedCivics {
  charters: { id: number; state: "proposed" | "active"; name: string; purpose: string; by: string; signed: number; member: boolean; terms: string[]; rules: string[] }[];
  memberships: { id: number; name: string; bond: number; breaches: number; suspended: boolean; roles: string[]; foodDueThisPeriod: number }[];
  motions: { id: number; institution: number; by: string; what: string; closesIn: number; voted: boolean }[];
  offers: { id: number; from: string; gives: string; givesQty: number; wants: string; wantsQty: number; forMe: boolean }[];
}

export interface Observation {
  v: typeof OBSERVATION_VERSION;
  tick: number;
  self: {
    id: number;
    name: string;
    x: number;
    y: number;
    needs: { energy: number; hydration: number; rest: number; warmth: number; health: number };
    ill: boolean;
    carrying: Record<string, number>;
    load: { weight: number; capacity: number };
    traits: Record<string, number>;
    skills: Record<string, number>;
    home: { x: number; y: number } | null;
    doing: string;
    /** The note I left myself with my last decision, if any. */
    note: string;
  };
  now: {
    daysLived: number;
    tickOfDay: number;
    light: "dark" | "dim" | "day";
    weather: string;
    air: "freezing" | "cold" | "cool" | "mild" | "warm";
    /** What my own days tell me: 0 nothing, 1 it is getting colder, 2 the cold is here. */
    coldSense: 0 | 1 | 2;
  };
  here: {
    biome: string;
    drinkable: boolean;
    byFire: boolean;
    node: number;
    structure: number;
    pile: Record<string, number> | null;
  };
  people: ObservedPerson[];
  nodes: ObservedNode[];
  structures: ObservedStructure[];
  piles: { x: number; y: number; dist: number; items: Record<string, number> }[];
  memories: { kind: string; age: number; who?: string; item?: string; qty?: number; ref?: number; toldBy?: string }[];
  /** `id` identifies the utterance, so that a reply can refer to it. */
  heard: { id: number; from: number; name: string; direct: boolean; age: number; act: SpeechAct; text?: string }[];
  commitments: { direction: "i_owe" | "owed_to_me"; other: number; name: string; item: string; qty: number; dueIn: number }[];
  /** What the world refused of my last decision, and why (reason codes; `detail` where there is one). */
  feedback: { age: number; action: string; reason: string; detail?: string }[];
  /** Absent when the scenario has no institutional affordance. */
  civics?: ObservedCivics;
  actions: ActionOption[];
  limits: typeof DECISION_LIMITS;
}

function named(inv: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < inv.length; i++) if ((inv[i] as number) > 0) out[ITEMS[i] as string] = inv[i] as number;
  return out;
}

const cheb = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax > bx ? ax - bx : bx - ax;
  const dy = ay > by ? ay - by : by - ay;
  return dx > dy ? dx : dy;
};

const STRUCTURE_STATE: readonly (readonly string[])[] = [
  ["unfinished", "cold", "burning"],
  ["unfinished", "standing"],
  ["unfinished", "empty", "some stock", "well stocked"],
  ["unfinished", "growing", "ripe"],
];

export function buildObservation(world: WorldState, sc: Scratch, a: Agent): Observation {
  const m = a.mind;
  const tick = world.tick;
  const tile = a.y * sc.w + a.x;
  const cal = calendarAt(world.config, tick);
  const name = (id: number) => world.agents[id]?.name ?? `#${id}`;
  const seen = visibleAgents(world, sc, a);

  // ── people in sight, with my own record of each
  const people: ObservedPerson[] = seen.slice(0, MAX_PEOPLE).map((s) => ({
    id: s.id,
    name: name(s.id),
    dx: s.x - a.x,
    dy: s.y - a.y,
    dist: s.dist,
    looksHungry: s.hunger,
    looksCold: s.cold,
    asleep: s.asleep,
    ill: s.ill,
    laden: s.laden,
    audible: s.audible,
    trust: m.trust[s.id] as number,
    gave: m.gave[s.id] as number,
    got: m.got[s.id] as number,
    kept: m.kept[s.id] as number,
    broke: m.broke[s.id] as number,
  }));

  // ── places I believe in, most relevant first: believed stock discounted by distance and staleness
  const scored: { n: number; score: number }[] = [];
  for (let n = 0; n < world.nodes.count; n++) {
    const amt = m.nodeAmt[n] as number;
    if (amt < 0) continue;
    const d = cheb(world.nodes.x[n] as number, world.nodes.y[n] as number, a.x, a.y);
    const age = tick - (m.nodeTick[n] as number);
    scored.push({ n, score: ((Math.min(amt, 10) + 1) * 100) / (8 + d * 2 + age / 24) });
  }
  scored.sort((p, q) => q.score - p.score || p.n - q.n);
  // keep variety: the best known place of every kind first, then the rest by relevance,
  // at most four of any one kind
  const perKind = new Map<number, number>();
  const chosen: number[] = [];
  for (const s of scored) {
    const kind = world.nodes.kind[s.n] as number;
    if (perKind.has(kind)) continue;
    perKind.set(kind, 1);
    chosen.push(s.n);
  }
  for (const s of scored) {
    if (chosen.length >= MAX_NODES) break;
    if (chosen.includes(s.n)) continue;
    const kind = world.nodes.kind[s.n] as number;
    const k = perKind.get(kind) ?? 0;
    if (k >= 4) continue;
    perKind.set(kind, k + 1);
    chosen.push(s.n);
  }
  const nodes: ObservedNode[] = chosen.map((n) => {
    const kind = world.nodes.kind[n] as number;
    const src = m.nodeSrc[n] as number;
    const x = world.nodes.x[n] as number;
    const y = world.nodes.y[n] as number;
    return {
      id: n,
      kind: NODE_KINDS[kind] as string,
      yields: ITEMS[NODE_SPECS[kind]!.yields] as string,
      x,
      y,
      dist: cheb(x, y, a.x, a.y),
      amount: m.nodeAmt[n] as number,
      age: tick - (m.nodeTick[n] as number),
      source: src < 0 ? "seen" : name(src),
    };
  });
  nodes.sort((p, q) => p.dist - q.dist || p.id - q.id);

  const structures: ObservedStructure[] = m.structs
    .map((ks) => ({ ks, d: cheb(ks.x, ks.y, a.x, a.y) }))
    .sort((p, q) => p.d - q.d || p.ks.id - q.ks.id)
    .slice(0, MAX_STRUCTURES)
    .map(({ ks, d }) => ({
      id: ks.id,
      kind: STRUCTURE_KINDS[ks.kind] as string,
      x: ks.x,
      y: ks.y,
      dist: d,
      state: STRUCTURE_STATE[ks.kind]?.[ks.state] ?? "unknown",
      age: tick - ks.tick,
      ...(ks.missing ? { missing: named(ks.missing) } : {}),
    }));

  const piles = visiblePiles(world, sc, a)
    .slice(0, 6)
    .map((p) => ({ x: p.x, y: p.y, dist: p.dist, items: named(p.inv) }));

  // ── memories by retention (salience decayed by age), the same score that governs forgetting
  const memories = m.mem
    .map((item) => ({ item, score: item.salience / (1 + (tick - item.tick) / TICKS_PER_DAY / 6) }))
    .sort((p, q) => q.score - p.score || q.item.tick - p.item.tick)
    .slice(0, MAX_MEMORIES)
    .map(({ item }) => ({
      kind: item.kind,
      age: tick - item.tick,
      ...(item.who >= 0 ? { who: name(item.who) } : {}),
      ...(item.item >= 0 ? { item: ITEMS[item.item] as string } : {}),
      ...(item.qty !== 0 ? { qty: item.qty } : {}),
      ...(item.ref >= 0 ? { ref: item.ref } : {}),
      ...(item.src >= 0 ? { toldBy: name(item.src) } : {}),
    }));

  const heard = m.inbox.map((h) => ({ id: h.utterance, from: h.from, name: name(h.from), direct: h.direct, age: tick - h.tick, act: h.act, ...(h.text ? { text: h.text } : {}) }));

  const commitments = m.commitments
    .filter((c) => !c.done)
    .map((c) => ({
      direction: c.dir === "owe" ? ("i_owe" as const) : ("owed_to_me" as const),
      other: c.to,
      name: name(c.to),
      item: ITEMS[c.item] as string,
      qty: c.qty,
      dueIn: c.due - tick,
    }));

  const k = pileAt(world, sc, tile);
  const sidHere = structureAt(world, sc, tile);
  const civics = buildCivics(world, a);
  const temp = world.climate.temp;
  return {
    v: OBSERVATION_VERSION,
    tick,
    self: {
      id: a.id,
      name: a.name,
      x: a.x,
      y: a.y,
      needs: { energy: a.energy, hydration: a.hydration, rest: a.rest, warmth: a.warmth, health: a.health },
      ill: a.ill > 0,
      carrying: named(a.inv),
      load: { weight: carriedWeight(a), capacity: carryCapacity(a) },
      traits: Object.fromEntries(TRAITS.map((t, i) => [t, a.traits[i] as number])),
      skills: Object.fromEntries(SKILLS.map((s, i) => [s, a.skills[i] as number])),
      home: m.homeX >= 0 ? { x: m.homeX, y: m.homeY } : null,
      doing: m.goal,
      note: m.note,
    },
    now: {
      daysLived: Math.floor(tick / TICKS_PER_DAY),
      tickOfDay: cal.tickOfDay,
      light: world.climate.light < 250 ? "dark" : world.climate.light < 460 ? "dim" : "day",
      weather: WEATHER[world.climate.weather] as string,
      air: temp < 0 ? "freezing" : temp < 60 ? "cold" : temp < 120 ? "cool" : temp < 200 ? "mild" : "warm",
      coldSense: sensesCold(a),
    },
    here: {
      biome: BIOMES[world.terrain.biome[tile] as number] as string,
      drinkable: believedDrinkable(world, a, tile),
      byFire: sc.warm[tile] === 1,
      node: world.nodes.atTile[tile] as number,
      structure: sidHere,
      pile: k >= 0 ? named(world.piles[k]!.inv) : null,
    },
    people,
    nodes,
    structures,
    piles,
    memories,
    heard,
    commitments,
    feedback: m.feedback.map((f) => ({ age: tick - f.t, action: f.k, reason: f.r, ...(f.d ? { detail: f.d } : {}) })),
    ...(civics ? { civics } : {}),
    actions: [...actionMask(world, sc, a, people, nodes, structures, k), ...civicMask(world, a, people, civics)],
    limits: DECISION_LIMITS,
  };
}

function buildCivics(world: WorldState, a: Agent): ObservedCivics | undefined {
  if (world.config.institutions === "off") return undefined;
  const name = (id: number) => world.agents[id]?.name ?? `#${id}`;
  const charters: ObservedCivics["charters"] = [];
  for (let i = a.mind.charters.length - 1; i >= 0 && charters.length < 4; i--) {
    const id = a.mind.charters[i] as number;
    const p = proposalById(world, id);
    if (!p || p.state === "lapsed") continue;
    const inst = p.state === "ratified" ? institutionById(world, id) : undefined;
    if (p.state === "ratified" && (!inst || inst.ended >= 0)) continue;
    const c = inst ? inst.charter : p.charter;
    charters.push({
      id,
      state: inst ? "active" : "proposed",
      name: c.name,
      purpose: c.purpose,
      by: name(p.proposer),
      signed: inst ? inst.members.length : p.endorsers.length,
      member: inst ? memberOf(inst, a.id) !== undefined : p.endorsers.includes(a.id),
      terms: describeTerms(c),
      rules: c.rules.map((r) => describeRule(r, c)),
    });
  }
  const mine = activeMemberships(world, a.id);
  const memberships = mine.map((inst) => {
    const m = memberOf(inst, a.id)!;
    let dep = 0;
    for (const f of FOOD_ITEMS) dep += m.dep[f] as number;
    return {
      id: inst.id,
      name: inst.charter.name,
      bond: m.bond,
      breaches: m.breaches,
      suspended: world.tick < m.suspendedUntil,
      roles: inst.charter.roles.filter((_, r) => (m.roles & (1 << r)) !== 0).map((r) => r.name),
      foodDueThisPeriod: duesOutstanding(world, a, inst.charter, dep, inst.members.length),
    };
  });
  const motions = world.inst.motions
    .filter((mo) => mo.state === "open" && mine.some((x) => x.id === mo.institution))
    .slice(0, 6)
    .map((mo) => ({ id: mo.id, institution: mo.institution, by: name(mo.by), what: describeMotion(mo.body, name), closesIn: mo.closes - world.tick, voted: mo.yes.includes(a.id) || mo.no.includes(a.id) }));
  const offers = a.mind.pacts
    .map((id) => world.inst.pacts.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p && p.state === "open" && p.a !== a.id && (p.b < 0 || p.b === a.id))
    .map((p) => ({ id: p.id, from: name(p.a), gives: ITEMS[p.give] as string, givesQty: p.giveQty, wants: ITEMS[p.want] as string, wantsQty: p.wantQty, forMe: p.b === a.id }));
  return { charters, memberships, motions, offers };
}

function civicMask(world: WorldState, a: Agent, people: ObservedPerson[], civics: ObservedCivics | undefined): ActionOption[] {
  if (!civics) return [];
  const out: ActionOption[] = [];
  const mode = world.config.institutions;
  if (mode === "grammar_search" || mode === "open") out.push({ k: "propose" });
  const signable = civics.charters.filter((c) => !c.member).map((c) => c.id);
  if (signable.length) out.push({ k: "endorse", proposals: signable });
  const mine = civics.memberships.map((m) => m.id);
  if (mine.length) {
    out.push({ k: "motion", institutions: mine });
    out.push({ k: "leave", institutions: mine });
  }
  const votable = civics.motions.filter((m) => !m.voted).map((m) => m.id);
  if (votable.length) out.push({ k: "vote", motions: votable });
  const carried: number[] = [];
  for (let i = 0; i < a.inv.length; i++) if ((a.inv[i] as number) > 0) carried.push(i);
  if (carried.length) out.push({ k: "pact_offer", to: [-1, ...people.filter((p) => p.audible && !p.asleep).map((p) => p.id)], items: carried });
  const takeable = civics.offers.filter((o) => (a.inv[ITEMS.indexOf(o.wants as (typeof ITEMS)[number])] as number) >= o.wantsQty).map((o) => o.id);
  if (takeable.length) out.push({ k: "pact_accept", pacts: takeable });
  return out;
}

const SPEECH_ALWAYS: SpeechAct["t"][] = ["greet", "inform_node", "inform_structure", "inform_agent", "request", "offer", "promise", "warn", "accept", "decline", "announce", "invite", "free"];

/** The concrete options open to this agent now (the action mask). */
function actionMask(world: WorldState, sc: Scratch, a: Agent, people: ObservedPerson[], nodes: ObservedNode[], structures: ObservedStructure[], pileHere: number): ActionOption[] {
  const out: ActionOption[] = [{ k: "goto" }, { k: "explore" }, { k: "rest" }, { k: "wait" }];
  const m = a.mind;
  const carried: number[] = [];
  for (let i = 0; i < a.inv.length; i++) if ((a.inv[i] as number) > 0) carried.push(i);

  // drinking needs known water (or a filled pot); the engine walks the agent there
  let knowsWater = (a.inv[Item.water] as number) > 0;
  if (!knowsWater) {
    for (let t = 0; t < sc.w * sc.h && !knowsWater; t++) if ((world.terrain.fresh[t] as number) > 0 && hasSeen(m.seen, t)) knowsWater = true;
  }
  if (knowsWater) {
    out.push({ k: "drink" });
    if (roomFor(a, Item.water) > 0) out.push({ k: "fill" });
  }

  const food = carried.filter((i) => FOOD_ITEMS.includes(i));
  if (food.length) out.push({ k: "eat", items: food });

  const gatherable = nodes.filter((n) => n.amount > 0).map((n) => n.id);
  if (gatherable.length) out.push({ k: "gather", nodes: gatherable });

  const recipes: number[] = [];
  for (const r of RECIPES) {
    if (r.inputs.every(([item, qty]) => (a.inv[item] as number) >= qty)) recipes.push(r.id);
  }
  if (recipes.length) out.push({ k: "craft", recipes });

  // building: kinds for which at least one material is in hand, plus any unfinished site known
  const kinds: number[] = [];
  for (const spec of STRUCTURE_SPECS) {
    if (spec.kind === StructureKind.plot && !world.config.planting) continue;
    if (spec.materials.some(([item]) => (a.inv[item] as number) > 0)) kinds.push(spec.kind);
  }
  const sites = structures.filter((s) => s.state === "unfinished").map((s) => s.id);
  if (kinds.length || sites.length) out.push({ k: "build", kinds, sites });

  const fires = structures.filter((s) => s.kind === "campfire" && s.state !== "unfinished").map((s) => s.id);
  if (fires.length && (a.inv[Item.wood] as number) > 0) out.push({ k: "refuel", structures: fires });
  const ripe = structures.filter((s) => s.kind === "plot" && s.state === "ripe").map((s) => s.id);
  if (ripe.length) out.push({ k: "harvest", structures: ripe });
  const stores = structures.filter((s) => s.kind === "store" && s.state !== "unfinished").map((s) => s.id);
  if (stores.length) {
    if (carried.length) out.push({ k: "deposit", structures: stores });
    out.push({ k: "withdraw", structures: stores });
  }
  if (structures.length) out.push({ k: "inspect", structures: structures.map((s) => s.id) });

  const near = people.filter((p) => !p.asleep);
  if (near.length && carried.length) out.push({ k: "give", to: near.map((p) => p.id), items: carried });
  if (carried.length) out.push({ k: "drop", items: carried });
  if (pileHere >= 0) {
    const items: number[] = [];
    const inv = world.piles[pileHere]!.inv;
    for (let i = 0; i < inv.length; i++) if ((inv[i] as number) > 0) items.push(i);
    if (items.length) out.push({ k: "pickup", items });
  }
  const listeners = people.filter((p) => p.audible && !p.asleep).map((p) => p.id);
  out.push({ k: "say", to: [-1, ...listeners], acts: SPEECH_ALWAYS });
  return out;
}

/**
 * Does the mask permit this intent? (Structural validity is checked separately by
 * `checkIntent`; the engine re-validates everything again when the intent is executed.)
 */
export function maskAllows(obs: Observation, intent: Intent): string | null {
  const opt = obs.actions.find((o) => o.k === intent.k);
  if (!opt) return "not_available";
  switch (intent.k) {
    case "eat":
      return (opt as { items: number[] }).items.includes(intent.item) ? null : "not_carried";
    case "gather":
      return (opt as { nodes: number[] }).nodes.includes(intent.node) ? null : "unknown_place";
    case "craft":
      return (opt as { recipes: number[] }).recipes.includes(intent.recipe) ? null : "no_materials";
    case "build": {
      const o = opt as { kinds: number[]; sites: number[] };
      if (o.kinds.includes(intent.kind)) return null;
      const site = obs.structures.find((s) => s.x === intent.x && s.y === intent.y && o.sites.includes(s.id));
      return site ? null : "no_materials";
    }
    case "refuel":
    case "harvest":
    case "inspect":
    case "deposit":
    case "withdraw":
      return (opt as { structures: number[] }).structures.includes(intent.structure) ? null : "unknown_place";
    case "give": {
      const o = opt as { to: number[]; items: number[] };
      if (!o.to.includes(intent.to)) return "not_in_sight";
      return o.items.includes(intent.item) ? null : "not_carried";
    }
    case "drop":
    case "pickup":
      return (opt as { items: number[] }).items.includes(intent.item) ? null : "not_available";
    case "say": {
      const o = opt as { to: number[]; acts: string[] };
      if (!o.to.includes(intent.to)) return "not_in_earshot";
      return o.acts.includes(intent.act.t) ? null : "not_available";
    }
    case "endorse":
      return (opt as { proposals: number[] }).proposals.includes(intent.proposal) ? null : "unknown_charter";
    case "motion":
    case "leave":
      return (opt as { institutions: number[] }).institutions.includes(intent.institution) ? null : "not_a_member";
    case "vote":
      return (opt as { motions: number[] }).motions.includes(intent.motion) ? null : "no_such_motion";
    case "pact_offer": {
      const o = opt as { to: number[]; items: number[] };
      if (!o.to.includes(intent.to)) return "not_in_earshot";
      return o.items.includes(intent.give) ? null : "not_carried";
    }
    case "pact_accept":
      return (opt as { pacts: number[] }).pacts.includes(intent.pact) ? null : "unknown_offer";
    default:
      return null;
  }
}

/** Energy value of the food an observation says its agent is carrying (a convenience for policies). */
export function carriedFoodEnergy(obs: Observation): number {
  let e = 0;
  for (const i of FOOD_ITEMS) e += (obs.self.carrying[ITEMS[i] as string] ?? 0) * ITEM_SPECS[i]!.energy;
  return e;
}
