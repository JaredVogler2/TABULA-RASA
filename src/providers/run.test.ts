import { describe, expect, it } from "vitest";
import { TICKS_PER_DAY, auditGoods, createWorld, makeConfig, run, worldDigest, type DecisionRecord, type WorldConfig, type WorldState } from "@/engine";
import { MockProvider } from "./mock";
import { BaselineProvider, ReplayProvider } from "./replay";
import { DEFAULT_SPEC, ask, commitEpoch, planEpoch, runEpoch, validateSpec, verifyTape, type Asked, type EpochResult, type RunSpec } from "./run";
import { SCHEDULER_KINDS, newSchedulerState } from "./schedule";
import { noResult, type CallResult, type DecisionCall, type Provider } from "./types";

const spec = (over: Partial<RunSpec> = {}, sched: Partial<RunSpec["scheduler"]> = {}): RunSpec => ({ ...DEFAULT_SPEC, ...over, scheduler: { ...DEFAULT_SPEC.scheduler, ...sched } });

const society = (seed: number, over: Partial<WorldConfig> = {}): WorldConfig => makeConfig("first_light", seed, { population: 50, externalShare: 1000, illness: 0, institutions: "open", cadence: 24, ...over });

/** Run a whole society for some epochs with a free provider; returns everything a replay needs. */
async function play(cfg: WorldConfig, s: RunSpec, provider: Provider, epochs: number): Promise<{ world: WorldState; results: EpochResult[]; tape: DecisionRecord[] }> {
  const world = createWorld(cfg);
  let st = newSchedulerState(world.agents.length);
  const results: EpochResult[] = [];
  const tape: DecisionRecord[] = [];
  for (let e = 0; e < epochs; e++) {
    const { result, next } = await runEpoch("test", world, s, st, e, provider);
    st = next;
    results.push(result);
    tape.push(...result.tape);
  }
  return { world, results, tape };
}

/** A provider whose behaviour per call is scripted, for injecting failures. */
class Scripted implements Provider {
  readonly id = "mock" as const;
  readonly model = "mock";
  readonly paid = false;
  readonly calls: { agent: number; attempt: number; epoch: number }[] = [];
  private readonly inner = new MockProvider();
  constructor(private readonly script: (call: DecisionCall) => CallResult | "ok" | "throw") {}
  reserveFor(): number {
    return 0;
  }
  async decide(call: DecisionCall): Promise<CallResult> {
    this.calls.push({ agent: call.agent, attempt: call.attempt, epoch: call.epoch });
    const what = this.script(call);
    if (what === "throw") throw new Error("socket hang up");
    return what === "ok" ? this.inner.decide(call) : what;
  }
}

describe("a society of fifty minds outside the engine (mock provider, no cost)", () => {
  for (const kind of SCHEDULER_KINDS) {
    it(`${kind}: fifty people decide independently over three days, and the record replays to the same world`, async () => {
      const cfg = society(21);
      const s = spec({ epochTicks: 24, epochs: 12 }, { kind, callsPerEpoch: 50, maxPerAgentPerDay: 4 });
      const first = await play(cfg, s, new MockProvider(), 12);
      expect(first.world.tick).toBe(12 * 24);
      expect(auditGoods(first.world)).toBeNull();

      // everyone took part, each on their own page: every person has decisions of their own in the record
      const deciders = new Set(first.tape.filter((r) => r.intents.length > 0).map((r) => r.agent));
      expect(deciders.size).toBe(50);
      for (const r of first.tape) expect(r.source).toBe("mock");
      // the trace accounts for every living person in every epoch, with a reason
      for (const r of first.results) {
        expect(r.trace).toHaveLength(r.alive === 50 ? 50 : r.trace.length);
        expect(r.trace.every((t) => t.reason.length > 0)).toBe(true);
        expect(r.trace.filter((t) => t.activated)).toHaveLength(r.outcomes.length);
      }
      expect(first.world.metrics.decisionsBySource.mock).toBeGreaterThan(100);
      expect(first.world.metrics.decisionsBySource.live ?? 0).toBe(0);

      // deterministic: the same run again is the same world, epoch by epoch
      const second = await play(cfg, s, new MockProvider(), 12);
      expect(second.results.map((r) => r.digest)).toEqual(first.results.map((r) => r.digest));

      // replay from the tape alone, consulting no mind, reproduces every epoch's digest
      expect(verifyTape(createWorld(cfg), first.tape, first.results)).toBe(-1);
      // and a tape that has been tampered with is caught at the epoch where it was changed
      const forged = first.tape.map((r) => ({ ...r }));
      const victim = forged.findIndex((r) => r.tick >= 2 * 24 && r.intents.some((i) => i.k === "gather" || i.k === "explore"));
      expect(victim).toBeGreaterThan(0);
      forged[victim] = { ...forged[victim]!, intents: [{ k: "wait", ticks: 20 }] };
      expect(verifyTape(createWorld(cfg), forged, first.results)).toBe(forged[victim]!.tick / 24);
    });
  }

  it("the record of a run is enough to run it again through the provider interface, asking nothing of the mock", async () => {
    const cfg = society(22, { population: 30 });
    const s = spec({}, { kind: "round_robin", callsPerEpoch: 30, maxPerAgentPerDay: 4 });
    const original = await play(cfg, s, new MockProvider(), 8);
    const replayed = await play(cfg, s, new ReplayProvider(original.tape), 8);
    expect(replayed.results.map((r) => r.digest)).toEqual(original.results.map((r) => r.digest));
    // decisions are labelled as replayed, and anything a replayed mind founds keeps the author it had
    expect(replayed.world.metrics.decisionsBySource.replay).toBe(original.world.metrics.decisionsBySource.mock);
    expect(replayed.world.metrics.decisionsBySource.mock ?? 0).toBe(0);
    expect(replayed.world.inst.proposals.map((p) => p.origin)).toEqual(original.world.inst.proposals.map((p) => p.origin));
    expect(replayed.tape).toEqual(original.tape);
  });

  it("mock minds that write and sign agreements leave them attributed to the mock, in the run and in its replay", async () => {
    // long enough for the mock's rare proposal to occur somewhere
    const cfg = society(23, { population: 40, spawn: "clustered" });
    const s = spec({ epochTicks: 12 }, { kind: "round_robin", callsPerEpoch: 40, maxPerAgentPerDay: 8 });
    const first = await play({ ...cfg, cadence: 12 }, s, new MockProvider(), 40);
    const proposals = first.world.inst.proposals;
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.origin === "mock")).toBe(true);
    expect(verifyTape(createWorld({ ...cfg, cadence: 12 }), first.tape, first.results)).toBe(-1);
  });

  it("a baseline arm runs through the same harness and is exactly the engine's own world", async () => {
    const cfg = makeConfig("first_light", 21, { population: 50, illness: 0 });
    const s = spec({ provider: "baseline", epochs: 6 });
    const viaHarness = await play(cfg, s, new BaselineProvider(), 6);
    const plain = createWorld(cfg);
    run(plain, 6 * 24);
    expect(viaHarness.results[5]!.digest).toBe(worldDigest(plain));
    expect(viaHarness.tape).toEqual([]);
    // with external minds and a provider that abstains, everyone acts on the labelled fallback
    const abstaining = await play(society(21), s, new BaselineProvider(), 6);
    expect(Object.keys(abstaining.world.metrics.decisionsBySource).sort()).toEqual(["fallback"]);
  });
});

describe("rationing deliberation fairly", () => {
  const consultations = (results: EpochResult[]): Map<number, number[]> => {
    const by = new Map<number, number[]>();
    for (const r of results) for (const o of r.outcomes) by.set(o.agent, [...(by.get(o.agent) ?? []), r.epoch]);
    return by;
  };

  for (const kind of SCHEDULER_KINDS) {
    it(`${kind}: with six slots for fifty minds nobody exceeds the daily cap and nobody is passed over for ever`, async () => {
      const cfg = society(31);
      const s = spec({ epochTicks: 24, epochs: 32 }, { kind, callsPerEpoch: 6, maxPerAgentPerDay: 2, starveAfterEpochs: 10 });
      const { results, world } = await play(cfg, s, new MockProvider(), 32);
      const by = consultations(results);
      // never more than six a turn
      for (const r of results) expect(r.outcomes.length).toBeLessThanOrEqual(6);
      // the daily cap holds for everyone
      for (const [, epochs] of by) {
        const perDay = new Map<number, number>();
        for (const e of epochs) perDay.set(Math.floor((e * 24) / TICKS_PER_DAY), (perDay.get(Math.floor((e * 24) / TICKS_PER_DAY)) ?? 0) + 1);
        for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(2);
      }
      // everyone alive at the end has been consulted
      for (const a of world.agents) if (a.alive) expect(by.has(a.id), `agent ${a.id} was never consulted under ${kind}`).toBe(true);
      // nobody holds more than a small share of all consultations
      const total = [...by.values()].reduce((sum, e) => sum + e.length, 0);
      const most = Math.max(...[...by.values()].map((e) => e.length));
      expect(most / total).toBeLessThan(0.08);
      // every skipped mind was skipped for a stated reason
      const reasons = new Set(results.flatMap((r) => r.trace.filter((t) => !t.activated).map((t) => t.reason)));
      for (const reason of reasons) expect(["asleep", "body_first", "not_due", "daily_cap", "no_slot", "no_event", "low_value"]).toContain(reason);
    });
  }

  it("the three policies spend differently on the same world: round-robin fills every slot, the others ask only when there is cause", async () => {
    const cfg = society(32);
    const calls: Record<string, number> = {};
    const idleAsks: Record<string, number> = {};
    for (const kind of SCHEDULER_KINDS) {
      const s = spec({ epochTicks: 24, epochs: 16 }, { kind, callsPerEpoch: 12, maxPerAgentPerDay: 4, starveAfterEpochs: 0 });
      const { results } = await play(cfg, s, new MockProvider(), 16);
      calls[kind] = results.reduce((n, r) => n + r.outcomes.length, 0);
      idleAsks[kind] = results.reduce((n, r) => n + r.outcomes.filter((o) => o.reason === "turn").length, 0);
      if (kind !== "round_robin") for (const r of results) for (const o of r.outcomes) expect(o.reason).not.toBe("turn");
    }
    expect(idleAsks.round_robin).toBe(calls.round_robin);
    expect(calls.event!).toBeLessThanOrEqual(calls.round_robin!);
    expect(calls.voi!).toBeLessThanOrEqual(calls.round_robin!);
    expect(calls.event!).toBeGreaterThan(0);
    expect(calls.voi!).toBeGreaterThan(0);
  });

  it("being talked at does not buy more deliberation than the cap allows", async () => {
    // everyone in one place, so speech is constant; the event policy must still respect the cap
    const cfg = society(33, { population: 20, spawn: "clustered" });
    const s = spec({ epochTicks: 12, epochs: 24 }, { kind: "event", callsPerEpoch: 20, maxPerAgentPerDay: 3, starveAfterEpochs: 0 });
    const { results } = await play({ ...cfg, cadence: 12 }, s, new MockProvider(), 24);
    const by = consultations(results);
    for (const [, epochs] of by) {
      const perDay = new Map<number, number>();
      for (const e of epochs) perDay.set(Math.floor((e * 12) / TICKS_PER_DAY), (perDay.get(Math.floor((e * 12) / TICKS_PER_DAY)) ?? 0) + 1);
      for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(3);
    }
    expect(results.some((r) => r.trace.some((t) => t.reason === "daily_cap"))).toBe(true);
  });

  it("refuses a specification outside its bounds, precisely", () => {
    const ok = { ...DEFAULT_SPEC };
    expect(validateSpec(ok)).toEqual(DEFAULT_SPEC);
    const bad: [Record<string, unknown>, string][] = [
      [{ ...ok, provider: "openai" }, "provider"],
      [{ ...ok, provider: "replay" }, "provider"],
      [{ ...ok, epochTicks: 0 }, "epochTicks"],
      [{ ...ok, epochs: 1e9 }, "epochs"],
      [{ ...ok, maxTokens: 100 }, "maxTokens"],
      [{ ...ok, maxTokens: 200_000 }, "maxTokens"],
      [{ ...ok, concurrency: 100 }, "concurrency"],
      [{ ...ok, maxAttempts: 9 }, "maxAttempts"],
      [{ ...ok, effort: "max" }, "effort"],
      [{ ...ok, context: "everything" }, "context"],
      [{ ...ok, timeoutMs: 5 }, "timeoutMs"],
      [{ ...ok, scheduler: { ...ok.scheduler, kind: "greedy" } }, "scheduler.kind"],
      [{ ...ok, scheduler: { ...ok.scheduler, callsPerEpoch: 0 } }, "callsPerEpoch"],
      [{ ...ok, scheduler: { ...ok.scheduler, maxPerAgentPerDay: 1.5 } }, "maxPerAgentPerDay"],
    ];
    for (const [raw, needle] of bad) expect(() => validateSpec(raw), needle).toThrow(needle);
    expect(() => validateSpec(null)).toThrow();
  });
});

describe("when calls fail, are cut short or are interrupted", () => {
  const cfg = society(41, { population: 12 });
  const s = spec({ maxAttempts: 2, concurrency: 3 }, { kind: "round_robin", callsPerEpoch: 12, maxPerAgentPerDay: 8 });
  const failed = (status: CallResult["status"], code: string, retryable: boolean): CallResult => noResult("mock", status, { code, status: null, retryable, message: code });

  it("a definite, unbilled failure is tried once more; an unknown outcome never is; neither reaches the world", async () => {
    const world = createWorld(cfg);
    const st = newSchedulerState(world.agents.length);
    const plan = planEpoch(world, s, st, 0);
    const ids = plan.schedule.activations.map((a) => a.agent);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    const [busy, dead, lost, garbled, cut, thrown, declined] = ids as [number, number, number, number, number, number, number];
    const provider = new Scripted((call) => {
      if (call.agent === busy) return call.attempt === 1 ? failed("rejected", "rate_limited", true) : "ok";
      if (call.agent === dead) return failed("rejected", "bad_request", false);
      if (call.agent === lost) return failed("unknown", "timeout", false);
      if (call.agent === garbled) return { ...failed("malformed", "not_json", false), costMicroUsd: 0 };
      if (call.agent === cut) return { ...failed("truncated", "max_tokens", false), costMicroUsd: 0 };
      if (call.agent === thrown) return "throw";
      if (call.agent === declined) return { ...failed("refused", "refusal", false), costMicroUsd: 0 };
      return "ok";
    });
    const asked = await ask("r", cfg, s, plan, provider);
    const attempts = (id: number) => provider.calls.filter((c) => c.agent === id).length;
    expect(attempts(busy)).toBe(2);
    expect(asked.get(busy)).toMatchObject({ attempts: 2, result: { status: "ok" } });
    expect(attempts(dead)).toBe(1);
    expect(attempts(lost)).toBe(1); // never re-sent: it may have been billed
    expect(attempts(thrown)).toBe(1);
    expect(asked.get(thrown)!.result).toMatchObject({ status: "unknown", error: { code: "provider_threw" } });
    // the error message of a thrown provider is not carried along (it could hold anything)
    expect(JSON.stringify(asked.get(thrown))).not.toContain("socket hang up");

    const result = commitEpoch(world, s, plan, asked, "mock");
    const outcome = (id: number) => result.outcomes.find((o) => o.agent === id)!;
    expect(outcome(busy)).toMatchObject({ status: "ok", attempts: 2 });
    expect(outcome(dead)).toMatchObject({ status: "rejected", accepted: 0 });
    expect(outcome(lost)).toMatchObject({ status: "unknown", accepted: 0 });
    // nothing was submitted for the failures, so they have no record on the tape and are due again at once
    const onTape = new Set(result.tape.map((r) => r.agent));
    for (const id of [dead, lost, thrown]) expect(onTape.has(id)).toBe(false);
    for (const id of [dead, lost, thrown]) expect(world.agents[id]!.mind.nextDeliberation).toBe(0);
    // an unusable answer is on the record as a refusal, tells the mind what was wrong, and makes it wait its interval
    for (const [id, why] of [[garbled, "could_not_be_read"], [cut, "cut_off_too_long"], [declined, "declined"]] as const) {
      const rec = result.tape.find((r) => r.agent === id)!;
      expect(rec.intents).toEqual([]);
      expect(rec.dropped).toEqual([{ action: "answer", reason: why }]);
      expect(world.agents[id]!.mind.nextDeliberation).toBe(plan.tick + cfg.cadence);
      expect(world.agents[id]!.mind.feedback.map((f) => f.r)).toContain(why);
    }
    // and the whole epoch, failures included, replays from its tape
    expect(verifyTape(createWorld(cfg), result.tape, [result])).toBe(-1);
  });

  it("an interrupted epoch resumes without asking anyone twice, and ends in the same world as an uninterrupted one", async () => {
    const whole = createWorld(cfg);
    const wholeResult = (await runEpoch("r", whole, s, newSchedulerState(whole.agents.length), 0, new MockProvider())).result;

    const world = createWorld(cfg);
    const st = newSchedulerState(world.agents.length);
    const provider = new Scripted(() => "ok");
    // first invocation: stopped after four answers (a cancelled request, a function that ran out of time)
    let plan = planEpoch(world, s, st, 0);
    let answered = 0;
    const first = await ask("r", cfg, { ...s, concurrency: 1 }, plan, provider, new Map(), { halted: () => answered >= 4, after: async () => void answered++ });
    expect(first.size).toBe(4);
    expect(world.tick).toBe(0); // nothing has reached the world yet

    // second invocation, from nothing but the stored answers: the plan is recomputed and is the same plan
    const stored: Map<number, Asked> = new Map(JSON.parse(JSON.stringify([...first])) as [number, Asked][]);
    plan = planEpoch(world, s, st, 0);
    const rest = await ask("r", cfg, s, plan, provider, stored);
    const all = new Map([...stored, ...rest]);
    expect(all.size).toBe(plan.schedule.activations.length);
    // nobody was asked twice
    const asks = provider.calls.map((c) => c.agent);
    expect(new Set(asks).size).toBe(asks.length);
    const resumed = commitEpoch(world, s, plan, all, "mock");
    expect(resumed.digest).toBe(wholeResult.digest);
    expect(resumed.tape).toEqual(wholeResult.tape);
  });

  it("stops at its deadline, and a refusal before the call (no budget, cancelled) leaves that mind for later", async () => {
    const world = createWorld(cfg);
    const st = newSchedulerState(world.agents.length);
    const plan = planEpoch(world, s, st, 0);
    let clock = 0;
    const provider = new Scripted(() => {
      clock += 10;
      return "ok";
    });
    const timed = await ask("r", cfg, { ...s, concurrency: 1 }, plan, provider, new Map(), {}, { deadlineMs: 25, now: () => clock });
    expect(timed.size).toBe(3); // calls started at 0, 10 and 20; the fourth would start at 30

    const refused: number[] = [];
    const none = new Scripted(() => "ok");
    const gated = await ask("r", cfg, s, plan, none, new Map(), {
      before: async (call) => {
        if (call.agent % 2 === 0) return { go: true };
        refused.push(call.agent);
        return { go: false, why: "run_cap" };
      },
    });
    expect(refused.length).toBeGreaterThan(0);
    for (const id of refused) expect(gated.has(id)).toBe(false);
    expect(none.calls.every((c) => c.agent % 2 === 0)).toBe(true);
    const result = commitEpoch(world, s, plan, gated, "mock");
    for (const id of refused) expect(result.outcomes.find((o) => o.agent === id)).toMatchObject({ status: "not_asked", attempts: 0 });
  });

  it("can let one call finish before the rest start, so that they can share what it cached", async () => {
    const world = createWorld(cfg);
    const plan = planEpoch(world, s, newSchedulerState(world.agents.length), 0);
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const provider: Provider = {
      id: "mock",
      model: "mock",
      paid: false,
      reserveFor: () => 0,
      decide: async (call) => {
        order.push(`start ${call.agent}`);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        order.push(`end ${call.agent}`);
        return new MockProvider().decide(call);
      },
    };
    await ask("r", cfg, { ...s, concurrency: 4 }, plan, provider, new Map(), {}, { warmFirst: true });
    const firstAgent = plan.schedule.activations[0]!.agent;
    expect(order[0]).toBe(`start ${firstAgent}`);
    expect(order[1]).toBe(`end ${firstAgent}`);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("refuses to commit an epoch to a world that has moved on", () => {
    const world = createWorld(cfg);
    const plan = planEpoch(world, s, newSchedulerState(world.agents.length), 0);
    run(world, 3);
    expect(() => commitEpoch(world, s, plan, new Map(), "mock")).toThrow(/planned at tick 0/);
  });
});
