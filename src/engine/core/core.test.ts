import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, canonicalJson, deepClone, parseCanonical } from "./canonical";
import { StateHasher, sha256Hex, sha256Text, utf8 } from "./hash";
import { chebyshev, cosTurn, fade, mod, octile10, sat, sinTurn, smoothstep } from "./math";
import { SeqRng, Stream, below, between, chance, hash2, hash3, hash4, seedFromString, stochasticDiv, u32, unit } from "./rng";

describe("rng", () => {
  it("matches golden vectors (changing these breaks every saved world)", () => {
    expect(u32(1, Stream.WorldGen)).toBe(u32(1, Stream.WorldGen));
    const golden = [
      u32(0, Stream.WorldGen, 0, 0, 0, 0),
      u32(1, Stream.Weather, 100, 7, 3, 9),
      u32(0xdeadbeef, Stream.Policy, 123456, 49, 2, 1),
      hash2(1, 2),
      hash3(1, 2, 3),
      hash4(1, 2, 3, 4),
      seedFromString("tabula rasa"),
    ];
    expect(golden).toMatchInlineSnapshot(`
      [
        2256595947,
        2468270822,
        2814708655,
        1234251883,
        2641906903,
        3076014444,
        1253303830,
      ]
    `);
  });

  it("is sensitive to every key position", () => {
    const base = u32(5, Stream.Policy, 1, 2, 3, 4);
    expect(u32(6, Stream.Policy, 1, 2, 3, 4)).not.toBe(base);
    expect(u32(5, Stream.Gather, 1, 2, 3, 4)).not.toBe(base);
    expect(u32(5, Stream.Policy, 2, 2, 3, 4)).not.toBe(base);
    expect(u32(5, Stream.Policy, 1, 3, 3, 4)).not.toBe(base);
    expect(u32(5, Stream.Policy, 1, 2, 4, 4)).not.toBe(base);
    expect(u32(5, Stream.Policy, 1, 2, 3, 5)).not.toBe(base);
    // argument order matters
    expect(u32(5, Stream.Policy, 2, 1, 3, 4)).not.toBe(base);
  });

  it("produces approximately uniform, uncorrelated streams", () => {
    const N = 40_000;
    const buckets = new Array(16).fill(0);
    let sum = 0;
    let cross = 0;
    for (let i = 0; i < N; i++) {
      const a = unit(42, Stream.Weather, i);
      const b = unit(42, Stream.Regrowth, i);
      buckets[Math.floor(a * 16)]++;
      sum += a;
      cross += (a - 0.5) * (b - 0.5);
    }
    expect(sum / N).toBeGreaterThan(0.49);
    expect(sum / N).toBeLessThan(0.51);
    const expected = N / 16;
    let chi = 0;
    for (const c of buckets) chi += ((c - expected) * (c - expected)) / expected;
    // 15 degrees of freedom: p=0.001 critical value is 37.7
    expect(chi).toBeLessThan(37.7);
    // correlation between independent streams should be ~0 (sd of estimate ≈ 1/(12·sqrt(N)))
    expect(Math.abs(cross / N)).toBeLessThan(0.003);
  });

  it("below/between stay in range and cover it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 - 1 }), fc.integer(), fc.integer(), (n, seed, k) => {
        const v = below(n, seed, Stream.Lab, k);
        return Number.isInteger(v) && v >= 0 && v < n;
      }),
    );
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(between(-2, 3, 9, Stream.Lab, i));
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3]);
  });

  it("below is unbiased for a non-power-of-two modulus", () => {
    const counts = [0, 0, 0];
    const N = 60_000;
    for (let i = 0; i < N; i++) counts[below(3, 77, Stream.Lab, i)]!++;
    for (const c of counts) expect(Math.abs(c - N / 3)).toBeLessThan(600);
  });

  it("chance and stochasticDiv have the right expectation", () => {
    let hits = 0;
    let total = 0;
    const N = 50_000;
    for (let i = 0; i < N; i++) {
      if (chance(3, 10, 5, Stream.Spoilage, i)) hits++;
      total += stochasticDiv(7, 4, 5, Stream.Regrowth, i);
    }
    expect(hits / N).toBeGreaterThan(0.29);
    expect(hits / N).toBeLessThan(0.31);
    expect(total / N).toBeGreaterThan(1.74);
    expect(total / N).toBeLessThan(1.76);
    expect(chance(0, 10, 1, Stream.Lab)).toBe(false);
    expect(chance(10, 10, 1, Stream.Lab)).toBe(true);
    expect(stochasticDiv(8, 4, 1, Stream.Lab)).toBe(2);
  });

  it("SeqRng is reproducible and shuffle is a permutation", () => {
    const a = new SeqRng(3, Stream.WorldGen, 1);
    const b = new SeqRng(3, Stream.WorldGen, 1);
    const xs = Array.from({ length: 20 }, () => a.nextU32());
    const ys = Array.from({ length: 20 }, () => b.nextU32());
    expect(xs).toEqual(ys);
    const deck = Array.from({ length: 50 }, (_, i) => i);
    const shuffled = new SeqRng(9, Stream.Spawn).shuffle(deck.slice());
    expect(shuffled.slice().sort((p, q) => p - q)).toEqual(deck);
    expect(shuffled).not.toEqual(deck);
  });
});

describe("hash", () => {
  it("sha256 matches FIPS 180-4 test vectors", () => {
    expect(sha256Text("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Text("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    const million = new Uint8Array(1_000_000).fill(0x61);
    expect(sha256Hex(million)).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("utf8 agrees with TextEncoder for arbitrary strings", () => {
    const enc = new TextEncoder();
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 40 }), (s) => {
        // TextEncoder replaces lone surrogates; restrict to well-formed strings.
        const wellFormed = s.toWellFormed();
        expect(Array.from(utf8(wellFormed))).toEqual(Array.from(enc.encode(wellFormed)));
      }),
    );
  });

  it("StateHasher is deterministic and order sensitive", () => {
    const h1 = new StateHasher().int(1).int(2).str("a").digest();
    const h2 = new StateHasher().int(1).int(2).str("a").digest();
    const h3 = new StateHasher().int(2).int(1).str("a").digest();
    const h4 = new StateHasher().int(1).int(2).str("b").digest();
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).not.toBe(h4);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });

  it("StateHasher detects single-value changes across a large state", () => {
    const base = new Int32Array(5000).map((_, i) => i * 7);
    const d0 = new StateHasher().ints(base).digest();
    const seen = new Set<string>([d0]);
    for (let i = 0; i < 5000; i += 37) {
      const copy = base.slice();
      copy[i] = (copy[i] as number) + 1;
      seen.add(new StateHasher().ints(copy).digest());
    }
    expect(seen.size).toBe(1 + Math.ceil(5000 / 37));
  });
});

describe("canonical", () => {
  it("is independent of key insertion order and omits undefined", () => {
    const a = { z: 1, a: { y: [1, 2, { q: true, p: null }], x: "s" }, u: undefined };
    const b = { a: { x: "s", y: [1, 2, { p: null, q: true }] }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"x":"s","y":[1,2,{"p":null,"q":true}]},"z":1}');
  });

  it("round-trips typed arrays exactly", () => {
    const value = {
      i16: new Int16Array([-32768, -1, 0, 1, 32767]),
      u8: new Uint8Array([0, 127, 255]),
      i32: new Int32Array([-2147483648, 2147483647, 42]),
      u32: new Uint32Array([0, 4294967295]),
      u16: new Uint16Array([65535, 1]),
      i8: new Int8Array([-128, 127]),
    };
    const text = canonicalJson(value);
    const back = parseCanonical<typeof value>(text);
    expect(back.i16).toBeInstanceOf(Int16Array);
    expect(Array.from(back.i16)).toEqual(Array.from(value.i16));
    expect(Array.from(back.u8)).toEqual(Array.from(value.u8));
    expect(Array.from(back.i32)).toEqual(Array.from(value.i32));
    expect(Array.from(back.u32)).toEqual(Array.from(value.u32));
    expect(Array.from(back.u16)).toEqual(Array.from(value.u16));
    expect(Array.from(back.i8)).toEqual(Array.from(value.i8));
    expect(canonicalJson(back)).toBe(text);
  });

  it("rejects values that would make hashes ambiguous", () => {
    expect(() => canonicalJson({ a: NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ a: Infinity })).toThrow(/non-finite/);
    expect(() => canonicalJson([undefined])).toThrow(/undefined/);
    expect(() => canonicalJson({ a: new Map() })).toThrow(/non-plain/);
    expect(() => canonicalJson({ a: new Date(0) })).toThrow(/non-plain/);
    expect(() => canonicalJson({ a: () => 1 })).toThrow(/unsupported/);
    expect(canonicalJson({ a: -0 })).toBe('{"a":0}');
  });

  it("base64 round-trips arbitrary bytes and rejects malformed input", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        const text = bytesToBase64(bytes);
        expect(text).toBe(Buffer.from(bytes).toString("base64"));
        expect(Array.from(base64ToBytes(text))).toEqual(Array.from(bytes));
      }),
    );
    expect(() => base64ToBytes("abc")).toThrow();
    expect(() => base64ToBytes("ab!d")).toThrow();
    expect(() => base64ToBytes("=abc")).toThrow();
  });

  it("canonical JSON round-trips arbitrary plain data", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const text = canonicalJson(v);
        expect(canonicalJson(parseCanonical(text))).toBe(text);
      }),
    );
  });

  it("deepClone copies typed arrays and nested structures without aliasing", () => {
    const src = { a: [1, { b: new Int16Array([1, 2, 3]) }], c: "x" };
    const copy = deepClone(src);
    expect(canonicalJson(copy)).toBe(canonicalJson(src));
    (copy.a[1] as { b: Int16Array }).b[0] = 99;
    expect((src.a[1] as { b: Int16Array }).b[0]).toBe(1);
  });
});

describe("math", () => {
  it("sinTurn approximates sine within 0.002 everywhere", () => {
    let worst = 0;
    for (let i = -2000; i <= 2000; i++) {
      const t = i / 1000;
      worst = Math.max(worst, Math.abs(sinTurn(t) - Math.sin(2 * Math.PI * t)));
      worst = Math.max(worst, Math.abs(cosTurn(t) - Math.cos(2 * Math.PI * t)));
    }
    expect(worst).toBeLessThan(0.002);
    expect(sinTurn(0)).toBe(0);
    expect(sinTurn(0.25)).toBe(1);
    expect(sinTurn(0.75)).toBe(-1);
  });

  it("basic helpers behave", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(fade(0)).toBe(0);
    expect(fade(1)).toBe(1);
    expect(mod(-1, 5)).toBe(4);
    expect(chebyshev(0, 0, 3, -5)).toBe(5);
    expect(octile10(0, 0, 3, 5)).toBe(62);
    expect(sat(1e12)).toBe(1_000_000_000);
    expect(sat(-1e12)).toBe(-1_000_000_000);
    expect(sat(NaN)).toBe(0);
    expect(sat(2.9)).toBe(2);
  });
});
