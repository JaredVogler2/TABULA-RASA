import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createWorld, makeConfig, type WorldConfig } from "@/engine";
import { PROMPT_VERSION } from "@/providers/prompt";
import { MockProvider } from "@/providers/mock";
import { DEFAULT_SPEC, verifyTape, type RunSpec } from "@/providers/run";
import { noResult, type CallResult, type DecisionCall, type Provider } from "@/providers/types";
import { TEST_DATABASE_URL, memoryDb, serverDb } from "../../tests/support/db";
import { num, type Db, type Queryer } from "./db";
import { Ledger } from "./ledger";
import { STEP_BUDGET_MS, STEP_LEASE_SECONDS } from "./api";
import { UNUSABLE_LIMIT, callSummary, createRun, epochsOf, getRun, listRuns, previewRun, publishRun, setRunStatus, stepRun, type Run } from "./runs";

const USD = 1_000_000;
const CEILING = 10_000 * USD;
const LIVE: { available: boolean; reasons: string[]; model: string | null } = { available: true, reasons: [], model: "claude-fable-5-2" };
const config = (seed: number, over: Partial<WorldConfig> = {}): WorldConfig => makeConfig("first_light", seed, { population: 10, externalShare: 1000, illness: 0, institutions: "open", ...over });
const spec = (over: Partial<RunSpec> = {}, sched: Partial<RunSpec["scheduler"]> = {}): RunSpec => ({ ...DEFAULT_SPEC, epochs: 4, concurrency: 3, ...over, scheduler: { ...DEFAULT_SPEC.scheduler, kind: "round_robin", callsPerEpoch: 10, maxPerAgentPerDay: 8, ...sched } });

/**
 * A provider that charges, for exercising the ledger without a model: it answers as the mock
 * mind does and reports a fixed, deterministic cost. Its behaviour per call can be scripted.
 */
class FakePaid implements Provider {
  readonly id = "anthropic" as const;
  readonly model = "claude-fable-5-2";
  readonly paid = true;
  readonly calls: { agent: number; attempt: number; epoch: number }[] = [];
  private readonly inner = new MockProvider();
  constructor(
    private readonly script: (call: DecisionCall) => "ok" | CallResult | "throw" = () => "ok",
    readonly reserve = 100_000,
    readonly cost = 23_000,
  ) {}
  reserveFor(): number {
    return this.reserve;
  }
  async decide(call: DecisionCall): Promise<CallResult> {
    this.calls.push({ agent: call.agent, attempt: call.attempt, epoch: call.epoch });
    const what = this.script(call);
    if (what === "throw") throw new Error("ECONNRESET");
    if (what !== "ok") return what;
    const r = await this.inner.decide(call);
    return { ...r, model: this.model, costMicroUsd: this.cost, requestId: `req_${call.epoch}_${call.agent}_${call.attempt}`, usage: { input_tokens: 1000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation_5m: 0, cache_creation_1h: 0, inference_geo: "global", speed: "standard", service_tier: "standard", thinking_tokens: 100 } };
  }
}

const failed = (status: CallResult["status"], code: string, retryable = false): CallResult => noResult("claude-fable-5-2", status, { code, status: null, retryable, message: "" });

async function drive(db: Db, ledger: Ledger, id: string, provider: Provider, maxSteps = 60): Promise<string[]> {
  const states: string[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const out = await stepRun(db, ledger, id, provider, { owner: "test", budgetMs: 60_000, retryDelayMs: 0 });
    states.push(out.state);
    if (out.state !== "committed" && out.state !== "partial") break;
  }
  return states;
}

async function books(db: Db): Promise<void> {
  const [b] = await db.query("SELECT * FROM budget WHERE id = 1");
  const [held] = await db.query("SELECT COALESCE(SUM(reserved_microusd),0) AS s FROM reservations WHERE state IN ('reserved','unknown')");
  const [spent] = await db.query("SELECT COALESCE(SUM(settled_microusd),0) AS s FROM reservations WHERE state = 'settled'");
  expect(num(b!.reserved_microusd)).toBe(num(held!.s));
  expect(num(b!.settled_microusd)).toBe(num(spent!.s));
  expect(num(b!.reserved_microusd) + num(b!.settled_microusd)).toBeLessThanOrEqual(num(b!.authorized_microusd));
}

describe("server-side runs (in memory)", () => {
  let db: Db;
  let ledger: Ledger;
  const open = async (authorized = 20 * USD) => {
    await ledger.authorize(authorized, authorized, "owner");
    await ledger.setKillSwitch(false, "test", "owner");
  };
  const create = async (cfg: WorldConfig, s: RunSpec, cap = 0, allowEarlyStop = false): Promise<Run> => {
    const made = await createRun(db, ledger, { title: "t", config: cfg, spec: s, capMicroUsd: cap, allowEarlyStop }, LIVE, "owner");
    if (!made.ok) throw new Error(`${made.error}: ${made.message}`);
    return made.run;
  };

  beforeAll(async () => {
    db = await memoryDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    for (const t of ["calls", "epochs", "reservations", "daily_spend", "runs", "audit_log"]) await db.query(`DELETE FROM ${t}`);
    await db.query("UPDATE budget SET authorized_microusd = 0, daily_cap_microusd = 0, reserved_microusd = 0, settled_microusd = 0, overage_microusd = 0, kill_switch = true, kill_reason = 'never enabled', kill_code = '' WHERE id = 1");
    ledger = new Ledger(db, { ceilingMicroUsd: CEILING });
  });

  it("a mock run needs no budget, advances epoch by epoch, and its stored record replays to the same world", async () => {
    const cfg = config(51);
    const run = await create(cfg, spec({ provider: "mock" }));
    expect(run).toMatchObject({ status: "active", provider: "mock", model: "mock", capMicroUsd: 0, epoch: 0, tick: 0 });
    expect(run.manifest).toMatchObject({ promptVersion: PROMPT_VERSION, provider: "mock", seed: 51, externalAgents: 10, epochsPlanned: 4 });
    const states = await drive(db, ledger, run.id, new MockProvider());
    expect(states).toEqual(["committed", "committed", "committed", "done"]);
    const done = (await getRun(db, run.id))!;
    expect(done).toMatchObject({ status: "done", epoch: 4, tick: 96 });
    const epochs = await epochsOf(db, run.id);
    expect(epochs.map((e) => e.epoch)).toEqual([0, 1, 2, 3]);
    expect(epochs[3]!.digest).toBe(done.digest);
    // anyone holding the configuration and the tape can rebuild the run and check it, without the server
    expect(verifyTape(createWorld(cfg), epochs.flatMap((e) => e.tape), epochs)).toBe(-1);
    // nothing was spent or held, and a finished run does nothing more
    expect(await db.query("SELECT id FROM reservations")).toEqual([]);
    expect((await stepRun(db, ledger, run.id, new MockProvider(), { owner: "test", budgetMs: 1000 })).state).toBe("done");
    const summary = await callSummary(db, run.id);
    expect(summary.calls).toBeGreaterThan(10);
    expect(summary.byStatus.ok).toBe(summary.calls);
  });

  it("a paid run reserves before every call, settles what each cost, and never exceeds what was previewed", async () => {
    await open();
    const cfg = config(52);
    const s = spec({ provider: "anthropic" });
    const preview = await previewRun(db, cfg, s, LIVE.model);
    expect(preview).toMatchObject({ paid: true, externalAgents: 10, callsPlanned: 40, measured: null });
    expect(preview.worstCaseMicroUsd).toBe(preview.perCallMicroUsd * 40);
    const run = await create(cfg, s, preview.worstCaseMicroUsd);
    const provider = new FakePaid();
    const states = await drive(db, ledger, run.id, provider);
    expect(states.at(-1)).toBe("done");
    const done = (await getRun(db, run.id))!;
    // every call has one reservation under its deterministic id, settled at the reported cost
    const reservations = await db.query("SELECT id, state, reserved_microusd, settled_microusd, provider_request_id, input_tokens FROM reservations ORDER BY id");
    expect(reservations).toHaveLength(provider.calls.length);
    expect(new Set(reservations.map((r) => r.id))).toEqual(new Set(provider.calls.map((c) => `${run.id}:${c.epoch}:${c.agent}:${c.attempt}`)));
    expect(reservations.every((r) => r.state === "settled" && num(r.settled_microusd) === 23_000 && num(r.input_tokens) === 1000)).toBe(true);
    expect(done.settledMicroUsd).toBe(provider.calls.length * 23_000);
    expect(done.reservedMicroUsd).toBe(0);
    expect(done.settledMicroUsd).toBeLessThanOrEqual(preview.worstCaseMicroUsd);
    expect(provider.calls.length).toBeLessThanOrEqual(preview.callsPlanned);
    const budget = await ledger.summary();
    expect(budget).toMatchObject({ settledMicroUsd: done.settledMicroUsd, reservedMicroUsd: 0, unknownMicroUsd: 0, overageMicroUsd: 0 });
    await books(db);
    // the decisions are labelled live, and the run replays from its record at no cost
    const epochs = await epochsOf(db, run.id);
    expect(epochs.flatMap((e) => e.tape).every((r) => r.source === "live")).toBe(true);
    expect(verifyTape(createWorld(cfg), epochs.flatMap((e) => e.tape), epochs)).toBe(-1);
    // and once real calls have settled, a preview reports what they measured
    expect((await previewRun(db, cfg, s, LIVE.model)).measured).toEqual({ calls: provider.calls.length, meanMicroUsd: 23_000, maxMicroUsd: 23_000 });
    expect(await callSummary(db, run.id)).toMatchObject({ calls: provider.calls.length, inputTokens: provider.calls.length * 1000, outputTokens: provider.calls.length * 300, thinkingTokens: provider.calls.length * 100 });
  });

  it("refuses to create a paid run without approval that covers it", async () => {
    const cfg = config(53);
    const s = spec({ provider: "anthropic" });
    const attempt = (cap: number, early = false, live = LIVE) => createRun(db, ledger, { title: "t", config: cfg, spec: s, capMicroUsd: cap, allowEarlyStop: early }, live, "owner");
    // nothing authorized yet
    expect(await attempt(5 * USD)).toMatchObject({ ok: false, error: "exceeds_budget" });
    await open(8 * USD);
    const preview = await previewRun(db, cfg, s, LIVE.model);
    expect(await attempt(0)).toMatchObject({ ok: false, error: "cap_required" });
    expect(await attempt(9 * USD)).toMatchObject({ ok: false, error: "exceeds_budget" });
    expect(await attempt(preview.perCallMicroUsd - 1, true)).toMatchObject({ ok: false, error: "cap_too_small" });
    expect(preview.worstCaseMicroUsd).toBeGreaterThan(4 * USD);
    expect(await attempt(4 * USD)).toMatchObject({ ok: false, error: "exceeds_cap" });
    // the owner may accept an early stop explicitly; the cap is still a cap
    expect(await attempt(4 * USD, true)).toMatchObject({ ok: true });
    // live mode not available: no run, whatever the cap
    expect(await attempt(4 * USD, true, { available: false, reasons: ["LIVE_ENABLED is not set to true"], model: null })).toMatchObject({ ok: false, error: "live_unavailable", message: "LIVE_ENABLED is not set to true" });
    expect(await attempt(4 * USD, true, { available: true, reasons: [], model: "claude-made-up" })).toMatchObject({ ok: false, error: "live_unavailable" });
    // malformed requests
    const bad = (c: unknown, sp: unknown) => createRun(db, ledger, { title: "t", config: c, spec: sp, capMicroUsd: 0, allowEarlyStop: false }, LIVE, "owner");
    expect(await bad({ ...cfg, population: 100_000 }, spec({ provider: "mock" }))).toMatchObject({ ok: false, error: "invalid" });
    expect(await bad({ ...cfg, population: 200 }, spec({ provider: "mock" }))).toMatchObject({ ok: false, error: "invalid" });
    expect(await bad(cfg, { ...spec({ provider: "mock" }), maxTokens: 1_000_000 })).toMatchObject({ ok: false, error: "invalid" });
    expect(await bad({ ...cfg, externalShare: 0 }, spec({ provider: "mock" }))).toMatchObject({ ok: false, error: "invalid" });
    expect(await bad("not a config", spec({ provider: "mock" }))).toMatchObject({ ok: false, error: "invalid" });
    expect((await listRuns(db)).length).toBe(1);
    expect((await db.query("SELECT action FROM audit_log WHERE action = 'run.create'")).length).toBe(1);
  });

  it("the kill switch stops a paid run mid-epoch; lifting it lets the run finish; nothing is asked twice", async () => {
    await open();
    const cfg = config(54);
    const run = await create(cfg, spec({ provider: "anthropic", concurrency: 1 }), 12 * USD, true);
    let made = 0;
    const provider = new FakePaid(() => {
      made++;
      return "ok";
    });
    // the owner presses stop after the fourth call
    const stopper: Provider = { id: provider.id, model: provider.model, paid: true, reserveFor: () => provider.reserveFor(), decide: async (call) => {
      const r = await provider.decide(call);
      if (made === 4) await ledger.setKillSwitch(true, "owner pressed stop", "owner");
      return r;
    } };
    const first = await stepRun(db, ledger, run.id, stopper, { owner: "test", budgetMs: 60_000 });
    expect(first).toMatchObject({ state: "paused", reason: "kill_switch", calls: 4 });
    expect(await getRun(db, run.id)).toMatchObject({ status: "paused", statusReason: "kill_switch", epoch: 0 });
    // paused means paused: stepping again asks nobody
    expect((await stepRun(db, ledger, run.id, stopper, { owner: "test", budgetMs: 60_000 })).state).toBe("paused");
    expect(made).toBe(4);
    await books(db);
    // the owner lifts the switch and resumes
    await ledger.setKillSwitch(false, "resume", "owner");
    expect(await setRunStatus(db, run.id, "active", "owner")).toBe(true);
    const states = await drive(db, ledger, run.id, provider);
    expect(states.at(-1)).toBe("done");
    // every (epoch, agent) was asked exactly once across the interruption
    const keys = provider.calls.map((c) => `${c.epoch}:${c.agent}:${c.attempt}`);
    expect(new Set(keys).size).toBe(keys.length);
    const epochs = await epochsOf(db, run.id);
    expect(verifyTape(createWorld(cfg), epochs.flatMap((e) => e.tape), epochs)).toBe(-1);
    await books(db);
    // and the world is the one an uninterrupted run reaches
    const twin = await create(cfg, spec({ provider: "anthropic", concurrency: 1 }), 12 * USD, true);
    await drive(db, ledger, twin.id, new FakePaid());
    expect((await getRun(db, twin.id))!.digest).toBe((await getRun(db, run.id))!.digest);
  });

  it("a run stops at its cap and never goes over it", async () => {
    await open();
    const provider = new FakePaid(() => "ok", 100_000, 90_000);
    const run = await create(config(55), spec({ provider: "anthropic", concurrency: 1 }), 550_000, true);
    const states = await drive(db, ledger, run.id, provider);
    expect(states.at(-1)).toBe("paused");
    const stopped = (await getRun(db, run.id))!;
    expect(stopped).toMatchObject({ status: "paused", statusReason: "run_cap" });
    // 550,000 allows five holds of 100,000 with settlements of 90,000 in between … and then one more only if it fits
    expect(stopped.settledMicroUsd + stopped.reservedMicroUsd).toBeLessThanOrEqual(550_000);
    expect(provider.calls.length).toBe(Math.floor((550_000 - 100_000) / 90_000) + 1);
    await books(db);
  });

  it("an unknown outcome keeps its money held and is never re-sent; a failure that may clear is tried once more", async () => {
    await open();
    const cfg = config(56);
    const run = await create(cfg, spec({ provider: "anthropic", epochs: 1, maxAttempts: 2 }), 12 * USD, true);
    const provider = new FakePaid((call) => {
      if (call.agent === 2) return failed("unknown", "timeout");
      if (call.agent === 3) return "throw";
      if (call.agent === 4 && call.attempt === 1) return failed("rejected", "rate_limited", true);
      if (call.agent === 5) return failed("rejected", "overloaded", true); // fails both attempts
      return "ok";
    });
    const states = await drive(db, ledger, run.id, provider);
    expect(states).toEqual(["done"]);
    const state = async (agent: number, attempt: number) => (await db.query("SELECT state FROM reservations WHERE id = $1", [`${run.id}:0:${agent}:${attempt}`]))[0]?.state;
    const asks = (agent: number) => provider.calls.filter((c) => c.agent === agent).length;
    const activated = new Set(provider.calls.map((c) => c.agent));
    if (activated.has(2)) {
      expect(asks(2)).toBe(1);
      expect(await state(2, 1)).toBe("unknown");
    }
    if (activated.has(3)) {
      expect(asks(3)).toBe(1);
      expect(await state(3, 1)).toBe("unknown");
    }
    if (activated.has(4)) {
      expect(asks(4)).toBe(2);
      expect(await state(4, 1)).toBe("released");
      expect(await state(4, 2)).toBe("settled");
    }
    if (activated.has(5)) {
      expect(asks(5)).toBe(2);
      expect(await state(5, 1)).toBe("released");
      expect(await state(5, 2)).toBe("released");
    }
    expect([2, 3, 4, 5].filter((a) => activated.has(a)).length).toBeGreaterThanOrEqual(3);
    const budget = await ledger.summary();
    expect(budget.unknownCount).toBe([2, 3].filter((a) => activated.has(a)).length);
    expect(budget.unknownMicroUsd).toBe(budget.unknownCount * 100_000);
    expect(budget.reservedMicroUsd).toBe(budget.unknownMicroUsd); // held, and counted against every ceiling
    await books(db);
    // the epoch still commits and still replays: the minds that got no answer simply were not heard from
    const epochs = await epochsOf(db, run.id);
    expect(epochs[0]!.outcomes.filter((o) => o.status === "unknown").map((o) => o.agent).sort()).toEqual([2, 3].filter((a) => activated.has(a)));
    expect(verifyTape(createWorld(cfg), epochs[0]!.tape, epochs)).toBe(-1);
  });

  it("a call that was cut off in flight is found on resume, held as unknown, and not repeated", async () => {
    await open();
    const cfg = config(57);
    const run = await create(cfg, spec({ provider: "anthropic", epochs: 1 }), 12 * USD, true);
    // the state a killed process leaves behind: a reservation for agent 1, attempt 1, and no record of any answer
    expect(await ledger.reserve({ id: `${run.id}:0:1:1`, runId: run.id, amount: 100_000, model: "claude-fable-5-2", requestHash: "h" })).toEqual({ ok: true });
    const provider = new FakePaid();
    const states = await drive(db, ledger, run.id, provider);
    expect(states).toEqual(["done"]);
    expect(provider.calls.some((c) => c.agent === 1)).toBe(false);
    expect((await ledger.get(`${run.id}:0:1:1`))!.state).toBe("unknown");
    expect((await db.query("SELECT status, reason FROM calls WHERE run_id = $1 AND agent = 1", [run.id]))[0]).toMatchObject({ status: "unknown", reason: "interrupted" });
    expect((await ledger.summary()).unknownMicroUsd).toBe(100_000);
    await books(db);
  });

  it("a call cut off in flight and then swept as unknown does not wedge the run: the next step records it and moves on", async () => {
    await open();
    const cfg = config(57);
    const run = await create(cfg, spec({ provider: "anthropic", epochs: 2 }), 12 * USD, true);
    // a step dies with a call in flight: a reservation, and no record of any answer…
    const lost = `${run.id}:0:1:1`;
    expect(await ledger.reserve({ id: lost, runId: run.id, amount: 100_000, model: "claude-fable-5-2", requestHash: "h" })).toEqual({ ok: true });
    // …the owner comes back a quarter of an hour later, and looking at the console sweeps it to "unknown"
    await db.query("UPDATE reservations SET created_at = now() - interval '20 minutes' WHERE id = $1", [lost]);
    expect(await ledger.sweep(15 * 60_000)).toBe(1);
    expect((await ledger.get(lost))!.state).toBe("unknown");
    expect(await db.query("SELECT 1 FROM calls WHERE run_id = $1", [run.id])).toEqual([]);
    // the owner presses Advance. The run moves: every epoch commits, and that attempt is never made again
    const provider = new FakePaid();
    const states = await drive(db, ledger, run.id, provider);
    expect(states).toEqual(["committed", "done"]);
    expect(provider.calls.some((c) => c.epoch === 0 && c.agent === 1)).toBe(false);
    expect((await db.query("SELECT status, reason, reservation_id FROM calls WHERE run_id = $1 AND epoch = 0 AND agent = 1", [run.id]))[0]).toMatchObject({ status: "unknown", reason: "interrupted", reservation_id: lost });
    // the money is still held, for the owner to decide — and deciding it afterwards is still possible
    expect((await ledger.summary()).unknownMicroUsd).toBe(100_000);
    expect(await ledger.reconcile(lost, { release: true }, "owner")).toBe("done");
    await books(db);
  });

  it("whatever state a recordless reservation is in, the next step writes its record and never asks for that attempt again", async () => {
    await open();
    const cfg = config(59);
    const run = await create(cfg, spec({ provider: "anthropic", epochs: 1 }), 12 * USD, true);
    const id = (agent: number) => `${run.id}:0:${agent}:1`;
    for (const agent of [1, 2, 3, 4]) expect(await ledger.reserve({ id: id(agent), runId: run.id, amount: 100_000, model: "claude-fable-5-2", requestHash: "h" })).toEqual({ ok: true });
    // as an older version could leave things, stopping between the money and the record:
    expect(await ledger.settle(id(1), { costMicroUsd: 31_000 })).toBe("settled"); // charged, answer never written down
    expect(await ledger.release(id(2), "rate_limited")).toBe("released"); // given back, nothing written down
    await ledger.markUnknown(id(3), "timeout"); // held as unknown, nothing written down
    // (agent 4: still plainly reserved)
    const provider = new FakePaid();
    expect(await drive(db, ledger, run.id, provider)).toEqual(["done"]);
    for (const agent of [1, 2, 3, 4]) expect(provider.calls.some((c) => c.agent === agent), `agent ${agent}`).toBe(false);
    const rows = await db.query("SELECT agent, status, reason, result FROM calls WHERE run_id = $1 AND agent IN (1, 2, 3, 4) ORDER BY agent", [run.id]);
    expect(rows.map((r) => [num(r.agent), r.status, r.reason])).toEqual([
      [1, "unknown", "answer_lost"],
      [2, "rejected", "released_without_record"],
      [3, "unknown", "interrupted"],
      [4, "unknown", "interrupted"],
    ]);
    // what is known of the cost is kept: paid 31,000 for an answer nobody has
    expect((JSON.parse(String(rows[0]!.result)) as CallResult).costMicroUsd).toBe(31_000);
    expect((await ledger.get(id(4)))!.state).toBe("unknown");
    const budget = await ledger.summary();
    expect(budget).toMatchObject({ unknownCount: 2, unknownMicroUsd: 200_000 });
    await books(db);
    // a second look changes nothing: there is one record per attempt, and no orphan left to find
    expect((await db.query("SELECT COUNT(*) AS n FROM calls WHERE run_id = $1 AND agent IN (1, 2, 3, 4)", [run.id]))[0]!.n).toBe(4);
  });

  it("if the record of a call cannot be written, its money is not moved either; nothing new is started, and the next step tidies up", async () => {
    await open();
    const cfg = config(60);
    const run = await create(cfg, spec({ provider: "anthropic", epochs: 1, concurrency: 1 }), 12 * USD, true);
    // the database fails once, at the moment the third call's record is written
    let inserts = 0;
    const failing = (q: Queryer): Queryer => ({
      query: async (sql, params) => {
        if (sql.includes("INSERT INTO calls") && sql.includes("latency_ms") && ++inserts === 3) throw new Error("connection lost");
        return q.query(sql, params);
      },
    });
    const flaky = { kind: db.kind, close: () => db.close(), query: failing(db).query, tx: <T>(fn: (q: Queryer) => Promise<T>) => db.tx((q) => fn(failing(q))) } as Db;
    const provider = new FakePaid();
    await expect(stepRun(flaky, new Ledger(flaky, { ceilingMicroUsd: CEILING }), run.id, provider, { owner: "a", budgetMs: 60_000, retryDelayMs: 0 })).rejects.toThrow("connection lost");
    // two calls are on the books whole; the third was answered, and neither its money nor its record was written
    expect(provider.calls).toHaveLength(3);
    const third = provider.calls[2]!;
    const rid = `${run.id}:0:${third.agent}:1`;
    expect((await ledger.get(rid))!.state).toBe("reserved");
    expect(await db.query("SELECT 1 FROM calls WHERE reservation_id = $1", [rid])).toEqual([]);
    expect((await db.query("SELECT COUNT(*) AS n FROM calls WHERE run_id = $1", [run.id]))[0]!.n).toBe(2);
    expect((await ledger.summary()).settledMicroUsd).toBe(2 * 23_000);
    await books(db);
    // the lease was handed back, so the next step can start at once; it finds the orphan, holds its money as unknown, and finishes
    expect(await drive(db, ledger, run.id, provider)).toEqual(["done"]);
    expect(provider.calls.filter((c) => c.agent === third.agent)).toHaveLength(1);
    expect((await ledger.get(rid))!.state).toBe("unknown");
    await books(db);
  });

  it("a run that keeps paying for answers it cannot use is stopped after three, and an answer from the wrong model stops it at once", async () => {
    await open();
    const cfg = config(61);
    const paidFor = (status: CallResult["status"], code: string): CallResult => ({ ...failed(status, code), costMicroUsd: 23_000, usage: { input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation_5m: 0, cache_creation_1h: 0, inference_geo: "global", speed: "standard", service_tier: "standard", thinking_tokens: 2000 } });
    // every answer is cut off at its length limit: paid for, and useless
    const run = await create(cfg, spec({ provider: "anthropic", epochs: 2, concurrency: 1 }), 12 * USD, true);
    let mode: "truncated" | "ok" | "mixed" = "truncated";
    let n = 0;
    const provider = new FakePaid(() => {
      n++;
      if (mode === "ok") return "ok";
      if (mode === "mixed") return n % 2 === 0 ? "ok" : paidFor("malformed", "wrong_shape");
      return paidFor("truncated", "max_tokens");
    });
    const first = await stepRun(db, ledger, run.id, provider, { owner: "a", budgetMs: 60_000, retryDelayMs: 0 });
    expect(first).toMatchObject({ state: "paused", reason: "unusable_answers", calls: UNUSABLE_LIMIT });
    expect(provider.calls).toHaveLength(3);
    expect((await ledger.summary()).settledMicroUsd).toBe(3 * 23_000);
    expect((await getRun(db, run.id))!).toMatchObject({ status: "paused", statusReason: "unusable_answers", epoch: 0 });
    expect((await db.query("SELECT action FROM audit_log WHERE action = 'run.paused'")).length).toBe(1);
    // the owner resumes it without changing anything: one more such answer and it stops again
    expect(await setRunStatus(db, run.id, "active", "owner")).toBe(true);
    const second = await stepRun(db, ledger, run.id, provider, { owner: "a", budgetMs: 60_000, retryDelayMs: 0 });
    expect(second).toMatchObject({ state: "paused", reason: "unusable_answers", calls: 1 });
    // a usable answer ends the count: once the answers are good again the run goes on to its end
    mode = "ok";
    expect(await setRunStatus(db, run.id, "active", "owner")).toBe(true);
    expect(await drive(db, ledger, run.id, provider)).toEqual(["committed", "done"]);
    await books(db);
    // answers that are sometimes unusable do not stop a run: only an unbroken run of them does
    const patchy = await create(config(65), spec({ provider: "anthropic", epochs: 2, concurrency: 1 }), 12 * USD, true);
    mode = "mixed";
    n = 0;
    expect(await drive(db, ledger, patchy.id, provider)).toEqual(["committed", "done"]);
    expect((await db.query("SELECT COUNT(*) AS n FROM calls WHERE run_id = $1 AND status = 'malformed'", [patchy.id]))[0]!.n).toBeGreaterThanOrEqual(5);
    await books(db);

    // an answer that says it came from another model than the one approved: paid for, unusable, and so would the next be
    const other = await create(config(62), spec({ provider: "anthropic", epochs: 1, concurrency: 1 }), 12 * USD, true);
    const wrong = new FakePaid(() => paidFor("malformed", "wrong_model"));
    expect(await stepRun(db, ledger, other.id, wrong, { owner: "a", budgetMs: 60_000, retryDelayMs: 0 })).toMatchObject({ state: "failed", reason: "wrong_model", calls: 1 });
    expect(wrong.calls).toHaveLength(1);
  });

  it("no call is left waiting past the end of the lease: its wait is cut to the time that is left, and none is started in the last seconds", async () => {
    await open();
    const cfg = config(63);
    const run = await create(cfg, spec({ provider: "anthropic", epochs: 1, concurrency: 1, timeoutMs: 240_000 }), 12 * USD, true);
    let clock = 5_000_000;
    const started = clock;
    const waits: { at: number; timeoutMs: number }[] = [];
    const provider = new FakePaid((call) => {
      waits.push({ at: clock - started, timeoutMs: call.timeoutMs });
      clock += 9_000; // each answer takes nine seconds
      return "ok";
    });
    // a lease of sixty seconds: nothing may still be waiting forty seconds in
    const out = await stepRun(db, ledger, run.id, provider, { owner: "a", budgetMs: 600_000, leaseSeconds: 60, retryDelayMs: 0, now: () => clock });
    expect(out.state).toBe("partial");
    // calls began at 0, 9, 18 and 27 seconds; at 36 fewer than five seconds were left, and none was started
    expect(waits.map((w) => w.at)).toEqual([0, 9_000, 18_000, 27_000]);
    for (const w of waits) {
      expect(w.timeoutMs).toBe(40_000 - w.at);
      expect(w.at + w.timeoutMs).toBeLessThanOrEqual(40_000);
    }
    // with the lease the application uses, a call started at the last moment a step starts one still ends before the lease does
    expect(STEP_BUDGET_MS + Math.min(240_000, STEP_LEASE_SECONDS * 1000 - 20_000 - STEP_BUDGET_MS)).toBeLessThan(STEP_LEASE_SECONDS * 1000);
    expect(await drive(db, ledger, run.id, new FakePaid())).toEqual(["done"]);
    await books(db);
  });

  it("an answer too large to be written down is recorded as one that could not be read, paid for all the same, and never used", async () => {
    await open();
    const cfg = config(64);
    const make = async () => create(cfg, spec({ provider: "anthropic", epochs: 1, concurrency: 1 }), 12 * USD, true);
    const run = await make();
    const inner = new MockProvider();
    let big = -1;
    const provider = new FakePaid((call) => {
      if (big === -1) big = call.agent;
      if (call.agent !== big) return "ok";
      return { ...failed("ok", ""), error: null, decision: { intents: [{ k: "explore" }], goal: "explore", rationale: "" }, text: "x".repeat(400_000), costMicroUsd: 23_000 };
    });
    void inner;
    expect(await drive(db, ledger, run.id, provider)).toEqual(["done"]);
    const [row] = await db.query("SELECT status, result FROM calls WHERE run_id = $1 AND agent = $2", [run.id, big]);
    expect(row!.status).toBe("malformed");
    const kept = JSON.parse(String(row!.result)) as CallResult;
    expect(kept).toMatchObject({ status: "malformed", decision: null, text: null, costMicroUsd: 23_000, error: { code: "unserializable" } });
    expect(String(row!.result).length).toBeLessThan(2_000);
    expect((await ledger.get(`${run.id}:0:${big}:1`))!).toMatchObject({ state: "settled", settledMicroUsd: 23_000 });
    // the world did not act on it: the committed epoch says that mind's answer could not be used
    const epochs = await epochsOf(db, run.id);
    expect(epochs[0]!.outcomes.find((o) => o.agent === big)).toMatchObject({ status: "malformed", accepted: 0 });
    expect(verifyTape(createWorld(cfg), epochs[0]!.tape, epochs)).toBe(-1);
    await books(db);
  });

  it("a step that runs out of time stops cleanly; the next step finishes the epoch; nobody is asked twice", async () => {
    await open();
    const cfg = config(58);
    const run = await create(cfg, spec({ provider: "anthropic", epochs: 1, concurrency: 1 }), 12 * USD, true);
    let clock = 1_000_000;
    const provider = new FakePaid(() => {
      clock += 1000;
      return "ok";
    });
    const first = await stepRun(db, ledger, run.id, provider, { owner: "a", budgetMs: 2500, now: () => clock });
    expect(first.state).toBe("partial");
    expect(first.calls).toBe(3);
    expect((await getRun(db, run.id))!.epoch).toBe(0);
    // a different instance picks it up (the first one's lease was released when it returned)
    const second = await stepRun(db, ledger, run.id, provider, { owner: "b", budgetMs: 600_000, now: () => clock });
    expect(second.state).toBe("done");
    const keys = provider.calls.map((c) => `${c.agent}:${c.attempt}`);
    expect(new Set(keys).size).toBe(keys.length);
    // the result is the world an uninterrupted epoch reaches
    const twin = await create(cfg, spec({ provider: "anthropic", epochs: 1, concurrency: 1 }), 12 * USD, true);
    await drive(db, ledger, twin.id, new FakePaid());
    expect((await getRun(db, twin.id))!.digest).toBe((await getRun(db, run.id))!.digest);
    await books(db);
  });

  it("while one stepper holds the lease another is turned away; cancelling stops a run for good", async () => {
    const cfg = config(59);
    const run = await create(cfg, spec({ provider: "mock", epochs: 3 }));
    // someone else holds the lease
    await db.query("UPDATE runs SET lease_owner = 'other', lease_until = now() + interval '5 minutes' WHERE id = $1", [run.id]);
    expect((await stepRun(db, ledger, run.id, new MockProvider(), { owner: "me", budgetMs: 1000 })).state).toBe("busy");
    // an expired lease is no obstacle
    await db.query("UPDATE runs SET lease_until = now() - interval '1 second' WHERE id = $1", [run.id]);
    expect((await stepRun(db, ledger, run.id, new MockProvider(), { owner: "me", budgetMs: 60_000 })).state).toBe("committed");
    expect(await setRunStatus(db, run.id, "cancelled", "owner", "enough")).toBe(true);
    expect((await stepRun(db, ledger, run.id, new MockProvider(), { owner: "me", budgetMs: 60_000 })).state).toBe("not_active");
    expect(await setRunStatus(db, run.id, "active", "owner")).toBe(false); // cancelled is final
    expect((await getRun(db, run.id))!).toMatchObject({ status: "cancelled", statusReason: "enough", epoch: 1 });
    expect((await stepRun(db, ledger, "run_nope", new MockProvider(), { owner: "me", budgetMs: 1000 })).state).toBe("missing");
  });

  it("an error no retry can fix fails the run at once and says why", async () => {
    await open();
    for (const code of ["auth", "model_unavailable", "spend_limit", "bad_request"]) {
      const run = await create(config(60), spec({ provider: "anthropic", concurrency: 1 }), 2 * USD, true);
      const provider = new FakePaid(() => failed("rejected", code));
      const out = await stepRun(db, ledger, run.id, provider, { owner: "t", budgetMs: 60_000 });
      expect(out, code).toMatchObject({ state: "failed", reason: code, calls: 1 });
      expect(provider.calls).toHaveLength(1); // nobody else was asked after the first refusal
      expect((await getRun(db, run.id))!).toMatchObject({ status: "failed", statusReason: code });
      // the failed request was not billed, so nothing is held for it
      expect((await getRun(db, run.id))!.reservedMicroUsd).toBe(0);
    }
    await books(db);
  });

  it("refuses to continue from a stored world that does not match its digest", async () => {
    const run = await create(config(61), spec({ provider: "mock" }));
    await db.query("UPDATE runs SET digest = 'tampered' WHERE id = $1", [run.id]);
    expect(await stepRun(db, ledger, run.id, new MockProvider(), { owner: "t", budgetMs: 1000 })).toMatchObject({ state: "failed", reason: "snapshot_mismatch" });
    expect((await getRun(db, run.id))!.status).toBe("failed");
  });

  it("the wrong provider for a run is refused before anything is asked", async () => {
    const run = await create(config(62), spec({ provider: "mock" }));
    const paid = new FakePaid();
    await expect(stepRun(db, ledger, run.id, paid, { owner: "t", budgetMs: 1000 })).rejects.toThrow(/does not match/);
    expect(paid.calls).toHaveLength(0);
    // and the lease was given back
    expect((await stepRun(db, ledger, run.id, new MockProvider(), { owner: "u", budgetMs: 60_000 })).state).toBe("committed");
  });

  it("publishing marks a run as readable by anyone; nothing else about it changes", async () => {
    const run = await create(config(63), spec({ provider: "mock", epochs: 1 }));
    expect(run.published).toBe(false);
    expect(await publishRun(db, run.id, true, "owner")).toBe(true);
    expect((await getRun(db, run.id))!.published).toBe(true);
    expect(await publishRun(db, "run_nope", true, "owner")).toBe(false);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("server-side runs with two instances stepping at once (PostgreSQL server)", () => {
  let handle: Awaited<ReturnType<typeof serverDb>>;
  beforeAll(async () => {
    handle = await serverDb(12);
  });
  afterAll(async () => {
    await handle.drop();
  });

  it("two instances racing through a paid run commit every epoch once and pay for every call once", async () => {
    const dbA = handle.db;
    const dbB = await handle.second();
    const ledgerA = new Ledger(dbA, { ceilingMicroUsd: CEILING });
    const ledgerB = new Ledger(dbB, { ceilingMicroUsd: CEILING });
    await ledgerA.authorize(50 * USD, 50 * USD, "owner");
    await ledgerA.setKillSwitch(false, "test", "owner");
    const cfg = config(71, { population: 12 });
    const s = spec({ provider: "anthropic", epochs: 5, concurrency: 4 }, { callsPerEpoch: 12 });
    const made = await createRun(dbA, ledgerA, { title: "race", config: cfg, spec: s, capMicroUsd: 20 * USD, allowEarlyStop: true }, LIVE, "owner");
    if (!made.ok) throw new Error(made.error);
    const id = made.run.id;
    const provider = new FakePaid();
    // slow the provider a little so that the two steppers really overlap
    const slow: Provider = { id: provider.id, model: provider.model, paid: true, reserveFor: () => provider.reserveFor(), decide: async (call) => {
      await new Promise((r) => setTimeout(r, 3));
      return provider.decide(call);
    } };
    const loop = async (db: Db, ledger: Ledger, owner: string): Promise<string[]> => {
      const seen: string[] = [];
      for (let i = 0; i < 200; i++) {
        const out = await stepRun(db, ledger, id, slow, { owner, budgetMs: 60_000, retryDelayMs: 0 });
        seen.push(out.state);
        if (out.state === "done" || out.state === "failed" || out.state === "paused") break;
        if (out.state === "busy") await new Promise((r) => setTimeout(r, 2));
      }
      return seen;
    };
    const [a, b] = await Promise.all([loop(dbA, ledgerA, "instance-a"), loop(dbB, ledgerB, "instance-b")]);
    expect(a.at(-1)).toBe("done");
    expect(b.at(-1)).toBe("done");
    expect(a.filter((x) => x === "committed").length + b.filter((x) => x === "committed").length).toBeLessThanOrEqual(5);
    const run = (await getRun(dbA, id))!;
    expect(run).toMatchObject({ status: "done", epoch: 5 });
    // no (epoch, agent, attempt) was ever sent twice, by either instance
    const keys = provider.calls.map((c) => `${c.epoch}:${c.agent}:${c.attempt}`);
    expect(new Set(keys).size).toBe(keys.length);
    const reservations = await dbA.query("SELECT id, state FROM reservations WHERE run_id = $1", [id]);
    expect(reservations).toHaveLength(keys.length);
    expect(reservations.every((r) => r.state === "settled")).toBe(true);
    expect(run.settledMicroUsd).toBe(keys.length * 23_000);
    const epochs = await epochsOf(dbA, id);
    expect(epochs.map((e) => e.epoch)).toEqual([0, 1, 2, 3, 4]);
    expect(verifyTape(createWorld(cfg), epochs.flatMap((e) => e.tape), epochs)).toBe(-1);
    await books(dbA);
  });
});
