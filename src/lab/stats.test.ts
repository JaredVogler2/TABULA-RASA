import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bootstrapMean, bootstrapP, bootstrapRatio, cliffsDelta, differenceInDifferences, dz, gini, halfWidthFor, holm, mean, paired, quantile, rng, sd, seedsForHalfWidth } from "./stats";

describe("lab statistics: fixtures with known answers", () => {
  it("mean, standard deviation and quantiles", () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    // sample SD of that classic series is sqrt(32/7)
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(sd([3])).toBeNaN();
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([10, 20, 30], 0.25)).toBe(15);
  });

  it("paired differences and the standardized paired effect", () => {
    const a = [10, 12, 9, 14, 11];
    const b = [8, 11, 9, 10, 9];
    const d = paired(a, b);
    expect(d).toEqual([2, 1, 0, 4, 2]);
    expect(mean(d)).toBe(1.8);
    // sd of [2,1,0,4,2] = sqrt(8.8/4)
    expect(dz(d)).toBeCloseTo(1.8 / Math.sqrt(8.8 / 4), 12);
    expect(dz([0, 0, 0])).toBe(0);
    expect(() => paired([1, 2], [1])).toThrow(/equal numbers/);
  });

  it("Cliff's delta: complete separation, none, and a hand-counted case", () => {
    expect(cliffsDelta([5, 6, 7], [1, 2, 3])).toBe(1);
    expect(cliffsDelta([1, 2, 3], [5, 6, 7])).toBe(-1);
    expect(cliffsDelta([1, 2, 3], [1, 2, 3])).toBe(0);
    // pairs (a,b): 1 vs {2,3}: less,less; 4 vs {2,3}: more,more; 3 vs {2,3}: more, tie → (3 − 2) / 6
    expect(cliffsDelta([1, 4, 3], [2, 3])).toBeCloseTo(1 / 6, 12);
  });

  it("Holm's step-down adjustment (worked example)", () => {
    // sorted: 0.01, 0.02, 0.03, 0.2 → ×4, ×3, ×2, ×1 = 0.04, 0.06, 0.06, 0.2
    const adj = holm([0.03, 0.01, 0.2, 0.02]);
    expect(adj[1]).toBeCloseTo(0.04, 12);
    expect(adj[3]).toBeCloseTo(0.06, 12);
    expect(adj[0]).toBeCloseTo(0.06, 12);
    expect(adj[2]).toBeCloseTo(0.2, 12);
    // never above 1, and monotone in the order of the raw values
    expect(holm([0.5, 0.6, 0.9])).toEqual([1, 1, 1]);
  });

  it("precision planning: seeds for a half-width, and back", () => {
    // z·sd/h = 1.96·10/5 = 3.92 → 15.4 → 16
    expect(seedsForHalfWidth(10, 5)).toBe(16);
    expect(seedsForHalfWidth(0, 5)).toBe(8);
    expect(halfWidthFor(10, 16)).toBeCloseTo((1.959964 * 10) / 4, 9);
    expect(seedsForHalfWidth(10, 0)).toBeNaN();
  });

  it("difference in differences", () => {
    expect(differenceInDifferences([10, 20], [15, 22], [10, 20], [12, 21])).toEqual([3, 1]);
    expect(() => differenceInDifferences([1], [1, 2], [1], [1])).toThrow();
  });

  it("Gini: equality, one holder, a hand-computed case, and the degenerate cases", () => {
    expect(gini([5, 5, 5, 5])).toBe(0);
    expect(gini([0, 0, 0, 12])).toBeCloseTo(0.75, 12);
    // [1,2,3,4]: sum of (2i−n−1)x = −3−2+3+12 = 10; / (4·10) = 0.25
    expect(gini([1, 2, 3, 4])).toBeCloseTo(0.25, 12);
    expect(gini([0, 0, 0])).toBe(0);
    expect(gini([7])).toBe(0);
  });
});

describe("lab statistics: resampling", () => {
  it("is deterministic: the same data and seed give the same interval to the last digit", () => {
    const xs = [1.2, -0.4, 0.8, 2.1, 0.3, 1.7, -0.2, 0.9, 1.1, 0.5];
    expect(bootstrapMean(xs)).toEqual(bootstrapMean(xs));
    expect(bootstrapMean(xs, 2000, 7)).not.toEqual(bootstrapMean(xs, 2000, 8));
    const first = rng(42);
    const again = rng(42);
    for (let i = 0; i < 20; i++) expect(first()).toBe(again());
  });

  it("the interval contains the estimate, narrows with more units, and is absent for a single unit", () => {
    const next = rng(5);
    const sample = (n: number) => Array.from({ length: n }, () => next() * 10);
    const small = bootstrapMean(sample(10), 4000);
    const large = bootstrapMean(sample(160), 4000);
    expect(small.lo).toBeLessThanOrEqual(small.estimate);
    expect(small.hi).toBeGreaterThanOrEqual(small.estimate);
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
    const one = bootstrapMean([3]);
    expect(one.estimate).toBe(3);
    expect(one.lo).toBeNaN();
  });

  it("covers a known mean about as often as it claims to (200 samples of 30 from a uniform, nominal 95%)", () => {
    const next = rng(99);
    let covered = 0;
    for (let s = 0; s < 200; s++) {
      const xs = Array.from({ length: 30 }, () => next());
      const ci = bootstrapMean(xs, 1000, 1000 + s);
      if (ci.lo <= 0.5 && ci.hi >= 0.5) covered++;
    }
    // percentile bootstrap under-covers slightly at n = 30; anything from 88% to 99% is consistent with a working interval
    expect(covered).toBeGreaterThanOrEqual(176);
    expect(covered).toBeLessThanOrEqual(198);
  });

  it("a constant difference has a degenerate interval and the smallest possible p; a centred one does not look significant", () => {
    const shift = bootstrapMean([2, 2, 2, 2, 2, 2], 2000);
    expect(shift).toMatchObject({ estimate: 2, lo: 2, hi: 2, n: 6 });
    const none = bootstrapP([1, -1, 2, -2, 0.5, -0.5, 1.5, -1.5], 4000);
    expect(none).toBeGreaterThan(0.5);
    const strong = bootstrapP([2.1, 1.9, 2.3, 1.8, 2.2, 2.0, 1.7, 2.4], 4000);
    expect(strong).toBeLessThan(0.01);
  });

  it("ratio of paired means: exact when proportional, and bracketing the estimate otherwise", () => {
    const b = [10, 12, 8, 11, 9, 13];
    const exact = bootstrapRatio(b.map((x) => x * 0.9), b, 2000);
    expect(exact.estimate).toBeCloseTo(0.9, 12);
    expect(exact.lo).toBeCloseTo(0.9, 9);
    expect(exact.hi).toBeCloseTo(0.9, 9);
    const noisy = bootstrapRatio([9, 12, 7, 10, 9, 11], b, 2000);
    expect(noisy.lo).toBeLessThan(noisy.estimate);
    expect(noisy.hi).toBeGreaterThan(noisy.estimate);
  });

  it("properties: delta is antisymmetric and bounded; Holm never lowers a p-value; Gini lies in [0, 1)", () => {
    const nums = fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), { minLength: 1, maxLength: 12 });
    fc.assert(
      fc.property(nums, nums, (a, b) => {
        const d = cliffsDelta(a, b);
        expect(d).toBeGreaterThanOrEqual(-1);
        expect(d).toBeLessThanOrEqual(1);
        expect(cliffsDelta(b, a)).toBeCloseTo(-d, 12);
      }),
    );
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 10 }), (ps) => {
        const adj = holm(ps);
        ps.forEach((p, i) => {
          expect(adj[i] as number).toBeGreaterThanOrEqual(p - 1e-12);
          expect(adj[i] as number).toBeLessThanOrEqual(1);
        });
      }),
    );
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1e6, noNaN: true }), { minLength: 0, maxLength: 20 }), (v) => {
        const g = gini(v);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThan(1);
      }),
    );
  });
});
