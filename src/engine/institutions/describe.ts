/**
 * Charters in plain words: one sentence per rule, for inspectors and for the observations
 * handed to minds. These sentences describe exactly what the interpreter will do; they are
 * generated from the validated charter and nothing else — never from its name or its stated
 * purpose. The one thing an author wrote that does appear in them is the name of a role, and
 * it appears only as the validator leaves it (a short plain label: `cleanLabel`) and only
 * inside quotation marks, so that a role's name can never pass for part of a rule.
 */
import { ITEMS, NODE_KINDS } from "../model/constants";
import { showExpr } from "./expr";
import type { Charter, MotionBody, Rule, Sanction, Who } from "./types";

const itemName = (i: number): string => (i < 0 ? "food" : (ITEMS[i] ?? "?"));

/** A role's name as it is written into a sentence: quoted, always. */
export const roleLabel = (name: string | undefined): string => `"${name ?? "role"}"`;

function whoText(who: Who, roles: readonly string[]): string {
  if (who.t === "all") return "Every member";
  const role = roleLabel(roles[who.role]);
  return who.t === "role" ? `Each member with the role ${role}` : `Every member without the role ${role}`;
}

function sanctionText(s: Sanction, charter: Charter): string {
  switch (s.t) {
    case "note":
      return "or it is recorded against them";
    case "forfeit":
      return `or lose ${s.qty} ${itemName(charter.bond?.item ?? -1)} of their bond`;
    case "suspend":
      return `or be barred from the common stock for ${s.periods} period${s.periods === 1 ? "" : "s"}`;
    case "expel":
      return "or be put out and lose their bond";
  }
}

export function describeRule(rule: Rule, charter: Charter): string {
  const roles = charter.roles.map((r) => r.name);
  const show = (e: Parameters<typeof showExpr>[0]) => showExpr(e, ITEMS, roles);
  const when = "when" in rule && rule.when ? `, when ${show(rule.when)}` : "";
  const subject = whoText(rule.who, roles);
  switch (rule.r) {
    case "may_withdraw":
      return `${subject} may draw up to ${show(rule.quota)} ${itemName(rule.item)} from the common stock each period${when}.`;
    case "may_shelter":
      return `${subject} may sleep in the common shelter${when}.`;
    case "must_deposit":
      return `${subject} must put ${show(rule.qty)} ${itemName(rule.item)} into the common stock each period${when}, ${sanctionText(rule.else, charter)}.`;
    case "must_supply":
      return `${subject} must put work, materials or fuel worth ${show(rule.worth)} into structure #${rule.structure} each period${when}, ${sanctionText(rule.else, charter)}.`;
    case "must_not_gather":
      return `${subject} must not take more than ${show(rule.over)} from ${rule.kind < 0 ? "any place" : (NODE_KINDS[rule.kind] ?? "?").replace("_", " ")}s within ${rule.within} tiles each period${when}, ${sanctionText(rule.else, charter)} — if another member sees it.`;
  }
}

export function describeTerms(c: Charter): string[] {
  const out: string[] = [];
  out.push(`Founded by at least ${c.minFounders}; at most ${c.maxMembers} members; ${c.entry === "open" ? "anyone may join" : c.entry === "vote" ? "members vote on each applicant" : "closed to new members"}.`);
  out.push(c.bond ? `Each member posts ${c.bond.qty} ${itemName(c.bond.item)} as a bond, returned on leaving unless forfeited.` : "No bond.");
  const how: Record<string, string> = { unanimity: "only if every member agrees", majority: "by a majority of those voting", two_thirds: "by two thirds of those voting", role: `by whoever holds the role ${roleLabel(c.roles[c.decide.role ?? 0]?.name)}` };
  out.push(`Decisions pass ${how[c.decide.rule] ?? c.decide.rule}${c.decide.quorum > 0 ? `, with at least ${Math.round(c.decide.quorum / 10)}% of members voting` : ""}.`);
  if (c.roles.length) out.push(`Roles: ${c.roles.map((r) => `${roleLabel(r.name)} (${r.seats}, ${r.by === "founder" ? "founders" : "elected"})`).join("; ")}.`);
  const span = c.period === 96 ? "one day" : c.period === 48 ? "half a day" : `${(c.period / 4).toFixed(c.period % 4 === 0 ? 0 : 1)} hours`;
  out.push(`A period is ${span}${c.days > 0 ? `; the charter lasts ${c.days} days` : ""}. Anyone may leave at any time.`);
  return out;
}

export function describeMotion(b: MotionBody, name: (agent: number) => string): string {
  switch (b.m) {
    case "amend":
      return `replace the rules with ${b.rules.length} new one${b.rules.length === 1 ? "" : "s"}`;
    case "admit":
      return `admit ${name(b.agent)}`;
    case "expel":
      return `put out ${name(b.agent)}`;
    case "assign":
      return `give a role to ${name(b.agent)}`;
    case "grant":
      return `grant ${name(b.agent)} ${b.qty} ${itemName(b.item)} from the common stock`;
    case "bind":
      return `place structure #${b.structure} under common control`;
    case "release":
      return `release structure #${b.structure}`;
    case "dissolve":
      return "dissolve the institution";
  }
}
