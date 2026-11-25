import "server-only";

/**
 * Server-side runs: a world whose minds are consulted through a provider, advanced one
 * decision epoch at a time by short, repeatable requests (D-009).
 *
 * The server holds the authoritative world as a compressed snapshot plus the tape of every
 * committed epoch. A step
 *
 *   1. takes a lease on the run (one stepper at a time)
 *   2. rebuilds the world from the snapshot and re-plans the epoch — the plan is a pure
 *      function of the world and the scheduler's state, so it is the same plan every time
 *   3. asks only the minds that have no stored answer; for a paid provider every attempt is
 *      reserved in the ledger first under a deterministic id, and settled, released or marked
 *      unknown the moment its fate is known
 *   4. when every mind in the plan has a final answer, offers the answers to the world,
 *      advances it, and commits the new snapshot, tape and digest in one transaction
 *
 * A step that is interrupted anywhere loses nothing and repeats nothing: stored answers are
 * reused, attempt numbers are never reused, and a commit happens at most once per epoch.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import {
  AFFORDANCE_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  configHash,
  createWorld,
  restoreWorld,
  serializeWorld,
  validateConfig,
  worldDigest,
  type DecisionRecord,
  type WorldConfig,
  type WorldState,
} from "@/engine";
import { priceOf, worstCaseCost } from "@/providers/prices";
import { PROMPT_VERSION, requestHash } from "@/providers/prompt";
import { ask, commitEpoch, planEpoch, plannedCalls, requestTokenBound, validateSpec, type AgentOutcome, type Asked, type RunSpec } from "@/providers/run";
import { newSchedulerState, type SchedulerState, type TraceEntry } from "@/providers/schedule";
import type { CallResult, DecisionCall, Provider } from "@/providers/types";
import { WIRE_VERSION } from "@/providers/wire";
import { FATAL_CODES } from "./anthropic";
import { num, type Db, type Queryer } from "./db";
import { audit, type Ledger, type Outcome } from "./ledger";

export type RunStatus = "active" | "paused" | "done" | "cancelled" | "failed";

export interface Run {
  id: string;
  title: string;
  status: RunStatus;
  statusReason: string;
  provider: string;
  model: string;
  promptVersion: string;
  capMicroUsd: number;
  reservedMicroUsd: number;
  settledMicroUsd: number;
  config: WorldConfig;
  spec: RunSpec;
  manifest: Record<string, unknown>;
  /** The next epoch to decide. */
  epoch: number;
  tick: number;
  digest: string;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

const pack = (world: WorldState): string => gzipSync(Buffer.from(serializeWorld(world), "utf8"), { level: 6 }).toString("base64");
const unpack = (snapshot: string): WorldState => restoreWorld(gunzipSync(Buffer.from(snapshot, "base64")).toString("utf8"));

function toRun(r: Record<string, unknown>): Run {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    status: r.status as RunStatus,
    statusReason: String(r.status_reason ?? ""),
    provider: String(r.provider),
    model: String(r.model),
    promptVersion: String(r.prompt_version),
    capMicroUsd: num(r.cap_microusd),
    reservedMicroUsd: num(r.reserved_microusd),
    settledMicroUsd: num(r.settled_microusd),
    config: JSON.parse(String(r.config)) as WorldConfig,
    spec: JSON.parse(String(r.spec)) as RunSpec,
    manifest: JSON.parse(String(r.manifest)) as Record<string, unknown>,
    epoch: num(r.epoch),
    tick: num(r.tick),
    digest: String(r.digest),
    published: r.published === true,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const RUN_COLUMNS = "id, title, status, status_reason, provider, model, prompt_version, cap_microusd, reserved_microusd, settled_microusd, config, spec, manifest, epoch, tick, digest, published, created_at::text AS created_at, updated_at::text AS updated_at";

export async function getRun(db: Db, id: string): Promise<Run | null> {
  const [r] = await db.query(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = $1`, [id]);
  return r ? toRun(r) : null;
}

export async function listRuns(db: Db, limit = 50): Promise<Run[]> {
  return (await db.query(`SELECT ${RUN_COLUMNS} FROM runs ORDER BY created_at DESC LIMIT $1`, [Math.max(1, Math.min(200, limit))])).map(toRun);
}

// ───────────────────────── cost preview

export interface CostPreview {
  provider: string;
  model: string;
  paid: boolean;
  /** People whose decisions come from the provider. */
  externalAgents: number;
  /** The most calls this plan can make. */
  callsPlanned: number;
  /** Upper bound on one call's input tokens (a token is at least a byte) and its output limit. */
  inputTokenBound: number;
  maxTokens: number;
  /** The most one call can cost, and the most the whole plan can cost. No cache hits are assumed. */
  perCallMicroUsd: number;
  worstCaseMicroUsd: number;
  /** What settled calls to this model have actually cost so far, if any have been made. Measured, not estimated. */
  measured: { calls: number; meanMicroUsd: number; maxMicroUsd: number } | null;
}

function countExternal(cfg: WorldConfig): number {
  let n = 0;
  for (const a of createWorld(cfg).agents) if (a.controller === "external") n++;
  return n;
}

/** The most a run of this shape can cost. Makes no call and reserves nothing. */
export async function previewRun(db: Db, cfg: WorldConfig, spec: RunSpec, model: string | null): Promise<CostPreview> {
  const externalAgents = countExternal(cfg);
  const callsPlanned = plannedCalls(spec, externalAgents);
  const paid = spec.provider === "anthropic";
  if (!paid) return { provider: spec.provider, model: spec.provider, paid: false, externalAgents, callsPlanned, inputTokenBound: 0, maxTokens: spec.maxTokens, perCallMicroUsd: 0, worstCaseMicroUsd: 0, measured: null };
  const price = model ? priceOf(model) : null;
  if (!model || !price) throw new Error("no priced model is configured for live calls");
  const bound = requestTokenBound(cfg, spec.context);
  const perCall = worstCaseCost(price, bound, spec.maxTokens, "5m");
  const [m] = await db.query("SELECT COUNT(*) AS n, COALESCE(AVG(settled_microusd + overage_microusd), 0) AS mean, COALESCE(MAX(settled_microusd + overage_microusd), 0) AS max FROM reservations WHERE state = 'settled' AND model = $1 AND output_tokens IS NOT NULL", [model]);
  const calls = num(m?.n);
  return { provider: spec.provider, model, paid: true, externalAgents, callsPlanned, inputTokenBound: bound, maxTokens: spec.maxTokens, perCallMicroUsd: perCall, worstCaseMicroUsd: perCall * callsPlanned, measured: calls > 0 ? { calls, meanMicroUsd: Math.round(Number(m?.mean)), maxMicroUsd: num(m?.max) } : null };
}

// ───────────────────────── creating a run

export interface CreateInput {
  title: string;
  config: unknown;
  spec: unknown;
  /** The most this run may spend, in microdollars (0 for a free provider). */
  capMicroUsd: number;
  /** Accept a plan whose worst case exceeds the cap: the run then pauses when the cap is reached. */
  allowEarlyStop: boolean;
}

export type CreateResult = { ok: true; run: Run; preview: CostPreview } | { ok: false; error: string; message: string };

const newId = (): string => `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/**
 * Create a run. For a paid provider this is the moment of approval: the cap is fixed here,
 * must fit inside what the owner has authorized, and — unless they explicitly accept an early
 * stop — must cover the plan's worst case.
 */
export async function createRun(db: Db, ledger: Ledger, input: CreateInput, live: { available: boolean; reasons: string[]; model: string | null }, actor: string): Promise<CreateResult> {
  let cfg: WorldConfig;
  let spec: RunSpec;
  try {
    cfg = validateConfig(JSON.parse(JSON.stringify(input.config)) as WorldConfig);
    spec = validateSpec(input.spec);
  } catch (err) {
    return { ok: false, error: "invalid", message: err instanceof Error ? err.message : "invalid run" };
  }
  if (cfg.population > 120) return { ok: false, error: "invalid", message: "a server-side run has at most 120 people" };
  const paid = spec.provider === "anthropic";
  if (paid && !live.available) return { ok: false, error: "live_unavailable", message: live.reasons.join("; ") };
  if (!Number.isSafeInteger(input.capMicroUsd) || input.capMicroUsd < 0) return { ok: false, error: "invalid", message: "the cap must be a whole number of microdollars" };
  let preview: CostPreview;
  try {
    preview = await previewRun(db, cfg, spec, paid ? live.model : null);
  } catch (err) {
    return { ok: false, error: "live_unavailable", message: err instanceof Error ? err.message : "no priced model" };
  }
  if (spec.provider !== "baseline" && preview.externalAgents === 0) return { ok: false, error: "invalid", message: "this world has nobody for the provider to decide for (externalShare is 0)" };
  let cap = 0;
  if (paid) {
    cap = input.capMicroUsd;
    if (cap <= 0) return { ok: false, error: "cap_required", message: "a live run needs a spending cap" };
    const budget = await ledger.summary();
    if (cap > budget.remainingMicroUsd) return { ok: false, error: "exceeds_budget", message: "the cap is more than what remains of the authorized budget" };
    if (cap < preview.perCallMicroUsd) return { ok: false, error: "cap_too_small", message: "the cap would not cover a single call" };
    if (preview.worstCaseMicroUsd > cap && !input.allowEarlyStop) return { ok: false, error: "exceeds_cap", message: "the plan's worst case is more than the cap; lower the plan, raise the cap, or accept that the run pauses when the cap is reached" };
  }
  const world = createWorld(cfg);
  const model = paid ? (live.model as string) : spec.provider;
  const manifest = {
    engine: ENGINE_VERSION,
    schema: SCHEMA_VERSION,
    affordances: AFFORDANCE_VERSION,
    promptVersion: PROMPT_VERSION,
    wireVersion: WIRE_VERSION,
    provider: spec.provider,
    model,
    seed: cfg.seed,
    scenario: cfg.scenario,
    configHash: configHash(cfg),
    scheduler: spec.scheduler,
    context: spec.context,
    effort: spec.effort,
    maxTokens: spec.maxTokens,
    epochTicks: spec.epochTicks,
    epochsPlanned: spec.epochs,
    externalAgents: preview.externalAgents,
    worstCaseMicroUsd: preview.worstCaseMicroUsd,
    capMicroUsd: cap,
    allowEarlyStop: paid ? input.allowEarlyStop : false,
    sampling: "provider default (the API accepts no sampling parameters for this model)",
  };
  const id = newId();
  await db.tx(async (q) => {
    await q.query(
      "INSERT INTO runs (id, title, status, provider, model, prompt_version, cap_microusd, config, spec, sched, manifest, epoch, tick, snapshot, digest) VALUES ($1, $2, 'active', $3, $4, $5, $6::bigint, $7, $8, $9, $10, 0, $11, $12, $13)",
      [id, input.title.slice(0, 80), spec.provider, model, PROMPT_VERSION, cap, JSON.stringify(cfg), JSON.stringify(spec), JSON.stringify(newSchedulerState(world.agents.length)), JSON.stringify(manifest), world.tick, pack(world), worldDigest(world)],
    );
    await audit(q, actor, "run.create", { id, provider: spec.provider, model, capMicroUsd: cap, worstCaseMicroUsd: preview.worstCaseMicroUsd });
  });
  return { ok: true, run: (await getRun(db, id)) as Run, preview };
}

/** A change of a run's status and its entry in the audit log are one transaction: neither exists without the other. */
export async function setRunStatus(db: Db, id: string, to: "paused" | "active" | "cancelled", actor: string, reason = ""): Promise<boolean> {
  const from = to === "paused" ? "status = 'active'" : to === "active" ? "status = 'paused'" : "status IN ('active', 'paused')";
  return db.tx(async (q) => {
    const rows = await q.query(`UPDATE runs SET status = $2, status_reason = $3, updated_at = now() WHERE id = $1 AND ${from} RETURNING id`, [id, to, reason.slice(0, 200)]);
    if (rows.length) await audit(q, actor, `run.${to}`, { id, reason: reason.slice(0, 200) });
    return rows.length > 0;
  });
}

export async function publishRun(db: Db, id: string, published: boolean, actor: string): Promise<boolean> {
  return db.tx(async (q) => {
    const rows = await q.query("UPDATE runs SET published = $2, updated_at = now() WHERE id = $1 RETURNING id", [id, published]);
    if (rows.length) await audit(q, actor, published ? "run.publish" : "run.unpublish", { id });
    return rows.length > 0;
  });
}

// ───────────────────────── stepping a run

export interface StepOutcome {
  /** committed: an epoch was completed · partial: answers are still outstanding, call again · the rest: nothing more will happen until something changes */
  state: "committed" | "partial" | "done" | "busy" | "not_active" | "paused" | "failed" | "missing";
  run: Run | null;
  epoch?: number;
  /** Calls made by this step. */
  calls?: number;
  reason?: string;
}

interface StoredCall {
  agent: number;
  attempt: number;
  status: string;
  result: CallResult;
}

const FINAL = new Set(["ok", "malformed", "truncated", "refused", "unknown", "abstain"]);
/** Answers that were paid for, or may have been, and could not be used. */
const UNUSABLE = new Set(["malformed", "truncated", "refused", "unknown"]);
/** After this many of them in a row, with no usable answer between, a paid run stops and waits for a person. */
export const UNUSABLE_LIMIT = 3;
/** A stored result larger than this is not a decision: it is recorded as one that could not be kept. */
const MAX_STORED_RESULT = 200_000;
const isFinal = (c: StoredCall, maxAttempts: number): boolean => FINAL.has(c.status) || !(c.result.error?.retryable ?? false) || c.attempt >= maxAttempts;

export interface StepOptions {
  /** Identifies this stepper for the lease (any unique string). */
  owner: string;
  /** Stop starting new calls after this much time (ms). */
  budgetMs: number;
  /**
   * How long the lease on the run holds. No call is left waiting past twenty seconds before
   * its end: by then every call has timed out, been recorded, and the step has finished, so a
   * second stepper never overlaps the first and nothing is paid for with nobody to record it.
   */
  leaseSeconds?: number;
  /** Pause before a second attempt after a failure that may clear (a rate limit, an overloaded provider). */
  retryDelayMs?: number;
  now?: () => number;
}

/**
 * Advance a run by at most one epoch. Safe to call again at any time, from anywhere.
 */
export async function stepRun(db: Db, ledger: Ledger, id: string, provider: Provider, options: StepOptions): Promise<StepOutcome> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const leaseSeconds = options.leaseSeconds ?? 300;
  const leased = await db.query(
    "UPDATE runs SET lease_owner = $2, lease_until = now() + ($3::int * interval '1 second') WHERE id = $1 AND status = 'active' AND (lease_until IS NULL OR lease_until < now() OR lease_owner = $2) RETURNING snapshot, sched, epoch, tick, digest",
    [id, options.owner, leaseSeconds],
  );
  const row = leased[0];
  if (!row) {
    const run = await getRun(db, id);
    if (!run) return { state: "missing", run: null };
    if (run.status === "active") return { state: "busy", run };
    return { state: run.status === "done" ? "done" : run.status === "paused" ? "paused" : run.status === "failed" ? "failed" : "not_active", run, reason: run.statusReason };
  }
  const release = async (): Promise<void> => {
    // hand the lease back outright: "expired a moment ago" would depend on the clock's resolution
    await db.query("UPDATE runs SET lease_owner = NULL, lease_until = NULL WHERE id = $1 AND lease_owner = $2", [id, options.owner]).catch(() => undefined);
  };
  try {
    const run = (await getRun(db, id)) as Run;
    const epoch = num(row.epoch);
    if (run.provider !== provider.id) throw new Error("the provider given does not match the run");
    if (epoch >= run.spec.epochs) {
      await db.query("UPDATE runs SET status = 'done', updated_at = now() WHERE id = $1 AND status = 'active'", [id]);
      return { state: "done", run: await getRun(db, id) };
    }
    const world = unpack(String(row.snapshot));
    if (worldDigest(world) !== String(row.digest) || world.tick !== num(row.tick)) {
      await db.query("UPDATE runs SET status = 'failed', status_reason = 'the stored world does not match its digest', updated_at = now() WHERE id = $1", [id]);
      return { state: "failed", run: await getRun(db, id), reason: "snapshot_mismatch" };
    }
    const sched = JSON.parse(String(row.sched)) as SchedulerState;
    const plan = planEpoch(world, run.spec, sched, epoch);

    // what is already known about this epoch's minds
    const stored = (await db.query("SELECT agent, attempt, status, result FROM calls WHERE run_id = $1 AND epoch = $2 ORDER BY agent, attempt", [id, epoch])).map((r): StoredCall => ({ agent: num(r.agent), attempt: num(r.attempt), status: String(r.status), result: JSON.parse(String(r.result)) as CallResult }));
    const have = new Map<number, Asked>();
    const attemptsMade = new Map<number, number>();
    for (const c of stored) {
      attemptsMade.set(c.agent, Math.max(attemptsMade.get(c.agent) ?? 0, c.attempt));
      if (isFinal(c, run.spec.maxAttempts)) have.set(c.agent, { result: c.result, attempts: c.attempt });
    }
    let streak = 0;
    if (provider.paid) {
      // A reservation of this epoch with no record of a call belongs to an attempt whose step
      // ended before it could write one — killed in flight, or swept as unknown while it lay
      // there, or (in an older record) stopped between the money and the record. Whatever
      // became of the money, the answer is gone: the attempt is over, a record of it is written
      // now, and its number is never used again. Without this the same reservation would be
      // refused as a duplicate on every later step and the run would never move.
      const orphans = await db.query("SELECT r.id, r.state, r.settled_microusd + r.overage_microusd AS cost FROM reservations r WHERE r.run_id = $1 AND r.id LIKE $2 AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.reservation_id = r.id)", [id, `${id}:${epoch}:%`]);
      for (const o of orphans) {
        const [, , agentText, attemptText] = String(o.id).split(":");
        const agent = Number(agentText);
        const attempt = Number(attemptText);
        if (!Number.isInteger(agent) || !Number.isInteger(attempt)) continue;
        const state = String(o.state);
        const released = state === "released";
        const settled = state === "settled";
        const result: CallResult = {
          status: released ? "rejected" : "unknown",
          decision: null,
          confidence: "",
          cites: [],
          text: null,
          usage: null,
          costMicroUsd: released ? 0 : settled ? num(o.cost) : null,
          model: provider.model,
          requestId: null,
          stopReason: null,
          error: { code: released ? "released_without_record" : settled ? "answer_lost" : "interrupted", status: null, retryable: false, message: "" },
          latencyMs: 0,
        };
        const record = async (q: Queryer): Promise<void> => {
          await q.query("INSERT INTO calls (run_id, epoch, agent, attempt, status, reason, reservation_id, result) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING", [id, epoch, agent, attempt, result.status, result.error?.code ?? "", String(o.id), JSON.stringify(result)]);
        };
        if (state === "reserved") await ledger.conclude(String(o.id), { kind: "unknown", note: "no outcome was recorded" }, record);
        else await record(db);
        have.set(agent, { result, attempts: attempt });
        attemptsMade.set(agent, Math.max(attemptsMade.get(agent) ?? 0, attempt));
      }
      // how the run's most recent paid answers went: a run that keeps paying for answers it cannot use is stopped
      const recent = await db.query("SELECT status FROM calls WHERE run_id = $1 AND reservation_id IS NOT NULL ORDER BY created_at DESC, epoch DESC, agent DESC, attempt DESC LIMIT $2", [id, UNUSABLE_LIMIT]);
      for (const r of recent) {
        if (!UNUSABLE.has(String(r.status))) break;
        streak++;
      }
    }

    let stop: { status: "paused" | "failed"; reason: string } | null = null;
    let calls = 0;
    const reasonOf = new Map(plan.schedule.activations.map((a) => [a.agent, a.reason]));
    const reservationOf = (call: DecisionCall): string => `${id}:${call.epoch}:${call.agent}:${call.attempt}`;
    let lastStatusCheck = 0;
    let active = true;

    const asked = await ask(
      id,
      run.config,
      run.spec,
      plan,
      provider,
      have,
      {
        halted: () => stop !== null || !active,
        before: async (call) => {
          if (provider.paid) {
            const r = await ledger.reserve({ id: reservationOf(call), runId: id, amount: provider.reserveFor(call), model: provider.model, requestHash: requestHash(call.request, provider.model, call.maxTokens, call.effort) });
            if (r.ok) return { go: true };
            if (r.reason === "run_not_active") active = false;
            else if (r.reason !== "duplicate") stop = { status: "paused", reason: r.reason };
            return { go: false, why: r.reason };
          }
          // a free provider spends nothing, but a cancelled or paused run still stops
          if (now() - lastStatusCheck > 500) {
            lastStatusCheck = now();
            const [s] = await db.query("SELECT status FROM runs WHERE id = $1", [id]);
            if (!s || s.status !== "active") active = false;
          }
          return active ? { go: true } : { go: false, why: "run_not_active" };
        },
        after: async (call, given) => {
          calls++;
          const rid = provider.paid ? reservationOf(call) : null;
          // an answer that cannot be written down is recorded as one that could not be read —
          // and its money is accounted for exactly as if it could
          let result = given;
          let stored = "";
          try {
            stored = JSON.stringify(result);
          } catch {
            stored = "";
          }
          if (stored === "" || stored.length > MAX_STORED_RESULT) {
            result = { ...given, status: given.costMicroUsd === null || given.status === "unknown" ? "unknown" : given.status === "rejected" ? "rejected" : "malformed", decision: null, confidence: "", cites: [], text: null, error: { code: "unserializable", status: given.error?.status ?? null, retryable: false, message: "" } };
            stored = JSON.stringify(result);
          }
          const record = async (q: Queryer): Promise<void> => {
            await q.query(
              "INSERT INTO calls (run_id, epoch, agent, attempt, status, reason, request_hash, reservation_id, result, latency_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING",
              [id, call.epoch, call.agent, call.attempt, result.status, reasonOf.get(call.agent) ?? "", requestHash(call.request, provider.model, call.maxTokens, call.effort), rid, stored, Math.round(result.latencyMs)],
            );
          };
          if (rid) {
            // the money and the record of the call are written together, or not at all
            const outcome: Outcome =
              result.status === "rejected"
                ? { kind: "release", note: result.error?.code ?? "rejected" }
                : result.costMicroUsd === null || result.status === "unknown"
                  ? { kind: "unknown", note: result.error?.code ?? "unknown" }
                  : { kind: "settle", input: { costMicroUsd: result.costMicroUsd, usage: result.usage, requestId: result.requestId, note: result.status } };
            const done = await ledger.conclude(rid, outcome, record);
            // charged after its hold had been given back: the ledger has turned the kill switch on, and the run waits too
            if (done === "late") stop = { status: "paused", reason: "charged_after_release" };
            if (result.status === "ok") streak = 0;
            else if (UNUSABLE.has(result.status)) streak++;
            if (streak >= UNUSABLE_LIMIT && stop === null) stop = { status: "paused", reason: "unusable_answers" };
          } else {
            await record(db);
          }
          if (result.error && FATAL_CODES.includes(result.error.code)) stop = { status: "failed", reason: result.error.code };
          return result;
        },
      },
      { deadlineMs: started + options.budgetMs, hardDeadlineMs: started + leaseSeconds * 1000 - 20_000, now, warmFirst: provider.paid, attemptsMade, retryDelayMs: options.retryDelayMs ?? 1500 },
    );

    const all = new Map([...have, ...asked]);
    const halted = stop as { status: "paused" | "failed"; reason: string } | null;
    if (halted) {
      // the epoch stays open: whatever was answered is kept, and nothing more is asked until a person intervenes
      await db.tx(async (q) => {
        const changed = await q.query("UPDATE runs SET status = $2, status_reason = $3, updated_at = now() WHERE id = $1 AND status = 'active' RETURNING id", [id, halted.status, halted.reason]);
        if (changed.length) await audit(q, "runner", `run.${halted.status}`, { id, epoch, reason: halted.reason });
      });
      return { state: halted.status, run: await getRun(db, id), epoch, calls, reason: halted.reason };
    }
    if (!active) return { state: "not_active", run: await getRun(db, id), epoch, calls };
    // a mind is finished when it has an answer that will not be asked for again: a failure that
    // may clear, with attempts left, is still outstanding
    const unfinished = (a: Asked | undefined): boolean => !a || (a.result.status === "rejected" && (a.result.error?.retryable ?? false) && a.attempts < run.spec.maxAttempts);
    if (plan.schedule.activations.some((a) => unfinished(all.get(a.agent)))) return { state: "partial", run, epoch, calls };

    const source = provider.id === "anthropic" ? "live" : provider.id === "replay" ? "replay" : "mock";
    const result = commitEpoch(world, run.spec, plan, all, source);
    const finished = epoch + 1 >= run.spec.epochs;
    const committed = await db.tx(async (q) => {
      const updated = await q.query(
        "UPDATE runs SET epoch = $3, tick = $4, snapshot = $5, digest = $6, sched = $7, status = $8, updated_at = now() WHERE id = $1 AND epoch = $2 AND lease_owner = $9 AND status = 'active' RETURNING id",
        [id, epoch, epoch + 1, world.tick, pack(world), result.digest, JSON.stringify(plan.schedule.next), finished ? "done" : "active", options.owner],
      );
      if (updated.length === 0) return false;
      await q.query("INSERT INTO epochs (run_id, epoch, from_tick, to_tick, digest, alive, tape, trace, outcomes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [id, epoch, result.fromTick, result.toTick, result.digest, result.alive, JSON.stringify(result.tape), JSON.stringify(result.trace), JSON.stringify(result.outcomes)]);
      return true;
    });
    if (!committed) return { state: "busy", run: await getRun(db, id), epoch, calls };
    return { state: finished ? "done" : "committed", run: await getRun(db, id), epoch, calls };
  } finally {
    await release();
  }
}

// ───────────────────────── reading a run back

export interface EpochRecord {
  epoch: number;
  fromTick: number;
  toTick: number;
  digest: string;
  alive: number;
  tape: DecisionRecord[];
  trace: TraceEntry[];
  outcomes: AgentOutcome[];
}

/** Committed epochs from `from` on: everything a replay needs, and nothing about cost. */
export async function epochsOf(db: Db, id: string, from = 0, limit = 50): Promise<EpochRecord[]> {
  const rows = await db.query("SELECT epoch, from_tick, to_tick, digest, alive, tape, trace, outcomes FROM epochs WHERE run_id = $1 AND epoch >= $2 ORDER BY epoch LIMIT $3", [id, Math.max(0, from), Math.max(1, Math.min(200, limit))]);
  return rows.map((r) => ({ epoch: num(r.epoch), fromTick: num(r.from_tick), toTick: num(r.to_tick), digest: String(r.digest), alive: num(r.alive), tape: JSON.parse(String(r.tape)) as DecisionRecord[], trace: JSON.parse(String(r.trace)) as TraceEntry[], outcomes: JSON.parse(String(r.outcomes)) as AgentOutcome[] }));
}

export interface CallSummary {
  calls: number;
  byStatus: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  thinkingTokens: number;
  meanLatencyMs: number;
}

/** What a run's calls came to, from their stored results. */
export async function callSummary(db: Db, id: string): Promise<CallSummary> {
  const rows = await db.query("SELECT status, result, latency_ms FROM calls WHERE run_id = $1", [id]);
  const out: CallSummary = { calls: rows.length, byStatus: {}, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, thinkingTokens: 0, meanLatencyMs: 0 };
  let latency = 0;
  for (const r of rows) {
    const status = String(r.status);
    out.byStatus[status] = (out.byStatus[status] ?? 0) + 1;
    latency += num(r.latency_ms);
    const u = (JSON.parse(String(r.result)) as CallResult).usage;
    if (u) {
      out.inputTokens += u.input_tokens || 0;
      out.outputTokens += u.output_tokens || 0;
      out.cacheReadTokens += u.cache_read_input_tokens || 0;
      out.cacheWriteTokens += u.cache_creation_input_tokens || 0;
      out.thinkingTokens += u.thinking_tokens ?? 0;
    }
  }
  out.meanLatencyMs = rows.length ? Math.round(latency / rows.length) : 0;
  return out;
}
