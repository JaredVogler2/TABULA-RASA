/**
 * Charter validation: the only door through which a proposed institution enters the world.
 *
 * Input is untrusted (it may come from a language model). Output is either a clean charter
 * rebuilt field by field in a fixed order — so that equal charters serialize identically —
 * or a list of diagnostics that say where and why it was refused. Nothing is "repaired":
 * a charter that asks for something the grammar cannot express is rejected, not approximated.
 *
 * What cannot be expressed, by construction: creating or destroying goods, taking from a
 * person, binding someone who did not consent, reading private state, running code, calling
 * another rule, looping. What is checked here: every bound, every index, and that the
 * proposer has standing over each structure they want to place under common control.
 */
import { cleanLabel, cleanText } from "../core/text";
import { ITEM_COUNT, NODE_KINDS, StructureKind } from "../model/constants";
import type { WorldState } from "../model/types";
import { checkExpr } from "./expr";
import { GRAMMAR_VERSION, LIMITS, type Charter, type DecisionRule, type Diagnostic, type MotionBody, type Rule, type Sanction, type Who } from "./types";

const RULE_FORMS: readonly string[] = ["may_withdraw", "may_shelter", "must_deposit", "must_supply", "must_not_gather"];

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export type Validation<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] };

function checkWho(raw: unknown, path: string, roles: number, d: Diagnostic[]): Who | null {
  if (!isObj(raw) || typeof raw.t !== "string") {
    d.push({ path, code: "bad_scope", message: 'expected { t: "all" }, { t: "role", role } or { t: "others", role }' });
    return null;
  }
  if (raw.t === "all") return { t: "all" };
  if (raw.t === "role" || raw.t === "others") {
    if (!isInt(raw.role) || raw.role < 0 || raw.role >= roles) {
      d.push({ path: `${path}.role`, code: "unknown_role", message: "the rule names a role this charter does not declare" });
      return null;
    }
    return { t: raw.t, role: raw.role };
  }
  d.push({ path, code: "bad_scope", message: "a rule can apply to all members, to holders of a role, or to everyone but them" });
  return null;
}

function checkSanction(raw: unknown, path: string, bond: Charter["bond"], d: Diagnostic[]): Sanction | null {
  if (!isObj(raw) || typeof raw.t !== "string") {
    d.push({ path, code: "bad_sanction", message: "expected note, forfeit, suspend or expel" });
    return null;
  }
  switch (raw.t) {
    case "note":
      return { t: "note" };
    case "expel":
      return { t: "expel" };
    case "suspend":
      if (!isInt(raw.periods) || raw.periods < 1 || raw.periods > LIMITS.suspendPeriods) {
        d.push({ path: `${path}.periods`, code: "out_of_range", message: `a suspension lasts 1 to ${LIMITS.suspendPeriods} periods` });
        return null;
      }
      return { t: "suspend", periods: raw.periods };
    case "forfeit":
      if (!bond) {
        d.push({ path, code: "nothing_to_forfeit", message: "a charter that takes no bond has nothing it can forfeit; a rule cannot take what was not posted" });
        return null;
      }
      if (!isInt(raw.qty) || raw.qty < 1 || raw.qty > bond.qty) {
        d.push({ path: `${path}.qty`, code: "exceeds_bond", message: `a forfeit can be at most the bond posted (${bond.qty})` });
        return null;
      }
      return { t: "forfeit", qty: raw.qty };
    default:
      d.push({ path, code: "bad_sanction", message: `"${cleanLabel(raw.t, 24)}" is not a sanction the grammar has; an institution can note, keep a bond, suspend or expel — nothing else` });
      return null;
  }
}

function checkItem(raw: unknown, path: string, d: Diagnostic[]): number | null {
  if (!isInt(raw) || raw < -1 || raw >= ITEM_COUNT) {
    d.push({ path, code: "bad_item", message: "item must be an item id, or -1 for any food" });
    return null;
  }
  return raw;
}

function checkRule(world: WorldState, raw: unknown, path: string, roles: number, bond: Charter["bond"], d: Diagnostic[]): Rule | null {
  if (!isObj(raw) || typeof raw.r !== "string") {
    d.push({ path, code: "bad_rule", message: "a rule needs a form: may_withdraw, may_shelter, must_deposit, must_supply or must_not_gather" });
    return null;
  }
  if (!RULE_FORMS.includes(raw.r)) {
    d.push({
      path: `${path}.r`,
      code: "not_expressible",
      message: `"${cleanLabel(raw.r, 32)}" is not a rule form. The grammar has: ${RULE_FORMS.join(", ")}. Rules cannot take from people, punish beyond a posted bond, or act on non-members.`,
    });
    return null;
  }
  const before = d.length;
  const who = checkWho(raw.who, `${path}.who`, roles, d);
  const when = raw.when === undefined ? undefined : checkExpr(raw.when, `${path}.when`, roles, d);
  const fine = () => d.length === before && who !== null;
  switch (raw.r) {
    case "may_withdraw": {
      const item = checkItem(raw.item, `${path}.item`, d);
      const quota = checkExpr(raw.quota, `${path}.quota`, roles, d);
      if (!fine() || item === null || !quota) return null;
      return { r: "may_withdraw", who: who!, item, quota, ...(when ? { when } : {}) };
    }
    case "may_shelter":
      if (!fine()) return null;
      return { r: "may_shelter", who: who!, ...(when ? { when } : {}) };
    case "must_deposit": {
      const item = checkItem(raw.item, `${path}.item`, d);
      const qty = checkExpr(raw.qty, `${path}.qty`, roles, d);
      const otherwise = checkSanction(raw.else, `${path}.else`, bond, d);
      if (!fine() || item === null || !qty || !otherwise) return null;
      return { r: "must_deposit", who: who!, item, qty, ...(when ? { when } : {}), else: otherwise };
    }
    case "must_supply": {
      const worth = checkExpr(raw.worth, `${path}.worth`, roles, d);
      const otherwise = checkSanction(raw.else, `${path}.else`, bond, d);
      const s = isInt(raw.structure) ? world.structures[raw.structure] : undefined;
      // a building site until it is finished; a hearth for as long as it stands (its fuel is never finished)
      if (!s || s.removed || (s.complete && s.kind !== StructureKind.campfire)) {
        d.push({ path: `${path}.structure`, code: "no_such_site", message: "must_supply needs an unfinished building site, or a hearth to keep in fuel" });
        return null;
      }
      if (raw.when !== undefined && s.kind !== StructureKind.campfire) d.push({ path: `${path}.when`, code: "not_expressible", message: "an obligation to build has no condition (it ends when the building is finished); only the keeping of a hearth can be seasonal" });
      if (!fine() || !worth || !otherwise) return null;
      return { r: "must_supply", who: who!, structure: s.id, worth, ...(when ? { when } : {}), else: otherwise };
    }
    case "must_not_gather": {
      const kind = raw.kind;
      if (!isInt(kind) || kind < -1 || kind >= NODE_KINDS.length) d.push({ path: `${path}.kind`, code: "bad_kind", message: "kind must be a kind of resource place, or -1 for any" });
      if (!isInt(raw.within) || raw.within < 1 || raw.within > LIMITS.gatherRadius) d.push({ path: `${path}.within`, code: "out_of_range", message: `the area a rule covers reaches 1 to ${LIMITS.gatherRadius} tiles from the institution's seat` });
      const over = checkExpr(raw.over, `${path}.over`, roles, d);
      const otherwise = checkSanction(raw.else, `${path}.else`, bond, d);
      if (!fine() || !over || !otherwise) return null;
      return { r: "must_not_gather", who: who!, kind: kind as number, within: raw.within as number, over, ...(when ? { when } : {}), else: otherwise };
    }
    default:
      return null;
  }
}

/** Validate a rules list against a charter's declared roles and bond. */
export function validateRules(world: WorldState, raw: unknown, roles: number, bond: Charter["bond"], d: Diagnostic[], path = "rules"): Rule[] | null {
  if (!Array.isArray(raw)) {
    d.push({ path, code: "bad_rules", message: "rules must be a list" });
    return null;
  }
  if (raw.length > LIMITS.rules) {
    d.push({ path, code: "too_many", message: `a charter may have at most ${LIMITS.rules} rules` });
    return null;
  }
  const rules: Rule[] = [];
  for (let i = 0; i < raw.length; i++) {
    const rule = checkRule(world, raw[i], `${path}[${i}]`, roles, bond, d);
    if (rule) rules.push(rule);
  }
  return rules.length === raw.length ? rules : null;
}

/** True if the agent founded the structure or put materials or labour into raising it. */
export function hasStanding(world: WorldState, agentId: number, structureId: number): boolean {
  const s = world.structures[structureId];
  return !!s && !s.removed && (s.founder === agentId || s.builders.includes(agentId));
}

export function validateCharter(world: WorldState, proposerId: number, raw: unknown): Validation<Charter> {
  const d: Diagnostic[] = [];
  const bad = (path: string, code: string, message: string) => d.push({ path, code, message });
  if (!isObj(raw)) return { ok: false, diagnostics: [{ path: "", code: "not_a_charter", message: "a charter must be an object" }] };
  if (raw.grammar !== GRAMMAR_VERSION) bad("grammar", "wrong_grammar", `this world reads grammar version ${GRAMMAR_VERSION}`);

  const name = cleanText(raw.name, LIMITS.nameChars);
  if (!name) bad("name", "missing", "a charter needs a name (it has no effect, but people must be able to refer to it)");
  const purpose = cleanText(raw.purpose, LIMITS.purposeChars);

  const maxMembers = raw.maxMembers;
  if (!isInt(maxMembers) || maxMembers < 2 || maxMembers > LIMITS.members) bad("maxMembers", "out_of_range", `maxMembers must be between 2 and ${LIMITS.members}`);
  const minFounders = raw.minFounders;
  if (!isInt(minFounders) || minFounders < 2 || (isInt(maxMembers) && minFounders > maxMembers)) bad("minFounders", "out_of_range", "an institution needs at least two founders, and no more than its maximum membership");

  const entry = raw.entry;
  if (entry !== "open" && entry !== "vote" && entry !== "closed") bad("entry", "bad_value", 'entry must be "open", "vote" or "closed"');

  let bond: Charter["bond"] = null;
  if (raw.bond !== null && raw.bond !== undefined) {
    if (!isObj(raw.bond) || !isInt(raw.bond.item) || raw.bond.item < 0 || raw.bond.item >= ITEM_COUNT || !isInt(raw.bond.qty) || raw.bond.qty < 1 || raw.bond.qty > LIMITS.bondQty) {
      bad("bond", "out_of_range", `a bond is 1 to ${LIMITS.bondQty} units of one item`);
    } else {
      bond = { item: raw.bond.item, qty: raw.bond.qty };
    }
  }

  const roles: Charter["roles"] = [];
  if (raw.roles !== undefined) {
    if (!Array.isArray(raw.roles) || raw.roles.length > LIMITS.roles) {
      bad("roles", "too_many", `a charter may declare at most ${LIMITS.roles} roles`);
    } else {
      raw.roles.forEach((r: unknown, i: number) => {
        if (!isObj(r) || !isInt(r.seats) || r.seats < 1 || r.seats > LIMITS.seats || (r.by !== "founder" && r.by !== "vote")) {
          bad(`roles[${i}]`, "bad_role", `a role needs a name, 1 to ${LIMITS.seats} seats, and to be filled by "founder" or by "vote"`);
          return;
        }
        // a role's name is written into the sentences that state the charter's rules, in everyone's
        // observations: it is kept to a plain label so that it can never read as anything else
        roles.push({ name: cleanLabel(r.name, LIMITS.roleChars) || `role ${i + 1}`, seats: r.seats, by: r.by });
      });
    }
  }
  const roleCount = Array.isArray(raw.roles) ? raw.roles.length : 0;

  let decide: Charter["decide"] = { rule: "unanimity", quorum: 0 };
  if (!isObj(raw.decide) || typeof raw.decide.rule !== "string" || !["unanimity", "majority", "two_thirds", "role"].includes(raw.decide.rule)) {
    bad("decide", "missing", 'a charter must say how its members decide: "unanimity", "majority", "two_thirds" or by a "role". Nothing is assumed.');
  } else {
    const quorum = raw.decide.quorum === undefined ? 0 : raw.decide.quorum;
    if (!isInt(quorum) || quorum < 0 || quorum > 1000) bad("decide.quorum", "out_of_range", "quorum is a share of members in permille, 0 to 1000");
    if (raw.decide.rule === "role") {
      if (!isInt(raw.decide.role) || raw.decide.role < 0 || raw.decide.role >= roleCount) bad("decide.role", "unknown_role", "decisions by a role need a role this charter declares");
      else decide = { rule: "role", role: raw.decide.role, quorum: isInt(quorum) ? quorum : 0 };
    } else {
      decide = { rule: raw.decide.rule as DecisionRule, quorum: isInt(quorum) ? quorum : 0 };
    }
  }

  if (!isInt(raw.period) || raw.period < LIMITS.periodMin || raw.period > LIMITS.periodMax) bad("period", "out_of_range", `the accounting period is ${LIMITS.periodMin} to ${LIMITS.periodMax} ticks`);
  const days = raw.days === undefined ? 0 : raw.days;
  if (!isInt(days) || days < 0 || days > LIMITS.lifetimeDays) bad("days", "out_of_range", `a lifetime is 0 (until dissolved) to ${LIMITS.lifetimeDays} days`);

  const stores: number[] = [];
  if (raw.stores !== undefined) {
    if (!Array.isArray(raw.stores) || raw.stores.length > LIMITS.stores) {
      bad("stores", "too_many", `a charter may place at most ${LIMITS.stores} structures under common control`);
    } else {
      raw.stores.forEach((id: unknown, i: number) => {
        const s = isInt(id) ? world.structures[id] : undefined;
        if (!s || s.removed || (s.kind !== StructureKind.store && s.kind !== StructureKind.shelter)) {
          bad(`stores[${i}]`, "no_such_structure", "only a store or a shelter that exists can be placed under common control");
        } else if (s.bound >= 0) {
          bad(`stores[${i}]`, "already_controlled", "that structure is already controlled by another institution");
        } else if (!hasStanding(world, proposerId, s.id)) {
          bad(`stores[${i}]`, "no_standing", "you can only place under common control what you built or helped to build");
        } else if (stores.includes(s.id)) {
          bad(`stores[${i}]`, "duplicate", "the same structure is listed twice");
        } else {
          stores.push(s.id);
        }
      });
    }
  }

  const rules = validateRules(world, raw.rules ?? [], roleCount, bond, d);
  if (d.length > 0 || !rules) return { ok: false, diagnostics: d };
  return {
    ok: true,
    value: {
      grammar: GRAMMAR_VERSION,
      name,
      purpose,
      minFounders: minFounders as number,
      maxMembers: maxMembers as number,
      entry: entry as Charter["entry"],
      bond,
      roles,
      decide,
      period: raw.period as number,
      stores,
      rules,
      days: days as number,
    },
  };
}

/** Validate the body of a motion in the context of the institution it is moved in. */
export function validateMotion(world: WorldState, charter: Charter, memberIds: readonly number[], raw: unknown): Validation<MotionBody> {
  const d: Diagnostic[] = [];
  const fail = (code: string, message: string): Validation<MotionBody> => ({ ok: false, diagnostics: [{ path: "motion", code, message }] });
  if (!isObj(raw) || typeof raw.m !== "string") return fail("bad_motion", "a motion needs a kind: amend, admit, expel, assign, grant, bind, release or dissolve");
  const agentOk = (x: unknown): x is number => isInt(x) && x >= 0 && x < world.agents.length && world.agents[x]!.alive;
  switch (raw.m) {
    case "amend": {
      const rules = validateRules(world, raw.rules, charter.roles.length, charter.bond, d, "motion.rules");
      if (!rules || d.length) return { ok: false, diagnostics: d };
      return { ok: true, value: { m: "amend", rules } };
    }
    case "admit":
      if (!agentOk(raw.agent) || memberIds.includes(raw.agent)) return fail("bad_agent", "admit needs a living person who is not already a member");
      return { ok: true, value: { m: "admit", agent: raw.agent } };
    case "expel":
      if (!isInt(raw.agent) || !memberIds.includes(raw.agent)) return fail("bad_agent", "expel needs a member");
      return { ok: true, value: { m: "expel", agent: raw.agent } };
    case "assign": {
      if (!isInt(raw.role) || raw.role < 0 || raw.role >= charter.roles.length) return fail("unknown_role", "assign needs a role this charter declares");
      if (charter.roles[raw.role]!.by !== "vote") return fail("not_elective", "that role is held by the founders and is not filled by vote");
      if (!isInt(raw.agent) || !memberIds.includes(raw.agent)) return fail("bad_agent", "a role can only be given to a member");
      return { ok: true, value: { m: "assign", role: raw.role, agent: raw.agent } };
    }
    case "grant":
      if (!isInt(raw.agent) || !memberIds.includes(raw.agent)) return fail("bad_agent", "a grant can only be made to a member");
      if (!isInt(raw.item) || raw.item < 0 || raw.item >= ITEM_COUNT) return fail("bad_item", "a grant names one item");
      if (!isInt(raw.qty) || raw.qty < 1 || raw.qty > LIMITS.grantQty) return fail("out_of_range", `a grant is 1 to ${LIMITS.grantQty} units, drawn from the common store when the member collects it`);
      return { ok: true, value: { m: "grant", agent: raw.agent, item: raw.item, qty: raw.qty } };
    case "bind": {
      const s = isInt(raw.structure) ? world.structures[raw.structure] : undefined;
      if (!s || s.removed || (s.kind !== StructureKind.store && s.kind !== StructureKind.shelter)) return fail("no_such_structure", "only a store or a shelter that exists can be placed under common control");
      if (s.bound >= 0) return fail("already_controlled", "that structure is already controlled by an institution");
      return { ok: true, value: { m: "bind", structure: s.id } };
    }
    case "release":
      if (!isInt(raw.structure)) return fail("no_such_structure", "release needs a structure this institution controls");
      return { ok: true, value: { m: "release", structure: raw.structure } };
    case "dissolve":
      return { ok: true, value: { m: "dissolve" } };
    default:
      return fail("not_expressible", `"${raw.m.slice(0, 24)}" is not something a motion can do`);
  }
}
