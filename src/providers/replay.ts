/**
 * Providers that never ask anyone anything.
 *
 * ReplayProvider answers from a recorded tape: the decision an agent made at a tick is the
 * decision it makes again. It consults no mind, costs nothing, and is how every recorded run
 * — mock or live — is watched again and verified.
 *
 * BaselineProvider makes no decisions at all. It exists so that a control arm (the engine's
 * own labelled policies) runs through exactly the same harness as a treatment arm.
 */
import type { DecisionRecord } from "@/engine";
import { noResult, type CallResult, type DecisionCall, type Provider } from "./types";

export class ReplayProvider implements Provider {
  readonly id = "replay" as const;
  readonly model = "replay";
  readonly paid = false;
  private readonly byKey = new Map<string, DecisionRecord>();

  constructor(tape: readonly DecisionRecord[]) {
    for (const r of tape) this.byKey.set(`${r.tick}:${r.agent}`, r);
  }

  reserveFor(): number {
    return 0;
  }

  /** The recorded decision for this agent at this tick, if there is one. */
  recordFor(tick: number, agent: number): DecisionRecord | undefined {
    return this.byKey.get(`${tick}:${agent}`);
  }

  async decide(call: DecisionCall): Promise<CallResult> {
    const r = this.recordFor(call.observation.tick, call.agent);
    if (!r) return noResult(this.model, "abstain");
    return {
      ...noResult(this.model, "ok"),
      costMicroUsd: 0,
      stopReason: "replay",
      ...(r.source ? { author: r.source } : {}),
      decision: { intents: r.intents, goal: r.goal, rationale: r.rationale, ...(r.note !== undefined ? { note: r.note } : {}), ...(r.dropped ? { dropped: r.dropped } : {}) },
    };
  }
}

export class BaselineProvider implements Provider {
  readonly id = "baseline" as const;
  readonly model = "baseline";
  readonly paid = false;

  reserveFor(): number {
    return 0;
  }

  async decide(): Promise<CallResult> {
    return noResult(this.model, "abstain");
  }
}
