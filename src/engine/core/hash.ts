/**
 * Hashing.
 *
 *  - StateHasher: fast 64-bit (2×32) rolling digest over integer streams. Used for
 *    per-tick divergence detection during replay. Not cryptographic.
 *  - sha256: pure-TypeScript SHA-256 for content addressing and integrity checks of
 *    snapshots, ledgers and exported bundles. Synchronous and identical in browsers,
 *    workers and Node (WebCrypto would force async call sites and is unavailable in
 *    some worker contexts).
 */

import { fmix32 } from "./rng";

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

export class StateHasher {
  private a = 0x9747b28c;
  private b = 0x3c6ef372;
  private n = 0;

  /** Feed one 32-bit integer (non-integers are truncated; callers should pass integers). */
  int(x: number): this {
    let k = x | 0;
    k = Math.imul(k, C1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, C2);
    this.a ^= k;
    this.a = (this.a << 13) | (this.a >>> 19);
    this.a = (Math.imul(this.a, 5) + 0xe6546b64) | 0;

    let j = (x | 0) ^ 0x5bd1e995;
    j = Math.imul(j, 0x85ebca6b);
    j = (j << 11) | (j >>> 21);
    j = Math.imul(j, 0xc2b2ae35);
    this.b ^= j;
    this.b = (this.b << 17) | (this.b >>> 15);
    this.b = (Math.imul(this.b, 9) + 0x38495ab5) | 0;
    this.n++;
    return this;
  }

  ints(xs: ArrayLike<number>): this {
    for (let i = 0; i < xs.length; i++) this.int(xs[i] as number);
    return this;
  }

  bool(x: boolean): this {
    return this.int(x ? 1 : 0);
  }

  str(s: string): this {
    this.int(s.length);
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
    return this;
  }

  /** 16 lowercase hex characters. */
  digest(): string {
    const x = fmix32(this.a ^ this.n);
    const y = fmix32(this.b ^ Math.imul(this.n, 0x9e3779b1) ^ x);
    return hex32(x) + hex32(y);
  }
}

export function hex32(x: number): string {
  return (x >>> 0).toString(16).padStart(8, "0");
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/** SHA-256 of a byte array, returned as 64 lowercase hex characters. */
export function sha256Hex(data: Uint8Array): string {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = data.length;
  const bitLenHi = Math.floor(len / 0x20000000);
  const bitLenLo = (len << 3) >>> 0;
  const padded = new Uint8Array((((len + 9 + 63) >>> 6) << 6) >>> 0);
  padded.set(data);
  padded[len] = 0x80;
  const end = padded.length;
  padded[end - 8] = (bitLenHi >>> 24) & 0xff;
  padded[end - 7] = (bitLenHi >>> 16) & 0xff;
  padded[end - 6] = (bitLenHi >>> 8) & 0xff;
  padded[end - 5] = bitLenHi & 0xff;
  padded[end - 4] = (bitLenLo >>> 24) & 0xff;
  padded[end - 3] = (bitLenLo >>> 16) & 0xff;
  padded[end - 2] = (bitLenLo >>> 8) & 0xff;
  padded[end - 1] = bitLenLo & 0xff;

  const w = new Uint32Array(64);
  for (let off = 0; off < end; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] =
        (((padded[j] as number) << 24) |
          ((padded[j + 1] as number) << 16) |
          ((padded[j + 2] as number) << 8) |
          (padded[j + 3] as number)) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
    h[5] = ((h[5] as number) + f) >>> 0;
    h[6] = ((h[6] as number) + g) >>> 0;
    h[7] = ((h[7] as number) + hh) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += hex32(h[i] as number);
  return out;
}

/** UTF-8 encoding without relying on platform TextEncoder (kept pure for the engine). */
export function utf8(text: string): Uint8Array {
  // Worst case 3 bytes per UTF-16 code unit (surrogate pairs take 4 bytes for 2 units).
  const out = new Uint8Array(text.length * 3);
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) {
      out[o++] = c;
    } else if (c < 0x800) {
      out[o++] = 0xc0 | (c >> 6);
      out[o++] = 0x80 | (c & 0x3f);
    } else if (c < 0x10000) {
      out[o++] = 0xe0 | (c >> 12);
      out[o++] = 0x80 | ((c >> 6) & 0x3f);
      out[o++] = 0x80 | (c & 0x3f);
    } else {
      out[o++] = 0xf0 | (c >> 18);
      out[o++] = 0x80 | ((c >> 12) & 0x3f);
      out[o++] = 0x80 | ((c >> 6) & 0x3f);
      out[o++] = 0x80 | (c & 0x3f);
    }
  }
  return out.subarray(0, o);
}

export function sha256Text(text: string): string {
  return sha256Hex(utf8(text));
}
