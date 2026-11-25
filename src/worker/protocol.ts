/**
 * Message protocol between the UI thread and the simulation worker.
 *
 * The worker owns the authoritative world(s). The UI receives compact, read-only
 * view frames and asks for detail on demand; it can never write simulation state.
 * The only inputs that affect a world are: its config, time control, and observer
 * interventions (which are logged in the world's own ledger).
 */
import type { DecisionRecord, SimEvent, Summary, WorldConfig } from "@/engine";

/**
 * A recorded run: the world's configuration, every decision an outside mind made (the tape),
 * and the state digest after each decision epoch. It is everything needed to rebuild the run
 * tick for tick and to check that what is shown is what happened. It contains no prompt, no
 * cost and nothing private.
 */
export interface Recording {
  format: "tabula-rasa/recording";
  version: 1;
  id: string;
  title: string;
  /** "mock" (a deterministic test double), "anthropic" (a language model) or "baseline". */
  provider: string;
  model: string;
  promptVersion: string;
  config: WorldConfig;
  epochs: { epoch: number; toTick: number; digest: string }[];
  tape: DecisionRecord[];
}

/** Where a recording being watched stands. */
export interface ReplayView {
  id: string;
  title: string;
  provider: string;
  model: string;
  endTick: number;
  /** The last tick at which the world matched the recorded digest. */
  verifiedTick: number;
  /** playing · ended (the record is exhausted) · mismatch (this engine did not reproduce the record). */
  state: "playing" | "ended" | "mismatch";
  decisions: number;
}

/** Floats per agent in ViewFrame.agents. */
export const AGENT_STRIDE = 20;
export const AF = {
  x: 0,
  y: 1,
  tx: 2,
  ty: 3,
  dur: 4,
  t: 5,
  action: 6,
  alive: 7,
  asleep: 8,
  energy: 9,
  hydration: 10,
  rest: 11,
  warmth: 12,
  health: 13,
  carry: 14,
  ill: 15,
  target: 16,
  load: 17,
  /** Bit set of tools owned (TOOL_BIT): a tool is drawn only for someone who has one. */
  tools: 18,
  /** The person being spoken to or given to (-1 if none): who to face. */
  partner: 19,
} as const;

export const TOOL_BIT = { axe: 1, spear: 2, basket: 4, pot: 8 } as const;

/** Action codes used in view frames (index = code). */
export const ACTION_CODES = [
  "idle",
  "step",
  "gather_forage",
  "gather_fish",
  "gather_wood",
  "gather_mine",
  "eat",
  "drink",
  "rest",
  "wait",
  "craft",
  "build",
  "give",
  "say",
  "carry",
  "harvest",
  "store",
] as const;
export type ActionCode = (typeof ACTION_CODES)[number];

export interface StaticAgentView {
  id: number;
  name: string;
  traits: number[];
  phys: number[];
}

export interface StaticWorldView {
  config: WorldConfig;
  configHash: string;
  terrainHash: string;
  engine: string;
  affordances: string;
  branchId: string;
  w: number;
  h: number;
  height: Int16Array;
  water: Uint8Array;
  biome: Uint8Array;
  fertility: Uint8Array;
  fresh: Uint8Array;
  flow: Uint16Array;
  nodeKind: Uint8Array;
  nodeX: Uint8Array;
  nodeY: Uint8Array;
  nodeCap: Int16Array;
  agents: StaticAgentView[];
}

export interface StructureView {
  id: number;
  kind: number;
  x: number;
  y: number;
  complete: boolean;
  /** 0..1000 construction progress (materials + labour). */
  progress: number;
  /** campfire fuel ticks; store fill 0..1000; plot ripeness 0..1000 */
  fuel: number;
  fill: number;
  ripe: number;
  occupants: number;
  bound: number;
  founder: number;
}

export interface PileView {
  x: number;
  y: number;
  /** total units and dominant item id */
  units: number;
  item: number;
}

/**
 * The physical trace of an agreement that was actually ratified: where it was made, how many
 * people hold to it now, and which stores it governs. Nothing is drawn for a charter that
 * was only proposed.
 */
export interface CivicMark {
  id: number;
  x: number;
  y: number;
  /** The institution has ended; its post stays where it stood. */
  ended: boolean;
  members: number;
  /** Structure ids of the stores it governs. */
  stores: number[];
}

export interface CalendarView {
  day: number;
  tickOfDay: number;
  season: number;
  seasonDay: number;
  seasonLength: number;
  year: number;
  yearPos: number;
}

export interface ClimateView {
  weather: number;
  temp: number;
  wet: number;
  snow: number;
  light: number;
  drought: boolean;
  cold: boolean;
  hush: boolean;
}

export interface ViewFrame {
  /** Identifies which world this frame belongs to; it changes every time the worker adopts a new world. */
  epoch: number;
  tick: number;
  /** Milliseconds elapsed since this tick was simulated (for sub-tick interpolation). */
  sinceTickMs: number;
  /** Simulation speed in ticks per second (0 when paused). */
  tps: number;
  playing: boolean;
  cal: CalendarView;
  climate: ClimateView;
  agents: Float32Array;
  nodeAmounts: Int16Array;
  /** Present only when structures / piles changed since the previous frame. */
  structures: StructureView[] | null;
  piles: PileView[] | null;
  /** Present only when ratified institutions changed since the previous frame. */
  marks: CivicMark[] | null;
  /** Present once per simulated day. */
  traffic: Uint16Array | null;
  /** Events since the previous frame that the UI displays. */
  events: SimEvent[];
  alive: number;
  population: number;
  /** Number of agents in the world (grows if newcomers arrive). */
  agentCount: number;
  /** Present when the roster changed (newcomers). */
  roster: StaticAgentView[] | null;
  /** True if this world has received an observer intervention. */
  treated: boolean;
  /** Charters currently on offer and institutions currently active (for the HUD badge). */
  civic: { proposals: number; institutions: number };
  /** Present while a recording is being watched. */
  replay: ReplayView | null;
}

/** One charter (proposal or institution) as the observer sees it. Rule sentences are generated from the validated charter. */
export interface CharterView {
  id: number;
  state: "proposed" | "active" | "lapsed" | "ended";
  name: string;
  purpose: string;
  /** How it came to be proposed: "grammar_search" (baseline search), "llm", "mock" or "scripted" (designer control; never emergence). */
  origin: string;
  proposer: number;
  proposedTick: number;
  ratifiedTick: number;
  endedTick: number;
  endedWhy: string;
  signers: number;
  minFounders: number;
  members: { id: number; bond: number; breaches: number; suspended: boolean; roles: string[] }[];
  terms: string[];
  rules: string[];
  stores: { id: number; kind: number; x: number; y: number }[];
  /** Rule-governed events so far, and how many members took part in them. */
  uses: number;
  usedBy: number;
  x: number;
  y: number;
}

export interface CivicsView {
  mode: string;
  charters: CharterView[];
  motions: { id: number; institution: number; by: number; what: string; yes: number; no: number; closesIn: number }[];
  exchanges: number;
  openOffers: number;
}

export interface DaySample {
  day: number;
  alive: number;
  welfare: number;
  food: number;
  wild: number;
  commons: number;
  gini: number;
  structures: number;
}

export interface CompareView {
  forkTick: number;
  forkDay: number;
  interventions: { tick: number; kind: string }[];
  treated: { summary: Summary; series: DaySample[] };
  control: { summary: Summary; series: DaySample[] };
}

export interface IntentView {
  k: string;
  text: string;
}

export interface MemoryView {
  tick: number;
  kind: string;
  who: number;
  ref: number;
  item: number;
  qty: number;
  src: number;
}

export interface BeliefView {
  node: number;
  kind: number;
  x: number;
  y: number;
  believed: number;
  /** The observer can see the truth; the citizen cannot. */
  actual: number;
  tick: number;
  src: number;
}

export interface PersonView {
  id: number;
  trust: number;
  gave: number;
  got: number;
  lastSeenTick: number;
}

export interface AgentDetail {
  id: number;
  name: string;
  alive: boolean;
  diedTick: number;
  deathCause: string;
  x: number;
  y: number;
  energy: number;
  hydration: number;
  rest: number;
  warmth: number;
  health: number;
  ill: number;
  asleep: boolean;
  inv: number[];
  traits: number[];
  phys: number[];
  skills: number[];
  controller: string;
  /** Where the plan being followed came from: baseline, fallback, mock, live or replay. */
  source: string;
  /** The note a model-driven mind left itself with its last decision (empty otherwise). */
  note: string;
  goal: string;
  why: string;
  action: string;
  queue: IntentView[];
  lastDecisionTick: number;
  decisionEvent: number;
  memory: MemoryView[];
  beliefs: BeliefView[];
  knownNodes: number;
  staleBeliefs: number;
  seenTiles: number;
  people: PersonView[];
  knownStructures: number;
  stats: { decisions: number; rejected: number; distance: number; givenUnits: number; receivedUnits: number; said: number };
  /** Bitset of tiles this citizen has seen (for the knowledge overlay). */
  seen: Uint8Array;
  capacity: number;
  load: number;
  /** The citizen's most recent logged events, newest first. */
  recent: SimEvent[];
}

export interface TileDetail {
  x: number;
  y: number;
  biome: number;
  water: number;
  height: number;
  fertility: number;
  fresh: number;
  moveCost: number;
  traffic: number;
  node: { id: number; kind: number; amount: number; cap: number } | null;
  structure: StructureView | null;
  pile: number[] | null;
  agents: number[];
}

export interface SavePayload {
  snapshot: string;
  hash: string;
  control: string | null;
  tick: number;
  day: number;
  alive: number;
  scenario: string;
  seed: number;
  treated: boolean;
  series: DaySample[];
  controlSeries: DaySample[];
}

export type ToWorker =
  | { type: "init"; config: WorldConfig; requestId: number }
  | { type: "load"; snapshot: string; control: string | null; series: DaySample[]; controlSeries: DaySample[]; requestId: number }
  | { type: "replay"; recording: Recording; requestId: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "speed"; tps: number }
  | { type: "step"; ticks: number }
  | { type: "intervene"; kind: string; params: Record<string, number>; requestId: number }
  | { type: "inspectAgent"; id: number; requestId: number }
  | { type: "inspectTile"; x: number; y: number; requestId: number }
  | { type: "compare"; requestId: number }
  | { type: "civics"; requestId: number }
  | { type: "save"; requestId: number }
  | { type: "frameRate"; hz: number }
  /** Ask for structures, piles, traffic and roster to be re-sent in the next frame (after a renderer rebuild). */
  | { type: "resync" };

export type FromWorker =
  | { type: "ready"; requestId: number; world: StaticWorldView; frame: ViewFrame; series: DaySample[] }
  | { type: "frame"; frame: ViewFrame }
  | { type: "day"; sample: DaySample; control: DaySample | null }
  | { type: "agent"; requestId: number; detail: AgentDetail | null }
  | { type: "civics"; requestId: number; view: CivicsView | null }
  | { type: "tile"; requestId: number; detail: TileDetail | null }
  | { type: "compare"; requestId: number; view: CompareView | null }
  | { type: "saved"; requestId: number; payload: SavePayload }
  | { type: "intervened"; requestId: number; ok: boolean; forkTick: number; reason?: string }
  | { type: "error"; requestId: number; code: string; message: string };
