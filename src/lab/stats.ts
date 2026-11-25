/**
 * Statistics for matched-seed studies, as registered in docs/EXPERIMENT_PROTOCOL.md §7.
 *
 * Every function is pure and deterministic: resampling uses a seeded generator, so a report
 * recomputed from the same per-run tables is identical to the digit. Nothing here knows what
 * a world is; inputs are numbers paired by seed.
 */

/** A small, well-mixed generator (mulberry32). Analysis only: the simulation has its own keyed streams. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n − 1). NaN for fewer than two values. */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return Number.NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/** Quantile by linear interpolation between order statistics (type 7). */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const h = (sorted.length - 1) * Math.max(0, Math.min(1, p));
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (h - lo);
}

export interface Interval {
  estimate: number;
  lo: number;
  hi: number;
  /** Number of units (seeds) the estimate rests on. */
  n: number;
}

/**
 * Percentile bootstrap interval for the mean of `xs` (resampling units with replacement).
 * With fewer than two units there is no interval: lo and hi are NaN.
 */
export function bootstrapMean(xs: readonly number[], resamples = 10_000, seed = 20261125, level = 0.95): Interval {
  const n = xs.length;
  const estimate = mean(xs);
  if (n < 2) return { estimate, lo: Number.NaN, hi: Number.NaN, n };
  const next = rng(seed);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[Math.floor(next() * n)] as number;
    means[r] = s / n;
  }
  const sorted = Array.from(means).sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  return { estimate, lo: quantile(sorted, alpha), hi: quantile(sorted, 1 - alpha), n };
}

/**
 * Percentile bootstrap interval for the ratio of two paired means, mean(a) / mean(b),
 * resampling seeds (pairs) with replacement. Used for non-inferiority margins.
 */
export function bootstrapRatio(a: readonly number[], b: readonly number[], resamples = 10_000, seed = 20261125, level = 0.95): Interval {
  const n = Math.min(a.length, b.length);
  const estimate = mean(a.slice(0, n)) / mean(b.slice(0, n));
  if (n < 2) return { estimate, lo: Number.NaN, hi: Number.NaN, n };
  const next = rng(seed);
  const ratios: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.floor(next() * n);
      sa += a[k] as number;
      sb += b[k] as number;
    }
    if (sb !== 0) ratios.push(sa / sb);
  }
  ratios.sort((x, y) => x - y);
  const alpha = (1 - level) / 2;
  return { estimate, lo: quantile(ratios, alpha), hi: quantile(ratios, 1 - alpha), n };
}

/** Differences a[i] − b[i] for values paired by position (the same seed in both conditions). */
export function paired(a: readonly number[], b: readonly number[]): number[] {
  if (a.length !== b.length) throw new Error(`paired values must come in equal numbers (${a.length} and ${b.length})`);
  return a.map((x, i) => x - (b[i] as number));
}

/** Standardized paired effect size: mean difference over the standard deviation of differences. */
export function dz(differences: readonly number[]): number {
  const s = sd(differences);
  if (!(s > 0)) return mean(differences) === 0 ? 0 : Number.NaN;
  return mean(differences) / s;
}

/**
 * Cliff's delta for paired samples treated as two groups: P(a > b) − P(a < b) over all cross
 * pairs. Distribution-free companion to d_z; −1 … 1.
 */
export function cliffsDelta(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return Number.NaN;
  let more = 0;
  let less = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) more++;
      else if (x < y) less++;
    }
  }
  return (more - less) / (a.length * b.length);
}

/**
 * Two-sided bootstrap p-value for "the mean paired difference is zero": resample the
 * differences recentred on zero and count means at least as far from zero as the observed one.
 * (Used only to order hypotheses for Holm's procedure; decisions are stated on intervals.)
 */
export function bootstrapP(differences: readonly number[], resamples = 10_000, seed = 20261125): number {
  const n = differences.length;
  if (n < 2) return Number.NaN;
  const observed = Math.abs(mean(differences));
  const centre = mean(differences);
  const next = rng(seed ^ 0x5bd1e995);
  let extreme = 0;
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += (differences[Math.floor(next() * n)] as number) - centre;
    if (Math.abs(s / n) >= observed - 1e-12) extreme++;
  }
  return (extreme + 1) / (resamples + 1);
}

/** Holm's step-down procedure: adjusted p-values in the input order, each capped at 1 and monotone. */
export function holm(ps: readonly number[]): number[] {
  const order = ps.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const m = ps.length;
  const adjusted = new Array<number>(m).fill(Number.NaN);
  let running = 0;
  order.forEach(({ p, i }, rank) => {
    const value = Number.isNaN(p) ? Number.NaN : Math.min(1, (m - rank) * p);
    running = Number.isNaN(value) ? running : Math.max(running, value);
    adjusted[i] = Number.isNaN(value) ? Number.NaN : running;
  });
  return adjusted;
}

/**
 * Precision before power: how many seeds are needed for a 95% interval on a mean paired
 * difference to have the given half-width, when differences have standard deviation `sdDiff`.
 * Normal approximation, n = (z · sd / h)², rounded up, never fewer than 8.
 */
export function seedsForHalfWidth(sdDiff: number, halfWidth: number, z = 1.959964): number {
  if (!(sdDiff >= 0) || !(halfWidth > 0)) return Number.NaN;
  return Math.max(8, Math.ceil(((z * sdDiff) / halfWidth) ** 2));
}

/** The half-width a 95% interval would have with `n` seeds, by the same approximation. */
export function halfWidthFor(sdDiff: number, n: number, z = 1.959964): number {
  return n > 0 ? (z * sdDiff) / Math.sqrt(n) : Number.NaN;
}

/** Difference in differences: (treated after − treated before) − (control after − control before), per unit. */
export function differenceInDifferences(treatedBefore: readonly number[], treatedAfter: readonly number[], controlBefore: readonly number[], controlAfter: readonly number[]): number[] {
  const n = treatedBefore.length;
  if (treatedAfter.length !== n || controlBefore.length !== n || controlAfter.length !== n) throw new Error("difference in differences needs the same units in all four series");
  return treatedBefore.map((_, i) => (treatedAfter[i] as number) - (treatedBefore[i] as number) - ((controlAfter[i] as number) - (controlBefore[i] as number)));
}

/** Gini coefficient of non-negative values; 0 when the total is 0 or there are fewer than two. */
export function gini(values: readonly number[]): number {
  const v = values.filter((x) => x >= 0).sort((a, b) => a - b);
  const n = v.length;
  const total = v.reduce((s, x) => s + x, 0);
  if (n < 2 || total === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * (v[i] as number);
  return acc / (n * total);
}
