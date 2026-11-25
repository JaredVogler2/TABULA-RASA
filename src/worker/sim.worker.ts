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
  StructureKind,
  STRUCTURE_SPECS,
  TICKS_PER_DAY,
  applyIntervention,
  calendarAt,
  carriedWeight,
  carryCapacity,
  commonsHealthPermille,
  createWorld,
  forkWorld,
  giniPermille,
  hasSeen,
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
  type SimEvent,
  type Structure,
  type WorldState,
} from "@/engine";
import { describeMotion, describeRule, describeTerms } from "@/engine";
import { describeIntent } from "./describe";
import {
  ACTION_CODES,
  AF,
  AGENT_STRIDE,
  type AgentDetail,
  type CharterView,
  type CivicsView,
  type DaySample,
  type FromWorker,
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

const uiEvents: SimEvent[] = [];
const scratchEvents: SimEvent[] = [];
const controlSink: SimEvent[] = [];
let series: DaySample[] = [];
let controlSeries: DaySample[] = [];
let structureSig = "";
let pileSig = "";
let rosterCount = 0;
let trafficDay = -1;
let worldEpoch = 0;

/** A recording being watched: its tape, how far into it we are, and whether the world still matches it. */
let rec: { view: ReplayView; tape: DecisionRecord[]; cursor: number; marks: Recording["epochs"]; mark: number } | null = null;
/** Last few events per agent, for the inspector. */
const recent = new Map<number, SimEvent[]>();

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
    // facing target for stationary actions (the node or structure being worked on)
    let target = -1;
    const intent = a.queue[0];
    if (act && act.k !== "step") {
      if (intent && intent.k === "gather") target = (w.nodes.y[intent.node] as number) * w.terrain.w + (w.nodes.x[intent.node] as number);
      else if (act.k === "work" || act.k === "supply" || act.k === "refuel" || act.k === "harvest" || act.k === "deposit" || act.k === "withdraw") target = act.y * w.terrain.w + act.x;
      else if (intent && intent.k === "give") {
        const t = w.agents[intent.to];
        if (t) target = t.y * w.terrain.w + t.x;
      }
    }
    buf[o + AF.target] = target;
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
  const sendTraffic = forceLists || cal.day !== trafficDay;
  trafficDay = cal.day;
  const sendRoster = forceLists || n !== rosterCount;
  rosterCount = n;

  const events = uiEvents.splice(0, uiEvents.length);
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
    traffic: sendTraffic ? w.traffic.slice() : null,
    events,
    alive,
    population: w.config.population,
    agentCount: n,
    roster: sendRoster ? roster(w) : null,
    treated: w.interventions.some((i) => i.origin === "observer"),
    civic: civicCounts(w),
    replay: rec ? rec.view : null,
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
  if (!world) return;
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
  if (control) {
    step(control, controlSink);
    controlSink.length = 0;
  }
  lastTickAt = performance.now();
  if (world.tick % TICKS_PER_DAY === 0) {
    const s = sample(world);
    series.push(s);
    let c: DaySample | null = null;
    if (control) {
      c = sample(control);
      controlSeries.push(c);
    }
    post({ type: "day", sample: s, control: c });
  }
}

function loop(): void {
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
    if (acc > 8) acc = 0; // never let a backlog build up behind a slow device
  }
  const frame = buildFrame(world, false);
  post({ type: "frame", frame }, [frame.agents.buffer as ArrayBuffer, frame.nodeAmounts.buffer as ArrayBuffer]);
}

function restart(): void {
  if (timer) clearInterval(timer);
  lastLoop = performance.now();
  lastTickAt = lastLoop;
  timer = setInterval(loop, Math.round(1000 / frameHz));
}

function adopt(w: WorldState, c: WorldState | null, s: DaySample[], cs: DaySample[], requestId: number, recording: typeof rec = null): void {
  worldEpoch++;
  rec = recording;
  world = w;
  control = c;
  forkTick = c ? c.meta.branch.forkTick : -1;
  series = s.slice();
  controlSeries = cs.slice();
  if (series.length === 0) series.push(sample(w));
  uiEvents.length = 0;
  recent.clear();
  structureSig = "";
  pileSig = "";
  trafficDay = -1;
  rosterCount = 0;
  acc = 0;
  playing = false;
  lastTickAt = performance.now();
  const frame = buildFrame(w, true);
  post({ type: "ready", requestId, world: staticView(w), frame, series });
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
    recent: (recent.get(a.id) ?? []).slice().reverse(),
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
        const w = restoreWorld(msg.snapshot);
        const c = msg.control ? restoreWorld(msg.control) : null;
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
        adopt(w, null, [], [], msg.requestId, { view, tape: r.tape, cursor: 0, marks, mark: 0 });
        break;
      }
      case "play":
        // a recording that has ended, or that this engine failed to reproduce, does not go on
        playing = !(rec && rec.view.state !== "playing");
        lastLoop = performance.now();
        break;
      case "pause":
        playing = false;
        acc = 0;
        break;
      case "speed":
        tps = Math.max(0.25, Math.min(4096, msg.tps));
        break;
      case "frameRate":
        frameHz = Math.max(4, Math.min(60, msg.hz));
        if (world) restart();
        break;
      case "resync":
        structureSig = "";
        pileSig = "";
        trafficDay = -1;
        rosterCount = 0;
        break;
      case "step": {
        playing = false;
        acc = 0;
        const n = Math.max(1, Math.min(TICKS_PER_DAY * 5, Math.floor(msg.ticks)));
        for (let i = 0; i < n; i++) tickOnce();
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
        // The untouched twin is forked BEFORE the first intervention and shares the parent's
        // random numbers, so the two timelines differ only by what the observer did.
        if (!control) {
          control = forkWorld(world, "control", true);
          forkTick = world.tick;
          controlSeries = series.slice();
        }
        const before = world.interventions.length;
        applyIntervention(world, scratchOf(world), scratchEvents, { tick: world.tick, kind: msg.kind, params: msg.params, origin: "observer" });
        for (const e of scratchEvents) uiEvents.push(e);
        scratchEvents.length = 0;
        const ok = world.interventions.length > before;
        post({ type: "intervened", requestId: msg.requestId, ok, forkTick, ...(ok ? {} : { reason: "unknown_kind" }) });
        break;
      }
      case "inspectAgent": {
        post({ type: "agent", requestId: msg.requestId, detail: world ? agentDetail(world, msg.id) : null });
        break;
      }
      case "inspectTile": {
        post({ type: "tile", requestId: msg.requestId, detail: world ? tileDetail(world, msg.x, msg.y) : null });
        break;
      }
      case "civics": {
        post({ type: "civics", requestId: msg.requestId, view: world ? civicsView(world) : null });
        break;
      }
      case "compare": {
        if (!world || !control) {
          post({ type: "compare", requestId: msg.requestId, view: null });
          break;
        }
        post({
          type: "compare",
          requestId: msg.requestId,
          view: {
            forkTick,
            forkDay: Math.floor(forkTick / TICKS_PER_DAY),
            interventions: world.interventions.filter((i) => i.origin === "observer").map((i) => ({ tick: i.tick, kind: i.kind })),
            treated: { summary: summarize(world), series },
            control: { summary: summarize(control), series: controlSeries },
          },
        });
        break;
      }
      case "save": {
        if (!world) throw new Error("no world to save");
        if (rec) throw new Error("a recording is watched, not saved");
        const snapshot = serializeWorld(world);
        const cal = calendarAt(world.config, world.tick);
        post({
          type: "saved",
          requestId: msg.requestId,
          payload: {
            snapshot,
            hash: snapshotHash(snapshot),
            control: control ? serializeWorld(control) : null,
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
