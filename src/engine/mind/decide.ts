/**
 * Decision dispatch: which layer decides for an agent that needs a new plan, and the
 * record of that decision. Every plan is labelled with its source and layer so that
 * a ledger never confuses baseline heuristics, fallbacks and model output.
 */
import type { Agent, DecisionSource, Heard, Utterance, WorldState } from "../model/types";
import { emit, type EventOut } from "../sim/events";
import type { Scratch } from "../sim/scratch";
import { planDecide } from "./planner";
import { reflexDecide, urgentNeed, type Plan } from "./reflex";
import { knownStructure, knowsCharter, knowsPact } from "./knowledge";
import { noteHeard } from "./social";
import { learnCharter } from "../institutions/engine";
import { learnPact } from "../institutions/pacts";

export type DecisionLayer = "reflex" | "planner" | "external";

/** Install a plan and write the decision record. */
export function adopt(
  world: WorldState,
  a: Agent,
  out: EventOut,
  plan: Plan,
  source: DecisionSource,
  layer: DecisionLayer,
  parents: number[] = [],
  /** For a replayed decision: the kind of mind that made it when the run was recorded. */
  author?: "mock" | "live",
  /** For an external decision: the note the mind left itself and what was refused, recorded so that a tape can restore both. */
  extras?: Record<string, unknown>,
): void {
  const m = a.mind;
  // consecutive idle waits are one continuing decision, not a new ledger entry each time
  const continuingIdle = plan.goal === "idle" && m.goal === "idle" && layer === "reflex" && m.decisionEvent >= 0;
  a.queue = plan.intents;
  a.progress = 0;
  a.path.length = 0;
  a.pathKey = -1;
  m.goal = plan.goal;
  m.why = plan.why;
  m.urgentAt = urgentNeed(a);
  m.lastDecision = world.tick;
  // a replayed plan keeps its author, so that whatever it founds is attributed as it was
  m.src = source === "replay" && author ? author : source;
  if (continuingIdle) return;
  a.stats.decisions++;
  world.metrics.decisionsBySource[source] = (world.metrics.decisionsBySource[source] ?? 0) + 1;
  m.decisionEvent = emit(world, out, "decision", a.id, {
    r: plan.goal,
    // an external decision is recorded whole: the ledger is then a tape it can be replayed from
    d:
      layer === "external"
        ? { src: source, ...(source === "replay" && author ? { of: author } : {}), layer, why: plan.why, n: plan.intents.length, plan: plan.intents.slice(), ...(extras ?? {}) }
        : { src: source, layer, why: plan.why, n: plan.intents.length },
    p: parents,
  });
}

/** Give an agent with no plan something to do. */
export function decide(world: WorldState, sc: Scratch, a: Agent, out: EventOut): void {
  const urgent = urgentNeed(a);
  // the deliberate layer is consulted unless thirst, cold or exhaustion is pressing; it is
  // consulted in hunger because only it knows about stores, piles and asking
  // With a planning clock (config.planEvery > 0) the planner is consulted at most that often and
  // the reflex layer carries the person in between; without one it is consulted whenever a plan runs out.
  const every = world.config.planEvery;
  if (a.controller === "planner" && (urgent === "" || urgent === "eat") && (every === 0 || world.tick >= a.mind.nextDeliberation)) {
    const plan = planDecide(world, sc, a);
    world.metrics.deliberations++;
    if (every > 0) a.mind.nextDeliberation = world.tick + every;
    // what was heard has now been weighed once; stale speech is not reconsidered forever
    pruneInbox(world, a);
    if (plan) {
      adopt(world, a, out, plan, "baseline", "planner");
      return;
    }
  }
  const plan = reflexDecide(world, sc, a);
  // For externally controlled minds the reflex layer is a fallback, and is labelled as one.
  adopt(world, a, out, plan, a.controller === "external" ? "fallback" : "baseline", "reflex");
}

const INBOX_CAP = 12;
/** Ticks for which something heard stays available to deliberation (four hours). */
const INBOX_TTL = 16;

function pruneInbox(world: WorldState, a: Agent): void {
  const inbox = a.mind.inbox;
  let k = 0;
  for (let i = 0; i < inbox.length; i++) {
    if (world.tick - inbox[i]!.tick <= INBOX_TTL) inbox[k++] = inbox[i]!;
  }
  inbox.length = k;
}

function hear(world: WorldState, a: Agent, u: Utterance, direct: boolean): void {
  const m = a.mind;
  const heard: Heard = { utterance: u.id, tick: u.tick, from: u.from, direct, act: u.act, ...(u.text ? { text: u.text } : {}) };
  if (m.inbox.length >= INBOX_CAP) {
    // drop the oldest overheard (non-direct) item first, else the oldest of all
    const k = m.inbox.findIndex((h) => !h.direct);
    m.inbox.splice(k >= 0 ? k : 0, 1);
  }
  m.inbox.push(heard);
  noteHeard(world, a, u, direct);
  m.lastTalk[u.from] = world.tick;
  m.metX[u.from] = u.x;
  m.metY[u.from] = u.y;
  m.metTick[u.from] = world.tick;

  // What a hearer learns of the world from speech is what the speaker knows and says — never
  // what is true. The engine reads the speaker's mind here, not the world: a structure is where
  // the speaker believes it is, an agreement or an offer is one the speaker has themselves
  // heard of. (Testimony about places carries the speaker's own figures; it updates beliefs
  // only if it is newer than what the hearer knows and the hearer trusts the speaker enough.)
  const trust = m.trust[u.from] as number;
  const speaker = world.agents[u.from];
  if (u.act.t === "inform_node" && trust >= 350) {
    const n = u.act.node;
    if (Number.isInteger(n) && n >= 0 && n < world.nodes.count && u.act.tick > (m.nodeTick[n] as number)) {
      m.nodeAmt[n] = Math.max(0, Math.min(30000, Math.floor(u.act.amount)));
      m.nodeTick[n] = Math.min(world.tick, Math.floor(u.act.tick));
      m.nodeSrc[n] = u.from;
    }
  } else if (u.act.t === "announce" || u.act.t === "invite") {
    // to hear of a charter is to know it exists; whether to believe in it is another matter
    const id = u.act.t === "announce" ? u.act.proposal : u.act.institution;
    if (speaker && knowsCharter(world, speaker, id) && world.inst.proposals.some((p) => p.id === id)) learnCharter(a, id);
  } else if (u.act.t === "offer" && u.act.pact !== undefined) {
    const id = u.act.pact;
    if (speaker && knowsPact(world, speaker, id) && world.inst.pacts.some((p) => p.id === id && p.state === "open")) learnPact(a, id);
  } else if (u.act.t === "warn" && trust >= 350) {
    // "that place is bare": believed only if it is newer than what the hearer knows first-hand
    const n = u.act.node;
    if (Number.isInteger(n) && n >= 0 && n < world.nodes.count && u.tick > (m.nodeTick[n] as number) && (m.nodeAmt[n] as number) >= 0) {
      m.nodeAmt[n] = 0;
      m.nodeTick[n] = u.tick;
      m.nodeSrc[n] = u.from;
    }
  } else if (u.act.t === "inform_structure" && trust >= 350) {
    const told = speaker ? knownStructure(speaker, u.act.structure) : undefined;
    if (told && !knownStructure(a, told.id)) {
      // the hearer takes on the speaker's picture of it — kind, place, and how it stood when the
      // speaker last saw it — dated to then, not to now. Who holds it is not passed on.
      m.structs.push({ id: told.id, kind: told.kind, x: told.x, y: told.y, tick: told.tick, state: told.state, bound: -1, ...(told.missing ? { missing: told.missing.slice() } : {}) });
    }
  }
}

/** Deliver last tick's utterances to those in range. Sleeping agents hear nothing. */
export function deliverSpeech(world: WorldState, sc: Scratch, radius: number): void {
  if (world.speech.length === 0) return;
  const { w, h } = sc;
  for (const u of world.speech) {
    if (u.to >= 0) {
      const t = world.agents[u.to];
      if (t && t.alive && !t.asleep) {
        const dx = t.x > u.x ? t.x - u.x : u.x - t.x;
        const dy = t.y > u.y ? t.y - u.y : u.y - t.y;
        if ((dx > dy ? dx : dy) <= Math.max(1, radius)) hear(world, t, u, true);
      }
      continue;
    }
    const y0 = u.y - radius < 0 ? 0 : u.y - radius;
    const y1 = u.y + radius >= h ? h - 1 : u.y + radius;
    const x0 = u.x - radius < 0 ? 0 : u.x - radius;
    const x1 = u.x + radius >= w ? w - 1 : u.x + radius;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        for (let id = sc.head[y * w + x] as number; id >= 0; id = sc.next[id] as number) {
          if (id === u.from) continue;
          const t = world.agents[id]!;
          if (t.alive && !t.asleep) hear(world, t, u, false);
        }
      }
    }
  }
  world.speech.length = 0;
}
