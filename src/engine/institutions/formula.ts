/**
 * Formulas as text.
 *
 * A language model (or a person) writes a rule's quantity or condition as a short line of
 * ordinary arithmetic — `if(season = winter, 1, 3)`, `stock(food) > members * 2` — and this
 * module turns it into the grammar's formula tree, deterministically. Nothing is executed
 * here and nothing is guessed: text that is not a formula is refused with the position of
 * the first thing that could not be read. The tree is then checked again, with the
 * grammar's own bounds, by `checkExpr` like any other untrusted formula.
 *
 *   formula := or
 *   or      := and  { "or" and }
 *   and     := not  { "and" not }
 *   not     := "not" not | compare
 *   compare := sum [ ( "<" | "<=" | "=" | "==" | "!=" | "<>" | ">=" | ">" ) sum ]
 *   sum     := product { ( "+" | "-" ) product }
 *   product := unary { ( "*" | "/" ) unary }
 *   unary   := "-" unary | atom
 *   atom    := whole number | "(" formula ")"
 *            | "if" "(" formula "," formula "," formula ")"
 *            | ( "min" | "max" ) "(" formula "," formula ")"
 *            | ( "stock" | "deposited" | "withdrawn" ) [ "(" item | "food" ")" ]
 *            | "has_role" "(" role index | role name ")"
 *            | members | day | season | night | tenure | bond | breaches | hunger
 *            | spring | summer | autumn | winter          (the constants 0 1 2 3)
 */
import type { BinaryOp, Expr, VarName } from "./types";

export const FORMULA_MAX_CHARS = 320;
const MAX_TOKENS = 160;
const MAX_DEPTH = 24;

export type FormulaResult = { ok: true; expr: Expr } | { ok: false; code: string; message: string; at: number };

type Tok = { t: "num"; v: number; at: number } | { t: "id"; v: string; at: number } | { t: "op"; v: string; at: number };

class FormulaError {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly at: number,
  ) {}
}

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isIdStart = (c: number): boolean => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95;

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      i++;
      continue;
    }
    if (out.length >= MAX_TOKENS) throw new FormulaError("too_long", "the formula has too many parts", i);
    if (isDigit(c)) {
      let j = i;
      let v = 0;
      while (j < text.length && isDigit(text.charCodeAt(j))) {
        v = v * 10 + (text.charCodeAt(j) - 48);
        if (v > 1_000_000_000) throw new FormulaError("bad_constant", "that number is too large", i);
        j++;
      }
      out.push({ t: "num", v, at: i });
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < text.length && (isIdStart(text.charCodeAt(j)) || isDigit(text.charCodeAt(j)))) j++;
      out.push({ t: "id", v: text.slice(i, j).toLowerCase(), at: i });
      i = j;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "==" || two === "!=" || two === "<>") {
      out.push({ t: "op", v: two, at: i });
      i += 2;
      continue;
    }
    // the typographic forms a charter is shown in read back as what they mean
    const ch = text[i] as string;
    const alias: Record<string, string> = { "×": "*", "÷": "/", "−": "-", "≤": "<=", "≥": ">=", "≠": "!=" };
    const one = alias[ch] ?? ch;
    if ("+-*/<>=(),".includes(one) || one.length === 2) {
      out.push({ t: "op", v: one, at: i });
      i++;
      continue;
    }
    throw new FormulaError("unexpected", `"${ch}" cannot appear in a formula`, i);
  }
  return out;
}

const PLAIN_FACTS: readonly VarName[] = ["members", "day", "season", "night", "tenure", "bond", "breaches", "hunger"];
const ITEM_FACTS: readonly VarName[] = ["stock", "deposited", "withdrawn"];
const SEASONS: Record<string, number> = { spring: 0, summer: 1, autumn: 2, fall: 2, winter: 3 };
const COMPARE: Record<string, BinaryOp> = { "<": "lt", "<=": "le", "=": "eq", "==": "eq", "!=": "ne", "<>": "ne", ">=": "ge", ">": "gt" };
const ANY_FOOD = new Set(["food", "any_food", "anyfood", "any"]);

/**
 * Read a formula. `items` are the item names by id and `roles` the role names the charter
 * declares, in order; both are matched without regard to case.
 */
export function parseFormula(text: unknown, items: readonly string[], roles: readonly string[] = []): FormulaResult {
  if (typeof text !== "string") return { ok: false, code: "not_text", message: "a formula is written as text", at: 0 };
  if (text.length > FORMULA_MAX_CHARS) return { ok: false, code: "too_long", message: `a formula is at most ${FORMULA_MAX_CHARS} characters`, at: FORMULA_MAX_CHARS };
  let toks: Tok[];
  try {
    toks = tokenize(text);
  } catch (err) {
    if (err instanceof FormulaError) return { ok: false, code: err.code, message: err.message, at: err.at };
    throw err;
  }
  if (toks.length === 0) return { ok: false, code: "empty", message: "the formula is empty", at: 0 };

  let pos = 0;
  const end = text.length;
  const peek = (): Tok | undefined => toks[pos];
  const at = (): number => peek()?.at ?? end;
  const isOp = (v: string): boolean => {
    const k = peek();
    return !!k && k.t === "op" && k.v === v;
  };
  const isWord = (v: string): boolean => {
    const k = peek();
    return !!k && k.t === "id" && k.v === v;
  };
  const expect = (v: string): void => {
    if (!isOp(v)) throw new FormulaError("expected", `expected "${v}"`, at());
    pos++;
  };
  const lowerItems = items.map((s) => s.toLowerCase());
  const lowerRoles = roles.map((s) => s.toLowerCase().replace(/\s+/g, "_"));

  const itemArg = (): number => {
    const k = peek();
    if (!k) throw new FormulaError("expected", "expected an item name", at());
    pos++;
    if (k.t === "id") {
      if (ANY_FOOD.has(k.v)) return -1;
      const i = lowerItems.indexOf(k.v);
      if (i >= 0) return i;
      throw new FormulaError("unknown_item", `"${k.v.slice(0, 24)}" is not an item`, k.at);
    }
    if (k.t === "num" && k.v < items.length) return k.v;
    throw new FormulaError("unknown_item", "expected an item name, or food", k.at);
  };

  function formula(depth: number): Expr {
    if (depth > MAX_DEPTH) throw new FormulaError("too_deep", "the formula nests too deeply", at());
    let left = conj(depth);
    while (isWord("or")) {
      pos++;
      left = { o: "or", a: left, b: conj(depth) };
    }
    return left;
  }
  function conj(depth: number): Expr {
    let left = negation(depth);
    while (isWord("and")) {
      pos++;
      left = { o: "and", a: left, b: negation(depth) };
    }
    return left;
  }
  function negation(depth: number): Expr {
    if (isWord("not")) {
      if (depth > MAX_DEPTH) throw new FormulaError("too_deep", "the formula nests too deeply", at());
      pos++;
      return { o: "not", a: negation(depth + 1) };
    }
    return compare(depth);
  }
  function compare(depth: number): Expr {
    const left = sum(depth);
    const k = peek();
    if (k && k.t === "op" && COMPARE[k.v]) {
      pos++;
      return { o: COMPARE[k.v] as BinaryOp, a: left, b: sum(depth) };
    }
    return left;
  }
  function sum(depth: number): Expr {
    let left = product(depth);
    for (;;) {
      if (isOp("+")) {
        pos++;
        left = { o: "add", a: left, b: product(depth) };
      } else if (isOp("-")) {
        pos++;
        left = { o: "sub", a: left, b: product(depth) };
      } else return left;
    }
  }
  function product(depth: number): Expr {
    let left = unary(depth);
    for (;;) {
      if (isOp("*")) {
        pos++;
        left = { o: "mul", a: left, b: unary(depth) };
      } else if (isOp("/")) {
        pos++;
        left = { o: "div", a: left, b: unary(depth) };
      } else return left;
    }
  }
  function unary(depth: number): Expr {
    if (isOp("-")) {
      if (depth > MAX_DEPTH) throw new FormulaError("too_deep", "the formula nests too deeply", at());
      pos++;
      const inner = unary(depth + 1);
      // a minus sign in front of a number is that negative number; in front of anything else it is "0 − it"
      return "c" in inner ? { c: inner.c === 0 ? 0 : -inner.c } : { o: "sub", a: { c: 0 }, b: inner };
    }
    return atom(depth);
  }
  function atom(depth: number): Expr {
    const k = peek();
    if (!k) throw new FormulaError("expected", "the formula stops where a value was expected", end);
    if (k.t === "num") {
      pos++;
      return { c: k.v };
    }
    if (k.t === "op") {
      if (k.v !== "(") throw new FormulaError("unexpected", `"${k.v}" where a value was expected`, k.at);
      pos++;
      const inner = formula(depth + 1);
      expect(")");
      return inner;
    }
    pos++;
    const word = k.v;
    if (word === "if") {
      expect("(");
      const a = formula(depth + 1);
      expect(",");
      const b = formula(depth + 1);
      expect(",");
      const e = formula(depth + 1);
      expect(")");
      return { o: "if", a, b, e };
    }
    if (word === "min" || word === "max") {
      expect("(");
      const a = formula(depth + 1);
      expect(",");
      const b = formula(depth + 1);
      expect(")");
      return { o: word, a, b };
    }
    if ((ITEM_FACTS as readonly string[]).includes(word)) {
      let i = -1;
      if (isOp("(")) {
        pos++;
        i = itemArg();
        expect(")");
      }
      return { v: word as VarName, i };
    }
    if (word === "has_role") {
      expect("(");
      const r = peek();
      if (!r) throw new FormulaError("expected", "expected a role", end);
      pos++;
      let i = -1;
      if (r.t === "num") i = r.v;
      else if (r.t === "id") i = lowerRoles.indexOf(r.v);
      if (i < 0) throw new FormulaError("unknown_role", "has_role needs the index or the name of a role this charter declares", r.at);
      expect(")");
      return { v: "has_role", i };
    }
    if ((PLAIN_FACTS as readonly string[]).includes(word)) return { v: word as VarName };
    if (word in SEASONS) return { c: SEASONS[word] as number };
    if (word === "true" || word === "yes") return { c: 1 };
    if (word === "false" || word === "no") return { c: 0 };
    throw new FormulaError("unknown_fact", `"${word.slice(0, 24)}" is not a fact a rule can read`, k.at);
  }

  try {
    const expr = formula(1);
    if (pos < toks.length) throw new FormulaError("unexpected", "the formula should have ended here", at());
    return { ok: true, expr };
  } catch (err) {
    if (err instanceof FormulaError) return { ok: false, code: err.code, message: err.message, at: err.at };
    throw err;
  }
}

const SYMBOL: Partial<Record<BinaryOp, string>> = { add: "+", sub: "-", mul: "*", div: "/", lt: "<", le: "<=", eq: "=", ne: "!=", ge: ">=", gt: ">", and: "and", or: "or" };

/**
 * The text of a formula tree, in the form `parseFormula` reads. For any validated formula,
 * parsing the text gives back the same tree.
 */
export function formatFormula(e: Expr, items: readonly string[]): string {
  if ("c" in e) return String(e.c);
  if ("v" in e) {
    if (e.v === "has_role") return `has_role(${e.i ?? 0})`;
    if ((ITEM_FACTS as readonly string[]).includes(e.v)) return `${e.v}(${(e.i ?? -1) < 0 ? "food" : (items[e.i as number] ?? "food")})`;
    return e.v;
  }
  if (e.o === "not") return `(not ${formatFormula(e.a, items)})`;
  if (e.o === "if") return `if(${formatFormula(e.a, items)}, ${formatFormula(e.b, items)}, ${formatFormula(e.e, items)})`;
  if (e.o === "min" || e.o === "max") return `${e.o}(${formatFormula(e.a, items)}, ${formatFormula(e.b, items)})`;
  return `(${formatFormula(e.a, items)} ${SYMBOL[e.o] ?? e.o} ${formatFormula(e.b, items)})`;
}
