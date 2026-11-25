/**
 * Who is asked to think, and when.
 *
 * A model's deliberation is the expensive part of a run, so it is rationed: at each decision
 * epoch a scheduler picks which externally driven minds are consulted, up to a fixed number,
 * and records why — for every mind, including the ones passed over. Three policies are
 * provided so that they can be compared on the same seeds:
 *
 *   round_robin  everyone in turn, whatever is happening to them
 *   event        only minds something has happened to since they last decided
 *   voi          the minds for whom a decision now is estimated to matter most
 *
 * Every policy is a deterministic function of the world and the scheduler's own state, and
 * reads only what belongs to the agent in question — its body, its plan, what it has heard,
 * what it knows of agreements. A scheduler never looks at anything the agent could not know,
 * so being asked to think carries no hidden information.
 *
 * Fairness is enforced the same way under every policy: nobody is consulted more than a
 * fixed number of times a day, and anyone passed over for too long goes to the front.
 */
import { TICKS_PER_DAY, buildObservation, needBand, scratchOf, urgentNeed, type Agent, type Observation, type WorldState } from "@/engine";

export type SchedulerKind = "round_robin" | "event" | "voi";
export const SCHEDULER_KINDS: readonly SchedulerKind[] = ["round_robin", "event", "voi"];

export interface SchedulerConfig {
  kind: SchedulerKind;
  /** Most minds consulted in one epoch. */
  callsPerEpoch: number;
  /** Most times one mind may be consulted in one day of the world. */
  maxPerAgentPerDay: number;
  /** A mind not consulted for this many epochs is consulted ahead of everyone else (0 = never forced). */
  starveAfterEpochs: number;
}

export interface SchedulerState {
  /** Round-robin: the id after the last agent served. */
  cursor: number;
  /** Per agent: the epoch it was last consulted in (-1 = never). */
  lastEpoch: number[];
  /** Per agent: consultations on `countDay`, and which day that is. */
  dayCount: number[];
  countDay: number[];
  /** Per agent: the newest utterance id it had heard, and how many agreements, motions and offers it knew of, when last consulted. */
  heardUpTo: number[];
  civicSeen: number[];
  /** Per agent: the people in sight when last consulted. */
  peopleSeen: number[][];
}

export function newSchedulerState(agents: number): SchedulerState {
  const fill = (v: number): number[] => new Array<number>(agents).fill(v);
  return { cursor: 0, lastEpoch: fill(-1), dayCount: fill(0), countDay: fill(-1), heardUpTo: fill(-1), civicSeen: fill(0), peopleSeen: Array.from({ length: agents }, () => []) };
}

export interface TraceEntry {
  agent: number;
  activated: boolean;
  /** Why it was consulted, or why it was not. */
  reason: string;
  score: number;
}

export interface Activation {
  agent: number;
  reason: string;
  score: number;
  observation: Observation;
}

export interface Schedule {
  activations: Activation[];
  trace: TraceEntry[];
  /** The scheduler's state after this epoch's choices. */
  next: SchedulerState;
}

interface Candidate {
  agent: Agent;
  obs: Observation;
  events: string[];
  score: number;
  waited: number;
}

/** Things that have happened to a mind since it last decided, in the order they are reported. */
function eventsFor(world: WorldState, a: Agent, obs: Observation, st: SchedulerState): { events: string[]; score: number } {
  const events: string[] = [];
  let score = 0;
  const add = (name: string, value: number): void => {
    events.push(name);
    score += value;
  };
  // its plan has run out: until it decides again it is acting by reflex
  if (a.queue.length === 0 && (a.act === null || a.act.k === "rest" || a.act.k === "wait")) add("plan_done", 40);
  if (obs.feedback.length > 0) add("refused", 35);
  const upTo = st.heardUpTo[a.id] ?? -1;
  const fresh = obs.heard.filter((h) => h.id > upTo);
  const direct = fresh.filter((h) => h.direct).length;
  // being spoken to matters; being talked at a great deal does not matter proportionally more
  if (direct > 0) add("spoken_to", 30 + Math.min(direct - 1, 2) * 5);
  else if (fresh.length > 0) add("overheard", 8 + Math.min(fresh.length - 1, 3) * 2);
  const cv = obs.civics;
  if (cv) {
    const pending = cv.motions.filter((m) => !m.voted).length + cv.offers.filter((o) => o.forMe).length;
    const known = cv.charters.length + cv.motions.length + cv.offers.length;
    if (pending > 0) add("asked_to_decide", 45);
    else if (known > (st.civicSeen[a.id] ?? 0)) add("agreement_news", 25);
    if (cv.memberships.some((m) => m.foodDueThisPeriod > 0)) add("dues_owed", 15);
  }
  if (obs.commitments.some((c) => c.direction === "i_owe" && c.dueIn <= 48)) add("promise_due", 30);
  const before = st.peopleSeen[a.id] ?? [];
  if (obs.people.some((p) => !before.includes(p.id))) add("new_face", 12);
  // a need that is slipping but not yet urgent is exactly when forethought is worth most
  const slipping = needBand(a.energy) === 1 || needBand(a.hydration) === 1 || needBand(a.warmth) === 1;
  if (slipping) add("need_slipping", 20);
  if (obs.now.coldSense > 0 && (st.lastEpoch[a.id] ?? -1) >= 0) score += 5;
  return { events, score };
}

/**
 * Choose this epoch's minds. `epoch` is the index of the epoch about to be decided; the
 * world must be at that epoch's first tick.
 */
export function schedule(world: WorldState, cfg: SchedulerConfig, st: SchedulerState, epoch: number): Schedule {
  const sc = scratchOf(world);
  const day = Math.floor(world.tick / TICKS_PER_DAY);
  const trace: TraceEntry[] = [];
  const candidates: Candidate[] = [];
  const skip = (agent: number, reason: string): void => {
    trace.push({ agent, activated: false, reason, score: 0 });
  };
  for (const a of world.agents) {
    if (a.controller !== "external") continue;
    if (!a.alive) continue; // the dead are not part of the trace
    if (a.asleep) {
      skip(a.id, "asleep");
      continue;
    }
    // the same rule the engine applies: a pressing need is the reflex layer's business
    if (urgentNeed(a) !== "") {
      skip(a.id, "body_first");
      continue;
    }
    if (world.tick < a.mind.nextDeliberation) {
      skip(a.id, "not_due");
      continue;
    }
    const today = st.countDay[a.id] === day ? (st.dayCount[a.id] ?? 0) : 0;
    if (today >= cfg.maxPerAgentPerDay) {
      skip(a.id, "daily_cap");
      continue;
    }
    const obs = buildObservation(world, sc, a);
    const { events, score } = eventsFor(world, a, obs, st);
    const last = st.lastEpoch[a.id] ?? -1;
    const waited = last < 0 ? epoch + 1 : epoch - last;
    candidates.push({ agent: a, obs, events, score: score + Math.min(waited, 12) * 2, waited });
  }

  const starving = (c: Candidate): boolean => cfg.starveAfterEpochs > 0 && c.waited >= cfg.starveAfterEpochs;
  const n = world.agents.length;
  const turn = (c: Candidate): number => (c.agent.id - st.cursor + n) % n;
  let order: Candidate[];
  let reasonOf: (c: Candidate) => string;
  let eligible: (c: Candidate) => boolean = () => true;
  let passedOver = "no_slot";
  if (cfg.kind === "round_robin") {
    order = [...candidates].sort((p, q) => Number(starving(q)) - Number(starving(p)) || turn(p) - turn(q));
    reasonOf = (c) => (starving(c) ? "starved" : "turn");
  } else if (cfg.kind === "event") {
    eligible = (c) => c.events.length > 0 || starving(c);
    passedOver = "no_slot";
    order = [...candidates].sort((p, q) => Number(starving(q)) - Number(starving(p)) || q.events.length - p.events.length || q.waited - p.waited || p.agent.id - q.agent.id);
    reasonOf = (c) => (c.events.length ? c.events.slice(0, 3).join("+") : "starved");
  } else {
    // value of information: a decision is worth asking for when enough has changed, or enough is at stake
    const threshold = 24;
    eligible = (c) => c.score >= threshold || starving(c);
    order = [...candidates].sort((p, q) => Number(starving(q)) - Number(starving(p)) || q.score - p.score || q.waited - p.waited || p.agent.id - q.agent.id);
    reasonOf = (c) => (c.score >= threshold ? `voi:${c.events.slice(0, 3).join("+") || "waited"}` : "starved");
  }

  const next: SchedulerState = { cursor: st.cursor, lastEpoch: st.lastEpoch.slice(), dayCount: st.dayCount.slice(), countDay: st.countDay.slice(), heardUpTo: st.heardUpTo.slice(), civicSeen: st.civicSeen.slice(), peopleSeen: st.peopleSeen.map((p) => p.slice()) };
  const activations: Activation[] = [];
  for (const c of order) {
    if (!eligible(c)) {
      trace.push({ agent: c.agent.id, activated: false, reason: cfg.kind === "event" ? "no_event" : "low_value", score: c.score });
      continue;
    }
    if (activations.length >= cfg.callsPerEpoch) {
      trace.push({ agent: c.agent.id, activated: false, reason: passedOver, score: c.score });
      continue;
    }
    const id = c.agent.id;
    const reason = reasonOf(c);
    activations.push({ agent: id, reason, score: c.score, observation: c.obs });
    trace.push({ agent: id, activated: true, reason, score: c.score });
    next.lastEpoch[id] = epoch;
    next.dayCount[id] = (next.countDay[id] === day ? (next.dayCount[id] ?? 0) : 0) + 1;
    next.countDay[id] = day;
    next.heardUpTo[id] = c.obs.heard.reduce((m, h) => (h.id > m ? h.id : m), next.heardUpTo[id] ?? -1);
    next.civicSeen[id] = c.obs.civics ? c.obs.civics.charters.length + c.obs.civics.motions.length + c.obs.civics.offers.length : 0;
    next.peopleSeen[id] = c.obs.people.map((p) => p.id);
    if (cfg.kind === "round_robin") next.cursor = (id + 1) % n;
  }
  // decisions are submitted in id order, whatever order the minds were chosen in
  activations.sort((p, q) => p.agent - q.agent);
  trace.sort((p, q) => p.agent - q.agent);
  return { activations, trace, next };
}
