/**
 * A stored world, checked before it is lived in.
 *
 * A snapshot is text, and text can be edited. Its content hash only shows that a file is the
 * file its manifest describes — whoever changes the world can recompute the hash. So before a
 * restored state is handed to the engine, every field of it is checked here for type, length
 * and range: every array the engine indexes has the length it indexes to, every id points at
 * something that exists, every number that drives a loop is bounded, every stored intent passes
 * the gate that live intents pass, every charter is one the grammar could have produced. A
 * state that passes cannot drive the engine out of bounds or into an unbounded loop; one that
 * does not is refused whole, with the place that was wrong.
 *
 * This is a check of form, not of history. Whether a well-formed world is one this engine
 * would ever have produced from its seed is a different question, answered by living its past
 * again (save/history.ts) and comparing.
 */
import { PAYLOAD_BOUNDS, boundedCopy } from "../core/bounded";
import { cleanLabel, cleanText } from "../core/text";
import { checkExpr } from "../institutions/expr";
import { LIMITS, type Diagnostic } from "../institutions/types";
import type { WorldConfig } from "../model/config";
import { AGE_COUNT, CRAFT_COUNT, ITEM_COUNT, NODE_KINDS, PHYS_COUNT, SKILLS, STRUCTURE_SPECS, TRAITS, WEATHER } from "../model/constants";
import { ACTIVITY_CLASSES, type Terrain, type WorldState } from "../model/types";
import { checkIntent, checkSpeechAct } from "../sim/intents";
import { agentCapacity } from "../world/population";

/** No tick, counter or id in a world that can be lived in is beyond this. */
const FAR = 2_000_000_000;
/** Sums that grow for as long as a world runs. */
const HUGE = Number.MAX_SAFE_INTEGER;
const GOODS = 10_000_000;
/** Every craft's bit set: the most a person or a record house can hold. */
const LORE_ALL = (1 << CRAFT_COUNT) - 1;

const MEMORY_KINDS = new Set(["found", "empty", "got", "gave", "refused", "took", "kept", "broke", "hungry", "thirsty", "cold", "exhausted", "death", "heard", "built", "proposal", "joined", "spoiled"]);
const SOURCES = new Set(["baseline", "mock", "live", "replay", "fallback"]);
const CONTROLLERS = new Set(["reflex", "planner", "external"]);
const ORIGINS = new Set(["grammar_search", "llm", "mock", "scripted"]);
const RULE_FORMS = new Set(["may_withdraw", "may_shelter", "must_deposit", "must_supply", "must_not_gather"]);
const INTENT_KINDS = new Set(["goto", "explore", "gather", "eat", "drink", "fill", "rest", "wait", "craft", "build", "supply", "work", "refuel", "harvest", "give", "drop", "pickup", "deposit", "withdraw", "say", "inspect", "propose", "endorse", "motion", "vote", "leave", "pact_offer", "pact_accept", "step"]);

export class Malformed extends Error {
  constructor(
    public readonly path: string,
    what: string,
  ) {
    super(`${path}: ${what}`);
  }
}

type Rec = Record<string, unknown>;

function bad(path: string, what: string): never {
  throw new Malformed(path, what);
}
function obj(v: unknown, path: string): Rec {
  if (!v || typeof v !== "object" || Array.isArray(v) || ArrayBuffer.isView(v)) bad(path, "expected an object");
  return v as Rec;
}
function int(v: unknown, lo: number, hi: number, path: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) bad(path, `expected a whole number from ${lo} to ${hi}`);
  return v as number;
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") bad(path, "expected true or false");
  return v as boolean;
}
function str(v: unknown, max: number, path: string): string {
  if (typeof v !== "string" || v.length > max) bad(path, `expected text of at most ${max} characters`);
  return v as string;
}
/** Text a mind supplied: it must already be clean (it was cleaned when it was stored). */
function clean(v: unknown, max: number, path: string): void {
  const s = str(v, max, path);
  if (cleanText(s, max) !== s) bad(path, "holds characters that stored text never holds");
}
function oneOf(v: unknown, set: ReadonlySet<string>, path: string): void {
  if (typeof v !== "string" || !set.has(v)) bad(path, "is not one of the values this field can have");
}
function list(v: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(v) || v.length > max) bad(path, `expected a list of at most ${max}`);
  return v as unknown[];
}
function ints(v: unknown, len: number, lo: number, hi: number, path: string): number[] {
  if (!Array.isArray(v) || v.length !== len) bad(path, `expected a list of ${len} numbers`);
  const a = v as unknown[];
  for (let i = 0; i < len; i++) int(a[i], lo, hi, `${path}[${i}]`);
  return a as number[];
}
function idList(v: unknown, max: number, lo: number, hi: number, path: string): number[] {
  const a = list(v, max, path);
  for (let i = 0; i < a.length; i++) int(a[i], lo, hi, `${path}[${i}]`);
  return a as number[];
}
type TypedCtor = Uint8ArrayConstructor | Int16ArrayConstructor | Int32ArrayConstructor | Uint16ArrayConstructor;
function typed<C extends TypedCtor>(v: unknown, ctor: C, len: number, path: string): InstanceType<C> {
  if (!(v instanceof ctor) || v.length !== len) bad(path, `expected ${ctor.name} of length ${len}`);
  return v as InstanceType<C>;
}
function within(a: ArrayLike<number>, lo: number, hi: number, path: string): void {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    if (x < lo || x > hi) bad(`${path}[${i}]`, `expected a number from ${lo} to ${hi}`);
  }
}

/** A charter as it is stored in a proposal or an institution: exactly a product of the grammar. */
function charter(v: unknown, path: string): { roles: number } {
  const c = obj(v, path);
  const copy = boundedCopy(c, PAYLOAD_BOUNDS);
  if (!copy.ok) bad(path, "is larger or deeper than a charter can be");
  clean(c.name, LIMITS.nameChars, `${path}.name`);
  clean(c.purpose, LIMITS.purposeChars, `${path}.purpose`);
  const maxMembers = int(c.maxMembers, 2, LIMITS.members, `${path}.maxMembers`);
  int(c.minFounders, 2, maxMembers, `${path}.minFounders`);
  if (c.entry !== "open" && c.entry !== "vote" && c.entry !== "closed") bad(`${path}.entry`, "is not a way of joining");
  let bondQty = 0;
  if (c.bond !== null) {
    const b = obj(c.bond, `${path}.bond`);
    int(b.item, 0, ITEM_COUNT - 1, `${path}.bond.item`);
    bondQty = int(b.qty, 1, LIMITS.bondQty, `${path}.bond.qty`);
  }
  const roles = list(c.roles, LIMITS.roles, `${path}.roles`);
  roles.forEach((r, i) => {
    const role = obj(r, `${path}.roles[${i}]`);
    const name = str(role.name, LIMITS.nameChars, `${path}.roles[${i}].name`);
    // a label, or the name an older version stored (clean text): never anything that needs cleaning
    if (cleanLabel(name, LIMITS.roleChars) !== name && cleanText(name, LIMITS.nameChars) !== name) bad(`${path}.roles[${i}].name`, "is not a role's name");
    int(role.seats, 1, LIMITS.seats, `${path}.roles[${i}].seats`);
    if (role.by !== "founder" && role.by !== "vote") bad(`${path}.roles[${i}].by`, "is not a way of filling a role");
  });
  const decide = obj(c.decide, `${path}.decide`);
  if (decide.rule !== "unanimity" && decide.rule !== "majority" && decide.rule !== "two_thirds" && decide.rule !== "role") bad(`${path}.decide.rule`, "is not a way of deciding");
  int(decide.quorum, 0, 1000, `${path}.decide.quorum`);
  if (decide.rule === "role") int(decide.role, 0, roles.length - 1, `${path}.decide.role`);
  int(c.period, LIMITS.periodMin, LIMITS.periodMax, `${path}.period`);
  idList(c.stores, LIMITS.stores, 0, FAR, `${path}.stores`);
  int(c.days, 0, LIMITS.lifetimeDays, `${path}.days`);
  rules(c.rules, roles.length, bondQty, `${path}.rules`);
  return { roles: roles.length };
}

function formula(v: unknown, roles: number, path: string): void {
  const diags: Diagnostic[] = [];
  if (checkExpr(v, path, roles, diags) === null) bad(diags[0]?.path ?? path, diags[0]?.message ?? "is not a formula");
}

function rules(v: unknown, roles: number, bondQty: number, path: string): void {
  list(v, LIMITS.rules, path).forEach((raw, i) => {
    const at = `${path}[${i}]`;
    const r = obj(raw, at);
    oneOf(r.r, RULE_FORMS, `${at}.r`);
    const who = obj(r.who, `${at}.who`);
    if (who.t !== "all" && who.t !== "role" && who.t !== "others") bad(`${at}.who.t`, "does not say whom a rule applies to");
    if (who.t !== "all") int(who.role, 0, roles - 1, `${at}.who.role`);
    if (r.when !== undefined) formula(r.when, roles, `${at}.when`);
    if (r.r === "may_withdraw" || r.r === "must_deposit") int(r.item, -1, ITEM_COUNT - 1, `${at}.item`);
    if (r.r === "may_withdraw") formula(r.quota, roles, `${at}.quota`);
    if (r.r === "must_deposit") formula(r.qty, roles, `${at}.qty`);
    if (r.r === "must_supply") {
      int(r.structure, 0, FAR, `${at}.structure`);
      formula(r.worth, roles, `${at}.worth`);
    }
    if (r.r === "must_not_gather") {
      int(r.kind, -1, NODE_KINDS.length - 1, `${at}.kind`);
      int(r.within, 1, LIMITS.gatherRadius, `${at}.within`);
      formula(r.over, roles, `${at}.over`);
    }
    if (r.r !== "may_withdraw" && r.r !== "may_shelter") {
      const s = obj(r.else, `${at}.else`);
      if (s.t === "forfeit") int(s.qty, 1, Math.max(1, bondQty), `${at}.else.qty`);
      else if (s.t === "suspend") int(s.periods, 1, LIMITS.suspendPeriods, `${at}.else.periods`);
      else if (s.t !== "note" && s.t !== "expel") bad(`${at}.else.t`, "is not a sanction");
    }
  });
}

/**
 * Throws `Malformed` (with the path of the first thing wrong) unless `state` is a world of the
 * right shape for this configuration and terrain.
 */
export function validateState(state: Omit<WorldState, "terrain">, cfg: WorldConfig, terrain: Terrain): void {
  const s = obj(state, "state") as unknown as Rec;
  const W = terrain.w;
  const H = terrain.h;
  const N = W * H;
  const cap = agentCapacity(cfg);
  // the three counts the gate for intents reads, and nothing else of the world
  const forIntents = state as unknown as WorldState;

  const meta = obj(s.meta, "meta");
  int(meta.schema, 1, 10_000, "meta.schema");
  str(meta.engine, 32, "meta.engine");
  str(meta.affordances, 32, "meta.affordances");
  str(meta.configHash, 128, "meta.configHash");
  const branch = obj(meta.branch, "meta.branch");
  str(branch.id, 128, "meta.branch.id");
  str(branch.parent, 128, "meta.branch.parent");
  int(branch.forkTick, -1, FAR, "meta.branch.forkTick");
  int(branch.rngEpoch, 0, 0xffffffff, "meta.branch.rngEpoch");
  int(s.tick, 0, FAR, "tick");

  // ── resource nodes
  const nodes = obj(s.nodes, "nodes");
  const count = int(nodes.count, 0, N, "nodes.count");
  const kind = typed(nodes.kind, Uint8Array, count, "nodes.kind");
  const nx = typed(nodes.x, Uint8Array, count, "nodes.x");
  const ny = typed(nodes.y, Uint8Array, count, "nodes.y");
  const capacity = typed(nodes.cap, Int16Array, count, "nodes.cap");
  const amount = typed(nodes.amount, Int16Array, count, "nodes.amount");
  within(kind, 0, NODE_KINDS.length - 1, "nodes.kind");
  within(nx, 0, W - 1, "nodes.x");
  within(ny, 0, H - 1, "nodes.y");
  within(capacity, 1, 30_000, "nodes.cap");
  const taken = new Uint8Array(N);
  for (let k = 0; k < count; k++) {
    if ((amount[k] as number) < 0 || (amount[k] as number) > (capacity[k] as number)) bad(`nodes.amount[${k}]`, "is not between nothing and the node's capacity");
    const tile = (ny[k] as number) * W + (nx[k] as number);
    if (taken[tile]) bad(`nodes[${k}]`, "stands on a tile that already has a node");
    taken[tile] = 1;
  }

  // ── climate
  const c = obj(s.climate, "climate");
  int(c.weather, 0, WEATHER.length - 1, "climate.weather");
  for (const k of ["weatherUntil", "droughtUntil", "coldUntil", "rainUntil", "hushUntil"]) int(c[k], 0, FAR, `climate.${k}`);
  int(c.temp, -5000, 5000, "climate.temp");
  int(c.coldDelta, -5000, 5000, "climate.coldDelta");
  for (const k of ["wet", "snow", "light"]) int(c[k], 0, 1000, `climate.${k}`);
  int(c.hushRadius, 0, 64, "climate.hushRadius");

  // ── structures and piles (before agents: agents refer to structures)
  const structures = list(s.structures, 50_000, "structures");
  if (int(s.nextStructure, 0, FAR, "nextStructure") !== structures.length) bad("nextStructure", "is not the number of structures");
  const agentsRaw = list(s.agents, cap, "agents");
  if (agentsRaw.length < 1) bad("agents", "a world has at least one person in it");
  const people = agentsRaw.length;
  structures.forEach((raw, i) => {
    const at = `structures[${i}]`;
    const t = obj(raw, at);
    if (int(t.id, 0, FAR, `${at}.id`) !== i) bad(`${at}.id`, "is not the structure's place in the list");
    int(t.kind, 0, STRUCTURE_SPECS.length - 1, `${at}.kind`);
    int(t.x, 0, W - 1, `${at}.x`);
    int(t.y, 0, H - 1, `${at}.y`);
    int(t.foundedTick, -1, FAR, `${at}.foundedTick`);
    int(t.builtTick, -1, FAR, `${at}.builtTick`);
    int(t.founder, -1, people - 1, `${at}.founder`);
    const contributors = idList(t.contributors, cap, 0, people - 1, `${at}.contributors`);
    ints(t.contributions, contributors.length, 0, HUGE, `${at}.contributions`);
    idList(t.builders, cap, 0, people - 1, `${at}.builders`);
    ints(t.missing, ITEM_COUNT, 0, GOODS, `${at}.missing`);
    int(t.laborDone, 0, GOODS, `${at}.laborDone`);
    int(t.laborNeeded, 0, GOODS, `${at}.laborNeeded`);
    bool(t.complete, `${at}.complete`);
    int(t.fuel, 0, FAR, `${at}.fuel`);
    ints(t.inv, ITEM_COUNT, 0, GOODS, `${at}.inv`);
    ints(t.open, ITEM_COUNT, 0, GOODS, `${at}.open`);
    int(t.ripeTick, -1, FAR, `${at}.ripeTick`);
    int(t.occupants, 0, cap, `${at}.occupants`);
    int(t.bound, -1, FAR, `${at}.bound`);
    int(t.integrity, 0, 1000, `${at}.integrity`);
    bool(t.removed, `${at}.removed`);
    int(t.lore, 0, LORE_ALL, `${at}.lore`);
  });
  list(s.piles, N, "piles").forEach((raw, i) => {
    const p = obj(raw, `piles[${i}]`);
    int(p.x, 0, W - 1, `piles[${i}].x`);
    int(p.y, 0, H - 1, `piles[${i}].y`);
    ints(p.inv, ITEM_COUNT, 0, GOODS, `piles[${i}].inv`);
  });
  typed(s.traffic, Uint16Array, N, "traffic");

  // ── speech in the air
  const utterance = (raw: unknown, at: string): void => {
    const u = obj(raw, at);
    int(u.id, 0, FAR, `${at}.id`);
    int(u.tick, 0, FAR, `${at}.tick`);
    int(u.from, 0, people - 1, `${at}.from`);
    int(u.to, -1, people - 1, `${at}.to`);
    int(u.x, 0, W - 1, `${at}.x`);
    int(u.y, 0, H - 1, `${at}.y`);
    if (checkSpeechAct(forIntents, u.act) !== null) bad(`${at}.act`, "is not something that can be said");
    if (u.text !== undefined) clean(u.text, 400, `${at}.text`);
  };
  list(s.speech, 8192, "speech").forEach((u, i) => utterance(u, `speech[${i}]`));
  int(s.nextUtterance, 0, FAR, "nextUtterance");
  int(s.nextEvent, 0, FAR, "nextEvent");

  // ── people
  agentsRaw.forEach((raw, i) => {
    const at = `agents[${i}]`;
    const a = obj(raw, at);
    if (int(a.id, 0, FAR, `${at}.id`) !== i) bad(`${at}.id`, "is not the person's place in the list");
    str(a.name, 40, `${at}.name`);
    for (const k of ["x", "px"]) int(a[k], 0, W - 1, `${at}.${k}`);
    for (const k of ["y", "py"]) int(a[k], 0, H - 1, `${at}.${k}`);
    bool(a.alive, `${at}.alive`);
    int(a.diedTick, -1, FAR, `${at}.diedTick`);
    str(a.deathCause, 24, `${at}.deathCause`);
    for (const k of ["energy", "hydration", "rest", "warmth", "health"]) int(a[k], -100_000, 100_000, `${at}.${k}`);
    int(a.ill, 0, FAR, `${at}.ill`);
    bool(a.asleep, `${at}.asleep`);
    int(a.shelter, -1, structures.length - 1, `${at}.shelter`);
    ints(a.inv, ITEM_COUNT, 0, GOODS, `${at}.inv`);
    ints(a.toolUses, ITEM_COUNT, 0, GOODS, `${at}.toolUses`);
    ints(a.traits, TRAITS.length, 0, 1000, `${at}.traits`);
    ints(a.phys, PHYS_COUNT, 0, 100_000, `${at}.phys`);
    ints(a.skills, SKILLS.length, 0, 100_000, `${at}.skills`);
    oneOf(a.controller, CONTROLLERS, `${at}.controller`);
    list(a.queue, 64, `${at}.queue`).forEach((intent, k) => {
      const reason = checkIntent(forIntents, intent);
      if (reason !== null) bad(`${at}.queue[${k}]`, `is not an intent (${reason})`);
      const it = intent as { k: string; charter?: unknown; motion?: unknown; text?: unknown };
      if (it.k === "propose" && !boundedCopy(it.charter).ok) bad(`${at}.queue[${k}].charter`, "is larger or deeper than a charter can be");
      if (it.k === "motion" && !boundedCopy(it.motion).ok) bad(`${at}.queue[${k}].motion`, "is larger or deeper than a motion can be");
      if (it.text !== undefined) clean(it.text, 400, `${at}.queue[${k}].text`);
    });
    if (a.act !== null) {
      const act = obj(a.act, `${at}.act`);
      oneOf(act.k, INTENT_KINDS, `${at}.act.k`);
      int(act.t, -1, 1_000_000, `${at}.act.t`);
      int(act.dur, 0, 1_000_000, `${at}.act.dur`);
      int(act.x, 0, W - 1, `${at}.act.x`);
      int(act.y, 0, H - 1, `${at}.act.y`);
    }
    idList(a.path, N, 0, N - 1, `${at}.path`);
    int(a.pathKey, -1, HUGE, `${at}.pathKey`);
    int(a.progress, 0, FAR, `${at}.progress`);
    int(a.memberships, 0, 1024, `${at}.memberships`);
    int(a.lore, 0, LORE_ALL, `${at}.lore`);
    int(a.since, 0, FAR, `${at}.since`);

    const st = obj(a.stats, `${at}.stats`);
    ints(st.activity, ACTIVITY_CLASSES.length, 0, HUGE, `${at}.stats.activity`);
    ints(st.gathered, ITEM_COUNT, 0, HUGE, `${at}.stats.gathered`);
    for (const k of ["givenUnits", "givenWorth", "receivedUnits", "receivedWorth", "decisions", "rejected", "said", "distance", "welfareSum", "aliveTicks"]) int(st[k], 0, HUGE, `${at}.stats.${k}`);

    const mAt = `${at}.mind`;
    const m = obj(a.mind, mAt);
    typed(m.seen, Uint8Array, (N + 7) >> 3, `${mAt}.seen`);
    within(typed(m.nodeAmt, Int16Array, count, `${mAt}.nodeAmt`), -1, 30_000, `${mAt}.nodeAmt`);
    within(typed(m.nodeTick, Int32Array, count, `${mAt}.nodeTick`), -1, FAR, `${mAt}.nodeTick`);
    within(typed(m.nodeSrc, Int16Array, count, `${mAt}.nodeSrc`), -1, cap - 1, `${mAt}.nodeSrc`);
    within(typed(m.nodeMax, Int16Array, count, `${mAt}.nodeMax`), 0, 30_000, `${mAt}.nodeMax`);
    within(typed(m.metX, Uint8Array, cap, `${mAt}.metX`), 0, W - 1, `${mAt}.metX`);
    within(typed(m.metY, Uint8Array, cap, `${mAt}.metY`), 0, H - 1, `${mAt}.metY`);
    typed(m.metTick, Int32Array, cap, `${mAt}.metTick`);
    within(typed(m.trust, Int16Array, cap, `${mAt}.trust`), 0, 1000, `${mAt}.trust`);
    typed(m.gave, Int32Array, cap, `${mAt}.gave`);
    typed(m.got, Int32Array, cap, `${mAt}.got`);
    typed(m.kept, Int16Array, cap, `${mAt}.kept`);
    typed(m.broke, Int16Array, cap, `${mAt}.broke`);
    typed(m.lastTalk, Int32Array, cap, `${mAt}.lastTalk`);
    list(m.structs, 50_000, `${mAt}.structs`).forEach((raw2, k) => {
      const ks = obj(raw2, `${mAt}.structs[${k}]`);
      int(ks.id, 0, FAR, `${mAt}.structs[${k}].id`);
      int(ks.kind, 0, STRUCTURE_SPECS.length - 1, `${mAt}.structs[${k}].kind`);
      int(ks.x, 0, W - 1, `${mAt}.structs[${k}].x`);
      int(ks.y, 0, H - 1, `${mAt}.structs[${k}].y`);
      int(ks.tick, -1, FAR, `${mAt}.structs[${k}].tick`);
      int(ks.state, 0, 64, `${mAt}.structs[${k}].state`);
      int(ks.bound, -1, FAR, `${mAt}.structs[${k}].bound`);
      if (ks.missing !== undefined) ints(ks.missing, ITEM_COUNT, 0, GOODS, `${mAt}.structs[${k}].missing`);
    });
    list(m.mem, 256, `${mAt}.mem`).forEach((raw2, k) => {
      const it = obj(raw2, `${mAt}.mem[${k}]`);
      int(it.tick, 0, FAR, `${mAt}.mem[${k}].tick`);
      oneOf(it.kind, MEMORY_KINDS, `${mAt}.mem[${k}].kind`);
      int(it.who, -1, cap - 1, `${mAt}.mem[${k}].who`);
      int(it.ref, -1, FAR, `${mAt}.mem[${k}].ref`);
      int(it.item, -1, ITEM_COUNT - 1, `${mAt}.mem[${k}].item`);
      int(it.qty, -FAR, FAR, `${mAt}.mem[${k}].qty`);
      int(it.salience, 0, 1000, `${mAt}.mem[${k}].salience`);
      int(it.src, -1, cap - 1, `${mAt}.mem[${k}].src`);
    });
    list(m.commitments, 64, `${mAt}.commitments`).forEach((raw2, k) => {
      const cm = obj(raw2, `${mAt}.commitments[${k}]`);
      int(cm.id, 0, FAR, `${mAt}.commitments[${k}].id`);
      if (cm.dir !== "owe" && cm.dir !== "due") bad(`${mAt}.commitments[${k}].dir`, "is neither owed nor due");
      int(cm.to, 0, people - 1, `${mAt}.commitments[${k}].to`);
      int(cm.item, 0, ITEM_COUNT - 1, `${mAt}.commitments[${k}].item`);
      int(cm.qty, 0, GOODS, `${mAt}.commitments[${k}].qty`);
      int(cm.due, 0, FAR, `${mAt}.commitments[${k}].due`);
      bool(cm.done, `${mAt}.commitments[${k}].done`);
    });
    idList(m.charters, 64, 0, FAR, `${mAt}.charters`);
    idList(m.pacts, 64, 0, FAR, `${mAt}.pacts`);
    oneOf(m.src, SOURCES, `${mAt}.src`);
    list(m.inbox, 64, `${mAt}.inbox`).forEach((raw2, k) => {
      const h = obj(raw2, `${mAt}.inbox[${k}]`);
      int(h.utterance, 0, FAR, `${mAt}.inbox[${k}].utterance`);
      int(h.tick, 0, FAR, `${mAt}.inbox[${k}].tick`);
      int(h.from, 0, people - 1, `${mAt}.inbox[${k}].from`);
      bool(h.direct, `${mAt}.inbox[${k}].direct`);
      if (checkSpeechAct(forIntents, h.act) !== null) bad(`${mAt}.inbox[${k}].act`, "is not something that can be said");
      if (h.text !== undefined) clean(h.text, 400, `${mAt}.inbox[${k}].text`);
    });
    str(m.goal, 64, `${mAt}.goal`);
    clean(m.why, 400, `${mAt}.why`);
    str(m.urgentAt, 24, `${mAt}.urgentAt`);
    int(m.lastDecision, -FAR, FAR, `${mAt}.lastDecision`);
    int(m.decisionEvent, -1, FAR, `${mAt}.decisionEvent`);
    int(m.homeX, -1, W - 1, `${mAt}.homeX`);
    int(m.homeY, -1, H - 1, `${mAt}.homeY`);
    int(m.heading, 0, 7, `${mAt}.heading`);
    if (!Array.isArray(m.cool) || m.cool.length < 11 || m.cool.length > 32) bad(`${mAt}.cool`, "expected the list of cooldowns");
    ints(m.cool, (m.cool as unknown[]).length, -FAR, FAR, `${mAt}.cool`);
    for (const k of ["coldNights", "hungerDays", "wintersSeen", "tempN", "coldRun"]) int(m[k], 0, FAR, `${mAt}.${k}`);
    for (const k of ["tempEma", "tempTrend", "tempSum"]) int(m[k], -FAR, FAR, `${mAt}.${k}`);
    int(m.droughtSeen, -1, FAR, `${mAt}.droughtSeen`);
    int(m.nextDeliberation, -FAR, FAR, `${mAt}.nextDeliberation`);
    clean(m.note, 400, `${mAt}.note`);
    list(m.feedback, 64, `${mAt}.feedback`).forEach((raw2, k) => {
      const f = obj(raw2, `${mAt}.feedback[${k}]`);
      int(f.t, 0, FAR, `${mAt}.feedback[${k}].t`);
      str(f.k, 40, `${mAt}.feedback[${k}].k`);
      str(f.r, 64, `${mAt}.feedback[${k}].r`);
      if (f.d !== undefined) clean(f.d, 400, `${mAt}.feedback[${k}].d`);
    });
  });

  // ── institutions
  const inst = obj(s.inst, "inst");
  int(inst.nextId, 1, FAR, "inst.nextId");
  list(inst.proposals, 100_000, "inst.proposals").forEach((raw, i) => {
    const at = `inst.proposals[${i}]`;
    const p = obj(raw, at);
    int(p.id, 0, FAR, `${at}.id`);
    charter(p.charter, `${at}.charter`);
    oneOf(p.origin, ORIGINS, `${at}.origin`);
    int(p.proposer, 0, people - 1, `${at}.proposer`);
    int(p.tick, 0, FAR, `${at}.tick`);
    int(p.expires, 0, FAR, `${at}.expires`);
    idList(p.endorsers, cap, 0, people - 1, `${at}.endorsers`);
    int(p.held, 0, GOODS, `${at}.held`);
    if (p.state !== "open" && p.state !== "ratified" && p.state !== "lapsed") bad(`${at}.state`, "is not a state a proposal can be in");
  });
  const roleCount = new Map<number, number>();
  list(inst.institutions, 100_000, "inst.institutions").forEach((raw, i) => {
    const at = `inst.institutions[${i}]`;
    const x = obj(raw, at);
    const id = int(x.id, 0, FAR, `${at}.id`);
    roleCount.set(id, charter(x.charter, `${at}.charter`).roles);
    oneOf(x.origin, ORIGINS, `${at}.origin`);
    int(x.proposer, 0, people - 1, `${at}.proposer`);
    int(x.ratified, 0, FAR, `${at}.ratified`);
    int(x.seatX, 0, W - 1, `${at}.seatX`);
    int(x.seatY, 0, H - 1, `${at}.seatY`);
    const members = list(x.members, LIMITS.members, `${at}.members`);
    members.forEach((rawMember, k) => {
      const mAt = `${at}.members[${k}]`;
      const mem = obj(rawMember, mAt);
      int(mem.id, 0, people - 1, `${mAt}.id`);
      int(mem.joined, 0, FAR, `${mAt}.joined`);
      int(mem.bond, 0, GOODS, `${mAt}.bond`);
      int(mem.breaches, 0, FAR, `${mAt}.breaches`);
      int(mem.suspendedUntil, 0, FAR, `${mAt}.suspendedUntil`);
      int(mem.roles, 0, (1 << LIMITS.roles) - 1, `${mAt}.roles`);
      ints(mem.dep, ITEM_COUNT, 0, HUGE, `${mAt}.dep`);
      ints(mem.wd, ITEM_COUNT, 0, HUGE, `${mAt}.wd`);
      int(mem.supplied, 0, HUGE, `${mAt}.supplied`);
      ints(mem.gathered, NODE_KINDS.length, 0, HUGE, `${mAt}.gathered`);
      int(mem.flagged, 0, (1 << LIMITS.rules) - 1, `${mAt}.flagged`);
      ints(mem.grants, ITEM_COUNT, 0, GOODS, `${mAt}.grants`);
      int(mem.uses, 0, HUGE, `${mAt}.uses`);
    });
    idList(x.stores, 256, 0, Math.max(0, structures.length - 1), `${at}.stores`);
    ints(x.custody, ITEM_COUNT, 0, GOODS, `${at}.custody`);
    int(x.periodStart, 0, FAR, `${at}.periodStart`);
    int(x.cursor, 0, members.length, `${at}.cursor`);
    int(x.ended, -1, FAR, `${at}.ended`);
    str(x.endedWhy, 64, `${at}.endedWhy`);
    int(x.uses, 0, HUGE, `${at}.uses`);
  });
  list(inst.motions, 100_000, "inst.motions").forEach((raw, i) => {
    const at = `inst.motions[${i}]`;
    const mo = obj(raw, at);
    int(mo.id, 0, FAR, `${at}.id`);
    const of = int(mo.institution, 0, FAR, `${at}.institution`);
    int(mo.by, 0, people - 1, `${at}.by`);
    const body = obj(mo.body, `${at}.body`);
    if (!boundedCopy(body).ok) bad(`${at}.body`, "is larger or deeper than a motion can be");
    switch (body.m) {
      case "amend":
        rules(body.rules, roleCount.get(of) ?? 0, LIMITS.bondQty, `${at}.body.rules`);
        break;
      case "admit":
      case "expel":
        int(body.agent, 0, people - 1, `${at}.body.agent`);
        break;
      case "assign":
        int(body.agent, 0, people - 1, `${at}.body.agent`);
        int(body.role, 0, LIMITS.roles - 1, `${at}.body.role`);
        break;
      case "grant":
        int(body.agent, 0, people - 1, `${at}.body.agent`);
        int(body.item, 0, ITEM_COUNT - 1, `${at}.body.item`);
        int(body.qty, 1, LIMITS.grantQty, `${at}.body.qty`);
        break;
      case "bind":
      case "release":
        int(body.structure, 0, FAR, `${at}.body.structure`);
        break;
      case "dissolve":
        break;
      default:
        bad(`${at}.body.m`, "is not something a motion can do");
    }
    int(mo.tick, 0, FAR, `${at}.tick`);
    int(mo.closes, 0, FAR, `${at}.closes`);
    idList(mo.yes, cap, 0, people - 1, `${at}.yes`);
    idList(mo.no, cap, 0, people - 1, `${at}.no`);
    if (mo.state !== "open" && mo.state !== "passed" && mo.state !== "failed") bad(`${at}.state`, "is not a state a motion can be in");
  });
  list(inst.pacts, 1_000_000, "inst.pacts").forEach((raw, i) => {
    const at = `inst.pacts[${i}]`;
    const p = obj(raw, at);
    int(p.id, 0, FAR, `${at}.id`);
    int(p.a, 0, people - 1, `${at}.a`);
    int(p.b, -1, people - 1, `${at}.b`);
    int(p.give, 0, ITEM_COUNT - 1, `${at}.give`);
    int(p.want, 0, ITEM_COUNT - 1, `${at}.want`);
    int(p.giveQty, 1, GOODS, `${at}.giveQty`);
    int(p.wantQty, 1, GOODS, `${at}.wantQty`);
    int(p.tick, 0, FAR, `${at}.tick`);
    int(p.expires, 0, FAR, `${at}.expires`);
    if (p.state !== "open" && p.state !== "done" && p.state !== "void") bad(`${at}.state`, "is not a state an offer can be in");
    int(p.held, 0, GOODS, `${at}.held`);
    int(p.x, 0, W - 1, `${at}.x`);
    int(p.y, 0, H - 1, `${at}.y`);
  });

  // ── provenance and books
  list(s.interventions, 100_000, "interventions").forEach((raw, i) => {
    const at = `interventions[${i}]`;
    const iv = obj(raw, at);
    int(iv.tick, 0, FAR, `${at}.tick`);
    str(iv.kind, 40, `${at}.kind`);
    const params = obj(iv.params, `${at}.params`);
    const keys = Object.keys(params);
    if (keys.length > 16) bad(`${at}.params`, "has more parameters than an intervention takes");
    for (const k of keys) int(params[k], -FAR, FAR, `${at}.params.${k.slice(0, 24)}`);
    if (iv.origin !== "observer" && iv.origin !== "scenario" && iv.origin !== "treatment") bad(`${at}.origin`, "is not where an intervention can come from");
  });
  ints(s.shockTicks, cfg.shocks.length, -1, FAR, "shockTicks");
  const mt = obj(s.metrics, "metrics");
  for (const k of ["days", "gives", "giveUnits", "pactTrades", "pactUnits", "institutionTransfers", "workTicks", "gatheredUnits", "projectsStarted", "projectsCompleted", "deaths", "proposals", "ratified", "rejectedIntents", "utterances", "deliberations"]) int(mt[k], 0, HUGE, `metrics.${k}`);
  int(mt.giniSum, 0, HUGE, "metrics.giniSum");
  int(mt.commonsMin, -FAR, FAR, "metrics.commonsMin");
  for (const k of ["deathsByCause", "decisionsBySource"]) {
    const counts = obj(mt[k], `metrics.${k}`);
    const keys = Object.keys(counts);
    if (keys.length > 64) bad(`metrics.${k}`, "has more entries than there are causes");
    for (const name of keys) int(counts[name], 0, HUGE, `metrics.${k}.${name.slice(0, 24)}`);
  }
  ints(mt.sources, ITEM_COUNT, 0, HUGE, "metrics.sources");
  ints(mt.sinks, ITEM_COUNT, 0, HUGE, "metrics.sinks");
  for (const k of ["discoveries", "learned", "inscribed", "fieldHarvests", "milled", "careLaid", "careSpent", "arrivals"]) int(mt[k], 0, HUGE, `metrics.${k}`);
  ints(mt.ages, AGE_COUNT, -1, FAR, "metrics.ages");
}
