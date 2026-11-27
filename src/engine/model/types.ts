/**
 * World state: plain data only (numbers, strings, booleans, arrays, plain objects and
 * integer typed arrays), so that it can be cloned, serialized canonically and hashed.
 * Nothing in here holds functions, Maps, Sets or class instances.
 */
import type { WorldConfig } from "./config";
import type { InstitutionsState } from "../institutions/types";

// ───────────────────────── terrain (static after generation)

export interface Terrain {
  w: number;
  h: number;
  /** Signed height: sea level is 0; land is 1..1000; sea floor is negative. */
  height: Int16Array;
  /** Water enum per tile. */
  water: Uint8Array;
  biome: Uint8Array;
  /** 0..100 */
  fertility: Uint8Array;
  /** Ticks to enter the tile (0 = impassable). Includes config.movementCost. */
  moveCost: Uint8Array;
  /** Where an agent standing on the tile can drink: 2 = perennial water, 1 = seasonal (dries in drought), 0 = none. */
  fresh: Uint8Array;
  /** Connected land region id (ignoring fords): the shores of a world with a strait are its two largest. 255 = not land. */
  region: Uint8Array;
  /** Flow accumulation (clamped), for rendering stream width. */
  flow: Uint16Array;
  landCount: number;
  /** SHA-256 of the canonical terrain; snapshots store it to detect generator drift. */
  hash: string;
}

export interface Nodes {
  count: number;
  kind: Uint8Array;
  x: Uint8Array;
  y: Uint8Array;
  cap: Int16Array;
  amount: Int16Array;
  /** Tile index → node id, or -1. */
  atTile: Int16Array;
}

// ───────────────────────── speech

export type SpeechAct =
  | { t: "greet" }
  | { t: "inform_node"; node: number; amount: number; tick: number }
  | { t: "inform_structure"; structure: number }
  | { t: "inform_agent"; about: number; claim: "gave" | "helped" | "took" | "kept" | "broke"; tick: number }
  | { t: "request"; item: number; qty: number }
  | { t: "offer"; give: number; giveQty: number; want: number; wantQty: number; pact?: number }
  | { t: "accept"; ref: number }
  | { t: "decline"; ref: number }
  | { t: "promise"; item: number; qty: number; due: number }
  | { t: "announce"; proposal: number }
  | { t: "invite"; institution: number }
  | { t: "warn"; node: number }
  | { t: "free" };

export interface Utterance {
  id: number;
  tick: number;
  from: number;
  /** -1 = public (everyone within hearing range), otherwise a single listener. */
  to: number;
  x: number;
  y: number;
  act: SpeechAct;
  /** Optional free text (bounded). Never interpreted by the engine. */
  text?: string;
}

// ───────────────────────── intents (what a mind may ask for)

export type Intent =
  | { k: "goto"; x: number; y: number; near: number }
  | { k: "explore" }
  | { k: "gather"; node: number; qty: number }
  | { k: "eat"; item: number; qty: number }
  | { k: "drink" }
  | { k: "fill" }
  | { k: "rest"; ticks: number }
  | { k: "wait"; ticks: number }
  | { k: "craft"; recipe: number }
  | { k: "build"; kind: number; x: number; y: number }
  | { k: "supply"; structure: number; item: number; qty: number }
  | { k: "work"; structure: number; ticks: number }
  | { k: "refuel"; structure: number; qty: number }
  | { k: "harvest"; structure: number }
  | { k: "give"; to: number; item: number; qty: number }
  | { k: "drop"; item: number; qty: number }
  | { k: "pickup"; item: number; qty: number }
  | { k: "deposit"; structure: number; item: number; qty: number }
  | { k: "withdraw"; structure: number; item: number; qty: number }
  | { k: "say"; to: number; act: SpeechAct; text?: string }
  | { k: "inspect"; structure: number }
  | { k: "propose"; charter: unknown }
  | { k: "endorse"; proposal: number }
  | { k: "motion"; institution: number; motion: unknown }
  | { k: "vote"; motion: number; yes: boolean }
  | { k: "leave"; institution: number }
  | { k: "pact_offer"; to: number; give: number; giveQty: number; want: number; wantQty: number }
  | { k: "pact_accept"; pact: number };

export type IntentKind = Intent["k"];

/** The physical action currently being executed (at most one per agent). */
export interface ActionState {
  /** Kind of the intent being executed, or "step" for one tile of movement. */
  k: IntentKind | "step";
  /** Ticks remaining, and total duration. */
  t: number;
  dur: number;
  /** Destination tile for "step". */
  x: number;
  y: number;
}

// ───────────────────────── minds (bounded cognitive state)

export type MemoryKind =
  | "found" // found a resource
  | "empty" // expected a resource, found none
  | "got" // received something
  | "gave"
  | "refused" // a request of mine was declined / ignored
  | "took" // saw someone take from a pile/store
  | "kept" // a promise was kept
  | "broke" // a promise was broken
  | "hungry"
  | "thirsty"
  | "cold"
  | "exhausted"
  | "death" // witnessed a death
  | "heard" // told something notable
  | "built"
  | "proposal"
  | "joined"
  | "spoiled";

export interface MemoryItem {
  tick: number;
  kind: MemoryKind;
  /** Other agent involved, or -1. */
  who: number;
  /** Node or structure id (meaning depends on kind), or -1. */
  ref: number;
  item: number;
  qty: number;
  /** 0..1000: how strongly this is retained. */
  salience: number;
  /** -1 = first-hand; otherwise the id of the agent who told me. */
  src: number;
}

export interface KnownStructure {
  id: number;
  kind: number;
  x: number;
  y: number;
  tick: number;
  /** Last seen state summary: lit/fuel band for fires, fill band for stores, ripe for plots. */
  state: number;
  /** Institution it was bound to when last seen, or -1. */
  bound: number;
  /** For an unfinished site: materials still missing when last seen (per item id). Absent once complete. */
  missing?: number[];
}

export interface Commitment {
  id: number;
  /** "owe": I promised `to`; "due": `to` promised me. */
  dir: "owe" | "due";
  to: number;
  item: number;
  qty: number;
  due: number;
  done: boolean;
}

export interface Heard {
  utterance: number;
  tick: number;
  from: number;
  /** true if it was addressed to me privately. */
  direct: boolean;
  act: SpeechAct;
  text?: string;
}

/** A request the world refused: when, what kind of action, the engine's reason code, and any detail. */
export interface Feedback {
  t: number;
  k: string;
  r: string;
  d?: string;
}

export interface Mind {
  /** Bitset over tiles: what this agent has ever seen. */
  seen: Uint8Array;
  /** Believed amount at each node (-1 unknown), when it was learned, and from whom (-1 = own eyes). */
  nodeAmt: Int16Array;
  nodeTick: Int32Array;
  nodeSrc: Int16Array;
  /** The most this agent has ever seen at each node with its own eyes (0 = never seen): its idea of "full". */
  nodeMax: Int16Array;
  /** Last known position of each other agent, and when (-1 = never met). */
  metX: Uint8Array;
  metY: Uint8Array;
  metTick: Int32Array;
  /** 0..1000 per other agent. */
  trust: Int16Array;
  /** Food-equivalent worth given to / received from each other agent. */
  gave: Int32Array;
  got: Int32Array;
  kept: Int16Array;
  broke: Int16Array;
  lastTalk: Int32Array;
  structs: KnownStructure[];
  mem: MemoryItem[];
  commitments: Commitment[];
  /** Charters (proposals and institutions) and open pact offers this agent knows to exist, by id. */
  charters: number[];
  pacts: number[];
  /** Where the plan now being followed came from. */
  src: DecisionSource;
  inbox: Heard[];
  /** Current goal code and a compact rationale, shown in the inspector. */
  goal: string;
  why: string;
  /** The urgent need (if any) that was already pressing when the current plan was made. */
  urgentAt: string;
  lastDecision: number;
  /** Event id of the decision that produced the current plan (-1 if none). */
  decisionEvent: number;
  /** A place this agent has come to treat as base, or -1. */
  homeX: number;
  homeY: number;
  /** Persistent exploration heading 0..7. */
  heading: number;
  /** Per-purpose cooldown expiry ticks. */
  cool: number[];
  /** Experience counters used by the planner's foresight. */
  coldNights: number;
  hungerDays: number;
  wintersSeen: number;
  /** Smoothed felt temperature and its day-over-day trend (the basis of seasonal foresight). */
  tempEma: number;
  tempTrend: number;
  /** Running sum and count of today's sensed outdoor temperature (folded into tempEma at day's end). */
  tempSum: number;
  tempN: number;
  /** Consecutive days whose mean sensed temperature was cold (a cold season being lived through). */
  coldRun: number;
  /** Tick at which this agent last saw a dried-up stream (-1 = never). */
  droughtSeen: number;
  /** Earliest tick at which a planner-controlled agent may deliberate strategically again. */
  nextDeliberation: number;
  /**
   * A short private note an externally driven mind left for itself with its last decision
   * (empty otherwise). It is shown back to that mind and to nobody else, and it has no effect
   * on anything: it is memory the mind chose to keep, in its own words.
   */
  note: string;
  /** What the world refused of an externally driven mind's last decision, and why (see mind/feedback.ts). */
  feedback: Feedback[];
}

// ───────────────────────── agents

export type ControllerKind = "reflex" | "planner" | "external";
export type DecisionSource = "baseline" | "mock" | "live" | "replay" | "fallback";

export interface AgentStats {
  /** Ticks spent per activity class (see ACTIVITY_CLASSES). */
  activity: number[];
  /** Units gathered per item. */
  gathered: number[];
  /** Units and worth given to others / received from others. */
  givenUnits: number;
  givenWorth: number;
  receivedUnits: number;
  receivedWorth: number;
  /** Counts. */
  decisions: number;
  rejected: number;
  said: number;
  distance: number;
  /** Sum over living ticks of min(need)/1000 scaled ×1000 (welfare integral). */
  welfareSum: number;
  aliveTicks: number;
}

export interface Agent {
  id: number;
  name: string;
  x: number;
  y: number;
  /** Tile the agent was on before its current/last step (for interpolation). */
  px: number;
  py: number;
  alive: boolean;
  diedTick: number;
  deathCause: string;
  // needs, 0..1000
  energy: number;
  hydration: number;
  rest: number;
  warmth: number;
  health: number;
  /** Ticks remaining of an illness (0 = healthy). */
  ill: number;
  asleep: boolean;
  /** Structure id of the shelter currently occupied, or -1. */
  shelter: number;
  inv: number[];
  /** Remaining uses of the tool in hand, per item id (0 for non-tools). */
  toolUses: number[];
  traits: number[];
  phys: number[];
  skills: number[];
  controller: ControllerKind;
  /** Queue of intents from the last deliberation; executed in order. */
  queue: Intent[];
  act: ActionState | null;
  /** Cached path (tile indices, next step last) for the current goto. */
  path: number[];
  /** Signature of the goal the cached path leads to (-1 = none). */
  pathKey: number;
  /** Progress counters for the intent at the head of the queue. */
  progress: number;
  stats: AgentStats;
  mind: Mind;
  /** Membership bitmap is stored in institutions; kept here only as a count for quick checks. */
  memberships: number;
  /** Crafts this person knows, one bit each (constants.ts: Craft). Zero in a world without crafts. */
  lore: number;
  /** The tick this person came to the island: 0 for those it began with. A record; nothing in the simulation reads it. */
  since: number;
}

// ───────────────────────── structures and piles

export interface Structure {
  id: number;
  kind: number;
  x: number;
  y: number;
  /** Tick construction was started and completed (-1 while unfinished). */
  foundedTick: number;
  builtTick: number;
  founder: number;
  /** Agents who supplied materials or labour, and how much (parallel arrays). */
  contributors: number[];
  contributions: number[];
  /** Agents who put materials or labour into raising it (a subset of contributors: depositors are not builders). */
  builders: number[];
  /** Materials still missing per item id (all zero when ready for labour). */
  missing: number[];
  laborDone: number;
  laborNeeded: number;
  complete: boolean;
  /** campfire: ticks of fuel left; lit iff > 0. healing house: ticks of care laid up. */
  fuel: number;
  /** store: contents per item id. */
  inv: number[];
  /**
   * store under an institution's control: units per item id that were already inside when it
   * was placed under control. They were put there by people who agreed to nothing, so they
   * stay open to everyone until drawn down. All zero for a store nobody controls.
   */
  open: number[];
  /** plot, field: tick it becomes ripe (-1 if not planted / already harvested). */
  ripeTick: number;
  /** shelter: number of current occupants. */
  occupants: number;
  /** Institution controlling this structure, or -1 (open access). */
  bound: number;
  /** Integrity 0..1000; structures decay slowly without upkeep and collapse at 0. */
  integrity: number;
  removed: boolean;
  /** record house: the crafts written down in it, one bit each. Zero for everything else. */
  lore: number;
}

export interface Pile {
  x: number;
  y: number;
  inv: number[];
}

// ───────────────────────── climate

export interface Climate {
  weather: number;
  /** Tick at which weather is next re-drawn. */
  weatherUntil: number;
  /** Ambient temperature at sea level right now, in tenths of °C. */
  temp: number;
  /** 0..1000 ground wetness and snow cover (visual + small gameplay effects). */
  wet: number;
  snow: number;
  /** 0..1000 daylight right now. */
  light: number;
  /** Active modifiers from shocks/interventions (expiry ticks; 0 = inactive). */
  droughtUntil: number;
  coldUntil: number;
  coldDelta: number;
  rainUntil: number;
  hushUntil: number;
  hushRadius: number;
}

// ───────────────────────── events

export type EventKind =
  | "decision"
  | "gather"
  | "eat"
  | "drink"
  | "fill"
  | "sleep"
  | "wake"
  | "craft"
  | "found"
  | "supply"
  | "built"
  | "refuel"
  | "plant"
  | "harvest"
  | "give"
  | "drop"
  | "pickup"
  | "deposit"
  | "withdraw"
  | "say"
  | "inspect"
  | "rejected"
  | "need"
  | "ill"
  | "recover"
  | "death"
  | "tool_broke"
  | "spoil"
  | "weather"
  | "season"
  | "day"
  | "depleted"
  | "recovered"
  | "fire_out"
  | "collapse"
  | "shock"
  | "intervention"
  | "arrival"
  | "proposal"
  | "proposal_rejected"
  | "endorse"
  | "ratified"
  | "lapsed"
  | "joined"
  | "left"
  | "expelled"
  | "motion"
  | "vote"
  | "motion_result"
  | "rule"
  | "transfer"
  | "obligation"
  | "breach"
  | "sanction"
  | "dissolved"
  | "pact"
  | "pact_done"
  | "pact_void"
  | "promise_kept"
  | "promise_broken"
  // worlds with crafts
  | "discovered" // a craft came to someone from their own practice
  | "learned" // a craft was taken in from watching someone, or from a record house
  | "inscribed" // a craft was written down in a record house
  | "milled" // a mill turned roots into rations
  | "tended" // care was laid up in a healing house
  | "age"; // the island as a whole passed a threshold (a reading, logged once; no citizen is told)

/**
 * One ledger entry. Compact keys keep ledgers small:
 *  id  sequential per world        t   tick
 *  k   kind                        a   actor (agent id; -1 environment; -2 observer; -3 institution)
 *  b   other agent                 n   node id       s   structure id
 *  x,y tile                        i   item id       q   quantity
 *  r   reason code                 p   causal parent event ids (direct, recorded dependencies)
 *  d   small kind-specific payload
 */
export interface SimEvent {
  id: number;
  t: number;
  k: EventKind;
  a: number;
  b?: number;
  n?: number;
  s?: number;
  x?: number;
  y?: number;
  i?: number;
  q?: number;
  r?: string;
  p?: number[];
  d?: Record<string, unknown>;
}

export const ACTOR_ENV = -1;
export const ACTOR_OBSERVER = -2;
export const ACTOR_INSTITUTION = -3;

// ───────────────────────── branch / provenance

export interface BranchInfo {
  /** Stable id of this timeline. */
  id: string;
  /** Parent timeline id, or "" for a root world. */
  parent: string;
  /** Tick at which this branch diverged from its parent (-1 for roots). */
  forkTick: number;
  /**
   * RNG epoch key mixed into exogenous draws at and after forkTick. 0 keeps common random
   * numbers with the parent; any other value decorrelates the branch.
   */
  rngEpoch: number;
}

export interface Intervention {
  tick: number;
  kind: string;
  /** Integer parameters (meaning depends on kind). */
  params: Record<string, number>;
  /** "observer" for player actions, "scenario" for scheduled shocks. */
  origin: "observer" | "scenario" | "treatment";
}

// ───────────────────────── metrics accumulators

export interface MetricsAcc {
  /** Day-sampled series (one entry per completed day). */
  days: number;
  giniSum: number;
  commonsMin: number;
  /** Directed transfer worth matrix is kept in agents' minds; here only totals. */
  gives: number;
  giveUnits: number;
  pactTrades: number;
  pactUnits: number;
  institutionTransfers: number;
  workTicks: number;
  gatheredUnits: number;
  projectsStarted: number;
  projectsCompleted: number;
  deaths: number;
  deathsByCause: Record<string, number>;
  proposals: number;
  ratified: number;
  rejectedIntents: number;
  utterances: number;
  decisionsBySource: Record<string, number>;
  /** Times a baseline planner was consulted (whether or not it found a plan worth adopting). */
  deliberations: number;
  /**
   * Declared sources and sinks per item id. Invariant at every tick:
   *   sources[i] − sinks[i] === total units of item i held anywhere in the world.
   */
  sources: number[];
  sinks: number[];
  // counted since engine 0.8.0 (all zero in a world without crafts or arrivals)
  discoveries: number;
  learned: number;
  inscribed: number;
  fieldHarvests: number;
  milled: number;
  careLaid: number;
  careSpent: number;
  arrivals: number;
  /**
   * The tick at which each age was first reached (-1 = not yet), by AGES index
   * (metrics/ages.ts). A reading of the world kept with it so that a save remembers when;
   * nothing in the simulation depends on it.
   */
  ages: number[];
}

// ───────────────────────── the world

export interface WorldMeta {
  schema: number;
  engine: string;
  affordances: string;
  configHash: string;
  branch: BranchInfo;
}

export interface WorldState {
  meta: WorldMeta;
  config: WorldConfig;
  tick: number;
  terrain: Terrain;
  nodes: Nodes;
  climate: Climate;
  agents: Agent[];
  structures: Structure[];
  piles: Pile[];
  /** Foot-traffic wear per tile (decays); worn tiles are cheaper to cross. */
  traffic: Uint16Array;
  /** Utterances spoken this tick, delivered at the start of the next. */
  speech: Utterance[];
  nextUtterance: number;
  nextStructure: number;
  nextEvent: number;
  inst: InstitutionsState;
  /** Interventions applied so far (provenance of treated timelines). */
  interventions: Intervention[];
  /** Resolved start ticks of scheduled shocks, parallel to config.shocks (-1 = already fired). */
  shockTicks: number[];
  metrics: MetricsAcc;
}

/** Activity classes for specialization metrics (index into AgentStats.activity). */
export const ACTIVITY_CLASSES = [
  "forage",
  "fish",
  "wood",
  "mine",
  "craft",
  "build",
  "farm",
  "travel",
  "rest",
  "social",
  "idle",
] as const;
export const Activity = {
  forage: 0,
  fish: 1,
  wood: 2,
  mine: 3,
  craft: 4,
  build: 5,
  farm: 6,
  travel: 7,
  rest: 8,
  social: 9,
  idle: 10,
} as const;
/** Activity classes that count as productive work for the specialization index. */
export const WORK_ACTIVITIES: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
