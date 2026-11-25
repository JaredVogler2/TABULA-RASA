/**
 * The contract between the world and any mind that is not built into the engine.
 *
 * A decision is a proposal: at most six intents and a short declared rationale. It is
 * checked for shape, for structural validity (`checkIntent`) and against the action mask of
 * a fresh observation; what survives is queued exactly like a baseline plan, and every
 * intent is validated again by the engine when it is executed. Nothing in a decision can
 * write world state directly.
 *
 * Every submitted decision is written to the ledger with its source (mock, live, replay),
 * the intents that were accepted and a note of what was refused, so a run driven by a model
 * can be replayed later from the ledger alone, at no cost, and must reproduce the same world.
 */
import { cleanText } from "../core/text";
import type { Agent, DecisionSource, Feedback, Intent, SimEvent, WorldState } from "../model/types";
import { interrupt } from "../sim/actions";
import { emit, type EventOut } from "../sim/events";
import { checkIntent } from "../sim/intents";
import { scratchOf } from "../sim/scratch";
import { adopt } from "./decide";
import { FEEDBACK_LIMITS, feedbackEntry } from "./feedback";
import { DECISION_LIMITS, buildObservation, maskAllows, type Observation } from "./observe";
import { urgentNeed } from "./reflex";

/** What a mind said was wrong with part of its own output before it reached the engine (e.g. an unreadable formula). */
export interface Dropped {
  action: string;
  reason: string;
  detail?: string;
}

export interface ExternalDecision {
  intents: Intent[];
  /** A few words naming the aim (shown in the inspector). */
  goal?: string;
  /** A short declared reason. This is what the mind chooses to state, not a transcript of its reasoning. */
  rationale?: string;
  /** A short private note to its future self (replaces the previous one; empty clears it). */
  note?: string;
  /** Parts of the mind's answer that the adapter could not turn into intents, to be fed back to it. */
  dropped?: Dropped[];
}

export interface DecisionOutcome {
  ok: boolean;
  /** Why the whole decision was refused (when ok is false). */
  error?: string;
  accepted: Intent[];
  rejected: { index: number; reason: string }[];
  /** Ledger id of the decision record, or -1. */
  event: number;
}

/** One line of a decision tape: enough to re-submit the decision at the same tick. */
export interface DecisionRecord {
  tick: number;
  agent: number;
  /** The intents that were accepted (empty if the whole decision was refused). */
  intents: Intent[];
  goal: string;
  rationale: string;
  /** The kind of mind that made the decision when it was recorded. */
  source?: "mock" | "live";
  /** The note the mind left itself (absent if it left none). */
  note?: string;
  /** What was refused when the decision was first submitted. */
  dropped?: Dropped[];
}

/** More intents than this in one decision and it is refused outright, unread. */
const MAX_INTENTS_READ = 24;

/** Externally driven agents that are awake, not in distress, and due to deliberate. */
export function dueForDecision(world: WorldState): number[] {
  const out: number[] = [];
  for (const a of world.agents) {
    if (!a.alive || a.controller !== "external" || a.asleep) continue;
    if (world.tick < a.mind.nextDeliberation) continue;
    if (urgentNeed(a) !== "") continue; // the body comes first; the reflex fallback handles it
    out.push(a.id);
  }
  return out;
}

export function observe(world: WorldState, agentId: number): Observation | null {
  const a = world.agents[agentId];
  if (!a || !a.alive) return null;
  return buildObservation(world, scratchOf(world), a);
}

function cleanDropped(tick: number, raw: unknown): Feedback[] {
  if (!Array.isArray(raw)) return [];
  const out: Feedback[] = [];
  for (const x of raw.slice(0, FEEDBACK_LIMITS.entries)) {
    if (!x || typeof x !== "object") continue;
    const d = x as Record<string, unknown>;
    out.push(feedbackEntry(tick, d.action, d.reason, d.detail));
  }
  return out;
}

const asDropped = (f: Feedback): Dropped => ({ action: f.k, reason: f.r, ...(f.d ? { detail: f.d } : {}) });

/**
 * Offer a decision to the world on behalf of an agent. Returns what was accepted and what
 * was refused, with reasons. A decision with no acceptable intent leaves the agent's current
 * plan alone (it carries on, or falls back to reflex) but is still recorded, still pushes
 * back the next deliberation, and still tells the mind what was refused.
 */
export function submitDecision(world: WorldState, agentId: number, decision: unknown, source: DecisionSource, out: EventOut, author?: "mock" | "live"): DecisionOutcome {
  const fail = (error: string): DecisionOutcome => ({ ok: false, error, accepted: [], rejected: [], event: -1 });
  const a: Agent | undefined = world.agents[agentId];
  if (!a || !a.alive) return fail("no_such_agent");
  if (a.controller !== "external") return fail("not_external");
  if (source !== "mock" && source !== "live" && source !== "replay") return fail("bad_source");
  const by = source === "replay" ? author : undefined;
  a.mind.nextDeliberation = world.tick + world.config.cadence;

  const d = decision && typeof decision === "object" ? (decision as Record<string, unknown>) : null;
  const wellFormed = d !== null && Array.isArray(d.intents) && d.intents.length <= MAX_INTENTS_READ;
  const raw: unknown[] = wellFormed ? (d.intents as unknown[]) : [];
  const feedback = cleanDropped(world.tick, d?.dropped);
  if (!wellFormed) feedback.push(feedbackEntry(world.tick, "decision", "malformed"));

  const obs = buildObservation(world, scratchOf(world), a);
  const accepted: Intent[] = [];
  const rejected: { index: number; reason: string }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i];
    let reason: string | null = accepted.length >= DECISION_LIMITS.maxIntents ? "too_many" : checkIntent(world, item);
    if (!reason) reason = maskAllows(obs, item as Intent);
    if (reason) {
      rejected.push({ index: i, reason });
      feedback.push(feedbackEntry(world.tick, item && typeof item === "object" ? (item as { k?: unknown }).k : "action", reason));
      continue;
    }
    const intent = item as Intent;
    if (intent.k === "say" && intent.text !== undefined) {
      const text = cleanText(intent.text, DECISION_LIMITS.maxTextChars);
      accepted.push(text ? { ...intent, text } : { k: "say", to: intent.to, act: intent.act });
    } else {
      accepted.push(intent);
    }
  }
  while (feedback.length > FEEDBACK_LIMITS.entries) feedback.pop();
  a.mind.feedback = feedback;
  // a decision that carries a note replaces the old one; a decision without one leaves it be
  const note = d && d.note !== undefined ? cleanText(d.note, DECISION_LIMITS.maxNoteChars) : undefined;
  if (note !== undefined) a.mind.note = note;
  const extras = { ...(note !== undefined ? { note } : {}), ...(feedback.length ? { dropped: feedback.map(asDropped) } : {}) };

  if (accepted.length === 0) {
    // nothing to adopt: the refusal itself is the record
    world.metrics.decisionsBySource.refused = (world.metrics.decisionsBySource.refused ?? 0) + 1;
    const event = emit(world, out, "decision", a.id, { r: "refused", d: { src: source, ...(by ? { of: by } : {}), layer: "external", why: "", n: 0, plan: [], ...extras } });
    return { ok: false, error: !wellFormed ? "malformed" : raw.length === 0 ? "empty" : "nothing_acceptable", accepted, rejected, event };
  }

  const goal = cleanText(d?.goal, DECISION_LIMITS.maxGoalChars).replace(/[^a-z0-9_ -]/gi, "") || "own_plan";
  const rationale = cleanText(d?.rationale, DECISION_LIMITS.maxRationaleChars);
  interrupt(world, a, out);
  adopt(world, a, out, { intents: accepted, goal, why: rationale }, source, "external", [], by, extras);
  return { ok: true, accepted, rejected, event: a.mind.decisionEvent };
}

/** Extract the decision tape from a ledger: every externally sourced decision, in order. */
export function tapeFromEvents(events: readonly SimEvent[]): DecisionRecord[] {
  const tape: DecisionRecord[] = [];
  for (const e of events) {
    if (e.k !== "decision" || !e.d) continue;
    const d = e.d as { layer?: string; plan?: Intent[]; why?: string; src?: string; of?: string; note?: string; dropped?: Dropped[] };
    if (d.layer !== "external" || !Array.isArray(d.plan)) continue;
    const by = d.src === "replay" ? d.of : d.src;
    tape.push({
      tick: e.t,
      agent: e.a,
      intents: d.plan,
      goal: e.r ?? "own_plan",
      rationale: d.why ?? "",
      ...(by === "mock" || by === "live" ? { source: by } : {}),
      ...(typeof d.note === "string" ? { note: d.note } : {}),
      ...(Array.isArray(d.dropped) && d.dropped.length ? { dropped: d.dropped } : {}),
    });
  }
  return tape;
}

/** Re-submit one recorded decision. No mind is consulted: this is replay. */
export function replayRecord(world: WorldState, r: DecisionRecord, out: EventOut): DecisionOutcome {
  return submitDecision(
    world,
    r.agent,
    { intents: r.intents, goal: r.goal, rationale: r.rationale, ...(r.note !== undefined ? { note: r.note } : {}), ...(r.dropped ? { dropped: r.dropped } : {}) },
    "replay",
    out,
    r.source,
  );
}

/**
 * Re-submit the tape's decisions for the current tick (call before `step`). Returns the
 * index of the next unread record.
 */
export function replayTape(world: WorldState, tape: readonly DecisionRecord[], from: number, out: EventOut): number {
  let i = from;
  while (i < tape.length && (tape[i] as DecisionRecord).tick < world.tick) i++;
  while (i < tape.length && (tape[i] as DecisionRecord).tick === world.tick) {
    replayRecord(world, tape[i] as DecisionRecord, out);
    i++;
  }
  return i;
}

export { cleanText };
