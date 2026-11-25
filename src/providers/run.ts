/**
 * Decision epochs: the loop that lets minds outside the engine take part in a world.
 *
 *   plan      the scheduler picks this epoch's minds from the world as it stands
 *   ask       each chosen mind is shown its own page, independently and in parallel;
 *             nothing any of them answers can be seen by another before the world moves
 *   commit    answers are offered to the world in agent-id order, each validated against
 *             the world as it is then; the world advances; the epoch's tape and state
 *             digest are returned
 *
 * Nothing here knows about databases, budgets or HTTP. The server wraps `ask` with its
 * ledger and its lease; scripts, tests and the browser call it bare with a free provider.
 * Because the plan is a pure function of the world and the scheduler's state, an epoch that
 * was interrupted can be planned again and will choose the same minds.
 */
import { replayRecord, step, submitDecision, tapeFromEvents, worldDigest, type DecisionRecord, type SimEvent, type WorldConfig, type WorldState } from "@/engine";
import { buildRequest, promptFeatures, type PromptContext, type PromptFeatures } from "./prompt";
import { schedule, SCHEDULER_KINDS, type Activation, type Schedule, type SchedulerConfig, type SchedulerState, type TraceEntry } from "./schedule";
import type { CallResult, CallStatus, DecisionCall, Effort, Provider, ProviderId } from "./types";

export interface RunSpec {
  provider: ProviderId;
  scheduler: SchedulerConfig;
  /** World ticks per decision epoch. */
  epochTicks: number;
  /** Planned number of epochs. */
  epochs: number;
  context: PromptContext;
  effort: Effort;
  /** Output limit per call, in tokens. For a model that thinks, thinking counts against it. */
  maxTokens: number;
  timeoutMs: number;
  /** Calls in flight at once. */
  concurrency: number;
  /** Attempts allowed for one decision. A further attempt is made only after a definite, unbilled failure. */
  maxAttempts: number;
}

export const DEFAULT_SPEC: RunSpec = {
  provider: "mock",
  scheduler: { kind: "voi", callsPerEpoch: 8, maxPerAgentPerDay: 3, starveAfterEpochs: 12 },
  epochTicks: 24,
  epochs: 8,
  context: "rich",
  effort: "low",
  maxTokens: 2000,
  timeoutMs: 60_000,
  concurrency: 4,
  maxAttempts: 2,
};

const intIn = (name: string, v: unknown, lo: number, hi: number): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new Error(`${name} must be a whole number from ${lo} to ${hi}`);
  return v;
};

/** Check an untrusted run specification and return a clean copy. Throws with a precise message. */
export function validateSpec(raw: unknown): RunSpec {
  if (!raw || typeof raw !== "object") throw new Error("a run needs a specification");
  const r = raw as Record<string, unknown>;
  const s = (r.scheduler && typeof r.scheduler === "object" ? r.scheduler : {}) as Record<string, unknown>;
  const provider = r.provider;
  if (provider !== "mock" && provider !== "baseline" && provider !== "anthropic") throw new Error("provider must be mock, baseline or anthropic");
  if (!SCHEDULER_KINDS.includes(s.kind as SchedulerConfig["kind"])) throw new Error("scheduler.kind must be round_robin, event or voi");
  if (r.context !== "minimal" && r.context !== "rich") throw new Error("context must be minimal or rich");
  if (r.effort !== "low" && r.effort !== "medium" && r.effort !== "high") throw new Error("effort must be low, medium or high");
  return {
    provider,
    scheduler: {
      kind: s.kind as SchedulerConfig["kind"],
      callsPerEpoch: intIn("scheduler.callsPerEpoch", s.callsPerEpoch, 1, 600),
      maxPerAgentPerDay: intIn("scheduler.maxPerAgentPerDay", s.maxPerAgentPerDay, 1, 96),
      starveAfterEpochs: intIn("scheduler.starveAfterEpochs", s.starveAfterEpochs, 0, 10_000),
    },
    epochTicks: intIn("epochTicks", r.epochTicks, 1, 960),
    epochs: intIn("epochs", r.epochs, 1, 20_000),
    context: r.context,
    effort: r.effort,
    maxTokens: intIn("maxTokens", r.maxTokens, 256, 16_000),
    timeoutMs: intIn("timeoutMs", r.timeoutMs, 1_000, 240_000),
    concurrency: intIn("concurrency", r.concurrency, 1, 16),
    maxAttempts: intIn("maxAttempts", r.maxAttempts, 1, 3),
  };
}

export interface EpochPlan {
  epoch: number;
  tick: number;
  schedule: Schedule;
  features: PromptFeatures;
}

export function planEpoch(world: WorldState, spec: RunSpec, st: SchedulerState, epoch: number): EpochPlan {
  return { epoch, tick: world.tick, schedule: schedule(world, spec.scheduler, st, epoch), features: promptFeatures(world.config) };
}

/** The question put to one of this epoch's minds. */
export function callFor(runId: string, cfg: WorldConfig, spec: RunSpec, plan: EpochPlan, act: Activation, attempt: number): DecisionCall {
  return {
    runId,
    epoch: plan.epoch,
    agent: act.agent,
    attempt,
    seed: cfg.seed,
    observation: act.observation,
    request: buildRequest(act.observation, plan.features, spec.context),
    maxTokens: spec.maxTokens,
    effort: spec.effort,
    timeoutMs: spec.timeoutMs,
  };
}

/** What became of asking one mind. */
export interface Asked {
  result: CallResult;
  attempts: number;
}

export interface AskHooks {
  /**
   * Called before every attempt. Return `go: false` to forbid it (no budget, cancelled, kill
   * switch); the mind is then not asked and keeps its turn for a later epoch.
   */
  before?(call: DecisionCall): Promise<{ go: true } | { go: false; why: string }>;
  /** Called with every attempt's result, as soon as it is known. */
  after?(call: DecisionCall, result: CallResult): Promise<void>;
  /** If it returns true, no further call is started. */
  halted?(): boolean;
}

/**
 * Ask every mind in the plan that has no answer yet. `have` holds answers already obtained
 * (an interrupted epoch being resumed); they are never asked again. Returns the answers
 * obtained now. A mind that was not asked — forbidden, halted or out of time — is absent.
 * `options.attemptsMade` says how many attempts were already spent on a mind that still has
 * no final answer, so that attempt numbers (and with them reservation ids) are never reused.
 */
export async function ask(
  runId: string,
  cfg: WorldConfig,
  spec: RunSpec,
  plan: EpochPlan,
  provider: Provider,
  have: ReadonlyMap<number, Asked> = new Map(),
  hooks: AskHooks = {},
  options: { deadlineMs?: number; now?: () => number; warmFirst?: boolean; attemptsMade?: ReadonlyMap<number, number>; retryDelayMs?: number } = {},
): Promise<Map<number, Asked>> {
  const now = options.now ?? (() => Date.now());
  const out = new Map<number, Asked>();
  const todo = plan.schedule.activations.filter((a) => !have.has(a.agent));
  const pastDeadline = (): boolean => options.deadlineMs !== undefined && now() >= options.deadlineMs;

  const one = async (act: Activation): Promise<void> => {
    // attempts already made for this mind in an earlier, interrupted invocation count against the limit
    let attempts = options.attemptsMade?.get(act.agent) ?? 0;
    let last: CallResult | null = null;
    while (attempts < spec.maxAttempts) {
      if (hooks.halted?.() || pastDeadline()) break;
      const call = callFor(runId, cfg, spec, plan, act, attempts + 1);
      const leave = hooks.before ? await hooks.before(call) : { go: true as const };
      if (!leave.go) break;
      attempts++;
      let result: CallResult;
      try {
        result = await provider.decide(call);
      } catch (err) {
        // a provider that throws has told us nothing about what happened to the request
        result = { status: "unknown", decision: null, confidence: "", cites: [], text: null, usage: null, costMicroUsd: null, model: provider.model, requestId: null, stopReason: null, error: { code: "provider_threw", status: null, retryable: false, message: err instanceof Error ? err.name : "error" }, latencyMs: 0 };
      }
      if (hooks.after) await hooks.after(call, result);
      last = result;
      // only a definite, unbilled failure that might clear is tried again, after a pause if one is asked for
      if (!(result.status === "rejected" && result.error?.retryable)) break;
      if (attempts < spec.maxAttempts && options.retryDelayMs) await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs));
    }
    if (last) out.set(act.agent, { result: last, attempts });
  };

  let cursor = 0;
  if (options.warmFirst && todo.length > 1) {
    // let one call finish first so that the others can read the prompt cache it wrote
    await one(todo[0] as Activation);
    cursor = 1;
  }
  const worker = async (): Promise<void> => {
    for (;;) {
      if (hooks.halted?.() || pastDeadline()) return;
      const i = cursor++;
      if (i >= todo.length) return;
      await one(todo[i] as Activation);
    }
  };
  await Promise.all(Array.from({ length: Math.min(spec.concurrency, Math.max(1, todo.length - cursor)) }, worker));
  return out;
}

export interface AgentOutcome {
  agent: number;
  /** Why the scheduler chose this mind. */
  reason: string;
  /** How the call ended, or "not_asked". */
  status: CallStatus | "not_asked";
  attempts: number;
  /** Intents the world accepted and refused from the answer. */
  accepted: number;
  refused: number;
  confidence: string;
  cites: string[];
}

export interface EpochResult {
  epoch: number;
  fromTick: number;
  toTick: number;
  /** State digest after the epoch: a replay must reproduce it. */
  digest: string;
  /** The epoch's decisions, as they must be replayed. */
  tape: DecisionRecord[];
  outcomes: AgentOutcome[];
  trace: TraceEntry[];
  alive: number;
}

const UNUSABLE: Partial<Record<CallStatus, string>> = { malformed: "could_not_be_read", truncated: "cut_off_too_long", refused: "declined" };

/**
 * Offer the epoch's answers to the world in agent order, advance the world, and return the
 * record. `source` labels the decisions (mock or live); with "replay" the answers are
 * recorded decisions and keep the author they were recorded with.
 */
export function commitEpoch(world: WorldState, spec: RunSpec, plan: EpochPlan, asked: ReadonlyMap<number, Asked>, source: "mock" | "live" | "replay", sink?: (events: SimEvent[]) => void): EpochResult {
  if (world.tick !== plan.tick) throw new Error(`epoch ${plan.epoch} was planned at tick ${plan.tick} but the world is at ${world.tick}`);
  const events: SimEvent[] = [];
  const outcomes: AgentOutcome[] = [];
  for (const act of plan.schedule.activations) {
    const got = asked.get(act.agent);
    const outcome: AgentOutcome = { agent: act.agent, reason: act.reason, status: got ? got.result.status : "not_asked", attempts: got?.attempts ?? 0, accepted: 0, refused: 0, confidence: got?.result.confidence ?? "", cites: got?.result.cites ?? [] };
    outcomes.push(outcome);
    if (!got) continue;
    const r = got.result;
    if (r.status === "ok" && r.decision) {
      const o = source === "replay" ? submitDecision(world, act.agent, r.decision, "replay", events, r.author) : submitDecision(world, act.agent, r.decision, source, events);
      outcome.accepted = o.accepted.length;
      outcome.refused = o.rejected.length + (r.decision.dropped?.length ?? 0);
    } else if (UNUSABLE[r.status] && source !== "replay") {
      // the mind is told its answer could not be used, and waits its ordinary interval before it is asked again
      submitDecision(world, act.agent, { intents: [], dropped: [{ action: "answer", reason: UNUSABLE[r.status] as string }] }, source, events);
    }
    // rejected, unknown, abstain: nothing reached the world; the mind stays due
  }
  for (let i = 0; i < spec.epochTicks; i++) step(world, events);
  const tape = tapeFromEvents(events);
  sink?.(events);
  let alive = 0;
  for (const a of world.agents) if (a.alive) alive++;
  return { epoch: plan.epoch, fromTick: plan.tick, toTick: world.tick, digest: worldDigest(world), tape, outcomes, trace: plan.schedule.trace, alive };
}

/** One whole epoch with nothing in the way: plan, ask, commit. For free providers. */
export async function runEpoch(runId: string, world: WorldState, spec: RunSpec, st: SchedulerState, epoch: number, provider: Provider, sink?: (events: SimEvent[]) => void): Promise<{ result: EpochResult; next: SchedulerState }> {
  const plan = planEpoch(world, spec, st, epoch);
  const asked = await ask(runId, world.config, spec, plan, provider);
  const source = provider.id === "anthropic" ? "live" : provider.id === "replay" ? "replay" : "mock";
  return { result: commitEpoch(world, spec, plan, asked, source, sink), next: plan.schedule.next };
}

/**
 * Replay a recorded run against a fresh world and check every epoch's digest. No mind is
 * consulted. Returns the first epoch whose digest does not match, or -1 if all match.
 */
export function verifyTape(world: WorldState, tape: readonly DecisionRecord[], epochs: readonly { toTick: number; digest: string }[]): number {
  const events: SimEvent[] = [];
  let cursor = 0;
  for (let e = 0; e < epochs.length; e++) {
    const target = epochs[e] as { toTick: number; digest: string };
    while (world.tick < target.toTick) {
      while (cursor < tape.length && (tape[cursor] as DecisionRecord).tick < world.tick) cursor++;
      while (cursor < tape.length && (tape[cursor] as DecisionRecord).tick === world.tick) replayRecord(world, tape[cursor++] as DecisionRecord, events);
      step(world, events);
      events.length = 0;
    }
    if (worldDigest(world) !== target.digest) return e;
  }
  return -1;
}
