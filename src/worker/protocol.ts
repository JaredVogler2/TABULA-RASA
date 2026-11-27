/**
 * Message protocol between the UI thread and the simulation worker.
 *
 * The worker owns the authoritative world(s). The UI receives compact, read-only
 * view frames and asks for detail on demand; it can never write simulation state.
 * The only inputs that affect a world are: its config, time control, and observer
 * interventions (which are logged in the world's own ledger).
 */
import type { AgeNeed, DecisionRecord, Legacy, Manifest, SimEvent, Summary, WorldConfig } from "@/engine";

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

/** Where the world being lived stands in its own history: the moments it can be returned to, and any re-run in progress. */
export interface HistoryView {
  /** Id of the world line being lived now. */
  branch: string;
  /** Ticks of this line that can be re-entered (the start, then every second day). */
  keyTicks: number[];
  /**
   * Present while a stretch of this world's own past is being re-run: from a stored moment,
   * with the observer's interventions re-applied at their ticks. `verified` becomes true or
   * false when the re-run reaches the moment it left from and the state is compared.
   */
  rerun: { fromTick: number; untilTick: number; pending: number; verified: boolean | null } | null;
  /** How many world lines exist (the one lived now and those set aside). */
  branches: number;
  /**
   * True when earlier moments are not in memory (the world was opened from a save or a file)
   * but can be made again: the world is deterministic, so its seed, its configuration and the
   * record of what the observer did are enough to re-live it from the first tick.
   */
  rebuildable: boolean;
  /** Why not, when it cannot be ("" when it can, or when there is nothing to rebuild). */
  rebuildBlocked: "" | "new_luck" | "outside_minds";
  /** Present while that is being done: how far it has got. */
  rebuilding: { tick: number; untilTick: number } | null;
  /**
   * How far the world on hand can be vouched for. "made": every tick of it was lived in this
   * session, from its seed. "opened": it came from a save or a file — what happened before is
   * a claim that nothing here has seen (a file being whole says only that it was not damaged).
   * "relived": opened, and since then its past was lived again from the seed, with the
   * observer's interventions re-done at their ticks, and arrived at exactly this world.
   */
  provenance: "made" | "opened" | "relived";
}

/** One world line: the one being lived, or one set aside at its last moment. */
export interface BranchView {
  id: string;
  parent: string;
  /** Tick at which it left its parent (-1 for the first line). */
  forkTick: number;
  tipTick: number;
  current: boolean;
  /** "same": the same weather and luck as its parent after the fork; "new": its own. */
  luck: "same" | "new";
  interventions: { tick: number; kind: string }[];
  alive: number;
  population: number;
  /** Content hash of the line's last state (empty for the line being lived: it is still moving). */
  sha256: string;
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
  /** The most people this world's record can ever hold (the dead included): how many figures a renderer must have room for. */
  capacity: number;
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
  /** record house: the crafts written in it, one bit each (0 for everything else). */
  lore: number;
  /** mill: whether its stream runs today (false for everything else). */
  running: boolean;
}

/**
 * How far the island has come, for the observer (worlds with crafts): the ages reached, what
 * the next one asks for, the legacy and its parts, who knows what — and the same reading of
 * the untouched twin once there is one. No citizen is shown any of it.
 */
export interface ProgressView {
  /** Highest age ever reached, and the highest whose thresholds hold now (indices into AGES). */
  reached: number;
  standing: number;
  /** The tick each age was first reached (-1 = not yet). */
  ticks: number[];
  next: { age: number; needs: AgeNeed[] } | null;
  legacy: Legacy;
  /** Living people who know each craft, by craft id. */
  knowers: number[];
  /** Crafts written down in some record house, one bit each. */
  recorded: number;
  living: number;
  works: { fields: number; granaries: number; houses: number; healingHouses: number; mills: number; recordHouses: number };
  /** The untouched twin, once there is one: how far it has come, when, what it has to show and how many are alive. */
  twin: { reached: number; legacy: number; living: number; ticks: number[] } | null;
}

/** The observer's hand in a world that limits it: how many changes a season allows and how many are left in this one. */
export interface HandView {
  perSeason: number;
  left: number;
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
  /**
   * Which world this frame shows: the one being lived, or its twin (after an intervention, the
   * untouched one; beside a recording, the same island with the engine's own minds deciding).
   * Both are stepped together, so the two views are always of the same tick.
   */
  viewing: "world" | "twin";
  /** True when there is a twin to look at. */
  hasTwin: boolean;
  /** The tick at which the untouched twin left this world (-1 if it has not been touched, or the twin never was this world). */
  forkTick: number;
  /** Present while a recording is being watched. */
  replay: ReplayView | null;
  /** The world's own history (absent while a recording is watched: that history is the recording). */
  history: HistoryView | null;
  /** Ages, legacy and crafts (null in a world without crafts). */
  progress: ProgressView | null;
  /** Null where the observer's hand is not limited. */
  hand: HandView | null;
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
  /** Legacy and the age reached that day (worlds with crafts; absent in samples made before they were counted). */
  legacy?: number;
  age?: number;
}

export type AimState = "open" | "met" | "lost" | "reading";

/**
 * How the aim on a scenario's card stands, counted from the world's own state (`aims.ts`).
 * "open" until its day of reckoning, then "met" or "lost"; "reading" for an aim that has no
 * such day and so no verdict.
 */
export interface AimView {
  /** The scenario's objective id. */
  id: string;
  /** The aim as the scenario's card states it. */
  text: string;
  state: AimState;
  /** The day, as shown on screen (counting from 1), on which it was decided; null while open and for a reading. */
  decidedDay: number | null;
  /** The one figure the aim is about, for setting beside the twin's. */
  figure: string;
  /** Where it stands, in plain sentences. */
  lines: string[];
}

export interface AimPair {
  /** The world being lived. Null for a scenario with no aim. */
  yours: AimView | null;
  /** The same reading of the untouched twin, when there is one. */
  twin: AimView | null;
}

export interface CompareView {
  /**
   * "intervention": the world the observer changed against its untouched twin.
   * "recording": a recorded run against the same island with the engine's own minds deciding
   * in place of the recorded ones (same seed, same people, same weather; a different way of deciding).
   */
  kind: "intervention" | "recording";
  forkTick: number;
  forkDay: number;
  interventions: { tick: number; kind: string }[];
  treated: { summary: Summary; series: DaySample[] };
  control: { summary: Summary; series: DaySample[] };
  /** The two worlds as they stand, counted side by side. */
  state: { label: string; yours: number; twin: number }[];
  /** What has happened in each since the start, by kind, from the engine's own counters. */
  happened: { label: string; yours: number; twin: number }[];
  /** People who have died in one world and are alive in the other. */
  deadOnlyYours: number[];
  deadOnlyTwin: number[];
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
  /** Crafts this citizen knows, one bit each (always 0 in a world without crafts). */
  lore: number;
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

/** A world and its twin as gzip of their canonical text: what is kept in the browser's storage. */
export interface PackedWorld {
  snapshot: Uint8Array;
  control: Uint8Array | null;
}

export interface SavePayload {
  /** The canonical text of the world ("" when the save was asked for packed: the text is then in `packed`). */
  snapshot: string;
  /** SHA-256 of the canonical text, packed or not: what a load checks. */
  hash: string;
  control: string | null;
  /** Present when the save was asked for packed. */
  packed: PackedWorld | null;
  /** Characters of canonical text (world and twin), whatever form they travel in. */
  textBytes: number;
  /** How long serializing (and, if packed, compressing) took in the worker. */
  buildMs: number;
  tick: number;
  day: number;
  alive: number;
  scenario: string;
  seed: number;
  treated: boolean;
  series: DaySample[];
  controlSeries: DaySample[];
}

/** Measurements taken inside the simulation worker (see `scripts/perf.mjs`). Times are of whole ticks, the twin's included when there is one. */
export interface WorkerPerf {
  tick: number;
  agents: number;
  /** How many recent ticks the quantiles are over (at most 1,024). */
  samples: number;
  tickMsP50: number;
  tickMsP95: number;
  tickMsMax: number;
  twin: boolean;
  /** The worker's JavaScript heap, where the browser reports it (Chromium only), else null. */
  heapMb: number | null;
  keyframes: number;
  keyframeKb: number;
  eventsHeld: number;
}

export type ToWorker =
  | { type: "init"; config: WorldConfig; requestId: number }
  /**
   * `hash` is the content hash recorded when the save was made; a snapshot that no longer hashes to it is refused.
   * `packed`, when given, is used instead of the text fields.
   */
  | { type: "load"; snapshot: string; control: string | null; packed?: PackedWorld | null; series: DaySample[]; controlSeries: DaySample[]; hash?: string; requestId: number }
  | { type: "replay"; recording: Recording; requestId: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "speed"; tps: number }
  | { type: "step"; ticks: number }
  | { type: "intervene"; kind: string; params: Record<string, number>; requestId: number }
  | { type: "inspectAgent"; id: number; requestId: number }
  | { type: "inspectTile"; x: number; y: number; requestId: number }
  | { type: "compare"; requestId: number }
  /** How the scenario's stated aim stands, in the world being lived and in its twin. */
  | { type: "aim"; requestId: number }
  | { type: "civics"; requestId: number }
  /** `packed`: return the world gzip-compressed instead of as text (for storage). */
  | { type: "save"; packed?: boolean; requestId: number }
  /** Go back to a stored moment of this world: re-run it exactly, or leave from there on a new line. */
  | { type: "rewind"; tick: number; mode: "rerun" | "branch" | "branch_new_luck"; requestId: number }
  | { type: "branches"; requestId: number }
  | { type: "switchBranch"; id: string; requestId: number }
  /** Pack the world (and its twin) with a manifest; `extras` is kept beside it untouched. */
  | { type: "export"; extras: Record<string, unknown>; requestId: number }
  | { type: "import"; text: string; requestId: number }
  /** The recorded causes of an event: its parents, and theirs, as the engine logged them. */
  | { type: "trace"; id: number; requestId: number }
  /** How long recent ticks took in this worker, and what it is holding in memory. Measures; changes nothing. */
  | { type: "perf"; requestId: number }
  /** The events the engine has logged for the world being lived, as held in memory: one JSON object per line. */
  | { type: "ledger"; requestId: number }
  /** Look at the twin instead of the world being lived (or back). Changes nothing in either. */
  | { type: "view"; twin: boolean }
  /** Make the earlier moments of a loaded world again from its seed, and check the result against it. */
  | { type: "rebuild"; requestId: number }
  | { type: "frameRate"; hz: number }
  /** Ask for structures, piles, traffic and roster to be re-sent in the next frame (after a renderer rebuild). */
  | { type: "resync" }
  /**
   * The page has taken a frame: the next may be sent. The worker sends a frame only when the last
   * one has been taken, so a page slower than the world is shown the world as it is when it next
   * looks, and never a queue of the moments it missed (D-050). Sent once for every `frame` message.
   */
  | { type: "taken" };

export type FromWorker =
  | { type: "ready"; requestId: number; world: StaticWorldView; frame: ViewFrame; series: DaySample[]; controlSeries: DaySample[]; imported?: { manifest: Manifest; extras: Record<string, unknown> } }
  | { type: "branches"; requestId: number; list: BranchView[] }
  | { type: "exported"; requestId: number; text: string; manifest: Manifest }
  | { type: "trace"; requestId: number; chain: SimEvent[] }
  | { type: "perf"; requestId: number; perf: WorkerPerf }
  /** `complete` is true only if the text holds every event since the first tick (ids 0 … n−1 with nothing dropped). */
  | { type: "ledger"; requestId: number; text: string; events: number; firstTick: number; complete: boolean }
  /** `ok` is true only if the re-lived world and its twin are, state for state, the ones that were loaded. */
  | { type: "rebuilt"; requestId: number; ok: boolean; ticks: number; ms: number; moments: number; series: DaySample[]; controlSeries: DaySample[]; events: SimEvent[] }
  | { type: "frame"; frame: ViewFrame }
  | { type: "day"; sample: DaySample; control: DaySample | null; aim: AimPair }
  | { type: "aim"; requestId: number; aim: AimPair }
  | { type: "agent"; requestId: number; detail: AgentDetail | null }
  | { type: "civics"; requestId: number; view: CivicsView | null }
  | { type: "tile"; requestId: number; detail: TileDetail | null }
  | { type: "compare"; requestId: number; view: CompareView | null }
  | { type: "saved"; requestId: number; payload: SavePayload }
  | { type: "intervened"; requestId: number; ok: boolean; forkTick: number; reason?: string }
  | { type: "error"; requestId: number; code: string; message: string };
