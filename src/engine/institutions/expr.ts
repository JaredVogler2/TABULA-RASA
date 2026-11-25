/**
 * Bounded integer formulas over public facts.
 *
 * A formula is a finite tree: constants, named facts, arithmetic, comparisons and one
 * conditional. There are no loops, no calls, no names bound by the charter and no way to
 * refer to another rule, so evaluation always terminates in at most `LIMITS.exprNodes`
 * steps and cannot recurse. Arithmetic saturates; division by zero yields zero. Every
 * evaluated node costs one unit of fuel.
 */
import { ITEM_COUNT } from "../model/constants";
import { BINARY_OPS, LIMITS, VARS, type BinaryOp, type Diagnostic, type Expr, type VarName } from "./types";

const SAT = 1_000_000_000;
const sat = (x: number): number => (x > SAT ? SAT : x < -SAT ? -SAT : Math.trunc(x));

/** The facts a formula can see. Functions are cheap lookups supplied by the interpreter. */
export interface Facts {
  members: number;
  day: number;
  season: number;
  night: number;
  stock(item: number): number;
  tenure: number;
  bond: number;
  breaches: number;
  deposited(item: number): number;
  withdrawn(item: number): number;
  hunger: number;
  roles: number;
}

export interface Fuel {
  left: number;
}

export function evalExpr(e: Expr, f: Facts, fuel: Fuel): number {
  if (--fuel.left < 0) return 0;
  if ("c" in e) return e.c;
  if ("v" in e) {
    const i = e.i ?? -1;
    switch (e.v) {
      case "members":
        return f.members;
      case "day":
        return f.day;
      case "season":
        return f.season;
      case "night":
        return f.night;
      case "stock":
        return sat(f.stock(i));
      case "tenure":
        return f.tenure;
      case "bond":
        return f.bond;
      case "breaches":
        return f.breaches;
      case "deposited":
        return sat(f.deposited(i));
      case "withdrawn":
        return sat(f.withdrawn(i));
      case "hunger":
        return f.hunger;
      case "has_role":
        return i >= 0 && (f.roles & (1 << i)) !== 0 ? 1 : 0;
      default:
        return 0;
    }
  }
  if (e.o === "not") return evalExpr(e.a, f, fuel) === 0 ? 1 : 0;
  if (e.o === "if") return evalExpr(e.a, f, fuel) !== 0 ? evalExpr(e.b, f, fuel) : evalExpr(e.e, f, fuel);
  const a = evalExpr(e.a, f, fuel);
  // short-circuit the logical connectives
  if (e.o === "and") return a !== 0 && evalExpr(e.b, f, fuel) !== 0 ? 1 : 0;
  if (e.o === "or") return a !== 0 || evalExpr(e.b, f, fuel) !== 0 ? 1 : 0;
  const b = evalExpr(e.b, f, fuel);
  switch (e.o) {
    case "add":
      return sat(a + b);
    case "sub":
      return sat(a - b);
    case "mul":
      return sat(a * b);
    case "div":
      return b === 0 ? 0 : sat(a / b);
    case "min":
      return a < b ? a : b;
    case "max":
      return a > b ? a : b;
    case "lt":
      return a < b ? 1 : 0;
    case "le":
      return a <= b ? 1 : 0;
    case "eq":
      return a === b ? 1 : 0;
    case "ne":
      return a !== b ? 1 : 0;
    case "ge":
      return a >= b ? 1 : 0;
    case "gt":
      return a > b ? 1 : 0;
    default:
      return 0;
  }
}

const ITEM_VARS = new Set<VarName>(["stock", "deposited", "withdrawn"]);
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

/**
 * Validate an untrusted value as a formula and return a clean copy (known fields only, in a
 * fixed order), or null with diagnostics. `roles` is the number of roles the charter declares.
 */
export function checkExpr(raw: unknown, path: string, roles: number, diags: Diagnostic[]): Expr | null {
  const budget = { nodes: LIMITS.exprNodes };
  const out = walk(raw, path, roles, diags, budget, 1);
  return out;
}

function walk(raw: unknown, path: string, roles: number, diags: Diagnostic[], budget: { nodes: number }, depth: number): Expr | null {
  const bad = (code: string, message: string): null => {
    diags.push({ path, code, message });
    return null;
  };
  if (depth > LIMITS.exprDepth) return bad("too_deep", `a formula may nest at most ${LIMITS.exprDepth} levels`);
  if (--budget.nodes < 0) return bad("too_large", `a formula may have at most ${LIMITS.exprNodes} parts`);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("not_a_formula", "expected a constant, a fact or an operation");
  const r = raw as Record<string, unknown>;
  if ("c" in r) {
    if (!isInt(r.c) || Math.abs(r.c) > LIMITS.constant) return bad("bad_constant", `constants are whole numbers within ±${LIMITS.constant}`);
    return { c: r.c };
  }
  if ("v" in r) {
    if (typeof r.v !== "string" || !(VARS as readonly string[]).includes(r.v)) return bad("unknown_fact", `"${String(r.v).slice(0, 24)}" is not a public fact a rule can read`);
    const v = r.v as VarName;
    if (ITEM_VARS.has(v)) {
      const i = r.i === undefined ? -1 : r.i;
      if (!isInt(i) || i < -1 || i >= ITEM_COUNT) return bad("bad_item", "item must be an item id, or -1 for any food");
      return { v, i };
    }
    if (v === "has_role") {
      if (!isInt(r.i) || r.i < 0 || r.i >= roles) return bad("unknown_role", "has_role needs the index of a role this charter declares");
      return { v, i: r.i };
    }
    return { v };
  }
  if (typeof r.o !== "string") return bad("not_a_formula", "expected a constant, a fact or an operation");
  if (r.o === "not") {
    const a = walk(r.a, `${path}.a`, roles, diags, budget, depth + 1);
    return a ? { o: "not", a } : null;
  }
  if (r.o === "if") {
    const a = walk(r.a, `${path}.a`, roles, diags, budget, depth + 1);
    const b = walk(r.b, `${path}.b`, roles, diags, budget, depth + 1);
    const e = walk(r.e, `${path}.e`, roles, diags, budget, depth + 1);
    return a && b && e ? { o: "if", a, b, e } : null;
  }
  if (!(BINARY_OPS as readonly string[]).includes(r.o)) return bad("unknown_operation", `"${r.o.slice(0, 24)}" is not an operation of the rule grammar`);
  const a = walk(r.a, `${path}.a`, roles, diags, budget, depth + 1);
  const b = walk(r.b, `${path}.b`, roles, diags, budget, depth + 1);
  return a && b ? { o: r.o as BinaryOp, a, b } : null;
}

/** Number of nodes in a (validated) formula. */
export function exprSize(e: Expr): number {
  if ("c" in e || "v" in e) return 1;
  if (e.o === "not") return 1 + exprSize(e.a);
  if (e.o === "if") return 1 + exprSize(e.a) + exprSize(e.b) + exprSize(e.e);
  return 1 + exprSize(e.a) + exprSize(e.b);
}

const SEASON_WORDS = ["spring", "summer", "autumn", "winter"] as const;

/** A formula as a short human-readable string (for charters shown to people and models). */
export function showExpr(e: Expr, items: readonly string[], roleNames: readonly string[]): string {
  if ("c" in e) return String(e.c);
  if ("v" in e) {
    if (e.v === "has_role") return `is ${roleNames[e.i ?? 0] ?? "role"}`;
    if (ITEM_VARS.has(e.v)) return `${e.v}(${(e.i ?? -1) < 0 ? "food" : (items[e.i as number] ?? "?")})`;
    return e.v;
  }
  if (e.o === "not") return `not ${showExpr(e.a, items, roleNames)}`;
  // the comparisons people actually write read better in words; the meaning is unchanged
  if (e.o !== "if" && "v" in e.a && "c" in e.b) {
    const c = e.b.c;
    if (e.a.v === "season" && c >= 0 && c <= 3) {
      const season = SEASON_WORDS[c] as string;
      if (e.o === "eq") return `it is ${season}`;
      if (e.o === "ne") return `it is not ${season}`;
      if (e.o === "lt" && c === 3) return "it is not winter";
    }
    if (e.a.v === "hunger" && e.o === "ge" && c >= 1 && c <= 3) return `they look ${["", "uneasy with hunger", "hungry", "starving"][c]}`;
    if (e.a.v === "night" && e.o === "eq" && (c === 0 || c === 1)) return c === 1 ? "it is night" : "it is day";
  }
  if (e.o === "if") return `(${showExpr(e.b, items, roleNames)} if ${showExpr(e.a, items, roleNames)}, otherwise ${showExpr(e.e, items, roleNames)})`;
  const sym: Record<string, string> = { add: "+", sub: "−", mul: "×", div: "÷", lt: "<", le: "≤", eq: "=", ne: "≠", ge: "≥", gt: ">", and: "and", or: "or" };
  if (e.o === "min" || e.o === "max") return `${e.o}(${showExpr(e.a, items, roleNames)}, ${showExpr(e.b, items, roleNames)})`;
  return `(${showExpr(e.a, items, roleNames)} ${sym[e.o] ?? e.o} ${showExpr(e.b, items, roleNames)})`;
}
