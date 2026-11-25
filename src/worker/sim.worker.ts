/// <reference lib="webworker" />
/**
 * Simulation host. Owns the authoritative world and, after the first observer
 * intervention, an untouched control twin forked at the same tick with common random
 * numbers. Posts compact view frames to the UI and answers detail requests.
 */
import {
  ITEM_COUNT,
  Item,
  NODE_SPECS,
  NodeKind,
  Skill,
  SnapshotError,
  StructureKind,
  STRUCTURE_SPECS,
  TICKS_PER_DAY,
  applyIntervention,
  calendarAt,
  carriedWeight,
  carryCapacity,
  cloneWorld,
  commonsHealthPermille,
  createWorld,
  forkWorld,
  giniPermille,
  hasSeen,
  manifestOf,
  openBundle,
  packBundle,
  replayTape,
  restoreWorld,
  scratchOf,
  serializeWorld,
  snapshotHash,
  step,
  summarize,
  totalGoods,
  validateConfig,
  worldDigest,
  worthOf,
  type Agent,
  type DecisionRecord,
  type Intervention,
  type SimEvent,
  type Structure,
  type WorldState,
} from "@/engine";
import { describeMotion, describeRule, describeTerms, type Manifest } from "@/engine";
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { readAims } from "./aims";
import { describeIntent } from "./describe";
import {
  ACTION_CODES,
  AF,
  AGENT_STRIDE,
  TOOL_BIT,
  type AgentDetail,
  type BranchView,
  type CharterView,
  type CivicsView,
  type CompareView,
  type DaySample,
  type FromWorker,
  type HistoryView,
  type PileView,
  type Recording,
  type ReplayView,
  type StaticAgentView,
  type StaticWorldView,
  type StructureView,
  type TileDetail,
  type ToWorker,
  type ViewFrame,
} from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let world: WorldState | null = null;
let control: WorldState | null = null;
let forkTick = -1;
let playing = false;
let tps = 2;
let acc = 0;
let lastLoop = 0;
let lastTickAt = 0;
let frameHz = 30;
let timer: ReturnType<typeof setInterval> | null = null;
/** Set when the world on hand could not be carried on: nothing more is asked of it. */
let faulted = false;
/** How far the world on hand can be vouched for (see HistoryView.provenance), and what the next adopted world will be. */
let provenance: HistoryView["provenance"] = "made";
let arriving: HistoryView["provenance"] = "made";
/** How long a world from a file is lived on a copy before it is let in (half a day). */
const TRIAL_TICKS = TICKS_PER_DAY / 2;

const uiEvents: SimEvent[] = [];
const scratchEvents: SimEvent[] = [];
const controlSink: SimEvent[] = [];
let series: DaySample[] = [];
let controlSeries: DaySample[] = [];
let structureSig = "";
let pileSig = "";
let markSig = "?";
let rosterCount = 0;
let trafficDay = -1;
let worldEpoch = 0;

/** A recording being watched: its tape, how far into it we are, and whether the world still matches it. */
let rec: { view: ReplayView; tape: DecisionRecord[]; cursor: number; marks: Recording["epochs"]; mark: number } | null = null;
/** Last few events per agent, for the inspector. */
const recent = new Map<number, SimEvent[]>();

// ───────────────────────── history: moments that can be returned to, and the lines set aside

/** A stored moment of the line being lived: the world and its untouched twin, compressed, and how long the daily series were. */
interface Keyframe {
  tick: number;
  world: Uint8Array;
  control: Uint8Array | null;
  seriesLen: number;
  controlSeriesLen: number;
}
const KEY_EVERY = 2 * TICKS_PER_DAY;
const MAX_KEYFRAMES = 24;
let keyframes: Keyframe[] = [];

interface BranchRecord {
  view: BranchView;
  /** The line's last state, kept while another line is lived (null for the one being lived). */
  frozen: { world: Uint8Array; control: Uint8Array | null; series: DaySample[]; controlSeries: DaySample[] } | null;
}
let branches: BranchRecord[] = [];
let branchSeq = 0;

/** A stretch of this world's own past being re-run: what is still to be re-applied, and what the end must look like. */
let rerun: { fromTick: number; untilTick: number; log: Intervention[]; next: number; digest: string; verified: boolean | null } | null = null;

/** Recent events of every kind, by id, so that the recorded causes of one can be followed back. */
const eventLog = new Map<number, SimEvent>();
const EVENT_LOG_CAP = 40_000;

/** How long the most recent ticks took, for the performance probe (a ring: it costs one write per tick). */
const tickRing = new Float32Array(1024);
let tickRingCount = 0;

/** True while the frames sent to the UI show the twin instead of the world being lived. Changes nothing in either. */
let viewTwin = false;
const shown = (): WorldState | null => (viewTwin && control ? control : world);
/** True if anyone in the world being lived is decided for from outside the engine (their past is not in the world's own record). */
let outsideMinds = false;

/**
 * The past of a loaded world, being lived again from its first tick: the same seed and
 * configuration, the observer's interventions at their ticks, the twin forked where it was
 * forked. It is done a few milliseconds at a time, and at the end the re-lived world must be,
 * state for state, the one that was loaded — otherwise nothing of it is kept.
 */
let rebuild: {
  w: WorldState;
  c: WorldState | null;
  log: Intervention[];
  next: number;
  untilTick: number;
  frames: Keyframe[];
  series: DaySample[];
  controlSeries: DaySample[];
  events: SimEvent[];
  requestId: number;
  started: number;
} | null = null;

const pack = (w: WorldState): Uint8Array => gzipSync(strToU8(serializeWorld(w)), { level: 4 });
const unpack = (z: Uint8Array): WorldState => restoreWorld(strFromU8(gunzipSync(z)));

/** Keep the start and the most recent eight; thin the middle to every other one. */
function thin(frames: Keyframe[]): Keyframe[] {
  let out = frames;
  while (out.length > MAX_KEYFRAMES) {
    const n = out.length;
    out = out.filter((_, i) => i === 0 || i >= n - 8 || i % 2 === 0);
  }
  return out;
}

function takeKeyframe(): void {
  if (!world || rec) return;
  const last = keyframes[keyframes.length - 1];
  if (last && last.tick === world.tick) return;
  keyframes.push({ tick: world.tick, world: pack(world), control: control ? pack(control) : null, seriesLen: series.length, controlSeriesLen: controlSeries.length });
  keyframes = thin(keyframes);
}

function currentBranch(): BranchRecord {
  let b = branches.find((x) => x.view.current);
  if (!b) {
    b = { view: { id: world?.meta.branch.id ?? "main", parent: world?.meta.branch.parent ?? "", forkTick: -1, tipTick: 0, current: true, luck: "same", interventions: [], alive: 0, population: 0, sha256: "" }, frozen: null };
    branches.push(b);
  }
  return b;
}

function branchViews(): BranchView[] {
  const w = world;
  return branches.map((b) =>
    b.view.current && w
      ? { ...b.view, tipTick: w.tick, alive: w.agents.filter((a) => a.alive).length, population: w.agents.length, interventions: w.interventions.filter((i) => i.origin !== "scenario").map((i) => ({ tick: i.tick, kind: i.kind })), sha256: "" }
      : b.view,
  );
}

/** Set the line being lived aside at its last moment, so that it can be returned to. */
function freezeCurrent(): void {
  if (!world) return;
  const b = currentBranch();
  const text = serializeWorld(world);
  b.frozen = { world: gzipSync(strToU8(text), { level: 4 }), control: control ? pack(control) : null, series: series.slice(), controlSeries: controlSeries.slice() };
  b.view = {
    ...b.view,
    current: false,
    tipTick: world.tick,
    alive: world.agents.filter((a) => a.alive).length,
    population: world.agents.length,
    interventions: world.interventions.filter((i) => i.origin !== "scenario").map((i) => ({ tick: i.tick, kind: i.kind })),
    sha256: snapshotHash(text),
  };
}

function historyView(): HistoryView | null {
  if (!world || rec) return null;
  // earlier moments are missing only when the world was opened from a save or a file
  const partial = (keyframes[0]?.tick ?? 0) > 0;
  const blocked: HistoryView["rebuildBlocked"] = !partial ? "" : world.meta.branch.rngEpoch !== 0 || (control !== null && control.meta.branch.rngEpoch !== 0) ? "new_luck" : outsideMinds ? "outside_minds" : "";
  return {
    branch: currentBranch().view.id,
    keyTicks: keyframes.map((k) => k.tick),
    rerun: rerun ? { fromTick: rerun.fromTick, untilTick: rerun.untilTick, pending: rerun.log.length - rerun.next, verified: rerun.verified } : null,
    branches: branches.length,
    rebuildable: partial && blocked === "" && rebuild === null && !(rerun && rerun.verified === null),
    rebuildBlocked: blocked,
    rebuilding: rebuild ? { tick: rebuild.w.tick, untilTick: rebuild.untilTick } : null,
    provenance,
  };
}

/** What the observer did at exactly this tick of the world being re-lived, done again in the order it was done. */
function rebuildDue(job: NonNullable<typeof rebuild>, sink: SimEvent[]): void {
  while (job.next < job.log.length && (job.log[job.next] as Intervention).tick <= job.w.tick) {
    const iv = job.log[job.next++] as Intervention;
    if (iv.tick !== job.w.tick) continue;
    if (!job.c) {
      // the twin leaves at the first intervention, as it did then, sharing the world's luck
      job.c = forkWorld(job.w, "control", true);
      job.controlSeries = job.series.slice();
    }
    applyIntervention(job.w, scratchOf(job.w), sink, { tick: job.w.tick, kind: iv.kind, params: { ...iv.params }, origin: iv.origin });
  }
}

function advanceRebuild(budgetMs: number): void {
  const job = rebuild;
  if (!job || !world) return;
  const t0 = performance.now();
  const sink: SimEvent[] = [];
  const keep = (): void => {
    for (const e of sink) job.events.push(e);
    sink.length = 0;
    if (job.events.length > EVENT_LOG_CAP + 4000) job.events.splice(0, job.events.length - EVENT_LOG_CAP);
  };
  while (job.w.tick < job.untilTick && performance.now() - t0 < budgetMs) {
    rebuildDue(job, sink);
    step(job.w, sink);
    keep();
    if (job.c) {
      step(job.c, controlSink);
      controlSink.length = 0;
    }
    if (job.w.tick % TICKS_PER_DAY === 0) {
      job.series.push(sample(job.w));
      if (job.c) job.controlSeries.push(sample(job.c));
    }
    if (job.w.tick % KEY_EVERY === 0) job.frames.push({ tick: job.w.tick, world: pack(job.w), control: job.c ? pack(job.c) : null, seriesLen: job.series.length, controlSeriesLen: job.controlSeries.length });
  }
  if (job.w.tick < job.untilTick) return;
  // anything done at the very moment the world was left
  rebuildDue(job, sink);
  keep();
  const same = worldDigest(job.w) === worldDigest(world) && (control === null) === (job.c === null) && (control === null || job.c === null || worldDigest(job.c) === worldDigest(control));
  rebuild = null;
  const ms = Math.round(performance.now() - job.started);
  if (!same) {
    post({ type: "rebuilt", requestId: job.requestId, ok: false, ticks: job.untilTick, ms, moments: 0, series: [], controlSeries: [], events: [] });
    return;
  }
  // the re-lived past is the past: its moments can be returned to, and its record of causes can be followed
  provenance = "relived";
  const present = keyframes.filter((k) => k.tick === job.untilTick);
  keyframes = thin([...job.frames.filter((k) => k.tick < job.untilTick), ...(present.length ? present : job.frames.filter((k) => k.tick === job.untilTick))]);
  takeKeyframe();
  const later = [...eventLog.values()];
  eventLog.clear();
  for (const e of job.events) eventLog.set(e.id, e);
  for (const e of later) eventLog.set(e.id, e);
  series = job.series;
  controlSeries = control ? job.controlSeries : [];
  post({ type: "rebuilt", requestId: job.requestId, ok: true, ticks: job.untilTick, ms, moments: keyframes.length, series, controlSeries, events: job.events.filter((e) => UI_EVENTS.has(e.k)).slice(-1500) });
}

/**
 * What the observer does to the world, done the same way whether it is done now or re-done
 * in a re-run: the untouched twin is forked BEFORE the first intervention and shares the
 * parent's random numbers, so the two timelines differ only by what the observer did.
 */
function applyObserver(kind: string, params: Record<string, number>, origin: Intervention["origin"] = "observer"): boolean {
  if (!world) return false;
  if (!control) {
    control = forkWorld(world, "control", true);
    forkTick = world.tick;
    controlSeries = series.slice();
  }
  const before = world.interventions.length;
  applyIntervention(world, scratchOf(world), scratchEvents, { tick: world.tick, kind, params, origin });
  for (const e of scratchEvents) {
    uiEvents.push(e);
    eventLog.set(e.id, e);
  }
  scratchEvents.length = 0;
  return world.interventions.length > before;
}

/** Event kinds forwarded to the UI (the Chronicle and world effects). */
const UI_EVENTS = new Set<string>([
  "death", "built", "found", "plant", "harvest", "give", "say", "craft", "depleted", "recovered", "weather", "season",
  "day", "shock", "intervention", "arrival", "ill", "recover", "tool_broke", "fire_out", "collapse", "proposal",
  "proposal_rejected", "endorse", "ratified", "lapsed", "joined", "left", "expelled", "motion", "vote", "motion_result",
  "rule", "transfer", "breach", "sanction", "dissolved", "pact", "pact_done", "pact_void", "promise_kept", "promise_broken",
  "deposit", "withdraw",
]);

function civicCounts(w: WorldState): { proposals: number; institutions: number } {
  let proposals = 0;
  let institutions = 0;
  for (const p of w.inst.proposals) if (p.state === "open") proposals++;
  for (const i of w.inst.institutions) if (i.ended < 0) institutions++;
  return { proposals, institutions };
}

function civicsView(w: WorldState): CivicsView {
  const name = (id: number) => w.agents[id]?.name ?? `#${id}`;
  const charters: CharterView[] = [];
  for (const p of w.inst.proposals) {
    const inst = w.inst.institutions.find((x) => x.id === p.id);
    const c = inst ? inst.charter : p.charter;
    const storeIds = inst ? inst.stores : c.stores;
    const stores = storeIds.map((id) => w.structures[id]).filter((s): s is NonNullable<typeof s> => !!s && !s.removed).map((s) => ({ id: s.id, kind: s.kind, x: s.x, y: s.y }));
    const at = w.agents[p.proposer]!;
    charters.push({
      id: p.id,
      state: inst ? (inst.ended >= 0 ? "ended" : "active") : p.state === "lapsed" ? "lapsed" : "proposed",
      name: c.name,
      purpose: c.purpose,
      origin: p.origin,
      proposer: p.proposer,
      proposedTick: p.tick,
      ratifiedTick: inst ? inst.ratified : -1,
      endedTick: inst ? inst.ended : -1,
      endedWhy: inst ? inst.endedWhy : "",
      signers: inst ? inst.members.length : p.endorsers.length,
      minFounders: c.minFounders,
      members: inst
        ? inst.members.map((m) => ({ id: m.id, bond: m.bond, breaches: m.breaches, suspended: w.tick < m.suspendedUntil, roles: c.roles.filter((_, r) => (m.roles & (1 << r)) !== 0).map((r) => r.name) }))
        : p.endorsers.map((id) => ({ id, bond: c.bond?.qty ?? 0, breaches: 0, suspended: false, roles: [] })),
      terms: describeTerms(c),
      rules: c.rules.map((r) => describeRule(r, c)),
      stores,
      uses: inst ? inst.uses : 0,
      usedBy: inst ? inst.members.filter((m) => m.uses > 0).length : 0,
      x: inst ? inst.seatX : (stores[0]?.x ?? at.x),
      y: inst ? inst.seatY : (stores[0]?.y ?? at.y),
    });
  }
  charters.sort((a, b) => (a.state === "active" ? 0 : a.state === "proposed" ? 1 : 2) - (b.state === "active" ? 0 : b.state === "proposed" ? 1 : 2) || b.id - a.id);
  const motions = w.inst.motions.filter((m) => m.state === "open").map((m) => ({ id: m.id, institution: m.institution, by: m.by, what: describeMotion(m.body, name), yes: m.yes.length, no: m.no.length, closesIn: m.closes - w.tick }));
  return { mode: w.config.institutions, charters, motions, exchanges: w.metrics.pactTrades, openOffers: w.inst.pacts.filter((p) => p.state === "open").length };
}

/** The two worlds as they stand, counted the same way, and who is dead in only one of them. */
function stateDiff(mine: WorldState, twin: WorldState): Pick<CompareView, "state" | "happened" | "deadOnlyYours" | "deadOnlyTwin"> {
  const count = (w: WorldState) => {
    const built = [0, 0, 0, 0];
    let lit = 0;
    for (const st of w.structures) {
      if (st.removed || !st.complete) continue;
      built[st.kind] = (built[st.kind] ?? 0) + 1;
      if (st.kind === StructureKind.campfire && st.fuel > 0) lit++;
    }
    let bare = 0;
    for (let n = 0; n < w.nodes.count; n++) if ((w.nodes.amount[n] as number) === 0 && (w.nodes.cap[n] as number) > 0) bare++;
    return {
      living: w.agents.filter((a) => a.alive).length,
      people: w.agents.length,
      hearths: built[StructureKind.campfire] ?? 0,
      lit,
      shelters: built[StructureKind.shelter] ?? 0,
      stores: built[StructureKind.store] ?? 0,
      plots: built[StructureKind.plot] ?? 0,
      inForce: w.inst.institutions.filter((i) => i.ended < 0).length,
      ratified: w.inst.institutions.length,
      bare,
      gifts: w.metrics.gives,
      trades: w.metrics.pactTrades,
    };
  };
  const a = count(mine);
  const b = count(twin);
  const state = [
    { label: "People alive", yours: a.living, twin: b.living },
    { label: "People who ever lived here", yours: a.people, twin: b.people },
    { label: "Hearths built", yours: a.hearths, twin: b.hearths },
    { label: "…of which lit now", yours: a.lit, twin: b.lit },
    { label: "Shelters", yours: a.shelters, twin: b.shelters },
    { label: "Stores", yours: a.stores, twin: b.stores },
    { label: "Plots planted", yours: a.plots, twin: b.plots },
    { label: "Agreements ever ratified", yours: a.ratified, twin: b.ratified },
    { label: "…in force now", yours: a.inForce, twin: b.inForce },
    { label: "Resource places stripped bare", yours: a.bare, twin: b.bare },
    { label: "Gifts made", yours: a.gifts, twin: b.gifts },
    { label: "Exchanges completed", yours: a.trades, twin: b.trades },
  ];
  const deadOnlyYours: number[] = [];
  const deadOnlyTwin: number[] = [];
  const n = Math.min(mine.agents.length, twin.agents.length);
  for (let i = 0; i < n; i++) {
    const m = mine.agents[i]!.alive;
    const t = twin.agents[i]!.alive;
    if (!m && t) deadOnlyYours.push(i);
    else if (m && !t) deadOnlyTwin.push(i);
  }
  // what has happened in each, by kind, from the counters the engine keeps as it applies events
  const ma = mine.metrics;
  const mb = twin.metrics;
  const happened = [
    { label: "Deaths", yours: ma.deaths, twin: mb.deaths },
    ...[...new Set([...Object.keys(ma.deathsByCause), ...Object.keys(mb.deathsByCause)])].sort().map((cause) => ({ label: `…of ${cause.replace(/_/g, " ")}`, yours: ma.deathsByCause[cause] ?? 0, twin: mb.deathsByCause[cause] ?? 0 })),
    { label: "Units gathered from the land", yours: ma.gatheredUnits, twin: mb.gatheredUnits },
    { label: "Things said aloud", yours: ma.utterances, twin: mb.utterances },
    { label: "Building projects started", yours: ma.projectsStarted, twin: mb.projectsStarted },
    { label: "…and finished", yours: ma.projectsCompleted, twin: mb.projectsCompleted },
    { label: "Charters proposed", yours: ma.proposals, twin: mb.proposals },
    { label: "Intents the engine refused", yours: ma.rejectedIntents, twin: mb.rejectedIntents },
  ];
  return { state, happened, deadOnlyYours, deadOnlyTwin };
}

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function actionCode(w: WorldState, a: Agent): number {
  const act = a.act;
  if (!act) return carriedWeight(a) > 12 ? ACTION_CODES.indexOf("carry") : 0;
  switch (act.k) {
    case "step":
      return ACTION_CODES.indexOf("step");
    case "gather": {
      const intent = a.queue[0];
      const kind = intent && intent.k === "gather" ? (w.nodes.kind[intent.node] as number) : 0;
      const skill = NODE_SPECS[kind]?.skill ?? Skill.forage;
      return ACTION_CODES.indexOf(skill === Skill.fish ? "gather_fish" : skill === Skill.wood ? "gather_wood" : skill === Skill.mine ? "gather_mine" : "gather_forage");
    }
    case "eat":
      return ACTION_CODES.indexOf("eat");
    case "drink":
    case "fill":
      return ACTION_CODES.indexOf("drink");
    case "rest":
      return ACTION_CODES.indexOf("rest");
    case "craft":
      return ACTION_CODES.indexOf("craft");
    case "build":
    case "supply":
    case "work":
    case "refuel":
      return ACTION_CODES.indexOf("build");
    case "harvest":
      return ACTION_CODES.indexOf("harvest");
    case "give":
      return ACTION_CODES.indexOf("give");
    case "say":
      return ACTION_CODES.indexOf("say");
    case "deposit":
    case "withdraw":
    case "pickup":
    case "drop":
      return ACTION_CODES.indexOf("store");
    default:
      return ACTION_CODES.indexOf("wait");
  }
}

function dominantItem(inv: readonly number[]): number {
  let best = -1;
  let bestW = 0;
  for (let i = 0; i < ITEM_COUNT; i++) {
    const q = inv[i] as number;
    if (q > bestW) {
      bestW = q;
      best = i;
    }
  }
  return best;
}

function structureView(s: Structure): StructureView {
  const spec = STRUCTURE_SPECS[s.kind]!;
  let needed = 0;
  let missing = 0;
  for (const [item, qty] of spec.materials) {
    needed += qty;
    missing += s.missing[item] as number;
  }
  const materialShare = needed === 0 ? 1 : (needed - missing) / needed;
  const laborShare = s.laborNeeded === 0 ? 1 : Math.min(1, s.laborDone / s.laborNeeded);
  let stored = 0;
  for (let i = 0; i < ITEM_COUNT; i++) stored += s.inv[i] as number;
  return {
    id: s.id,
    kind: s.kind,
    x: s.x,
    y: s.y,
    complete: s.complete,
    progress: s.complete ? 1000 : Math.round(1000 * (0.5 * materialShare + 0.5 * laborShare)),
    fuel: s.fuel,
    fill: Math.min(1000, stored * 12),
    ripe: s.kind === StructureKind.plot && s.ripeTick >= 0 && world ? (world.tick >= s.ripeTick ? 1000 : Math.max(0, 1000 - Math.round(((s.ripeTick - world.tick) * 1000) / (12 * TICKS_PER_DAY)))) : 0,
    occupants: s.occupants,
    bound: s.bound,
    founder: s.founder,
  };
}

function structureSignature(w: WorldState): string {
  let sig = "";
  for (const s of w.structures) {
    if (s.removed) continue;
    let stored = 0;
    for (let i = 0; i < ITEM_COUNT; i++) stored += s.inv[i] as number;
    sig += `${s.id}:${s.complete ? 1 : 0}:${s.laborDone}:${s.fuel > 0 ? 1 : 0}:${stored}:${s.occupants}:${s.bound}:${s.ripeTick >= 0 && w.tick >= s.ripeTick ? 1 : 0};`;
  }
  return sig;
}

function pileViews(w: WorldState): PileView[] {
  return w.piles.map((p) => {
    let units = 0;
    for (let i = 0; i < ITEM_COUNT; i++) units += p.inv[i] as number;
    return { x: p.x, y: p.y, units, item: dominantItem(p.inv) };
  });
}

function roster(w: WorldState): StaticAgentView[] {
  return w.agents.map((a) => ({ id: a.id, name: a.name, traits: a.traits.slice(), phys: a.phys.slice() }));
}

function staticView(w: WorldState): StaticWorldView {
  const t = w.terrain;
  return {
    config: w.config,
    configHash: w.meta.configHash,
    terrainHash: t.hash,
    engine: w.meta.engine,
    affordances: w.meta.affordances,
    branchId: w.meta.branch.id,
    w: t.w,
    h: t.h,
    height: t.height.slice(),
    water: t.water.slice(),
    biome: t.biome.slice(),
    fertility: t.fertility.slice(),
    fresh: t.fresh.slice(),
    flow: t.flow.slice(),
    nodeKind: w.nodes.kind.slice(),
    nodeX: w.nodes.x.slice(),
    nodeY: w.nodes.y.slice(),
    nodeCap: w.nodes.cap.slice(),
    agents: roster(w),
  };
}

function buildFrame(w: WorldState, forceLists: boolean): ViewFrame {
  const n = w.agents.length;
  const buf = new Float32Array(n * AGENT_STRIDE);
  let alive = 0;
  for (let k = 0; k < n; k++) {
    const a = w.agents[k]!;
    const o = k * AGENT_STRIDE;
    const act = a.act;
    buf[o + AF.x] = a.x;
    buf[o + AF.y] = a.y;
    if (act && act.k === "step") {
      buf[o + AF.tx] = act.x;
      buf[o + AF.ty] = act.y;
      buf[o + AF.dur] = act.dur;
      buf[o + AF.t] = act.t;
    } else {
      buf[o + AF.tx] = a.x;
      buf[o + AF.ty] = a.y;
      buf[o + AF.dur] = act ? act.dur : 0;
      buf[o + AF.t] = act ? act.t : 0;
    }
    buf[o + AF.action] = actionCode(w, a);
    buf[o + AF.alive] = a.alive ? 1 : 0;
    buf[o + AF.asleep] = a.asleep ? 1 : 0;
    buf[o + AF.energy] = a.energy;
    buf[o + AF.hydration] = a.hydration;
    buf[o + AF.rest] = a.rest;
    buf[o + AF.warmth] = a.warmth;
    buf[o + AF.health] = a.health;
    buf[o + AF.carry] = dominantItem(a.inv);
    buf[o + AF.ill] = a.ill > 0 ? 1 : 0;
    // what a stationary action is directed at: the node or structure being worked on, or a person
    let target = -1;
    let partner = -1;
    const intent = a.queue[0];
    if (act && act.k !== "step") {
      if (intent && intent.k === "gather") target = (w.nodes.y[intent.node] as number) * w.terrain.w + (w.nodes.x[intent.node] as number);
      else if (act.k === "work" || act.k === "supply" || act.k === "refuel" || act.k === "harvest" || act.k === "deposit" || act.k === "withdraw") target = act.y * w.terrain.w + act.x;
      else if (intent && (intent.k === "give" || intent.k === "say")) {
        const t = w.agents[intent.to];
        if (t && t.alive) {
          partner = t.id;
          target = t.y * w.terrain.w + t.x;
        }
      }
    }
    buf[o + AF.target] = target;
    buf[o + AF.partner] = partner;
    buf[o + AF.tools] =
      ((a.inv[Item.axe] as number) > 0 ? TOOL_BIT.axe : 0) | ((a.inv[Item.spear] as number) > 0 ? TOOL_BIT.spear : 0) | ((a.inv[Item.basket] as number) > 0 ? TOOL_BIT.basket : 0) | ((a.inv[Item.pot] as number) > 0 ? TOOL_BIT.pot : 0);
    buf[o + AF.load] = Math.min(1, carriedWeight(a) / Math.max(1, carryCapacity(a)));
    if (a.alive) alive++;
  }

  const sSig = structureSignature(w);
  const pSig = `${w.piles.length}:${w.piles.reduce((s, p) => s + p.x * 131 + p.y * 17 + p.inv.reduce((x, y) => x + y, 0), 0)}`;
  const cal = calendarAt(w.config, w.tick);
  const sendStructures = forceLists || sSig !== structureSig;
  const sendPiles = forceLists || pSig !== pileSig;
  structureSig = sSig;
  pileSig = pSig;
  const mSig = w.inst.institutions.map((i) => `${i.id}:${i.ended >= 0 ? 1 : 0}:${i.members.length}:${i.stores.join(".")}`).join("|");
  const sendMarks = forceLists || mSig !== markSig;
  markSig = mSig;
  const sendTraffic = forceLists || cal.day !== trafficDay;
  trafficDay = cal.day;
  const sendRoster = forceLists || n !== rosterCount;
  rosterCount = n;

  // the Chronicle follows the world being lived; while the twin is on screen its events wait
  const twin = w !== world;
  const events = twin ? [] : uiEvents.splice(0, uiEvents.length);
  return {
    epoch: worldEpoch,
    tick: w.tick,
    sinceTickMs: Math.max(0, performance.now() - lastTickAt),
    tps: playing ? tps : 0,
    playing,
    cal: { day: cal.day, tickOfDay: cal.tickOfDay, season: cal.season, seasonDay: cal.seasonDay, seasonLength: cal.seasonLength, year: cal.year, yearPos: cal.yearPos },
    climate: {
      weather: w.climate.weather,
      temp: w.climate.temp,
      wet: w.climate.wet,
      snow: w.climate.snow,
      light: w.climate.light,
      drought: w.tick < w.climate.droughtUntil,
      cold: w.tick < w.climate.coldUntil,
      hush: w.tick < w.climate.hushUntil,
    },
    agents: buf,
    nodeAmounts: w.nodes.amount.slice(),
    structures: sendStructures ? w.structures.filter((s) => !s.removed).map(structureView) : null,
    piles: sendPiles ? pileViews(w) : null,
    marks: sendMarks ? w.inst.institutions.map((i) => ({ id: i.id, x: i.seatX, y: i.seatY, ended: i.ended >= 0, members: i.members.length, stores: i.stores.filter((id) => w.structures[id] && !w.structures[id]!.removed) })) : null,
    traffic: sendTraffic ? w.traffic.slice() : null,
    events,
    alive,
    population: w.config.population,
    agentCount: n,
    roster: sendRoster ? roster(w) : null,
    treated: (world ?? w).interventions.some((i) => i.origin === "observer"),
    civic: civicCounts(w),
    viewing: twin ? "twin" : "world",
    hasTwin: control !== null,
    forkTick: control ? forkTick : -1,
    replay: rec ? rec.view : null,
    history: historyView(),
  };
}

function sample(w: WorldState): DaySample {
  const goods = totalGoods(w);
  let wild = 0;
  for (let n = 0; n < w.nodes.count; n++) {
    const k = w.nodes.kind[n] as number;
    if (k === NodeKind.berry_bush || k === NodeKind.root_patch || k === NodeKind.fishing_water) wild += w.nodes.amount[n] as number;
  }
  let alive = 0;
  let welfare = 0;
  const holdings: number[] = [];
  for (const a of w.agents) {
    if (!a.alive) continue;
    alive++;
    welfare += Math.min(a.energy, a.hydration, a.rest, a.warmth);
    holdings.push(worthOf(a.inv));
  }
  let structures = 0;
  for (const s of w.structures) if (s.complete && !s.removed && s.kind !== StructureKind.plot) structures++;
  return {
    day: Math.floor(w.tick / TICKS_PER_DAY),
    alive,
    welfare: alive === 0 ? 0 : Math.round(welfare / alive),
    food: (goods[Item.berry] ?? 0) + (goods[Item.root] ?? 0) + (goods[Item.fish] ?? 0) + (goods[Item.ration] ?? 0),
    wild,
    commons: commonsHealthPermille(w),
    gini: giniPermille(holdings),
    structures,
  };
}

function tickOnce(): void {
  if (!world || rebuild) return;
  if (rerun) {
    if (rerun.verified !== null) {
      // the re-run has ended and been checked: time is live again from here
      rerun = null;
    } else {
      // re-do what the observer did at this very tick, in the order it was done
      while (rerun.next < rerun.log.length && (rerun.log[rerun.next] as Intervention).tick <= world.tick) {
        const iv = rerun.log[rerun.next++] as Intervention;
        if (iv.tick === world.tick) applyObserver(iv.kind, { ...iv.params }, iv.origin);
      }
      if (world.tick >= rerun.untilTick) {
        // back at the moment the re-run left from: the state must be the one that was left
        rerun.verified = worldDigest(world) === rerun.digest;
        playing = false;
        acc = 0;
        return;
      }
    }
  }
  if (rec) {
    if (world.tick >= rec.view.endTick) {
      // the record is exhausted: what happened after it was never decided by anyone
      if (rec.view.state === "playing") rec.view = { ...rec.view, state: "ended" };
      playing = false;
      return;
    }
    // the recorded decisions for this tick are offered to the world exactly as they were then
    rec.cursor = replayTape(world, rec.tape, rec.cursor, scratchEvents);
  }
  const tickStarted = performance.now();
  step(world, scratchEvents);
  if (rec) {
    const mark = rec.marks[rec.mark];
    if (mark && world.tick === mark.toTick) {
      rec.mark++;
      if (rec.view.state !== "mismatch") rec.view = worldDigest(world) === mark.digest ? { ...rec.view, verifiedTick: world.tick } : { ...rec.view, state: "mismatch" };
    }
    if (world.tick >= rec.view.endTick && rec.view.state === "playing") rec.view = { ...rec.view, state: "ended" };
  }
  for (const e of scratchEvents) {
    eventLog.set(e.id, e);
    if (UI_EVENTS.has(e.k)) uiEvents.push(e);
    if (e.a >= 0) {
      let list = recent.get(e.a);
      if (!list) {
        list = [];
        recent.set(e.a, list);
      }
      list.push(e);
      if (list.length > 14) list.shift();
    }
  }
  scratchEvents.length = 0;
  if (uiEvents.length > 4000) uiEvents.splice(0, uiEvents.length - 4000);
  if (eventLog.size > EVENT_LOG_CAP) {
    // a Map keeps insertion order: the first keys are the oldest events
    let drop = eventLog.size - EVENT_LOG_CAP + 2000;
    for (const id of eventLog.keys()) {
      if (drop-- <= 0) break;
      eventLog.delete(id);
    }
  }
  if (control) {
    step(control, controlSink);
    controlSink.length = 0;
  }
  lastTickAt = performance.now();
  tickRing[tickRingCount++ % tickRing.length] = lastTickAt - tickStarted;
  if (world.tick % TICKS_PER_DAY === 0) {
    const s = sample(world);
    series.push(s);
    let c: DaySample | null = null;
    if (control) {
      c = sample(control);
      controlSeries.push(c);
    }
    post({ type: "day", sample: s, control: c, aim: readAims(world, series, control, controlSeries) });
  }
  if (world.tick % KEY_EVERY === 0) takeKeyframe();
}

/**
 * The engine threw while this world was being lived or drawn. That should never happen — and
 * if it does, the worst outcome is a world that silently stands still, or one that is carried
 * on half-stepped. So time stops for good, the page is told in words, and the world is not
 * touched again; what was saved before stays as it was.
 */
function fault(err: unknown): void {
  faulted = true;
  playing = false;
  if (timer) clearInterval(timer);
  timer = null;
  const what = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  post({ type: "error", requestId: -1, code: "fault", message: `This world has stopped: something in it could not be carried on (${what.slice(0, 160)}). Worlds you saved earlier are untouched.` });
}

/** A world from a file is lived for a little while on a copy before it takes the place of the one on hand. */
function trial(w: WorldState): void {
  const copy = cloneWorld(w);
  const sink: SimEvent[] = [];
  try {
    for (let i = 0; i < TRIAL_TICKS; i++) {
      step(copy, sink);
      sink.length = 0;
    }
    buildFrame(copy, true);
  } catch {
    throw new SnapshotError("corrupt", "the world in this file cannot be carried on from where it stops");
  }
}

function loop(): void {
  if (!world || faulted) return;
  try {
    frameOnce();
  } catch (err) {
    fault(err);
  }
}

function frameOnce(): void {
  if (!world) return;
  const now = performance.now();
  const dt = Math.min(250, now - lastLoop);
  lastLoop = now;
  if (playing) {
    acc += (dt * tps) / 1000;
    const budgetMs = 14;
    const started = performance.now();
    let n = 0;
    while (acc >= 1 && n < 512) {
      tickOnce();
      acc -= 1;
      n++;
      if (performance.now() - started > budgetMs) break;
    }
    // A tick that ran long is made up on the frames that follow; a device that cannot keep the pace asked is
    // never chased. What is owed beyond half a second of the speed asked is forgotten, and time simply passes
    // more slowly there. (This used to forget everything as soon as eight ticks were owed — a sixteenth of a
    // second at the fastest speed — so a few slow ticks cost a 100-person world a tenth of its pace.)
    const owedAtMost = Math.max(8, tps / 2);
    if (acc > owedAtMost) acc = owedAtMost;
  }
  if (rebuild) advanceRebuild(11);
  const frame = buildFrame(shown() ?? world, false);
  post({ type: "frame", frame }, [frame.agents.buffer as ArrayBuffer, frame.nodeAmounts.buffer as ArrayBuffer]);
}

/** Lists that are sent only when they change must be sent again when the world on screen changes. */
function resendLists(): void {
  structureSig = "";
  pileSig = "";
  markSig = "?";
  trafficDay = -1;
  rosterCount = 0;
}

function restart(): void {
  if (timer) clearInterval(timer);
  lastLoop = performance.now();
  lastTickAt = lastLoop;
  timer = setInterval(loop, Math.round(1000 / frameHz));
}

/**
 * Make `w` the world being lived. `keepHistory` is for moves within one history (a rewind, a
 * return to a line set aside): the list of lines is kept. Any other adoption — a new world, a
 * loaded or imported one, a recording — starts a history of its own.
 */
function adopt(w: WorldState, c: WorldState | null, s: DaySample[], cs: DaySample[], requestId: number, recording: typeof rec = null, keepHistory = false, imported?: { manifest: Manifest; extras: Record<string, unknown> }): void {
  worldEpoch++;
  faulted = false;
  rec = recording;
  world = w;
  control = c;
  viewTwin = false;
  rebuild = null;
  outsideMinds = w.agents.some((a) => a.controller === "external");
  if (!keepHistory) {
    provenance = arriving;
    branches = [];
    branchSeq = 0;
    rerun = null;
    keyframes = [];
    eventLog.clear();
    const b = currentBranch();
    b.view = { ...b.view, id: w.meta.branch.id, parent: w.meta.branch.parent, forkTick: w.meta.branch.forkTick, luck: w.meta.branch.rngEpoch === 0 ? "same" : "new" };
  }
  arriving = "made";
  forkTick = c ? c.meta.branch.forkTick : -1;
  series = s.slice();
  controlSeries = cs.slice();
  if (series.length === 0) series.push(sample(w));
  // beside a recording, the twin has lived the same days from the start
  if (recording && c && controlSeries.length === 0) controlSeries.push(sample(c));
  uiEvents.length = 0;
  recent.clear();
  structureSig = "";
  pileSig = "";
  markSig = "?";
  trafficDay = -1;
  rosterCount = 0;
  acc = 0;
  playing = false;
  lastTickAt = performance.now();
  // the moment arrived at can itself be returned to
  takeKeyframe();
  const frame = buildFrame(w, true);
  post({ type: "ready", requestId, world: staticView(w), frame, series, controlSeries, ...(imported ? { imported } : {}) });
  restart();
}

function agentDetail(w: WorldState, id: number): AgentDetail | null {
  const a = w.agents[id];
  if (!a) return null;
  const m = a.mind;
  const beliefs: AgentDetail["beliefs"] = [];
  let knownNodes = 0;
  let stale = 0;
  for (let n = 0; n < w.nodes.count; n++) {
    const believed = m.nodeAmt[n] as number;
    if (believed === -1) continue;
    knownNodes++;
    const actual = w.nodes.amount[n] as number;
    if (believed !== actual) stale++;
    beliefs.push({ node: n, kind: w.nodes.kind[n] as number, x: w.nodes.x[n] as number, y: w.nodes.y[n] as number, believed, actual, tick: m.nodeTick[n] as number, src: m.nodeSrc[n] as number });
  }
  // nearest dozen, so the inspector stays readable
  beliefs.sort((p, q) => Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y)) - Math.max(Math.abs(q.x - a.x), Math.abs(q.y - a.y)) || p.node - q.node);
  let seenTiles = 0;
  const tiles = w.terrain.w * w.terrain.h;
  for (let t = 0; t < tiles; t++) if (hasSeen(m.seen, t)) seenTiles++;
  const people: AgentDetail["people"] = [];
  for (let o = 0; o < w.agents.length; o++) {
    if (o === a.id || (m.metTick[o] as number) < 0) continue;
    people.push({ id: o, trust: m.trust[o] as number, gave: m.gave[o] as number, got: m.got[o] as number, lastSeenTick: m.metTick[o] as number });
  }
  people.sort((p, q) => q.got + q.gave - (p.got + p.gave) || q.lastSeenTick - p.lastSeenTick || p.id - q.id);
  const act = a.act;
  return {
    id: a.id,
    name: a.name,
    alive: a.alive,
    diedTick: a.diedTick,
    deathCause: a.deathCause,
    x: a.x,
    y: a.y,
    energy: a.energy,
    hydration: a.hydration,
    rest: a.rest,
    warmth: a.warmth,
    health: a.health,
    ill: a.ill,
    asleep: a.asleep,
    inv: a.inv.slice(),
    traits: a.traits.slice(),
    phys: a.phys.slice(),
    skills: a.skills.slice(),
    controller: a.controller,
    source: m.src,
    note: m.note,
    goal: m.goal,
    why: m.why,
    action: act ? (act.k === "step" ? "walking" : act.k) : "idle",
    queue: a.queue.slice(0, 6).map((i) => ({ k: i.k, text: describeIntent(w, i) })),
    lastDecisionTick: m.lastDecision,
    decisionEvent: m.decisionEvent,
    memory: m.mem.slice(-14).reverse().map((x) => ({ tick: x.tick, kind: x.kind, who: x.who, ref: x.ref, item: x.item, qty: x.qty, src: x.src })),
    beliefs: beliefs.slice(0, 12),
    knownNodes,
    staleBeliefs: stale,
    seenTiles,
    people: people.slice(0, 8),
    knownStructures: m.structs.length,
    stats: { decisions: a.stats.decisions, rejected: a.stats.rejected, distance: a.stats.distance, givenUnits: a.stats.givenUnits, receivedUnits: a.stats.receivedUnits, said: a.stats.said },
    seen: m.seen.slice(),
    capacity: carryCapacity(a),
    load: carriedWeight(a),
    recent: w === world ? (recent.get(a.id) ?? []).slice().reverse() : [],
  };
}

function tileDetail(w: WorldState, x: number, y: number): TileDetail | null {
  const t = w.terrain;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= t.w || y >= t.h) return null;
  const tile = y * t.w + x;
  const node = w.nodes.atTile[tile] as number;
  const s = w.structures.find((q) => !q.removed && q.x === x && q.y === y);
  const pile = w.piles.find((p) => p.x === x && p.y === y);
  return {
    x,
    y,
    biome: t.biome[tile] as number,
    water: t.water[tile] as number,
    height: t.height[tile] as number,
    fertility: t.fertility[tile] as number,
    fresh: t.fresh[tile] as number,
    moveCost: t.moveCost[tile] as number,
    traffic: w.traffic[tile] as number,
    node: node >= 0 ? { id: node, kind: w.nodes.kind[node] as number, amount: w.nodes.amount[node] as number, cap: w.nodes.cap[node] as number } : null,
    structure: s ? structureView(s) : null,
    pile: pile ? pile.inv.slice() : null,
    agents: w.agents.filter((a) => a.alive && a.x === x && a.y === y).map((a) => a.id),
  };
}

ctx.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "init": {
        adopt(createWorld(msg.config), null, [], [], msg.requestId);
        break;
      }
      case "load": {
        let text = msg.snapshot;
        let controlText = msg.control;
        if (msg.packed) {
          // bytes that do not unpack are a damaged save, like text that does not parse
          try {
            text = strFromU8(gunzipSync(msg.packed.snapshot));
            controlText = msg.packed.control ? strFromU8(gunzipSync(msg.packed.control)) : null;
          } catch {
            throw new SnapshotError("corrupt", "this save cannot be unpacked");
          }
        }
        // a stored save carries the hash of its own text: storage that returns something else is not believed
        if (msg.hash !== undefined && snapshotHash(text) !== msg.hash) throw new SnapshotError("corrupt", "this save does not match the hash it was stored with");
        const w = restoreWorld(text);
        const c = controlText ? restoreWorld(controlText) : null;
        // a world that begins at its first tick has no past to take on trust
        arriving = w.tick > 0 ? "opened" : "made";
        adopt(w, c, msg.series, msg.controlSeries, msg.requestId);
        break;
      }
      case "replay": {
        const r = msg.recording;
        if (!r || r.format !== "tabula-rasa/recording" || r.version !== 1 || !Array.isArray(r.tape) || !Array.isArray(r.epochs) || r.epochs.length === 0) throw new Error("this is not a recording this version can play");
        if (r.tape.length > 200_000 || r.epochs.length > 50_000) throw new Error("this recording is too large to play here");
        const w = createWorld(validateConfig(r.config));
        const marks = r.epochs.map((e) => ({ epoch: Number(e.epoch), toTick: Number(e.toTick), digest: String(e.digest) })).sort((p, q) => p.toTick - q.toTick);
        const endTick = marks[marks.length - 1]!.toTick;
        const view: ReplayView = { id: String(r.id).slice(0, 80), title: String(r.title ?? "").slice(0, 80), provider: String(r.provider).slice(0, 24), model: String(r.model).slice(0, 60), endTick, verifiedTick: 0, state: "playing", decisions: r.tape.length };
        // the same island and the same people with the engine's own minds deciding in place of the recorded ones
        const own = w.agents.some((a) => a.controller === "external") ? createWorld(validateConfig({ ...r.config, externalShare: 0 })) : null;
        adopt(w, own, [], [], msg.requestId, { view, tape: r.tape, cursor: 0, marks, mark: 0 });
        break;
      }
      case "play":
        // a recording that has ended, or that this engine failed to reproduce, does not go on
        playing = !(rec && rec.view.state !== "playing") && rebuild === null && !faulted;
        lastLoop = performance.now();
        break;
      case "pause":
        playing = false;
        acc = 0;
        break;
      case "speed":
        tps = Math.max(0.25, Math.min(4096, msg.tps));
        // what was owed at the old speed is not owed at the new one
        if (acc > 1) acc = 1;
        break;
      case "frameRate":
        frameHz = Math.max(4, Math.min(60, msg.hz));
        if (world) restart();
        break;
      case "resync":
        resendLists();
        break;
      case "view": {
        const next = msg.twin && control !== null;
        if (next !== viewTwin) {
          viewTwin = next;
          resendLists();
        }
        break;
      }
      case "rebuild": {
        if (!world) throw new Error("no world");
        if (rec) throw new Error("a recording is rebuilt from its record every time it is played");
        if (rebuild) throw new Error("its past is already being rebuilt");
        const h = historyView();
        if (!h || !h.rebuildable) throw new Error(h?.rebuildBlocked === "new_luck" ? "this line took new luck on the way: its earlier days cannot be made again from the seed alone" : h?.rebuildBlocked === "outside_minds" ? "some of its people were decided for from outside the engine, and those decisions are not in this world's record" : "every moment of this world is already in memory");
        playing = false;
        acc = 0;
        const first = createWorld(world.config, { ...world.meta.branch });
        rebuild = {
          w: first,
          c: null,
          log: world.interventions.filter((i) => i.origin !== "scenario").map((i) => ({ tick: i.tick, kind: i.kind, params: { ...i.params }, origin: i.origin })),
          next: 0,
          untilTick: world.tick,
          frames: [{ tick: 0, world: pack(first), control: null, seriesLen: 1, controlSeriesLen: 0 }],
          series: [sample(first)],
          controlSeries: [],
          events: [],
          requestId: msg.requestId,
          started: performance.now(),
        };
        break;
      }
      case "step": {
        playing = false;
        acc = 0;
        const n = Math.max(1, Math.min(TICKS_PER_DAY * 5, Math.floor(msg.ticks)));
        if (faulted) break;
        try {
          for (let i = 0; i < n; i++) {
            tickOnce();
            // a re-run that has just arrived stops there, so that its verdict is seen before time goes on
            if (rerun && rerun.verified !== null) break;
          }
        } catch (err) {
          fault(err);
        }
        break;
      }
      case "intervene": {
        if (!world) {
          post({ type: "intervened", requestId: msg.requestId, ok: false, forkTick: -1, reason: "no_world" });
          break;
        }
        if (rec) {
          // a recording is what happened; changing it would make the rest of its tape someone else's decisions
          post({ type: "intervened", requestId: msg.requestId, ok: false, forkTick: -1, reason: "recording" });
          break;
        }
        if (rerun && rerun.verified === null) {
          // the past is being re-run as it was; to change it, leave from here on a new line
          post({ type: "intervened", requestId: msg.requestId, ok: false, forkTick: -1, reason: "rerun" });
          break;
        }
        if (rebuild || viewTwin) {
          // nothing is changed in a world that is not on screen, or while its past is being checked
          post({ type: "intervened", requestId: msg.requestId, ok: false, forkTick: -1, reason: rebuild ? "rebuild" : "twin" });
          break;
        }
        const ok = applyObserver(msg.kind, msg.params);
        post({ type: "intervened", requestId: msg.requestId, ok, forkTick, ...(ok ? {} : { reason: "unknown_kind" }) });
        break;
      }
      case "inspectAgent": {
        const w = shown();
        post({ type: "agent", requestId: msg.requestId, detail: w ? agentDetail(w, msg.id) : null });
        break;
      }
      case "inspectTile": {
        const w = shown();
        post({ type: "tile", requestId: msg.requestId, detail: w ? tileDetail(w, msg.x, msg.y) : null });
        break;
      }
      case "civics": {
        const w = shown();
        post({ type: "civics", requestId: msg.requestId, view: w ? civicsView(w) : null });
        break;
      }
      case "aim":
        post({ type: "aim", requestId: msg.requestId, aim: world ? readAims(world, series, control, controlSeries) : { yours: null, twin: null } });
        break;
      case "compare": {
        if (!world || !control) {
          post({ type: "compare", requestId: msg.requestId, view: null });
          break;
        }
        post({
          type: "compare",
          requestId: msg.requestId,
          view: {
            kind: rec ? "recording" : "intervention",
            forkTick,
            forkDay: Math.floor(forkTick / TICKS_PER_DAY),
            interventions: world.interventions.filter((i) => i.origin === "observer").map((i) => ({ tick: i.tick, kind: i.kind })),
            treated: { summary: summarize(world), series },
            control: { summary: summarize(control), series: controlSeries },
            ...stateDiff(world, control),
          },
        });
        break;
      }
      case "rewind": {
        if (!world) throw new Error("no world to go back in");
        if (rec) throw new Error("a recording has its own controls");
        if (rebuild) throw new Error("its past is being rebuilt: a moment");
        const k = [...keyframes].reverse().find((kf) => kf.tick <= msg.tick);
        if (!k) throw new Error("no stored moment that early");
        const tipTick = world.tick;
        if (msg.mode === "rerun") {
          if (k.tick >= tipTick) throw new Error("that is the present moment: there is nothing to re-run");
          // everything the observer did on this line, to be done again at the same ticks
          const log = world.interventions.filter((i) => i.origin !== "scenario").map((i) => ({ tick: i.tick, kind: i.kind, params: { ...i.params }, origin: i.origin }));
          const digest = worldDigest(world);
          const w = unpack(k.world);
          const c = k.control ? unpack(k.control) : null;
          const s = series.slice(0, k.seriesLen);
          const cs = c ? controlSeries.slice(0, k.controlSeriesLen) : [];
          keyframes = keyframes.filter((kf) => kf.tick <= k.tick);
          rerun = { fromTick: k.tick, untilTick: tipTick, log, next: w.interventions.filter((i) => i.origin !== "scenario").length, digest, verified: null };
          adopt(w, c, s, cs, msg.requestId, null, true);
        } else {
          // the line being left is kept as it stands; a new line leaves from the stored moment
          const parentId = currentBranch().view.id;
          freezeCurrent();
          const id = `line-${++branchSeq}`;
          const newLuck = msg.mode === "branch_new_luck";
          const w = forkWorld(unpack(k.world), id, !newLuck);
          // with new luck there is no twin to compare with until the observer next intervenes
          const c = !newLuck && k.control ? unpack(k.control) : null;
          const s = series.slice(0, k.seriesLen);
          const cs = c ? controlSeries.slice(0, k.controlSeriesLen) : [];
          keyframes = keyframes.filter((kf) => kf.tick < k.tick);
          rerun = null;
          branches.push({ view: { id, parent: parentId, forkTick: k.tick, tipTick: k.tick, current: true, luck: newLuck ? "new" : "same", interventions: [], alive: 0, population: 0, sha256: "" }, frozen: null });
          adopt(w, c, s, cs, msg.requestId, null, true);
        }
        break;
      }
      case "branches": {
        post({ type: "branches", requestId: msg.requestId, list: branchViews() });
        break;
      }
      case "switchBranch": {
        if (!world) throw new Error("no world");
        if (rebuild) throw new Error("its past is being rebuilt: a moment");
        const target = branches.find((b) => b.view.id === msg.id && b.frozen);
        if (!target || !target.frozen) throw new Error("there is no such line set aside");
        freezeCurrent();
        const f = target.frozen;
        const w = unpack(f.world);
        const c = f.control ? unpack(f.control) : null;
        target.frozen = null;
        target.view = { ...target.view, current: true, sha256: "" };
        keyframes = [];
        rerun = null;
        adopt(w, c, f.series, f.controlSeries, msg.requestId, null, true);
        break;
      }
      case "export": {
        if (!world) throw new Error("no world to export");
        if (rec) throw new Error("a recording is already a file: it is exported from where it was recorded");
        const text = packBundle(world, control, { ...msg.extras, series, controlSeries });
        post({ type: "exported", requestId: msg.requestId, text, manifest: manifestOf(world) });
        break;
      }
      case "import": {
        const opened = openBundle(msg.text);
        // a file is not believed because it is well formed: it is lived a little first, on a copy
        trial(opened.world);
        if (opened.control) trial(opened.control);
        arriving = opened.world.tick > 0 ? "opened" : "made";
        const extras = opened.extras;
        const daily = (v: unknown): DaySample[] => (Array.isArray(v) ? (v as DaySample[]).filter((d) => d && typeof d.day === "number").slice(0, 4000) : []);
        adopt(opened.world, opened.control, daily(extras.series), opened.control ? daily(extras.controlSeries) : [], msg.requestId, null, false, { manifest: opened.manifest, extras });
        break;
      }
      case "perf": {
        if (!world) throw new Error("no world");
        const n = Math.min(tickRingCount, tickRing.length);
        const sorted = Array.from(tickRing.subarray(0, n)).sort((p, q) => p - q);
        const at = (q: number): number => (n ? Math.round((sorted[Math.min(n - 1, Math.floor(n * q))] as number) * 1000) / 1000 : 0);
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        post({
          type: "perf",
          requestId: msg.requestId,
          perf: {
            tick: world.tick,
            agents: world.agents.length,
            samples: n,
            tickMsP50: at(0.5),
            tickMsP95: at(0.95),
            tickMsMax: n ? Math.round((sorted[n - 1] as number) * 1000) / 1000 : 0,
            twin: control !== null,
            heapMb: memory ? Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10 : null,
            keyframes: keyframes.length,
            keyframeKb: Math.round(keyframes.reduce((sum, k) => sum + k.world.byteLength + (k.control?.byteLength ?? 0), 0) / 1024),
            eventsHeld: eventLog.size,
          },
        });
        break;
      }
      case "ledger": {
        if (!world) throw new Error("no world");
        // what is in memory, oldest first: an append-only list whose ids are consecutive from the engine's first event
        const list = [...eventLog.values()].sort((p, q) => p.id - q.id);
        const first = list[0];
        const last = list[list.length - 1];
        const complete = list.length === world.nextEvent && (first?.id ?? 0) === 0;
        const header = {
          format: "tabula-rasa/ledger",
          version: 1,
          engine: world.meta.engine,
          schema: world.meta.schema,
          affordances: world.meta.affordances,
          scenario: world.config.scenario,
          seed: world.config.seed,
          configHash: world.meta.configHash,
          branch: world.meta.branch,
          tick: world.tick,
          events: list.length,
          firstId: first?.id ?? 0,
          lastId: last?.id ?? -1,
          eventsEverLogged: world.nextEvent,
          complete,
          fields: "id; t tick; k kind; a agent (-1 none); b other agent; n node; s structure; x, y tile; i item; q quantity; r reason; p ids of the events the engine recorded as causes; d detail",
        };
        const lines = [JSON.stringify(header)];
        for (const e of list) lines.push(JSON.stringify(e));
        post({ type: "ledger", requestId: msg.requestId, text: `${lines.join("\n")}\n`, events: list.length, firstTick: first?.t ?? world.tick, complete });
        break;
      }
      case "trace": {
        // follow the engine's own record of causes back from one event: parents, then theirs
        const chain: SimEvent[] = [];
        const seen = new Set<number>();
        let frontier = [msg.id];
        while (frontier.length && chain.length < 16) {
          const next: number[] = [];
          for (const id of frontier) {
            if (seen.has(id)) continue;
            seen.add(id);
            const e = eventLog.get(id);
            if (!e) continue;
            chain.push(e);
            for (const parent of e.p ?? []) next.push(parent);
          }
          frontier = next;
        }
        post({ type: "trace", requestId: msg.requestId, chain });
        break;
      }
      case "save": {
        if (!world) throw new Error("no world to save");
        if (rec) throw new Error("a recording is watched, not saved");
        const built = performance.now();
        const snapshot = serializeWorld(world);
        const controlText = control ? serializeWorld(control) : null;
        // storage keeps the text compressed: mostly-unknown belief arrays shrink to a small fraction of their size
        const packed = msg.packed ? { snapshot: gzipSync(strToU8(snapshot), { level: 4 }), control: controlText ? gzipSync(strToU8(controlText), { level: 4 }) : null } : null;
        const cal = calendarAt(world.config, world.tick);
        post({
          type: "saved",
          requestId: msg.requestId,
          payload: {
            snapshot: packed ? "" : snapshot,
            hash: snapshotHash(snapshot),
            control: packed ? null : controlText,
            packed,
            textBytes: snapshot.length + (controlText?.length ?? 0),
            buildMs: Math.round(performance.now() - built),
            tick: world.tick,
            day: cal.day,
            alive: world.agents.filter((a) => a.alive).length,
            scenario: world.config.scenario,
            seed: world.config.seed,
            treated: world.interventions.some((i) => i.origin === "observer"),
            series,
            controlSeries,
          },
        });
        break;
      }
    }
  } catch (err) {
    const requestId = "requestId" in msg ? msg.requestId : -1;
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "error";
    post({ type: "error", requestId, code, message: err instanceof Error ? err.message : String(err) });
  }
};
