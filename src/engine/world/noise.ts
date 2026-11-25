/**
 * Deterministic gradient noise built only from integer hashing and exact float
 * arithmetic (no trigonometry), so world generation is reproducible on every platform.
 */
import { fade, lerp } from "../core/math";
import { hash3 } from "../core/rng";

function grad(h: number, x: number, y: number): number {
  switch (h & 7) {
    case 0:
      return x + y;
    case 1:
      return -x + y;
    case 2:
      return x - y;
    case 3:
      return -x - y;
    case 4:
      return x * 1.4142135623730951;
    case 5:
      return -x * 1.4142135623730951;
    case 6:
      return y * 1.4142135623730951;
    default:
      return -y * 1.4142135623730951;
  }
}

/** 2D Perlin-style gradient noise, roughly in [-1, 1]. */
export function perlin(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fade(fx);
  const v = fade(fy);
  const n00 = grad(hash3(seed, x0, y0), fx, fy);
  const n10 = grad(hash3(seed, x0 + 1, y0), fx - 1, fy);
  const n01 = grad(hash3(seed, x0, y0 + 1), fx, fy - 1);
  const n11 = grad(hash3(seed, x0 + 1, y0 + 1), fx - 1, fy - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

/** Fractal Brownian motion: `octaves` layers of perlin noise, normalised to about [-1, 1]. */
export function fbm(seed: number, x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * perlin(seed + o * 1013, x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal in [0, 1]: sharp crests where the underlying noise crosses zero. */
export function ridged(seed: number, x: number, y: number, octaves: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = perlin(seed + o * 7919, x * freq, y * freq);
    const r = 1 - (n < 0 ? -n : n);
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}
