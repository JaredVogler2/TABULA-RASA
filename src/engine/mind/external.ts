/**
 * The contract between the world and any mind that is not built into the engine.
 *
 * A decision is a proposal: at most six intents and a short declared rationale. It is
 * checked for shape, for structural validity (`checkIntent`) and against the action mask of
 * a fresh observation; what survives is queued exactly like a baseline plan, and every
 * intent is validated again by the engine when it is executed. Nothing in a decision can
 * write world state directly.
 *
 * Every accepted decision is written to the ledger with its source (mock, live, replay) and
 * the intents themselves, so a run driven by a model can be replayed later from the ledger
 * alone, at no cost, and must reproduce the same world.
 */
import type { Agent, DecisionSource, Intent, SimEvent, WorldState } from "../model/types";
import { interrupt } from "../sim/actions";
import type { EventOut } from "../sim/events";
import { checkIntent } from "../sim/intents";
import { scratchOf } from "../sim/scratch";
import { adopt } from "./decide";
import { DECISION_LIMITS, buildObservation, maskAllows, type Observation } from "./observe";
import { urgentNeed } from "./reflex";

export interface ExternalDecision {
  intents: Intent[];
  /** A few words naming the aim (shown in the inspector). */
  goal?: string;
  /** A short declared reason. This is what the mind chooses to state, not a transcript of its reasoning. */
  rationale?: string;
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
  intents: Intent[];
  goal: string;
  rationale: string;
}

/** Strip control characters and bound the length of text that will be stored and shown. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127 || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      out += " ";
    } else {
      out += ch;
    }
    if (out.length >= max) break;
  }
  return out.trim().slice(0, max);
}

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

/**
 * Offer a decision to the world on behalf of an agent. Returns what was accepted and what
 * was refused, with reasons. A decision with no acceptable intent changes nothing (the
 * agent carries on under its fallback) but still pushes back the next deliberation.
 */
export function submitDecision(world: WorldState, agentId: number, decision: unknown, source: DecisionSource, out: EventOut): DecisionOutcome {
  const fail = (error: string): DecisionOutcome => ({ ok: false, error, accepted: [], rejected: [], event: -1 });
  const a: Agent | undefined = world.agents[agentId];
  if (!a || !a.alive) return fail("no_such_agent");
  if (a.controller !== "external") return fail("not_external");
  if (source !== "mock" && source !== "live" && source !== "replay") return fail("bad_source");
  a.mind.nextDeliberation = world.tick + world.config.cadence;
  if (!decision || typeof decision !== "object") return fail("malformed");
  const d = decision as Record<string, unknown>;
  if (!Array.isArray(d.intents)) return fail("malformed");
  if (d.intents.length === 0) return fail("empty");

  const obs = buildObservation(world, scratchOf(world), a);
  const accepted: Intent[] = [];
  const rejected: { index: number; reason: string }[] = [];
  for (let i = 0; i < d.intents.length; i++) {
    if (accepted.length >= DECISION_LIMITS.maxIntents) {
      rejected.push({ index: i, reason: "too_many" });
      continue;
    }
    const raw: unknown = d.intents[i];
    const structural = checkIntent(world, raw);
    if (structural) {
      rejected.push({ index: i, reason: structural });
      continue;
    }
    const intent = raw as Intent;
    const masked = maskAllows(obs, intent);
    if (masked) {
      rejected.push({ index: i, reason: masked });
      continue;
    }
    if (intent.k === "say" && intent.text !== undefined) {
      const text = cleanText(intent.text, DECISION_LIMITS.maxTextChars);
      accepted.push(text ? { ...intent, text } : { k: "say", to: intent.to, act: intent.act });
    } else {
      accepted.push(intent);
    }
  }
  if (accepted.length === 0) return { ok: false, error: "nothing_acceptable", accepted, rejected, event: -1 };

  const goal = cleanText(d.goal, DECISION_LIMITS.maxGoalChars).replace(/[^a-z0-9_ -]/gi, "") || "own_plan";
  const rationale = cleanText(d.rationale, DECISION_LIMITS.maxRationaleChars);
  interrupt(world, a, out);
  adopt(world, a, out, { intents: accepted, goal, why: rationale }, source, "external");
  return { ok: true, accepted, rejected, event: a.mind.decisionEvent };
}

/** Extract the decision tape from a ledger: every externally sourced decision, in order. */
export function tapeFromEvents(events: readonly SimEvent[]): DecisionRecord[] {
  const tape: DecisionRecord[] = [];
  for (const e of events) {
    if (e.k !== "decision" || !e.d) continue;
    const d = e.d as { layer?: string; plan?: Intent[]; why?: string };
    if (d.layer !== "external" || !Array.isArray(d.plan)) continue;
    tape.push({ tick: e.t, agent: e.a, intents: d.plan, goal: e.r ?? "own_plan", rationale: d.why ?? "" });
  }
  return tape;
}

/**
 * Re-submit the tape's decisions for the current tick (call before `step`). Returns the
 * index of the next unread record. No mind is consulted: this is replay.
 */
export function replayTape(world: WorldState, tape: readonly DecisionRecord[], from: number, out: EventOut): number {
  let i = from;
  while (i < tape.length && (tape[i] as DecisionRecord).tick < world.tick) i++;
  while (i < tape.length && (tape[i] as DecisionRecord).tick === world.tick) {
    const r = tape[i] as DecisionRecord;
    submitDecision(world, r.agent, { intents: r.intents, goal: r.goal, rationale: r.rationale }, "replay", out);
    i++;
  }
  return i;
}
