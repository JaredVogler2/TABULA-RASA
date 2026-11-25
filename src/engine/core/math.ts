/**
 * Deterministic arithmetic helpers.
 *
 * The engine never calls transcendental Math functions (sin, exp, pow, ...) because
 * their results are implementation-defined and can differ between JavaScript engines
 * in the last bit. Everything here is built from +, -, *, /, floor and sqrt, which
 * IEEE-754 defines exactly.
 */

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clampInt(x: number, lo: number, hi: number): number {
  const v = Math.trunc(x);
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Quintic fade (Perlin's improved interpolant): zero first and second derivative at 0 and 1. */
export function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Floor division for integers (rounds toward negative infinity). */
export function idiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** a * b / c in integers, floored. Safe while |a*b| < 2^53. */
export function mulDiv(a: number, b: number, c: number): number {
  return Math.floor((a * b) / c);
}

/** Positive modulo. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * Sine of an angle given in turns (1 turn = 2π), using Bhaskara I's rational
 * approximation (max error ≈ 0.0016). Deterministic; adequate for seasonal and diurnal curves.
 */
export function sinTurn(turns: number): number {
  let t = turns - Math.floor(turns); // [0,1)
  let sign = 1;
  if (t > 0.5) {
    t -= 0.5;
    sign = -1;
  }
  // t in [0, 0.5] maps to x in [0, π]; with x = 2πt: sin x ≈ 16x(π−x) / (5π² − 4x(π−x))
  const p = t * (0.5 - t); // = x(π−x)/(4π²)
  return (sign * (16 * p)) / (1.25 - 4 * p);
}

export function cosTurn(turns: number): number {
  return sinTurn(turns + 0.25);
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax > bx ? ax - bx : bx - ax;
  const dy = ay > by ? ay - by : by - ay;
  return dx > dy ? dx : dy;
}

export function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return (ax > bx ? ax - bx : bx - ax) + (ay > by ? ay - by : by - ay);
}

export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Octile distance scaled by 10 (straight = 10, diagonal = 14): an admissible integer
 * heuristic for 8-connected grids.
 */
export function octile10(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax > bx ? ax - bx : bx - ax;
  const dy = ay > by ? ay - by : by - ay;
  return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx;
}

/** Saturating integer add used by the institution expression evaluator. */
export const SAT_MAX = 1_000_000_000;
export function sat(x: number): number {
  if (x !== x) return 0; // NaN
  if (x > SAT_MAX) return SAT_MAX;
  if (x < -SAT_MAX) return -SAT_MAX;
  return Math.trunc(x);
}

/** Integer percentile helper for sorted arrays (nearest-rank). */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const rank = clampInt(Math.ceil(p * n) - 1, 0, n - 1);
  return sorted[rank] as number;
}
