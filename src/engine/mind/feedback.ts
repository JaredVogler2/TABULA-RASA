/**
 * What the world said back.
 *
 * A mind that decides from outside the engine does not see the engine refuse its requests;
 * it only sees its next observation. So that it can learn from a refusal instead of
 * repeating it, each externally driven mind keeps a short list of what was refused since
 * its last decision and why, in the engine's own reason codes. Baseline minds never use it.
 */
import { cleanText } from "../core/text";
import type { Agent, Feedback, WorldState } from "../model/types";

export const FEEDBACK_LIMITS = { entries: 12, actionChars: 24, reasonChars: 40, detailChars: 160 } as const;

/** A clean, bounded feedback entry from untrusted parts. */
export function feedbackEntry(tick: number, action: unknown, reason: unknown, detail?: unknown): Feedback {
  const d = cleanText(detail, FEEDBACK_LIMITS.detailChars);
  return {
    t: tick,
    k: cleanText(action, FEEDBACK_LIMITS.actionChars).replace(/[^a-z0-9_ ]/gi, "") || "action",
    r: cleanText(reason, FEEDBACK_LIMITS.reasonChars).replace(/[^a-z0-9_ ]/gi, "") || "refused",
    ...(d ? { d } : {}),
  };
}

/**
 * Record a refusal for an externally driven mind (a no-op for everyone else). Only what the
 * mind itself asked for is recorded: when its plan has run out and the reflex layer is acting
 * for it, the reflex layer's own mishaps are not its business.
 */
export function noteFeedback(world: WorldState, a: Agent, action: string, reason: string, detail?: string): void {
  if (a.controller !== "external" || a.mind.src === "fallback" || a.mind.src === "baseline") return;
  const list = a.mind.feedback;
  list.push(feedbackEntry(world.tick, action, reason, detail));
  while (list.length > FEEDBACK_LIMITS.entries) list.shift();
}
