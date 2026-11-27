/**
 * The wire format: the one shape a language model may answer in, and its translation to and
 * from the engine's intents.
 *
 * The shape is deliberately flat. Every action is the same small record — what to do, an
 * id, a thing, a quantity, a place — and a charter writes its quantities and conditions as
 * short lines of arithmetic that `parseFormula` reads. There are no unions, no recursion and
 * no optional structure for a model to get wrong, and the JSON Schema stays inside what the
 * provider's structured-output grammar supports (checked by `lintSchema`).
 *
 * Translation is deterministic and never repairs meaning: an action that cannot be read is
 * dropped with a reason that is fed back to the mind that wrote it; a charter with one
 * unreadable rule is dropped whole. What comes out is still only a proposal — the engine
 * checks every intent against the action mask, and again when it is carried out.
 */
import {
  DECISION_LIMITS,
  FIRST_WORK_KIND,
  GRAMMAR_VERSION,
  INSTITUTION_LIMITS,
  ITEMS,
  NODE_KINDS,
  RECIPES,
  STRUCTURE_KINDS,
  cleanLabel,
  cleanText,
  formatFormula,
  parseFormula,
  type Charter,
  type Dropped,
  type Expr,
  type ExternalDecision,
  type Intent,
  type MotionBody,
  type Observation,
  type Rule,
  type Sanction,
  type SpeechAct,
} from "@/engine";

export const WIRE_VERSION = 1;

export const ACTION_KINDS = [
  "goto",
  "explore",
  "rest",
  "wait",
  "drink",
  "fill",
  "eat",
  "gather",
  "craft",
  "build",
  "refuel",
  "harvest",
  "inspect",
  "deposit",
  "withdraw",
  "give",
  "drop",
  "pickup",
  "say",
  "propose",
  "endorse",
  "motion",
  "vote",
  "leave",
  "pact_offer",
  "pact_accept",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const SPEECH_KINDS = ["greet", "inform_node", "inform_structure", "inform_agent", "request", "offer", "accept", "decline", "promise", "announce", "invite", "warn", "free"] as const;
const CLAIMS = ["gave", "helped", "took", "kept", "broke"] as const;
const MOTION_KINDS = ["amend", "admit", "expel", "assign", "grant", "bind", "release", "dissolve"] as const;
const RULE_FORMS = ["may_withdraw", "may_shelter", "must_deposit", "must_supply", "must_not_gather"] as const;
const SANCTIONS = ["note", "forfeit", "suspend", "expel", "none"] as const;
const ENTRY = ["open", "vote", "closed"] as const;
const DECIDE = ["unanimity", "majority", "two_thirds", "role"] as const;
const CONFIDENCE = ["low", "medium", "high"] as const;

const ITEM_NAMES: readonly string[] = ITEMS;
const RECIPE_NAMES: readonly string[] = RECIPES.map((r) => r.name);
const STRUCTURE_NAMES: readonly string[] = STRUCTURE_KINDS;
const PLACE_NAMES: readonly string[] = NODE_KINDS;
/**
 * Everything the `what` field can name: an item, a recipe or a kind of structure. The works
 * are named only to minds in a world that has crafts; every other world's schema is the one it
 * always was.
 */
const whatNames = (crafts: boolean): readonly string[] => [...new Set([...ITEM_NAMES, ...RECIPE_NAMES, ...(crafts ? STRUCTURE_NAMES : STRUCTURE_NAMES.slice(0, FIRST_WORK_KIND))])];
export const WHAT_NAMES: readonly string[] = whatNames(false);

/** Hard limits on what is read from a model's answer. */
export const WIRE_LIMITS = { maxChars: 24_000, maxActions: 12, maxCites: 8, maxRules: 12, maxRoles: 4, maxStructures: 4 } as const;

// ───────────────────────── the wire types

export interface WireAction {
  do: string;
  target?: number;
  what?: string;
  qty?: number;
  x?: number;
  y?: number;
  ticks?: number;
  speech?: string;
  about?: number;
  claim?: string;
  want?: string;
  want_qty?: number;
  text?: string;
  yes?: boolean;
  motion?: string;
  role?: number;
}

export interface WireRule {
  form: string;
  who: string;
  item: string;
  amount: string;
  when: string;
  structure: number;
  place_kind: string;
  within: number;
  or_else: string;
  or_else_qty: number;
}

export interface WireCharter {
  name: string;
  purpose: string;
  founders: number;
  max_members: number;
  entry: string;
  bond_item: string;
  bond_qty: number;
  roles: { name: string; seats: number; filled_by: string }[];
  decide: string;
  decide_role: number;
  quorum_permille: number;
  period_ticks: number;
  structures: number[];
  days: number;
  rules: WireRule[];
}

export interface WireDecision {
  goal: string;
  why: string;
  confidence: string;
  note: string;
  cites: string[];
  actions: WireAction[];
  charter?: WireCharter;
}

// ───────────────────────── JSON Schema (the provider compiles this into an output grammar)

type Json = Record<string, unknown>;
const text = (description: string): Json => ({ type: "string", description });
const whole = (description: string): Json => ({ type: "integer", description });
const oneOf = (values: readonly string[], description: string): Json => ({ type: "string", enum: [...values], description });
const record = (properties: Record<string, Json>, required: string[]): Json => ({ type: "object", properties, required, additionalProperties: false });

const actionSchema = (crafts: boolean): Json => record(
  {
    do: oneOf(ACTION_KINDS, "The action."),
    target: whole("The id acted on: a place, a structure, a person (-1 = everyone in earshot), an agreement, a motion or an offer."),
    what: oneOf(whatNames(crafts), "An item, a recipe (craft) or a kind of structure (build)."),
    qty: whole("How many."),
    x: whole("Tile column."),
    y: whole("Tile row."),
    ticks: whole("How long, in ticks."),
    speech: oneOf(SPEECH_KINDS, "For say: the kind of thing said."),
    about: whole("The id spoken about, or the person or structure a motion concerns."),
    claim: oneOf(CLAIMS, "For say inform_agent: what you say they did."),
    want: oneOf(ITEM_NAMES, "The item asked in return."),
    want_qty: whole("How many are asked in return."),
    text: text("For say: your own words."),
    yes: { type: "boolean", description: "For vote." },
    motion: oneOf(MOTION_KINDS, "For motion: what is moved."),
    role: whole("For motion assign: the index of the role."),
  },
  ["do"],
);

const RULE_SCHEMA = record(
  {
    form: oneOf(RULE_FORMS, "The form of the rule."),
    who: text('"all", "role:N" or "others:N".'),
    item: oneOf([...ITEM_NAMES, "food", "none"], "The item the rule concerns; food = any food."),
    amount: text("A formula for the quantity per period; empty if the form has none."),
    when: text("A formula for when the rule applies; empty for always."),
    structure: whole("must_supply: the site or hearth id; otherwise -1."),
    place_kind: oneOf([...PLACE_NAMES, "any", "none"], "must_not_gather: the kind of place."),
    within: whole("must_not_gather: reach in tiles; otherwise 0."),
    or_else: oneOf(SANCTIONS, "What follows a breach of a must rule."),
    or_else_qty: whole("Bond units forfeited or periods suspended; otherwise 0."),
  },
  ["form", "who", "item", "amount", "when", "structure", "place_kind", "within", "or_else", "or_else_qty"],
);

const CHARTER_SCHEMA = record(
  {
    name: text("A name for the agreement."),
    purpose: text("One sentence, for people to read. It has no effect."),
    founders: whole("Signatures needed, yours included."),
    max_members: whole("Most members it may have."),
    entry: oneOf(ENTRY, "Who may join later."),
    bond_item: oneOf([...ITEM_NAMES, "none"], "Item each signer posts as a bond."),
    bond_qty: whole("Units of bond; 0 for none."),
    roles: { type: "array", description: "Roles it declares; may be empty.", items: record({ name: text("Role name."), seats: whole("How many may hold it."), filled_by: oneOf(["founder", "vote"], "How it is filled.") }, ["name", "seats", "filled_by"]) },
    decide: oneOf(DECIDE, "How members decide motions."),
    decide_role: whole("Index of the deciding role; otherwise -1."),
    quorum_permille: whole("Share of members who must vote, 0 to 1000."),
    period_ticks: whole("Accounting period in ticks."),
    structures: { type: "array", description: "Ids of stores or shelters placed under it.", items: { type: "integer" } },
    days: whole("Lifetime in days; 0 = until dissolved."),
    rules: { type: "array", description: "Its rules.", items: RULE_SCHEMA },
  },
  ["name", "purpose", "founders", "max_members", "entry", "bond_item", "bond_qty", "roles", "decide", "decide_role", "quorum_permille", "period_ticks", "structures", "days", "rules"],
);

/**
 * The schema sent as `output_config.format`. `civic` adds the charter block; worlds without
 * the institutional affordance use the smaller schema.
 */
export function decisionSchema(civic: boolean, crafts = false): Json {
  const base = actionSchema(crafts);
  const actions: Json = { ...base };
  if (!civic) {
    const kinds = ACTION_KINDS.filter((k) => !["propose", "endorse", "motion", "vote", "leave", "pact_offer", "pact_accept"].includes(k));
    const p = { ...(base.properties as Record<string, Json>) };
    p.do = oneOf(kinds, "The action.");
    delete p.yes;
    delete p.motion;
    delete p.role;
    actions.properties = p;
  }
  return record(
    {
      goal: text("Two or three plain words for what you are about to do."),
      why: text("One short sentence you would say aloud about your aim."),
      confidence: oneOf(CONFIDENCE, "How sure you are that this is a good plan."),
      note: text("A private note to your future self, or empty."),
      cites: { type: "array", description: "Labels of the remembered or heard lines this rests on; may be empty.", items: { type: "string" } },
      actions: { type: "array", description: "What you do next, in order.", minItems: 1, items: actions },
      ...(civic ? { charter: CHARTER_SCHEMA } : {}),
    },
    ["goal", "why", "confidence", "note", "cites", "actions"],
  );
}

/**
 * Check a schema against the documented limits of the provider's structured outputs
 * (docs/research/anthropic-api.md §D.2). Returns the problems found; empty means none.
 * This is an offline check of documented rules, not proof that the provider accepts it.
 */
export function lintSchema(schema: unknown): string[] {
  const problems: string[] = [];
  let optional = 0;
  let unions = 0;
  const BANNED = ["oneOf", "not", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems", "uniqueItems", "patternProperties", "if", "then", "else", "$ref", "$defs", "definitions"];
  const visit = (node: unknown, path: string, depth: number): void => {
    if (depth > 12) {
      problems.push(`${path}: nested too deeply`);
      return;
    }
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      problems.push(`${path}: not a schema object`);
      return;
    }
    const n = node as Record<string, unknown>;
    for (const k of BANNED) if (k in n) problems.push(`${path}: "${k}" is not supported (or is avoided here)`);
    if (Array.isArray(n.type)) unions++;
    if ("anyOf" in n) {
      unions++;
      if ("type" in n || "properties" in n) problems.push(`${path}: anyOf beside type/properties`);
    }
    if ("minItems" in n && n.minItems !== 0 && n.minItems !== 1) problems.push(`${path}: minItems may only be 0 or 1`);
    if (Array.isArray(n.enum)) {
      const seen = new Set<string>();
      for (const v of n.enum) {
        if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean" && v !== null) problems.push(`${path}: complex enum value`);
        const key = String(v).toLowerCase();
        if (seen.has(key)) problems.push(`${path}: enum values differ only by case (${key})`);
        seen.add(key);
        if (typeof v === "string" && v !== v.toLowerCase()) problems.push(`${path}: enum value is not lower case (${v})`);
      }
    }
    if (n.type === "object") {
      if (n.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
      const props = n.properties && typeof n.properties === "object" ? (n.properties as Record<string, unknown>) : null;
      if (!props || Object.keys(props).length === 0) {
        problems.push(`${path}: an object needs declared properties`);
        return;
      }
      const required = Array.isArray(n.required) ? (n.required as unknown[]) : [];
      for (const r of required) if (typeof r !== "string" || !(r in props)) problems.push(`${path}: required names an undeclared property (${String(r)})`);
      for (const [name, child] of Object.entries(props)) {
        if (["reasoning", "thinking", "trace"].includes(name.toLowerCase())) problems.push(`${path}.${name}: this field name can trigger a reasoning-extraction refusal`);
        if (!required.includes(name)) optional++;
        visit(child, `${path}.${name}`, depth + 1);
      }
    } else if (n.type === "array") {
      visit(n.items, `${path}[]`, depth + 1);
    } else if (!["string", "integer", "number", "boolean", "null"].includes(n.type as string)) {
      problems.push(`${path}: unknown type ${String(n.type)}`);
    }
  };
  visit(schema, "$", 0);
  if (optional > 24) problems.push(`optional properties: ${optional} (limit 24)`);
  if (unions > 16) problems.push(`union-typed properties: ${unions} (limit 16)`);
  return problems;
}

// ───────────────────────── reading an answer

export interface WireResult {
  ok: boolean;
  /** Why nothing could be read: "too_long" | "not_json" | "wrong_shape". */
  error?: string;
  detail?: string;
  /** The decision to submit (its `dropped` list says which actions could not be read). */
  decision: ExternalDecision | null;
  confidence: "" | "low" | "medium" | "high";
  cites: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const lower = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const intOr = (v: unknown, fallback: number): number => (isInt(v) ? v : fallback);

class Unreadable {
  constructor(
    public readonly reason: string,
    public readonly detail?: string,
  ) {}
}
const need = (cond: boolean, reason: string, detail?: string): void => {
  if (!cond) throw new Unreadable(reason, detail);
};

function itemId(name: unknown, field: string): number {
  const i = ITEM_NAMES.indexOf(lower(name));
  need(i >= 0, "unknown_item", `${field} must name an item`);
  return i;
}

function formulaOf(textValue: unknown, where: string, roles: readonly string[]): Expr {
  const r = parseFormula(textValue, ITEM_NAMES, roles);
  if (!r.ok) throw new Unreadable("bad_formula", `${where}: ${r.message} (at character ${r.at + 1})`);
  return r.expr;
}

function ruleOf(raw: unknown, index: number, roles: readonly string[]): Record<string, unknown> {
  const at = `rules[${index}]`;
  need(isObj(raw), "bad_rule", `${at} is not a rule`);
  const r = raw as Record<string, unknown>;
  const form = lower(r.form);
  need((RULE_FORMS as readonly string[]).includes(form), "bad_rule", `${at}.form is not a rule form`);
  const whoText = lower(r.who).replace(/\s+/g, "");
  let who: unknown;
  const m = /^(role|others)[:=#]?(\d{1,2})$/.exec(whoText);
  if (whoText === "all" || whoText === "") who = { t: "all" };
  else if (m) who = { t: m[1], role: Number(m[2]) };
  else throw new Unreadable("bad_rule", `${at}.who must be "all", "role:N" or "others:N"`);
  const whenText = typeof r.when === "string" ? r.when.trim() : "";
  const when = whenText ? { when: formulaOf(whenText, `${at}.when`, roles) } : {};
  const sanction = (): unknown => {
    const s = lower(r.or_else);
    if (s === "forfeit") return { t: "forfeit", qty: intOr(r.or_else_qty, 0) };
    if (s === "suspend") return { t: "suspend", periods: intOr(r.or_else_qty, 0) };
    if (s === "expel") return { t: "expel" };
    return { t: "note" };
  };
  const item = (): number => {
    const name = lower(r.item);
    return name === "food" ? -1 : itemId(name, `${at}.item`);
  };
  switch (form) {
    case "may_withdraw":
      return { r: form, who, item: item(), quota: formulaOf(r.amount, `${at}.amount`, roles), ...when };
    case "may_shelter":
      return { r: form, who, ...when };
    case "must_deposit":
      return { r: form, who, item: item(), qty: formulaOf(r.amount, `${at}.amount`, roles), ...when, else: sanction() };
    case "must_supply":
      return { r: form, who, structure: intOr(r.structure, -1), worth: formulaOf(r.amount, `${at}.amount`, roles), ...when, else: sanction() };
    default: {
      const kindName = lower(r.place_kind);
      const kind = kindName === "any" ? -1 : PLACE_NAMES.indexOf(kindName);
      need(kindName === "any" || kind >= 0, "bad_rule", `${at}.place_kind must name a kind of place, or any`);
      return { r: form, who, kind, within: intOr(r.within, 0), over: formulaOf(r.amount, `${at}.amount`, roles), ...when, else: sanction() };
    }
  }
}

function rulesOf(raw: unknown, roles: readonly string[]): Record<string, unknown>[] {
  need(Array.isArray(raw), "bad_charter", "rules must be a list");
  const list = raw as unknown[];
  need(list.length <= WIRE_LIMITS.maxRules, "bad_charter", `at most ${WIRE_LIMITS.maxRules} rules`);
  return list.map((r, i) => ruleOf(r, i, roles));
}

/** A wire charter as the raw charter object the engine's validator reads. */
function charterOf(raw: unknown): Record<string, unknown> {
  need(isObj(raw), "needs_charter", "a proposal needs the charter block");
  const c = raw as Record<string, unknown>;
  const rolesRaw = Array.isArray(c.roles) ? (c.roles as unknown[]) : [];
  need(rolesRaw.length <= WIRE_LIMITS.maxRoles, "bad_charter", `at most ${WIRE_LIMITS.maxRoles} roles`);
  const roles = rolesRaw.map((r, i) => {
    need(isObj(r), "bad_charter", `roles[${i}] is not a role`);
    const role = r as Record<string, unknown>;
    // a role's name is a plain label: what the engine's validator would make of it, made of it here
    return { name: cleanLabel(role.name, INSTITUTION_LIMITS.roleChars), seats: intOr(role.seats, 0), by: lower(role.filled_by) };
  });
  const roleNames = roles.map((r) => r.name);
  const bondName = lower(c.bond_item);
  const bondQty = intOr(c.bond_qty, 0);
  const decide = lower(c.decide);
  const structures = Array.isArray(c.structures) ? (c.structures as unknown[]) : [];
  need(structures.length <= WIRE_LIMITS.maxStructures, "bad_charter", `at most ${WIRE_LIMITS.maxStructures} structures`);
  need(structures.every((s) => isInt(s)), "bad_charter", "structures is a list of structure ids");
  // nothing passes through as the model wrote it: every field is read as its own type, and
  // text is cleaned and cut here, before the charter is kept anywhere
  return {
    grammar: GRAMMAR_VERSION,
    name: cleanText(c.name, INSTITUTION_LIMITS.nameChars),
    purpose: cleanText(c.purpose, INSTITUTION_LIMITS.purposeChars),
    minFounders: intOr(c.founders, 0),
    maxMembers: intOr(c.max_members, 0),
    entry: lower(c.entry),
    bond: bondName === "none" || bondName === "" || bondQty <= 0 ? null : { item: itemId(bondName, "bond_item"), qty: bondQty },
    roles,
    decide: decide === "role" ? { rule: "role", role: intOr(c.decide_role, -1), quorum: intOr(c.quorum_permille, 0) } : { rule: decide, quorum: intOr(c.quorum_permille, 0) },
    period: intOr(c.period_ticks, 0),
    stores: structures,
    rules: rulesOf(c.rules, roleNames),
    days: intOr(c.days, 0),
  };
}

function speechOf(a: WireAction, obs: Observation): SpeechAct {
  const kind = lower(a.speech) || (typeof a.text === "string" && a.text.trim() ? "free" : "");
  need((SPEECH_KINDS as readonly string[]).includes(kind), "unknown_speech_act", "say needs a kind of speech");
  switch (kind) {
    case "greet":
      return { t: "greet" };
    case "free":
      return { t: "free" };
    case "inform_node": {
      need(isInt(a.about), "malformed", "inform_node needs the id of the place in about");
      // you can tell only of places you know; the time attached is when you learned of it
      const known = obs.nodes.find((n) => n.id === a.about);
      need(!!known, "unknown_place", "you can only tell of a place you know");
      const amount = isInt(a.qty) && a.qty >= 0 ? a.qty : known!.amount;
      return { t: "inform_node", node: a.about as number, amount: clamp(amount, 0, 30_000), tick: Math.max(0, obs.tick - known!.age) };
    }
    case "inform_structure":
      need(isInt(a.about), "malformed", "inform_structure needs the structure id in about");
      return { t: "inform_structure", structure: a.about as number };
    case "inform_agent": {
      need(isInt(a.about), "malformed", "inform_agent needs the person's id in about");
      const claim = lower(a.claim);
      need((CLAIMS as readonly string[]).includes(claim), "malformed", "inform_agent needs a claim");
      return { t: "inform_agent", about: a.about as number, claim: claim as (typeof CLAIMS)[number], tick: obs.tick };
    }
    case "request":
      return { t: "request", item: itemId(a.what, "what"), qty: clamp(intOr(a.qty, 1), 1, 10_000) };
    case "offer":
      return { t: "offer", give: itemId(a.what, "what"), giveQty: clamp(intOr(a.qty, 1), 1, 10_000), want: itemId(a.want, "want"), wantQty: clamp(intOr(a.want_qty, 1), 1, 10_000) };
    case "accept":
    case "decline":
      need(isInt(a.about), "malformed", `${kind} needs the id of what was said in about`);
      return { t: kind, ref: a.about as number };
    case "promise":
      return { t: "promise", item: itemId(a.what, "what"), qty: clamp(intOr(a.qty, 1), 1, 10_000), due: obs.tick + clamp(intOr(a.ticks, 96), 1, 960) };
    case "announce":
      need(isInt(a.about), "malformed", "announce needs the agreement's id in about");
      return { t: "announce", proposal: a.about as number };
    case "invite":
      need(isInt(a.about), "malformed", "invite needs the agreement's id in about");
      return { t: "invite", institution: a.about as number };
    default:
      need(isInt(a.about), "malformed", "warn needs the id of the place in about");
      return { t: "warn", node: a.about as number };
  }
}

function motionOf(a: WireAction, charter: unknown): unknown {
  const kind = lower(a.motion);
  need((MOTION_KINDS as readonly string[]).includes(kind), "bad_motion", "a motion needs a kind");
  switch (kind) {
    case "amend": {
      need(isObj(charter), "needs_charter", "an amendment gives the new rules in the charter block");
      return { m: "amend", rules: rulesOf((charter as Record<string, unknown>).rules, []) };
    }
    case "admit":
    case "expel":
      need(isInt(a.about), "malformed", `${kind} needs the person's id in about`);
      return { m: kind, agent: a.about };
    case "assign":
      need(isInt(a.about) && isInt(a.role), "malformed", "assign needs the person's id in about and a role index");
      return { m: "assign", role: a.role, agent: a.about };
    case "grant":
      need(isInt(a.about), "malformed", "grant needs the member's id in about");
      return { m: "grant", agent: a.about, item: itemId(a.what, "what"), qty: intOr(a.qty, 1) };
    case "bind":
    case "release":
      need(isInt(a.about), "malformed", `${kind} needs the structure's id in about`);
      return { m: kind, structure: a.about };
    default:
      return { m: "dissolve" };
  }
}

/** One wire action as an engine intent. Throws `Unreadable` if it cannot be read. */
function intentOf(a: WireAction, obs: Observation, charter: unknown): Intent {
  const kind = lower(a.do) as ActionKind;
  const target = (what: string): number => {
    need(isInt(a.target), "malformed", `${kind} needs ${what} in target`);
    return a.target as number;
  };
  const qty = (fallback: number, hi = 10_000): number => clamp(intOr(a.qty, fallback), 1, hi);
  switch (kind) {
    case "goto":
      need(isInt(a.x) && isInt(a.y), "bad_tile", "goto needs x and y");
      return { k: "goto", x: a.x as number, y: a.y as number, near: clamp(intOr(a.qty, 0), 0, 6) };
    case "explore":
    case "drink":
    case "fill":
      return { k: kind };
    case "rest":
    case "wait":
      return { k: kind, ticks: clamp(intOr(a.ticks, 8), 1, 96) };
    case "eat":
    case "drop":
    case "pickup":
      return { k: kind, item: itemId(a.what, "what"), qty: qty(1) };
    case "gather":
      return { k: "gather", node: target("the place's id"), qty: qty(3) };
    case "craft": {
      const name = lower(a.what);
      const recipe = RECIPE_NAMES.indexOf(name);
      need(recipe >= 0, "unknown_recipe", "craft needs a recipe name in what");
      return { k: "craft", recipe };
    }
    case "build": {
      // continuing a known site: its id is enough
      const site = isInt(a.target) && a.target >= 0 ? obs.structures.find((s) => s.id === a.target) : undefined;
      if (site) return { k: "build", kind: STRUCTURE_NAMES.indexOf(site.kind), x: site.x, y: site.y };
      const structure = STRUCTURE_NAMES.indexOf(lower(a.what));
      need(structure >= 0, "malformed", "build needs the id of a site you know in target, or a kind of structure in what");
      need(isInt(a.x) && isInt(a.y), "bad_tile", "a new structure needs x and y");
      return { k: "build", kind: structure, x: a.x as number, y: a.y as number };
    }
    case "refuel":
      return { k: "refuel", structure: target("the fire's id"), qty: qty(1) };
    case "harvest":
    case "inspect":
      return { k: kind, structure: target("the structure's id") };
    case "deposit":
    case "withdraw":
      return { k: kind, structure: target("the store's id"), item: itemId(a.what, "what"), qty: qty(1) };
    case "give":
      return { k: "give", to: target("the person's id"), item: itemId(a.what, "what"), qty: qty(1) };
    case "say": {
      const act = speechOf(a, obs);
      const words = typeof a.text === "string" ? a.text.trim().slice(0, DECISION_LIMITS.maxTextChars) : "";
      return { k: "say", to: intOr(a.target, -1), act, ...(words ? { text: words } : {}) };
    }
    case "propose":
      return { k: "propose", charter: charterOf(charter) };
    case "endorse":
      return { k: "endorse", proposal: target("the agreement's id") };
    case "motion":
      return { k: "motion", institution: target("the agreement's id"), motion: motionOf(a, charter) };
    case "vote":
      need(typeof a.yes === "boolean", "malformed", "vote needs yes: true or false");
      return { k: "vote", motion: target("the motion's id"), yes: a.yes as boolean };
    case "leave":
      return { k: "leave", institution: target("the agreement's id") };
    case "pact_offer":
      return { k: "pact_offer", to: intOr(a.target, -1), give: itemId(a.what, "what"), giveQty: qty(1), want: itemId(a.want, "want"), wantQty: clamp(intOr(a.want_qty, 1), 1, 10_000) };
    case "pact_accept":
      return { k: "pact_accept", pact: target("the offer's id") };
    default:
      throw new Unreadable("unknown_intent", `"${cleanLabel(a.do, 24)}" is not an action`);
  }
}

/**
 * Read a model's answer. Never throws; never returns anything but intents the engine's
 * own checks will then judge.
 */
export function parseWire(textValue: unknown, obs: Observation): WireResult {
  const fail = (error: string, detail?: string): WireResult => ({ ok: false, error, ...(detail ? { detail } : {}), decision: null, confidence: "", cites: [] });
  if (typeof textValue !== "string") return fail("not_json", "the answer is not text");
  if (textValue.length > WIRE_LIMITS.maxChars) return fail("too_long", `the answer is longer than ${WIRE_LIMITS.maxChars} characters`);
  let raw: unknown;
  try {
    raw = JSON.parse(textValue);
  } catch {
    return fail("not_json", "the answer is not JSON");
  }
  if (!isObj(raw)) return fail("wrong_shape", "the answer is not an object");
  if (!Array.isArray(raw.actions)) return fail("wrong_shape", "actions is not a list");
  if (raw.actions.length > WIRE_LIMITS.maxActions) return fail("wrong_shape", "too many actions");

  const intents: Intent[] = [];
  const dropped: Dropped[] = [];
  for (const item of raw.actions as unknown[]) {
    if (!isObj(item)) {
      dropped.push({ action: "action", reason: "malformed", detail: "an action must be an object" });
      continue;
    }
    const a = item as unknown as WireAction;
    try {
      intents.push(intentOf(a, obs, raw.charter));
    } catch (err) {
      if (!(err instanceof Unreadable)) throw err;
      dropped.push({ action: lower(a.do).slice(0, 24) || "action", reason: err.reason, ...(err.detail ? { detail: err.detail } : {}) });
    }
  }
  const confidence = lower(raw.confidence);
  const cites = Array.isArray(raw.cites) ? (raw.cites as unknown[]).filter((c): c is string => typeof c === "string").map((c) => c.trim().slice(0, 8)).filter((c) => /^[mh]\d{1,2}$/.test(c)).slice(0, WIRE_LIMITS.maxCites) : [];
  return {
    ok: true,
    decision: {
      intents,
      ...(typeof raw.goal === "string" ? { goal: raw.goal } : {}),
      ...(typeof raw.why === "string" ? { rationale: raw.why } : {}),
      ...(typeof raw.note === "string" ? { note: raw.note } : {}),
      ...(dropped.length ? { dropped } : {}),
    },
    confidence: (CONFIDENCE as readonly string[]).includes(confidence) ? (confidence as "low" | "medium" | "high") : "",
    cites,
  };
}

// ───────────────────────── writing an answer (used by the mock mind and by round-trip tests)

const itemName = (i: number): string => ITEM_NAMES[i] ?? "";

function ruleToWire(r: Rule): WireRule {
  const who = r.who.t === "all" ? "all" : `${r.who.t}:${r.who.role}`;
  const base: WireRule = { form: r.r, who, item: "none", amount: "", when: r.when ? formatFormula(r.when, ITEM_NAMES) : "", structure: -1, place_kind: "none", within: 0, or_else: "none", or_else_qty: 0 };
  const sanction = (s: Sanction): Partial<WireRule> => (s.t === "forfeit" ? { or_else: "forfeit", or_else_qty: s.qty } : s.t === "suspend" ? { or_else: "suspend", or_else_qty: s.periods } : { or_else: s.t });
  switch (r.r) {
    case "may_withdraw":
      return { ...base, item: r.item < 0 ? "food" : itemName(r.item), amount: formatFormula(r.quota, ITEM_NAMES) };
    case "may_shelter":
      return base;
    case "must_deposit":
      return { ...base, item: r.item < 0 ? "food" : itemName(r.item), amount: formatFormula(r.qty, ITEM_NAMES), ...sanction(r.else) };
    case "must_supply":
      return { ...base, structure: r.structure, amount: formatFormula(r.worth, ITEM_NAMES), ...sanction(r.else) };
    default:
      return { ...base, place_kind: r.kind < 0 ? "any" : (PLACE_NAMES[r.kind] ?? "any"), within: r.within, amount: formatFormula(r.over, ITEM_NAMES), ...sanction(r.else) };
  }
}

/** A validated charter in wire form. */
export function charterToWire(c: Charter): WireCharter {
  return {
    name: c.name,
    purpose: c.purpose,
    founders: c.minFounders,
    max_members: c.maxMembers,
    entry: c.entry,
    bond_item: c.bond ? itemName(c.bond.item) : "none",
    bond_qty: c.bond ? c.bond.qty : 0,
    roles: c.roles.map((r) => ({ name: r.name, seats: r.seats, filled_by: r.by })),
    decide: c.decide.rule,
    decide_role: c.decide.rule === "role" ? (c.decide.role ?? -1) : -1,
    quorum_permille: c.decide.quorum,
    period_ticks: c.period,
    structures: c.stores.slice(),
    days: c.days,
    rules: c.rules.map(ruleToWire),
  };
}

/**
 * An engine intent in wire form. `charter` receives the charter block when the intent
 * carries one (a proposal, or an amendment's rules). Used to drive the whole reading path
 * from decisions that did not come from a model.
 */
export function intentToWire(intent: Intent, obs: Observation, charter: { value?: WireCharter } = {}): WireAction {
  switch (intent.k) {
    case "goto":
      return { do: "goto", x: intent.x, y: intent.y, ...(intent.near ? { qty: intent.near } : {}) };
    case "explore":
    case "drink":
    case "fill":
      return { do: intent.k };
    case "rest":
    case "wait":
      return { do: intent.k, ticks: intent.ticks };
    case "eat":
    case "drop":
    case "pickup":
      return { do: intent.k, what: itemName(intent.item), qty: intent.qty };
    case "gather":
      return { do: "gather", target: intent.node, qty: intent.qty };
    case "craft":
      return { do: "craft", what: RECIPE_NAMES[intent.recipe] ?? "" };
    case "build":
      return { do: "build", what: STRUCTURE_NAMES[intent.kind] ?? "", x: intent.x, y: intent.y };
    case "refuel":
      return { do: "refuel", target: intent.structure, qty: intent.qty };
    case "harvest":
    case "inspect":
      return { do: intent.k, target: intent.structure };
    case "deposit":
    case "withdraw":
      return { do: intent.k, target: intent.structure, what: itemName(intent.item), qty: intent.qty };
    case "give":
      return { do: "give", target: intent.to, what: itemName(intent.item), qty: intent.qty };
    case "say": {
      const base: WireAction = { do: "say", target: intent.to, speech: intent.act.t, ...(intent.text ? { text: intent.text } : {}) };
      const act = intent.act;
      switch (act.t) {
        case "inform_node":
          return { ...base, about: act.node, qty: act.amount };
        case "inform_structure":
          return { ...base, about: act.structure };
        case "inform_agent":
          return { ...base, about: act.about, claim: act.claim };
        case "request":
          return { ...base, what: itemName(act.item), qty: act.qty };
        case "offer":
          return { ...base, what: itemName(act.give), qty: act.giveQty, want: itemName(act.want), want_qty: act.wantQty };
        case "accept":
        case "decline":
          return { ...base, about: act.ref };
        case "promise":
          return { ...base, what: itemName(act.item), qty: act.qty, ticks: Math.max(1, act.due - obs.tick) };
        case "announce":
          return { ...base, about: act.proposal };
        case "invite":
          return { ...base, about: act.institution };
        case "warn":
          return { ...base, about: act.node };
        default:
          return base;
      }
    }
    case "propose":
      charter.value = charterToWire(intent.charter as Charter);
      return { do: "propose" };
    case "endorse":
      return { do: "endorse", target: intent.proposal };
    case "motion": {
      const body = intent.motion as MotionBody;
      const base: WireAction = { do: "motion", target: intent.institution, motion: body.m };
      switch (body.m) {
        case "amend":
          charter.value = { name: "", purpose: "", founders: 2, max_members: 2, entry: "closed", bond_item: "none", bond_qty: 0, roles: [], decide: "majority", decide_role: -1, quorum_permille: 0, period_ticks: 96, structures: [], days: 0, rules: body.rules.map(ruleToWire) };
          return base;
        case "admit":
        case "expel":
          return { ...base, about: body.agent };
        case "assign":
          return { ...base, about: body.agent, role: body.role };
        case "grant":
          return { ...base, about: body.agent, what: itemName(body.item), qty: body.qty };
        case "bind":
        case "release":
          return { ...base, about: body.structure };
        default:
          return base;
      }
    }
    case "vote":
      return { do: "vote", target: intent.motion, yes: intent.yes };
    case "leave":
      return { do: "leave", target: intent.institution };
    case "pact_offer":
      return { do: "pact_offer", target: intent.to, what: itemName(intent.give), qty: intent.giveQty, want: itemName(intent.want), want_qty: intent.wantQty };
    case "pact_accept":
      return { do: "pact_accept", target: intent.pact };
    default:
      // supply and work are steps of a build; a mind asks for the build
      return { do: "wait", ticks: 1 };
  }
}

/** A whole decision in wire form (the text a well-behaved model would return for it). */
export function decisionToWire(decision: ExternalDecision, obs: Observation, extra: { confidence?: string; cites?: string[] } = {}): WireDecision {
  const charter: { value?: WireCharter } = {};
  const actions = decision.intents.map((i) => intentToWire(i, obs, charter));
  return {
    goal: decision.goal ?? "",
    why: decision.rationale ?? "",
    confidence: extra.confidence ?? "medium",
    note: decision.note ?? "",
    cites: extra.cites ?? [],
    actions,
    ...(charter.value ? { charter: charter.value } : {}),
  };
}
