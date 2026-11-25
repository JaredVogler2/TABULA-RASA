/**
 * Counter-based, keyed pseudo-random numbers.
 *
 * Every random draw in the simulation is a pure function of
 * (world seed, stream, up to four integer keys) — typically (tick, entity id, purpose, n).
 * There is no hidden generator state, so:
 *   - iteration order can never perturb another entity's randomness,
 *   - replay from any snapshot reproduces the same draws,
 *   - two branches forked from one history can share exogenous randomness
 *     ("common random numbers") or be decorrelated by changing the RNG epoch key.
 *
 * The mixing function is MurmurHash3 x86_32 applied to the sequence of 32-bit keys.
 * Only Math.imul, shifts, xor and adds are used, so results are bit-identical on every
 * conforming JavaScript engine.
 */

/** Named random streams. Values are stable identifiers; never renumber, only append. */
export const Stream = {
  WorldGen: 1,
  Terrain: 2,
  Hydrology: 3,
  Nodes: 4,
  Spawn: 5,
  Traits: 6,
  Names: 7,
  Weather: 8,
  Regrowth: 9,
  Spoilage: 10,
  Arbitration: 11,
  Policy: 12,
  Illness: 13,
  Gather: 14,
  Institution: 15,
  Scheduler: 16,
  Perception: 17,
  Mock: 18,
  Lab: 19,
  Decay: 20,
  Evolution: 21,
} as const;
export type StreamId = (typeof Stream)[keyof typeof Stream];

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

function round(h: number, k: number): number {
  k = Math.imul(k, C1);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, C2);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/** MurmurHash3 finaliser: full avalanche of a 32-bit value. */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash of two 32-bit integers. */
export function hash2(a: number, b: number): number {
  let h = round(0x2f6b1a3d, a);
  h = round(h, b);
  return fmix32(h ^ 8);
}

/** Hash of three 32-bit integers. */
export function hash3(a: number, b: number, c: number): number {
  let h = round(0x2f6b1a3d, a);
  h = round(h, b);
  h = round(h, c);
  return fmix32(h ^ 12);
}

/** Hash of four 32-bit integers. */
export function hash4(a: number, b: number, c: number, d: number): number {
  let h = round(0x2f6b1a3d, a);
  h = round(h, b);
  h = round(h, c);
  h = round(h, d);
  return fmix32(h ^ 16);
}

/**
 * Uniform unsigned 32-bit draw for (seed, stream, k1, k2, k3, k4).
 * Unused keys default to 0. This is the single primitive every other draw is built on.
 */
export function u32(seed: number, stream: StreamId, k1 = 0, k2 = 0, k3 = 0, k4 = 0): number {
  let h = round(0x2f6b1a3d, seed);
  h = round(h, stream);
  h = round(h, k1);
  h = round(h, k2);
  h = round(h, k3);
  h = round(h, k4);
  return fmix32(h ^ 24);
}

const INV_2_32 = 1 / 4294967296;

/** Uniform float in [0, 1). Exactly representable: a 32-bit integer times 2^-32. */
export function unit(seed: number, stream: StreamId, k1 = 0, k2 = 0, k3 = 0, k4 = 0): number {
  return u32(seed, stream, k1, k2, k3, k4) * INV_2_32;
}

/** Uniform integer in [0, n). n must be in 1..2^31. Uses the exact multiply-shift method. */
export function below(n: number, seed: number, stream: StreamId, k1 = 0, k2 = 0, k3 = 0, k4 = 0): number {
  if (n <= 1) return 0;
  // u32 * n < 2^63 is not exactly representable in a double for large n, so split the multiply.
  const r = u32(seed, stream, k1, k2, k3, k4);
  const hi = (r >>> 16) * n;
  const lo = (r & 0xffff) * n;
  return Math.floor((hi + Math.floor(lo / 65536)) / 65536);
}

/** Uniform integer in [lo, hi] inclusive. */
export function between(lo: number, hi: number, seed: number, stream: StreamId, k1 = 0, k2 = 0, k3 = 0, k4 = 0): number {
  return lo + below(hi - lo + 1, seed, stream, k1, k2, k3, k4);
}

/** Bernoulli trial with probability p = numer/denom, evaluated in integers. */
export function chance(
  numer: number,
  denom: number,
  seed: number,
  stream: StreamId,
  k1 = 0,
  k2 = 0,
  k3 = 0,
  k4 = 0,
): boolean {
  if (numer <= 0) return false;
  if (numer >= denom) return true;
  return below(denom, seed, stream, k1, k2, k3, k4) < numer;
}

/**
 * Stochastic rounding of a rational quantity numer/denom to an integer whose
 * expectation equals the exact value. Used for sub-unit rates (regrowth, spoilage).
 */
export function stochasticDiv(
  numer: number,
  denom: number,
  seed: number,
  stream: StreamId,
  k1 = 0,
  k2 = 0,
  k3 = 0,
  k4 = 0,
): number {
  if (denom <= 0) return 0;
  const q = Math.floor(numer / denom);
  const rem = numer - q * denom;
  if (rem === 0) return q;
  return q + (below(denom, seed, stream, k1, k2, k3, k4) < rem ? 1 : 0);
}

/**
 * A small sequential generator for code that needs many draws in a fixed order
 * (world generation). It is a thin counter over the keyed primitive, so it stays
 * reproducible and independent of every other stream.
 */
export class SeqRng {
  private n = 0;
  constructor(
    private readonly seed: number,
    private readonly stream: StreamId,
    private readonly key = 0,
  ) {}
  nextU32(): number {
    return u32(this.seed, this.stream, this.key, this.n++);
  }
  unit(): number {
    return this.nextU32() * INV_2_32;
  }
  below(n: number): number {
    return below(n, this.seed, this.stream, this.key, this.n++);
  }
  between(lo: number, hi: number): number {
    return lo + this.below(hi - lo + 1);
  }
  chance(numer: number, denom: number): boolean {
    return this.below(denom) < numer;
  }
  /** Approximately normal draw (Irwin–Hall, 4 uniforms), mean 0, sd 1. Arithmetic only. */
  normalish(): number {
    const s = this.unit() + this.unit() + this.unit() + this.unit();
    return (s - 2) * 1.7320508075688772;
  }
  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error("SeqRng.pick: empty array");
    return xs[this.below(xs.length)] as T;
  }
  /** In-place Fisher–Yates shuffle. */
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = this.below(i + 1);
      const t = xs[i] as T;
      xs[i] = xs[j] as T;
      xs[j] = t;
    }
    return xs;
  }
}

/** FNV-1a hash of a string to an unsigned 32-bit seed (used for human-readable seeds). */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= text.charCodeAt(i) >>> 8;
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h);
}
