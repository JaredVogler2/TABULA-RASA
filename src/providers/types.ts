/**
 * The provider contract: one question to one mind, and what came back.
 *
 * A provider never touches a world. It is handed an observation already rendered into a
 * request, and returns an answer already read into a decision (or the reason there is none)
 * together with whatever the call cost. Whoever calls it decides what to do with that —
 * reserve money first, submit the decision to the engine, record the outcome.
 */
import type { ExternalDecision, Observation } from "@/engine";
import type { DecisionRequest } from "./prompt";
import type { Usage } from "./prices";

export type ProviderId = "mock" | "replay" | "baseline" | "anthropic";
export type Effort = "low" | "medium" | "high";

export interface DecisionCall {
  runId: string;
  epoch: number;
  agent: number;
  /** 1 for the first try. Each attempt is a separate request and, for a paid provider, a separate reservation. */
  attempt: number;
  /** The world's seed (a mock mind draws its choices from it; a model never sees it). */
  seed: number;
  observation: Observation;
  request: DecisionRequest;
  maxTokens: number;
  effort: Effort;
  timeoutMs: number;
}

export type CallStatus =
  /** An answer was read. (The world may still refuse some or all of what it asks for.) */
  | "ok"
  /** An answer arrived and was paid for, but could not be read as a decision. */
  | "malformed"
  /** The answer was cut off at the output limit (paid for, discarded). */
  | "truncated"
  /** The provider declined to answer. */
  | "refused"
  /** A definite error response: the request did no billable work. */
  | "rejected"
  /** The request may have run and been billed, but its outcome is not known (timeout, lost connection, unusable usage report). */
  | "unknown"
  /** This provider does not decide (the engine's own policy governs the agent). */
  | "abstain";

export interface CallError {
  /** A stable code: rate_limited, overloaded, timeout, connection, auth, bad_request, spend_limit, model_unavailable, server_error, … */
  code: string;
  status: number | null;
  /** Whether a fresh attempt could reasonably succeed. Never true for an unknown outcome. */
  retryable: boolean;
  message: string;
}

export interface CallResult {
  status: CallStatus;
  decision: ExternalDecision | null;
  confidence: string;
  cites: string[];
  /** The answer as returned (the JSON text only; never the model's reasoning). */
  text: string | null;
  usage: Usage | null;
  /** What the provider's usage report prices to, in microdollars. Null when it cannot be known. */
  costMicroUsd: number | null;
  model: string;
  requestId: string | null;
  stopReason: string | null;
  error: CallError | null;
  latencyMs: number;
  /** Replay only: the kind of mind that made the decision when it was recorded. */
  author?: "mock" | "live";
}

export interface Provider {
  readonly id: ProviderId;
  /** The exact model id calls are made with ("mock", "replay" and "baseline" for the free providers). */
  readonly model: string;
  /** True if a call costs money: it must then be reserved in the budget ledger before it is made. */
  readonly paid: boolean;
  /** The most one attempt at this call can cost, in microdollars (0 for a free provider). */
  reserveFor(call: DecisionCall): number;
  decide(call: DecisionCall, signal?: AbortSignal): Promise<CallResult>;
}

export const noResult = (model: string, status: CallStatus, error: CallError | null = null): CallResult => ({
  status,
  decision: null,
  confidence: "",
  cites: [],
  text: null,
  usage: null,
  costMicroUsd: status === "rejected" || status === "abstain" ? 0 : null,
  model,
  requestId: null,
  stopReason: null,
  error,
  latencyMs: 0,
});
