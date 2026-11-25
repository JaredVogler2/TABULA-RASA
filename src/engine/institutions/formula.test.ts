import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ITEMS, ITEM_COUNT } from "../model/constants";
import { checkExpr } from "./expr";
import { FORMULA_MAX_CHARS, formatFormula, parseFormula } from "./formula";
import { BINARY_OPS, LIMITS, type Diagnostic, type Expr } from "./types";

const parse = (text: string, roles: string[] = []) => parseFormula(text, ITEMS, roles);
const tree = (text: string, roles: string[] = []): Expr => {
  const r = parse(text, roles);
  if (!r.ok) throw new Error(`${r.code} at ${r.at}: ${r.message}`);
  return r.expr;
};

describe("formulas written as text", () => {
  it("reads arithmetic with the usual precedence, left to right", () => {
    expect(tree("1 + 2 * 3")).toEqual({ o: "add", a: { c: 1 }, b: { o: "mul", a: { c: 2 }, b: { c: 3 } } });
    expect(tree("8 - 2 - 1")).toEqual({ o: "sub", a: { o: "sub", a: { c: 8 }, b: { c: 2 } }, b: { c: 1 } });
    expect(tree("(1 + 2) * 3")).toEqual({ o: "mul", a: { o: "add", a: { c: 1 }, b: { c: 2 } }, b: { c: 3 } });
    expect(tree("members / 2")).toEqual({ o: "div", a: { v: "members" }, b: { c: 2 } });
    expect(tree("-3")).toEqual({ c: -3 });
    expect(tree("-members")).toEqual({ o: "sub", a: { c: 0 }, b: { v: "members" } });
  });

  it("reads comparisons, connectives, conditionals and the facts a rule may see", () => {
    expect(tree("season = winter")).toEqual({ o: "eq", a: { v: "season" }, b: { c: 3 } });
    expect(tree("if(season == WINTER, 1, 3)")).toEqual({ o: "if", a: { o: "eq", a: { v: "season" }, b: { c: 3 } }, b: { c: 1 }, e: { c: 3 } });
    expect(tree("stock(food) > members * 2 and not night")).toEqual({
      o: "and",
      a: { o: "gt", a: { v: "stock", i: -1 }, b: { o: "mul", a: { v: "members" }, b: { c: 2 } } },
      b: { o: "not", a: { v: "night" } },
    });
    expect(tree("stock")).toEqual({ v: "stock", i: -1 });
    expect(tree(`withdrawn(${ITEMS[2]})`)).toEqual({ v: "withdrawn", i: 2 });
    expect(tree("min(hunger, 2) >= 1 or tenure <> 0")).toEqual({
      o: "or",
      a: { o: "ge", a: { o: "min", a: { v: "hunger" }, b: { c: 2 } }, b: { c: 1 } },
      b: { o: "ne", a: { v: "tenure" }, b: { c: 0 } },
    });
    expect(tree("has_role(keeper)", ["Elder", "Keeper"])).toEqual({ v: "has_role", i: 1 });
    expect(tree("has_role(0)", ["Elder"])).toEqual({ v: "has_role", i: 0 });
  });

  it("reads back the symbols a charter is displayed with", () => {
    expect(tree("(members × 2) ≤ stock(food)")).toEqual({ o: "le", a: { o: "mul", a: { v: "members" }, b: { c: 2 } }, b: { v: "stock", i: -1 } });
    expect(tree("bond ≠ 0")).toEqual({ o: "ne", a: { v: "bond" }, b: { c: 0 } });
  });

  it("refuses what is not a formula and says where", () => {
    const cases: [string, string][] = [
      ["", "empty"],
      ["   ", "empty"],
      ["1 +", "expected"],
      ["(1 + 2", "expected"],
      ["1 2", "unexpected"],
      ["wealth > 3", "unknown_fact"],
      ["stock(gold)", "unknown_item"],
      ["has_role(chief)", "unknown_role"],
      ["members; drop table", "unexpected"],
      ["eval(1)", "unknown_fact"],
      ["if(1, 2)", "expected"],
      ["1 < 2 < 3", "unexpected"],
      ["99999999999", "bad_constant"],
      ["a".repeat(FORMULA_MAX_CHARS + 1), "too_long"],
      ["(".repeat(60) + "1" + ")".repeat(60), "too_deep"],
      ["not ".repeat(60) + "1", "too_deep"],
      ["1" + " + 1".repeat(100), "too_long"],
    ];
    for (const [text, code] of cases) {
      const r = parse(text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) {
        expect(r.code, text).toBe(code);
        expect(r.at).toBeGreaterThanOrEqual(0);
      }
    }
    expect(parseFormula(42, ITEMS).ok).toBe(false);
    expect(parseFormula(null, ITEMS).ok).toBe(false);
  });

  // a generator of formulas the grammar accepts: every node within bounds
  const leaf: fc.Arbitrary<Expr> = fc.oneof(
    fc.integer({ min: -LIMITS.constant, max: LIMITS.constant }).map((c) => ({ c })),
    fc.constantFrom<Expr>({ v: "members" }, { v: "day" }, { v: "season" }, { v: "night" }, { v: "tenure" }, { v: "bond" }, { v: "breaches" }, { v: "hunger" }),
    fc.tuple(fc.constantFrom("stock" as const, "deposited" as const, "withdrawn" as const), fc.integer({ min: -1, max: ITEM_COUNT - 1 })).map(([v, i]) => ({ v, i })),
    fc.integer({ min: 0, max: 1 }).map((i) => ({ v: "has_role" as const, i })),
  );
  const expr: fc.Arbitrary<Expr> = fc.letrec<{ e: Expr }>((tie) => ({
    e: fc.oneof(
      { maxDepth: 3, depthSize: "small" },
      leaf,
      fc.tuple(fc.constantFrom(...BINARY_OPS), tie("e"), tie("e")).map(([o, a, b]) => ({ o, a, b })),
      tie("e").map((a) => ({ o: "not" as const, a })),
      fc.tuple(tie("e"), tie("e"), tie("e")).map(([a, b, e]) => ({ o: "if" as const, a, b, e })),
    ),
  })).e;

  it("property: a formula written out and read back is the same formula", () => {
    fc.assert(
      fc.property(expr, (e) => {
        const text = formatFormula(e, ITEMS);
        if (text.length > FORMULA_MAX_CHARS) return; // longer than a rule may be; the validator would refuse it anyway
        const back = parse(text, ["a", "b"]);
        if (!back.ok && back.code === "too_long") return;
        expect(back).toEqual({ ok: true, expr: e });
      }),
      { numRuns: 800 },
    );
  });

  it("property: no text makes the reader throw, loop or return anything but a formula or a refusal", () => {
    const soup = fc
      .array(fc.constantFrom(..."0123456789 ()+-*/<>=!,×÷≤≥≠".split(""), "if", "min", "max", "not", "and", "or", "stock", "members", "winter", "food", "has_role", "\u0000", "\n", "💥", "__proto__", "constructor"), { maxLength: 120 })
      .map((parts) => parts.join(""));
    fc.assert(
      fc.property(fc.oneof(soup, fc.string({ maxLength: 200 })), (text) => {
        const r = parse(text);
        if (r.ok) {
          // whatever was read is plain data of the grammar's shape, and the validator can judge it
          const diags: Diagnostic[] = [];
          const checked = checkExpr(r.expr, "f", 0, diags);
          expect(checked !== null || diags.length > 0).toBe(true);
          expect(Object.getPrototypeOf(r.expr)).toBe(Object.prototype);
        } else {
          expect(typeof r.code).toBe("string");
          expect(r.at).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 1500 },
    );
  });
});
