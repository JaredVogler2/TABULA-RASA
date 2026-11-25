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
import { noteHeard } from "./social";

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
  if (continuingIdle) return;
  a.stats.decisions++;
  world.metrics.decisionsBySource[source] = (world.metrics.decisionsBySource[source] ?? 0) + 1;
  m.decisionEvent = emit(world, out, "decision", a.id, {
    r: plan.goal,
    // an external decision is recorded whole: the ledger is then a tape it can be replayed from
    d: layer === "external" ? { src: source, layer, why: plan.why, n: plan.intents.length, plan: plan.intents.slice() } : { src: source, layer, why: plan.why, n: plan.intents.length },
    p: parents,
  });
}

/** Give an agent with no plan something to do. */
export function decide(world: WorldState, sc: Scratch, a: Agent, out: EventOut): void {
  const urgent = urgentNeed(a);
  // the deliberate layer is consulted unless thirst, cold or exhaustion is pressing; it is
  // consulted in hunger because only it knows about stores, piles and asking
  if (a.controller === "planner" && (urgent === "" || urgent === "eat")) {
    const plan = planDecide(world, sc, a);
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

  // Testimony about places updates beliefs only if it is newer than what the hearer knows
  // and the hearer trusts the speaker enough; its source is recorded.
  const trust = m.trust[u.from] as number;
  if (u.act.t === "inform_node" && trust >= 350) {
    const n = u.act.node;
    if (Number.isInteger(n) && n >= 0 && n < world.nodes.count && u.act.tick > (m.nodeTick[n] as number)) {
      m.nodeAmt[n] = Math.max(0, Math.min(30000, Math.floor(u.act.amount)));
      m.nodeTick[n] = Math.min(world.tick, Math.floor(u.act.tick));
      m.nodeSrc[n] = u.from;
    }
  } else if (u.act.t === "warn" && trust >= 350) {
    // "that place is bare": believed only if it is newer than what the hearer knows first-hand
    const n = u.act.node;
    if (Number.isInteger(n) && n >= 0 && n < world.nodes.count && u.tick > (m.nodeTick[n] as number) && (m.nodeAmt[n] as number) >= 0) {
      m.nodeAmt[n] = 0;
      m.nodeTick[n] = u.tick;
      m.nodeSrc[n] = u.from;
    }
  } else if (u.act.t === "inform_structure" && trust >= 350) {
    const s = world.structures[u.act.structure];
    if (s && !s.removed && !m.structs.some((k) => k.id === s.id)) {
      // the hearer learns that it exists and where; its state is unknown until seen
      m.structs.push({ id: s.id, kind: s.kind, x: s.x, y: s.y, tick: world.tick, state: s.complete ? 1 : 0, bound: -1 });
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
        for (let id = sc.head[y * w + x] as number; id !== -1; id = sc.next[id] as number) {
          if (id === u.from) continue;
          const t = world.agents[id]!;
          if (t.alive && !t.asleep) hear(world, t, u, false);
        }
      }
    }
  }
  world.speech.length = 0;
}
