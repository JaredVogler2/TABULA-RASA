import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, createWorld, makeConfig, restoreWorld, serializeWorld, step, validateConfig, worldDigest, type SimEvent, type WorldConfig, type WorldState } from "../index";

function advance(w: WorldState, ticks: number): { planner: number; reflex: number } {
  const out: SimEvent[] = [];
  const seen = { planner: 0, reflex: 0 };
  for (let i = 0; i < ticks; i++) {
    step(w, out);
    for (const e of out) {
      if (e.k !== "decision") continue;
      const layer = (e.d as { layer?: string } | undefined)?.layer;
      if (layer === "planner") seen.planner++;
      else if (layer === "reflex") seen.reflex++;
    }
    out.length = 0;
  }
  return seen;
}

describe("the planner's deliberation clock (config.planEvery)", () => {
  it("is off in the reference configuration, and then every consultation is counted and nothing waits", () => {
    const w = createWorld(makeConfig("first_light", 3, { population: 20, policy: "planner" }));
    expect(w.config.planEvery).toBe(0);
    advance(w, 96 * 2);
    expect(w.metrics.deliberations).toBeGreaterThan(100);
    // without a clock the planner never sets a time before which it may not be consulted
    for (const a of w.agents) expect(a.mind.nextDeliberation).toBe(0);
  });

  it("with a clock, nobody deliberates twice within the interval, and reflex carries them in between", () => {
    const every = 24;
    const w = createWorld(makeConfig("first_light", 3, { population: 20, policy: "planner", planEvery: every }));
    const out: SimEvent[] = [];
    const last = new Map<number, number>();
    let plans = 0;
    let reflex = 0;
    for (let t = 0; t < 96 * 3; t++) {
      step(w, out);
      for (const e of out) {
        if (e.k !== "decision") continue;
        const layer = (e.d as { layer?: string } | undefined)?.layer;
        if (layer === "planner") {
          plans++;
          const before = last.get(e.a);
          if (before !== undefined) expect(e.t - before, `agent ${e.a} planned at ${before} and again at ${e.t}`).toBeGreaterThanOrEqual(every);
          last.set(e.a, e.t);
        } else if (layer === "reflex") reflex++;
      }
      out.length = 0;
    }
    expect(plans).toBeGreaterThan(20);
    expect(reflex).toBeGreaterThan(plans);
  });

  it("a longer interval means fewer deliberations: the treatment really is applied", () => {
    const run = (planEvery: number): number => {
      const w = createWorld(makeConfig("first_light", 4, { population: 24, policy: "planner", planEvery }));
      advance(w, 96 * 4);
      return w.metrics.deliberations;
    };
    const unclocked = run(0);
    const fast = run(12);
    const slow = run(48);
    expect(fast).toBeLessThan(unclocked);
    expect(slow).toBeLessThan(fast * 0.7);
    // and never more than the clock allows: one consultation per person per interval
    expect(slow).toBeLessThanOrEqual(24 * ((96 * 4) / 48 + 1));
    expect(fast).toBeLessThanOrEqual(24 * ((96 * 4) / 12 + 1));
  });

  it("a snapshot from before the clock existed opens as a world without one, and goes on exactly as it would have", () => {
    const w = createWorld(makeConfig("first_light", 9, { population: 16, policy: "planner" }));
    advance(w, 150);
    const env = JSON.parse(serializeWorld(w)) as { schema: number; state: { config: Record<string, unknown>; metrics: Record<string, unknown> } };
    expect(env.schema).toBe(SCHEMA_VERSION);
    // what a schema-4 snapshot looked like: no clock in the configuration, no count of deliberations
    env.schema = 4;
    delete env.state.config.planEvery;
    delete env.state.metrics.deliberations;
    const old = restoreWorld(JSON.stringify(env));
    expect(old.config.planEvery).toBe(0);
    expect(old.metrics.deliberations).toBe(0);
    expect(worldDigest(old)).toBe(worldDigest(w));
    advance(old, 120);
    advance(w, 120);
    expect(worldDigest(old)).toBe(worldDigest(w));
  });

  it("a configuration written before the clock existed (a recording's, a stored run's) is read as having none", () => {
    const cfg = { ...makeConfig("first_light", 1, {}) } as Partial<WorldConfig>;
    delete cfg.planEvery;
    expect(validateConfig(cfg as WorldConfig).planEvery).toBe(0);
    expect(() => makeConfig("first_light", 1, { planEvery: -1 })).toThrow(/planEvery/);
    expect(() => makeConfig("first_light", 1, { planEvery: 961 })).toThrow(/planEvery/);
  });
});
