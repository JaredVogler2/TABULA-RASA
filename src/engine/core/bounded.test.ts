import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkExpr } from "../institutions/expr";
import { GRAMMAR_VERSION, LIMITS, type Charter, type Diagnostic, type Expr, type Rule } from "../institutions/types";
import { PAYLOAD_BOUNDS, boundedCopy } from "./bounded";
import { canonicalJson } from "./canonical";

/** Characters of text in the largest charter (names, purposes, and the short words of rules and formulas). */
const TEXT_OF_LARGEST = 3696;

/** A formula of exactly `nodes` nodes, as wide and as deep as the grammar allows. */
function bigExpr(nodes: number, depth: number): Expr {
  if (nodes <= 1 || depth <= 1) return { v: "stock", i: 3 };
  if (nodes >= 4 && depth >= 2) {
    const rest = nodes - 1;
    const a = Math.max(1, Math.floor(rest / 3));
    const b = Math.max(1, Math.floor((rest - a) / 2));
    return { o: "if", a: bigExpr(a, depth - 1), b: bigExpr(b, depth - 1), e: bigExpr(rest - a - b, depth - 1) };
  }
  const left = Math.floor((nodes - 1) / 2);
  return { o: "add", a: bigExpr(left, depth - 1), b: bigExpr(nodes - 1 - left, depth - 1) };
}

/** The largest charter the grammar allows: every list full, every formula as large as it may be. */
function largestCharter(): Charter {
  const formula = bigExpr(LIMITS.exprNodes, LIMITS.exprDepth);
  const rule: Rule = { r: "must_not_gather", who: { t: "others", role: 3 }, kind: 2, within: LIMITS.gatherRadius, over: formula, when: formula, else: { t: "forfeit", qty: LIMITS.forfeit } };
  return {
    grammar: GRAMMAR_VERSION,
    name: "n".repeat(LIMITS.nameChars),
    purpose: "p".repeat(LIMITS.purposeChars),
    minFounders: 2,
    maxMembers: LIMITS.members,
    entry: "vote",
    bond: { item: 3, qty: LIMITS.bondQty },
    roles: Array.from({ length: LIMITS.roles }, (_, i) => ({ name: `${"r".repeat(LIMITS.roleChars - 2)} ${i}`, seats: LIMITS.seats, by: "vote" as const })),
    decide: { rule: "role", role: 3, quorum: 1000 },
    period: LIMITS.periodMax,
    stores: [0, 1, 2, 3].slice(0, LIMITS.stores),
    rules: Array.from({ length: LIMITS.rules }, () => rule),
    days: LIMITS.lifetimeDays,
  };
}

function measure(v: unknown, depth = 0): { nodes: number; depth: number } {
  if (v === null || typeof v !== "object") return { nodes: 1, depth };
  let nodes = 1;
  let deepest = depth + 1;
  const children = Array.isArray(v) ? v : Object.values(v);
  if (!Array.isArray(v)) nodes += children.length; // keys are counted too
  for (const c of children) {
    const m = measure(c, depth + 1);
    nodes += m.nodes;
    deepest = Math.max(deepest, m.depth);
  }
  return { nodes, depth: deepest };
}

describe("boundedCopy: structured data from outside the engine", () => {
  it("the largest charter the grammar allows fits, with room, and comes through unchanged", () => {
    const c = largestCharter();
    const size = measure(c);
    // these two numbers are what PAYLOAD_BOUNDS is sized against
    expect(size.nodes).toBe(4137);
    expect(size.nodes).toBeLessThan(PAYLOAD_BOUNDS.nodes);
    let chars = 0;
    JSON.stringify(c, (_key, v: unknown) => {
      if (typeof v === "string") chars += v.length;
      return v;
    });
    expect(chars).toBe(TEXT_OF_LARGEST);
    expect(chars).toBeLessThan(PAYLOAD_BOUNDS.chars);
    // and the deepest: a formula nested as far as the grammar lets one nest, inside a rule, inside the list of rules
    let chain: Expr = { c: 1 };
    for (let level = 1; level < LIMITS.exprDepth; level++) chain = { o: "not", a: chain };
    const diags: Diagnostic[] = [];
    expect(checkExpr(chain, "", 0, diags)).not.toBeNull();
    expect(checkExpr({ o: "not", a: chain }, "", 0, diags)).toBeNull(); // one level more is already refused
    const deep = measure({ ...c, rules: [{ r: "may_shelter", who: { t: "all" }, when: chain }] });
    expect(deep.depth).toBe(3 + LIMITS.exprDepth);
    expect(deep.depth).toBeLessThanOrEqual(PAYLOAD_BOUNDS.depth);
    expect(LIMITS.purposeChars).toBeLessThanOrEqual(PAYLOAD_BOUNDS.text);
    const copy = boundedCopy(c);
    expect(copy.ok).toBe(true);
    if (copy.ok) expect(canonicalJson(copy.value)).toBe(canonicalJson(c));
  });

  it("refuses what is deeper or larger than that, without recursing into it", () => {
    let deep: unknown = "x";
    for (let i = 0; i < 11_900; i++) deep = [deep];
    expect(boundedCopy({ name: deep })).toEqual({ ok: false });
    expect(boundedCopy(Array.from({ length: PAYLOAD_BOUNDS.nodes + 1 }, () => 0))).toEqual({ ok: false });
    expect(boundedCopy(new Array(1e9))).toEqual({ ok: false });
    const wide: Record<string, number> = {};
    for (let i = 0; i < PAYLOAD_BOUNDS.nodes; i++) wide[`k${i}`] = i; // refused for its size before any key is looked at
    expect(boundedCopy(wide)).toEqual({ ok: false });
  });

  it("keeps plain data only", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined, () => 1, Symbol("s"), 10n, new Date(0), new Map(), new (class Thing {})()]) {
      expect(boundedCopy({ a: [bad] }), String(bad)).toEqual({ ok: false });
    }
    expect(boundedCopy(Object.create(null))).toEqual({ ok: true, value: {} });
    expect(boundedCopy({ a: undefined, b: 1 })).toEqual({ ok: true, value: { b: 1 } });
  });

  it("refuses more text in all than a charter could hold, however it is spread", () => {
    const many = { roles: Array.from({ length: 40 }, () => ({ name: "n".repeat(PAYLOAD_BOUNDS.text) })) };
    expect(40 * PAYLOAD_BOUNDS.text).toBeGreaterThan(PAYLOAD_BOUNDS.chars);
    expect(boundedCopy(many)).toEqual({ ok: false });
    expect(boundedCopy({ roles: many.roles.slice(0, 20) }).ok).toBe(true);
  });

  it("cleans and cuts text, and drops keys that could reach a prototype or are too long to be a field", () => {
    const hostile = JSON.parse(`{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}, "name": "a\\u2028b\\u0000c", "hidden_code": "process.exit()", "secret": {"name": "x"}, "purpose": "${"z".repeat(5000)}"}`) as unknown;
    const copy = boundedCopy(hostile);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    const out = copy.value as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(["name", "purpose"]);
    expect(out.name).toBe("a b c");
    expect((out.purpose as string).length).toBe(PAYLOAD_BOUNDS.text);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it("property: a copy is plain, bounded JSON, and copying it again changes nothing", () => {
    fc.assert(
      fc.property(fc.anything({ maxDepth: 8, withBigInt: true, withDate: true, withMap: true, withNullPrototype: true, withObjectString: true, withSet: true, withTypedArray: true }), (value) => {
        const copy = boundedCopy(value);
        if (!copy.ok) return;
        const text = JSON.stringify(copy.value);
        expect(JSON.parse(text)).toEqual(copy.value);
        const size = measure(copy.value);
        expect(size.depth).toBeLessThanOrEqual(PAYLOAD_BOUNDS.depth);
        expect(size.nodes).toBeLessThanOrEqual(PAYLOAD_BOUNDS.nodes);
        const again = boundedCopy(copy.value);
        expect(again).toEqual({ ok: true, value: copy.value });
      }),
      { numRuns: 400 },
    );
  });
});
