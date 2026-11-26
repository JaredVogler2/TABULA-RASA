/**
 * A bounded, plain copy of structured data that came from outside the engine.
 *
 * A charter or a motion written by a model is an object the engine has not made. Before the
 * validator has judged it, it is already kept — in the agent's plan, and in the decision
 * record a run can be replayed and published from. This is what makes that safe: the copy is
 * plain data (objects, arrays, text, whole or fractional numbers, booleans, null) of bounded
 * depth and size, with every piece of text cleaned and cut to length, and with no key the
 * grammar does not use (so none that could reach a prototype). Text is cut and entries under
 * unknown keys are dropped — the validator would cut and ignore them anyway; anything deeper
 * or larger than a legitimate charter could be is refused whole rather than trimmed into
 * something that was not offered.
 *
 * Copying a value that is already within bounds gives an equal value: a replayed decision
 * passes through here a second time and is unchanged by it.
 */
import { cleanText } from "./text";

export interface Bounds {
  /** Containers nested inside one another, the outermost included. */
  depth: number;
  /** Values of any kind, containers and keys included. */
  nodes: number;
  /** UTF-16 units kept of any one piece of text. */
  text: number;
  /** UTF-16 units of text in all, after cleaning and cutting. */
  chars: number;
  /** The only keys kept; an entry under any other key is dropped. */
  keys: ReadonlySet<string>;
}

/**
 * Every key the institution grammar uses, at any level of a charter or a motion (types.ts:
 * Charter, Rule, Who, Sanction, Expr, MotionBody). A copy keeps nothing under any other key,
 * so a charter in a plan or a record carries no field the validator would not read.
 */
const PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  // charter
  "grammar", "name", "purpose", "minFounders", "maxMembers", "entry", "bond", "roles", "decide", "period", "stores", "rules", "days",
  // bond, role, decision rule
  "item", "qty", "seats", "by", "rule", "role", "quorum",
  // rule, who, sanction
  "r", "who", "quota", "worth", "structure", "kind", "within", "over", "when", "else", "t", "periods",
  // formula
  "c", "v", "i", "o", "a", "b", "e",
  // motion
  "m", "agent",
]);

/**
 * Bounds for a charter or a motion. The largest charter the grammar allows — twelve rules, each
 * with two formulas of twenty-four nodes six deep, four roles, four stores — comes to about
 * 4,100 values and keys holding about 3,700 characters of text, and the deepest nests nine
 * containers (measured in bounded.test.ts, which fails if the grammar outgrows these); the
 * bounds leave it room and little more.
 */
export const PAYLOAD_BOUNDS: Bounds = { depth: 12, nodes: 6000, text: 240, chars: 6000, keys: PAYLOAD_KEYS };

class OutOfBounds extends Error {}

export function boundedCopy(value: unknown, bounds: Bounds = PAYLOAD_BOUNDS): { ok: true; value: unknown } | { ok: false } {
  let left = bounds.nodes;
  let chars = bounds.chars;
  const copy = (v: unknown, depth: number): unknown => {
    if (--left < 0) throw new OutOfBounds();
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") {
      // JSON has no NaN or infinity; nothing the engine reads from here should either
      if (!Number.isFinite(v)) throw new OutOfBounds();
      // Nor a negative zero: written out it is "0", so a copy that kept one would not be the copy that is
      // read back from a record. (The engine's canonical form already writes it as 0: no digest can tell.)
      return v === 0 ? 0 : v;
    }
    if (typeof v === "string") {
      const text = cleanText(v, bounds.text);
      chars -= text.length;
      if (chars < 0) throw new OutOfBounds();
      return text;
    }
    if (typeof v !== "object") throw new OutOfBounds(); // undefined, functions, symbols, bigints
    if (depth >= bounds.depth) throw new OutOfBounds();
    if (Array.isArray(v)) {
      if (v.length > left) throw new OutOfBounds();
      const out: unknown[] = [];
      for (let i = 0; i < v.length; i++) out.push(copy(v[i], depth + 1));
      return out;
    }
    const proto = Object.getPrototypeOf(v) as unknown;
    if (proto !== Object.prototype && proto !== null) throw new OutOfBounds(); // plain objects only
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v)) {
      if (--left < 0) throw new OutOfBounds();
      const child = (v as Record<string, unknown>)[key];
      // `keys` is a closed vocabulary of ordinary names: "__proto__" and its like are not in it
      if (child === undefined || !bounds.keys.has(key)) continue;
      out[key] = copy(child, depth + 1);
    }
    return out;
  };
  try {
    return { ok: true, value: copy(value, 0) };
  } catch (err) {
    if (err instanceof OutOfBounds) return { ok: false };
    throw err;
  }
}
