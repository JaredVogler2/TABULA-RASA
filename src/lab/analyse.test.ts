import { describe, expect, it } from "vitest";
import { analyse, confirmatoryRefusal, planFrom, seedClassOf, toCsv, toMarkdown, type Plan } from "./analyse";
import { METRIC_LABEL, STUDIES, type Contrast, type Metric, type RunResult, type Study } from "./studies";

/** A study that exists only here: two conditions, and one contrast of each kind the registry can state. */
function fixture(contrasts: Contrast[]): Study {
  return {
    id: "fixture",
    title: "Fixture",
    registered: true,
    days: 1,
    conditions: [
      { id: "a", label: "condition a", scenario: "first_light", overrides: {} },
      { id: "b", label: "condition b", scenario: "first_light", overrides: {} },
    ],
    contrasts,
    note: "",
  };
}

const zero = (): Record<Metric, number> => Object.fromEntries((Object.keys(METRIC_LABEL) as Metric[]).map((m) => [m, 0])) as Record<Metric, number>;

function run(condition: string, seed: number, metrics: Partial<Record<Metric, number>>): RunResult {
  return { study: "fixture", condition, seed, days: 1, digest: "d", sha256: `${condition}${seed}`, configHash: "c", alive: 1, population: 1, metrics: { ...zero(), ...metrics }, ladder: {}, deaths: {}, ms: 0 };
}

const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Condition a's survival is `shift` above condition b's on every seed, give or take a little that sums to nothing. */
function runs(shift: number, wobble = 0.01): RunResult[] {
  return seeds.flatMap((s, i) => [run("a", s, { survival: 0.5 + shift + (i % 2 ? wobble : -wobble), welfare: 0.6, deliberations: 50 }), run("b", s, { survival: 0.5, welfare: 0.5, deliberations: 100 })]);
}

const greater: Contrast = { id: "g", hypothesis: "T1", metric: "survival", a: "a", b: "b", kind: "difference", predicts: "greater", bound: 0, text: "a is above b" };

describe("study analysis: the registered rule, applied to the interval and to nothing else", () => {
  it("'greater': supported only if the whole interval is above the bound; an interval that includes it counts as falsified, as registered", () => {
    expect(analyse(fixture([greater]), seeds, runs(0.1), 2000).contrasts[0]).toMatchObject({ verdict: "supported", n: 10, predicts: "greater", bound: 0 });
    expect(analyse(fixture([greater]), seeds, runs(0), 2000).contrasts[0]?.verdict).toBe("falsified");
    expect(analyse(fixture([greater]), seeds, runs(-0.1), 2000).contrasts[0]?.verdict).toBe("falsified");
    const r = analyse(fixture([greater]), seeds, runs(0.1), 2000).contrasts[0]!;
    expect(r.interval.estimate).toBeCloseTo(0.1, 10);
    expect(r.interval.lo).toBeLessThanOrEqual(0.1);
    expect(r.interval.hi).toBeGreaterThanOrEqual(0.1);
    expect(r.dz).toBeGreaterThan(5);
    expect(r.cliffsDelta).toBe(1);
  });

  it("'less', 'at-least', 'at-most' and 'two-sided' read the right end of the interval", () => {
    const less: Contrast = { ...greater, id: "l", predicts: "less" };
    expect(analyse(fixture([less]), seeds, runs(-0.1), 2000).contrasts[0]?.verdict).toBe("supported");
    expect(analyse(fixture([less]), seeds, runs(0.1), 2000).contrasts[0]?.verdict).toBe("falsified");
    // a ratio of means: welfare 0.6 against 0.5 is 1.2 on every seed
    const atLeast: Contrast = { ...greater, id: "al", metric: "welfare", kind: "ratio", predicts: "at-least", bound: 0.9 };
    const ratio = analyse(fixture([atLeast]), seeds, runs(0), 2000).contrasts[0]!;
    expect(ratio.interval.estimate).toBeCloseTo(1.2, 10);
    expect(ratio.verdict).toBe("supported");
    expect(Number.isNaN(ratio.p)).toBe(true);
    expect(analyse(fixture([{ ...atLeast, bound: 1.3 }]), seeds, runs(0), 2000).contrasts[0]?.verdict).toBe("falsified");
    // deliberations 50 against 100: half as many
    const atMost: Contrast = { ...greater, id: "am", metric: "deliberations", kind: "ratio", predicts: "at-most", bound: 0.6 };
    expect(analyse(fixture([atMost]), seeds, runs(0), 2000).contrasts[0]?.verdict).toBe("supported");
    expect(analyse(fixture([{ ...atMost, bound: 0.35 }]), seeds, runs(0), 2000).contrasts[0]?.verdict).toBe("not supported");
    const twoSided: Contrast = { ...greater, id: "t", predicts: "two-sided" };
    expect(analyse(fixture([twoSided]), seeds, runs(0.1), 2000).contrasts[0]).toMatchObject({ verdict: "reported" });
    expect(analyse(fixture([twoSided]), seeds, runs(0), 2000).contrasts[0]?.reading).toContain("no difference distinguishable");
  });

  it("gives no verdict on fewer than eight paired seeds", () => {
    const few = seeds.slice(0, 5);
    expect(analyse(fixture([greater]), few, runs(0.1), 2000).contrasts[0]).toMatchObject({ verdict: "too few seeds", n: 5 });
  });

  it("lists every missing cell, pairs only seeds on which both conditions finished, and says so", () => {
    const partial = runs(0.1).filter((r) => !(r.condition === "b" && (r.seed === 3 || r.seed === 7)));
    const report = analyse(fixture([greater]), seeds, partial, 2000);
    expect(report.missing).toEqual([
      { condition: "b", seed: 3 },
      { condition: "b", seed: 7 },
    ]);
    expect(report.runs).toBe(18);
    expect(report.expectedRuns).toBe(20);
    expect(report.contrasts[0]?.n).toBe(8);
    expect(report.conditions.map((c) => c.n)).toEqual([10, 8]);
    expect(report.warnings.some((w) => w.includes("2 of 20 registered cells have no finished run"))).toBe(true);
    expect(toMarkdown(report)).toContain("Missing cells: b@3, b@7");
  });

  it("is reproducible to the last digit, and a different analysis seed changes only the resampled ends", () => {
    const a = analyse(fixture([greater]), seeds, runs(0.1, 0.03), 4000);
    const b = analyse(fixture([greater]), seeds, runs(0.1, 0.03), 4000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = analyse(fixture([greater]), seeds, runs(0.1, 0.03), 4000, 7);
    expect(c.contrasts[0]?.interval.estimate).toBe(a.contrasts[0]?.interval.estimate);
  });

  it("Holm's adjustment across a study's contrasts never makes a p-value smaller", () => {
    const second: Contrast = { ...greater, id: "g2", metric: "welfare" };
    const report = analyse(fixture([greater, second]), seeds, runs(0.02, 0.05), 4000);
    for (const c of report.contrasts) expect(c.pHolm).toBeGreaterThanOrEqual(c.p);
    expect(report.warnings.some((w) => w.includes("2 contrasts in this study"))).toBe(true);
  });
});

describe("study analysis: what kind of evidence a bundle is", () => {
  it("names seeds for what they are: development, holdout, or a mixture that is never confirmatory", () => {
    expect(seedClassOf([1, 2, 3])).toBe("pilot");
    expect(seedClassOf([9000, 9001])).toBe("confirmatory");
    expect(seedClassOf([1, 9000])).toBe("mixed");
    const pilot = analyse(fixture([greater]), seeds, runs(0.1), 1000);
    expect(pilot.seedClass).toBe("pilot");
    expect(pilot.warnings.some((w) => w.includes("They are not a test of any hypothesis"))).toBe(true);
    // a pilot's table never states a verdict as a verdict
    expect(toMarkdown(pilot)).toContain('would read "supported"');
    expect(toMarkdown(pilot)).not.toContain("**supported**");
    const holdout = [9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009];
    const confirmatory = analyse(fixture([greater]), holdout, runs(0.1).map((r) => ({ ...r, seed: r.seed + 8999 })), 1000);
    expect(confirmatory.seedClass).toBe("confirmatory");
    expect(toMarkdown(confirmatory)).toContain("**supported**");
  });

  it("sizes the next batch by precision: a 95% interval of ±0.35 standard deviations takes 32 seeds, whatever the measure", () => {
    const report = analyse(fixture([greater, { ...greater, id: "g2", metric: "welfare" }]), seeds, runs(0.1, 0.04), 2000);
    const plans = planFrom(report);
    expect(plans.map((p) => p.contrast)).toEqual(["g"]); // welfare never varies in the fixture: no spread, nothing to size
    expect(plans[0]?.seeds).toBe(32);
    expect(plans[0]?.targetHalfWidth).toBeCloseTo((plans[0]?.sdDiff ?? 0) * 0.35, 12);
    expect(plans[0]?.pilotHalfWidth).toBeGreaterThan(plans[0]?.targetHalfWidth ?? 0);
    expect(planFrom(report, 0.1)[0]?.seeds).toBe(96); // capped: a study nobody can afford is not a plan
  });

  it("a confirmatory batch is the planned one or it is not run: the planned size, the first holdout seeds, in order", () => {
    const plan: Plan[] = [{ contrast: "g", metric: "survival", sdDiff: 0.1, targetHalfWidth: 0.035, seeds: 32, pilotHalfWidth: 0.06 }];
    const planned = Array.from({ length: 32 }, (_, i) => 9000 + i);
    expect(confirmatoryRefusal(planned, plan)).toBe("");
    expect(confirmatoryRefusal(planned.slice(0, 16), plan)).toContain("fixes 32 seeds");
    expect(confirmatoryRefusal([...planned, 9032], plan)).toContain("fixes 32 seeds");
    expect(confirmatoryRefusal(planned.map((s) => s + 100), plan)).toContain("seeds are not chosen");
    expect(confirmatoryRefusal([...planned.slice(0, 31), 9500], plan)).toContain("seeds are not chosen");
    expect(confirmatoryRefusal(planned, [])).toContain("names no contrast");
  });

  it("the raw table has one row per run and every measure as a column", () => {
    const csv = toCsv(runs(0.1)).trim().split("\n");
    expect(csv.length).toBe(21);
    expect(csv[0]?.split(",").length).toBe(6 + Object.keys(METRIC_LABEL).length + 3);
    expect(csv[1]?.startsWith("fixture,a,1,1,1,1,")).toBe(true);
  });
});

describe("the registered studies are what the protocol registered", () => {
  it("six hypotheses, fourteen conditions, nine contrasts, every contrast between two conditions of its own study", () => {
    expect(STUDIES.map((s) => s.id)).toEqual(["h1-scarcity", "h2-mobility", "h3-communication", "h4-diversity", "h5-cadence", "h6-institutions"]);
    expect(STUDIES.reduce((n, s) => n + s.conditions.length, 0)).toBe(14);
    expect(STUDIES.reduce((n, s) => n + s.contrasts.length, 0)).toBe(9);
    for (const s of STUDIES) {
      expect(s.registered).toBe(true);
      expect(s.days).toBe(40);
      const ids = new Set(s.conditions.map((c) => c.id));
      expect(ids.size).toBe(s.conditions.length);
      for (const c of s.contrasts) {
        expect(ids.has(c.a) && ids.has(c.b) && c.a !== c.b).toBe(true);
        expect(c.metric in METRIC_LABEL).toBe(true);
      }
    }
  });

  it("the thresholds are the registered ones: H5's 0.90 and 0.35, zero everywhere else, no sign predicted for H6b", () => {
    const all = STUDIES.flatMap((s) => s.contrasts);
    const by = (id: string): Contrast => all.find((c) => c.id === id) as Contrast;
    expect(by("h5a")).toMatchObject({ kind: "ratio", predicts: "at-least", bound: 0.9, metric: "welfare" });
    expect(by("h5b")).toMatchObject({ kind: "ratio", predicts: "at-most", bound: 0.35, metric: "deliberations" });
    expect(by("h6a")).toMatchObject({ predicts: "greater", bound: 0, metric: "survival", a: "scripted", b: "off" });
    expect(by("h6b").predicts).toBe("two-sided");
    for (const id of ["h1a", "h1b", "h2", "h3", "h4"]) expect(by(id)).toMatchObject({ kind: "difference", predicts: "greater", bound: 0 });
  });
});
