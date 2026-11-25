/**
 * The institution grammar (version 1) and the state institutions keep.
 *
 * A charter has three kinds of content, kept apart on purpose:
 *
 *   narrative    name, purpose, role names — stored and shown, never executed
 *   constitutive who may join and on what bond, what roles exist, how the group decides,
 *                which built structures it controls, how long it lasts
 *   regulative   statements of the form  WHO  may | must | must not  DO WHAT  [WHEN]  [OR ELSE]
 *
 * Authority is consent-bounded. A rule binds only people who endorsed the charter or joined
 * later; it can ration only what members put into structures the institution controls; the
 * worst it can do to anyone is keep the bond they posted, suspend their entitlements or put
 * them out. Leaving is always possible. Nothing here can create goods, take from a person's
 * hands, or read a private belief: conditions are integer formulas over public facts.
 *
 * Everything in this file is plain data so that it serializes canonically with the world.
 */

export const GRAMMAR_VERSION = 1;

export const LIMITS = {
  rules: 12,
  roles: 4,
  seats: 8,
  stores: 4,
  exprNodes: 24,
  exprDepth: 6,
  constant: 100_000,
  nameChars: 40,
  purposeChars: 200,
  members: 500,
  bondQty: 20,
  forfeit: 20,
  suspendPeriods: 30,
  periodMin: 24,
  periodMax: 960,
  lifetimeDays: 400,
  gatherRadius: 24,
  grantQty: 40,
  /** Expression nodes evaluated per tick across all institutions; work beyond it waits for the next tick. */
  fuelPerTick: 20_000,
  /** Ticks a proposal stays open for endorsement, a motion for votes, a pact for acceptance. */
  proposalTicks: 3 * 96,
  motionTicks: 96,
  pactTicks: 96,
  openProposalsPerAgent: 1,
  membershipsPerAgent: 3,
  openMotionsPerInstitution: 4,
  openPactsPerAgent: 2,
} as const;

// ───────────────────────── expressions

/** Public facts a formula may read. "actor" facts refer to the member the rule is being applied to. */
export const VARS = [
  "members", // number of members
  "day", // days since the institution was ratified
  "season", // 0 spring · 1 summer · 2 autumn · 3 winter
  "night", // 1 at night, else 0
  "stock", // units of item i (or all food if i = -1) in the structures the institution controls
  "tenure", // actor: whole days since joining
  "bond", // actor: units of bond still held for them
  "breaches", // actor: breaches recorded against them
  "deposited", // actor: units of item i (or all food) deposited this period
  "withdrawn", // actor: units of item i (or all food) withdrawn this period
  "hunger", // actor: how hungry they look, 0 fine … 3 critical (the band anyone can see)
  "has_role", // actor: 1 if they hold role i
] as const;
export type VarName = (typeof VARS)[number];

export const BINARY_OPS = ["add", "sub", "mul", "div", "min", "max", "lt", "le", "eq", "ne", "ge", "gt", "and", "or"] as const;
export type BinaryOp = (typeof BINARY_OPS)[number];

export type Expr =
  | { c: number }
  | { v: VarName; i?: number }
  | { o: BinaryOp; a: Expr; b: Expr }
  | { o: "not"; a: Expr }
  | { o: "if"; a: Expr; b: Expr; e: Expr };

// ───────────────────────── charter

/** Which members a rule applies to. Non-members are never in scope. */
export type Who = { t: "all" } | { t: "role"; role: number } | { t: "others"; role: number };

export type Sanction = { t: "note" } | { t: "forfeit"; qty: number } | { t: "suspend"; periods: number } | { t: "expel" };

/** `item` is an item id, or -1 for "any food". */
export type Rule =
  | { r: "may_withdraw"; who: Who; item: number; quota: Expr; when?: Expr }
  | { r: "may_shelter"; who: Who; when?: Expr }
  | { r: "must_deposit"; who: Who; item: number; qty: Expr; when?: Expr; else: Sanction }
  | { r: "must_supply"; who: Who; structure: number; worth: Expr; when?: Expr; else: Sanction }
  | { r: "must_not_gather"; who: Who; kind: number; within: number; over: Expr; when?: Expr; else: Sanction };

export type DecisionRule = "unanimity" | "majority" | "two_thirds" | "role";

export interface Charter {
  grammar: typeof GRAMMAR_VERSION;
  /** Narrative: shown to people and models, never interpreted. */
  name: string;
  purpose: string;
  /** Endorsements (including the proposer's) needed to ratify. At least 2. */
  minFounders: number;
  maxMembers: number;
  /** After ratification: anyone may join · members vote on each applicant · nobody may join. */
  entry: "open" | "vote" | "closed";
  /** Posted on joining, held for the member, returned on leaving unless forfeited by a sanction. */
  bond: { item: number; qty: number } | null;
  roles: { name: string; seats: number; by: "founder" | "vote" }[];
  decide: { rule: DecisionRule; role?: number; quorum: number };
  /** Accounting period in ticks: quotas and obligations are per period. */
  period: number;
  /** Built structures (stores, shelters) to place under the institution's control at ratification. */
  stores: number[];
  rules: Rule[];
  /** Lifetime in days; 0 = until dissolved. */
  days: number;
}

// ───────────────────────── state

export type Origin = "grammar_search" | "llm" | "mock" | "scripted";

export interface Member {
  id: number;
  joined: number;
  bond: number;
  breaches: number;
  /** Entitlements are suspended until this tick. */
  suspendedUntil: number;
  /** Bitmask of role indices held. */
  roles: number;
  /** This period: units deposited and withdrawn per item id, worth supplied to obliged projects, units gathered per node kind near the seat. */
  dep: number[];
  wd: number[];
  supplied: number;
  gathered: number[];
  /** Bitmask of rule indices already breached this period (a rule is breached at most once per period). */
  flagged: number;
  /** One-off extra withdrawal rights per item id, from `grant` motions. */
  grants: number[];
  /** Rule-governed acts performed (for the "used by" count). */
  uses: number;
}

export interface Institution {
  id: number;
  charter: Charter;
  origin: Origin;
  proposer: number;
  ratified: number;
  /** Where it sits: its first controlled structure, else where it was ratified. */
  seatX: number;
  seatY: number;
  members: Member[];
  /** Structures currently under its control. */
  stores: number[];
  /** Bond units held, per item id. */
  custody: number[];
  periodStart: number;
  /** Members whose books have been closed in a period closing that is still in progress. */
  cursor: number;
  /** Tick it ended (-1 while active) and why. */
  ended: number;
  endedWhy: string;
  /** Count of rule-governed events since ratification. */
  uses: number;
}

export interface Proposal {
  id: number;
  charter: Charter;
  origin: Origin;
  proposer: number;
  tick: number;
  expires: number;
  /** Agents who individually consented, in order. The proposer is first. */
  endorsers: number[];
  /** Bond units held for the endorsers while the proposal is open (each has posted the charter's bond). */
  held: number;
  state: "open" | "ratified" | "lapsed";
}

export type MotionBody =
  | { m: "amend"; rules: Rule[] }
  | { m: "admit"; agent: number }
  | { m: "expel"; agent: number }
  | { m: "assign"; role: number; agent: number }
  | { m: "grant"; agent: number; item: number; qty: number }
  | { m: "bind"; structure: number }
  | { m: "release"; structure: number }
  | { m: "dissolve" };

export interface Motion {
  id: number;
  institution: number;
  by: number;
  body: MotionBody;
  tick: number;
  closes: number;
  yes: number[];
  no: number[];
  state: "open" | "passed" | "failed";
}

export interface Pact {
  id: number;
  a: number;
  /** Counterparty, or -1 for whoever accepts first. */
  b: number;
  give: number;
  giveQty: number;
  want: number;
  wantQty: number;
  tick: number;
  expires: number;
  state: "open" | "done" | "void";
  /** Units of `give` held in escrow (0 when the scenario has no escrow). */
  held: number;
  x: number;
  y: number;
}

export interface InstitutionsState {
  nextId: number;
  proposals: Proposal[];
  institutions: Institution[];
  motions: Motion[];
  pacts: Pact[];
}

export function emptyInstitutions(): InstitutionsState {
  return { nextId: 1, proposals: [], institutions: [], motions: [], pacts: [] };
}

export interface Diagnostic {
  /** Where in the charter, e.g. "rules[2].quota". */
  path: string;
  code: string;
  message: string;
}
