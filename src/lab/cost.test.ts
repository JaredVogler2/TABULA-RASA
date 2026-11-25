import { describe, expect, it } from "vitest";
import { createWorld, makeConfig } from "@/engine";
import { MARGINS, PRICE_TABLE, worstCaseCost, type PriceTable } from "@/providers/prices";
import { DEFAULT_SPEC, plannedCalls, requestTokenBound } from "@/providers/run";
import { LIVE_DESIGNS, dollars, estimateLiveStudy, seedsWithin, type LiveDesign } from "./cost";

/** A price list with round numbers, so that every figure below can be worked by hand. */
const ROUND: PriceTable = {
  verifiedOn: "2026-01-01",
  source: "test fixture",
  staleAfterDays: 45,
  models: {
    round: { input: 1_000_000, cacheWrite5m: 1_250_000, cacheWrite1h: 2_000_000, cacheRead: 100_000, output: 5_000_000 },
    half: { input: 500_000, cacheWrite5m: 625_000, cacheWrite1h: 1_000_000, cacheRead: 50_000, output: 2_500_000 },
  },
};

const ALL: LiveDesign = { label: "one day", scenario: "first_light", overrides: { externalShare: 1000 }, liveConditions: 1, seeds: [9000], days: 1 };

describe("laboratory cost estimator: ceilings that can be worked by hand", () => {
  it("one world for one day: calls from the scheduler's limits, cost from the price list, nothing assumed in the reader's favour", () => {
    const e = estimateLiveStudy(ALL, "round", ROUND);
    const cfg = makeConfig("first_light", 9000, { externalShare: 1000 });
    expect(e.runs).toBe(1);
    expect(e.externalAgents).toBe(cfg.population);
    // a day is 96 ticks: four epochs of 24; eight calls an epoch binds before three a day for each of fifty people
    expect(DEFAULT_SPEC.epochTicks).toBe(24);
    expect(e.callsPerRun).toBe(Math.min(4 * DEFAULT_SPEC.scheduler.callsPerEpoch, cfg.population * DEFAULT_SPEC.scheduler.maxPerAgentPerDay));
    expect(e.callsPerRun).toBe(32);
    expect(e.inputTokenBound).toBe(requestTokenBound(cfg, DEFAULT_SPEC.context));
    expect(e.maxTokens).toBe(DEFAULT_SPEC.maxTokens);
    // by hand: every input token at the dearer of input and cache-write, every output token used, then the geography margin
    const tokensIn = e.inputTokenBound + MARGINS.hiddenInputTokens;
    const base = Math.ceil((tokensIn * 1_250_000) / 1_000_000) + Math.ceil((2000 * 5_000_000) / 1_000_000);
    expect(e.perCallMicroUsd).toBe(Math.ceil((base * MARGINS.geography) / 1000));
    expect(e.perRunMicroUsd).toBe(e.perCallMicroUsd * 32);
    expect(e.worstCaseMicroUsd).toBe(e.perRunMicroUsd);
    expect(e.calls).toBe(32);
  });

  it("is the same arithmetic the server's preview uses", () => {
    const design: LiveDesign = { ...ALL, days: 6, spec: { maxTokens: 1200, context: "minimal", scheduler: { ...DEFAULT_SPEC.scheduler, callsPerEpoch: 5, maxPerAgentPerDay: 2 } } };
    const e = estimateLiveStudy(design, "claude-haiku-5-5");
    const cfg = makeConfig("first_light", 9000, { externalShare: 1000 });
    const spec = { ...DEFAULT_SPEC, ...design.spec, epochs: (6 * 96) / 24 };
    expect(e.callsPerRun).toBe(plannedCalls(spec, cfg.population));
    expect(e.perCallMicroUsd).toBe(worstCaseCost(PRICE_TABLE.models["claude-haiku-5-5"]!, requestTokenBound(cfg, "minimal"), 1200, "5m"));
  });

  it("scales exactly with conditions and seeds, and never falls when days are added", () => {
    const one = estimateLiveStudy(ALL, "round", ROUND);
    const many = estimateLiveStudy({ ...ALL, liveConditions: 3, seeds: [9000, 9001, 9002, 9003] }, "round", ROUND);
    expect(many.runs).toBe(12);
    expect(many.worstCaseMicroUsd).toBe(one.worstCaseMicroUsd * 12);
    let last = 0;
    for (const days of [1, 2, 5, 10, 40]) {
      const e = estimateLiveStudy({ ...ALL, days }, "round", ROUND);
      expect(e.worstCaseMicroUsd).toBeGreaterThanOrEqual(last);
      last = e.worstCaseMicroUsd;
    }
    expect(estimateLiveStudy(ALL, "half", ROUND).worstCaseMicroUsd).toBeLessThan(one.worstCaseMicroUsd);
    expect(estimateLiveStudy({ ...ALL, liveConditions: 0 }, "round", ROUND).worstCaseMicroUsd).toBe(0);
  });

  it("when only some people are decided for from outside, the largest such group over the seeds is priced", () => {
    const design: LiveDesign = { ...ALL, overrides: { externalShare: 300 }, seeds: [9000, 9001, 9002], days: 2 };
    const counts = design.seeds.map((seed) => createWorld(makeConfig("first_light", seed, { externalShare: 300 })).agents.filter((a) => a.controller === "external").length);
    const e = estimateLiveStudy(design, "round", ROUND);
    expect(e.externalAgents).toBe(Math.max(...counts));
    expect(e.externalAgents).toBeGreaterThan(0);
    expect(e.externalAgents).toBeLessThan(50);
    expect(e.callsPerRun).toBe(plannedCalls({ ...DEFAULT_SPEC, epochs: 8 }, e.externalAgents));
    expect(estimateLiveStudy({ ...ALL, overrides: { externalShare: 0 } }, "round", ROUND).worstCaseMicroUsd).toBe(0);
  });

  it("refuses a model without a published price, and designs that are not designs", () => {
    expect(() => estimateLiveStudy(ALL, "some-model-nobody-priced", ROUND)).toThrow(/no published price/);
    expect(() => estimateLiveStudy({ ...ALL, seeds: [] }, "round", ROUND)).toThrow();
    expect(() => estimateLiveStudy({ ...ALL, days: 0 }, "round", ROUND)).toThrow();
    expect(() => estimateLiveStudy({ ...ALL, liveConditions: 1.5 }, "round", ROUND)).toThrow();
  });
});

describe("laboratory cost estimator: sizing a design to a budget", () => {
  const design: LiveDesign = { ...ALL, liveConditions: 2, seeds: [9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007], days: 3 };

  it("gives the most seeds whose ceiling fits, and one more would not", () => {
    const perSeed = estimateLiveStudy({ ...design, seeds: [9000] }, "round", ROUND).worstCaseMicroUsd;
    expect(seedsWithin(perSeed * 5, design, "round", ROUND)).toBe(5);
    expect(seedsWithin(perSeed * 5 + perSeed - 1, design, "round", ROUND)).toBe(5);
    expect(seedsWithin(perSeed * 5 - 1, design, "round", ROUND)).toBe(4);
    expect(seedsWithin(perSeed - 1, design, "round", ROUND)).toBe(0);
    expect(seedsWithin(0, design, "round", ROUND)).toBe(0);
    expect(seedsWithin(Number.NaN, design, "round", ROUND)).toBe(0);
    // never more seeds than the design has
    expect(seedsWithin(perSeed * 1000, design, "round", ROUND)).toBe(8);
  });

  it("every listed design can be priced on every model in the real price list, and dearer models never cost less", () => {
    const order = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"];
    for (const d of LIVE_DESIGNS) {
      const costs = order.map((m) => estimateLiveStudy(d, m).worstCaseMicroUsd);
      for (const c of costs) expect(Number.isSafeInteger(c) && c > 0).toBe(true);
      for (let i = 1; i < costs.length; i++) expect(costs[i]!).toBeGreaterThanOrEqual(costs[i - 1]!);
    }
  });

  it("money is written the way a person reads it", () => {
    expect(dollars(4_000)).toBe("$0.004");
    expect(dollars(1_234_567)).toBe("$1.23");
    expect(dollars(48_600_000)).toBe("$49");
    expect(dollars(12_345_000_000)).toBe("$12,345");
  });
});
