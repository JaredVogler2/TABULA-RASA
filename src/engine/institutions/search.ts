/**
 * Grammar search: the non-LLM source of institutional proposals (treatment `grammar_search`).
 *
 * An agent with a recurring problem draws a handful of charters at random from the
 * distribution below, judges each by its own estimate of what living under it would be worth
 * (`judge.ts`), and puts forward the best one if it clears its own bar. There are no named
 * templates: a "larder", a "closed season" or a "roof compact" can only appear as a
 * combination of independently drawn parts that the proposer happened to rate well.
 *
 * THE DISTRIBUTION IS A DESIGNER PRIOR and is part of the disclosed affordances. Whatever
 * this produces is the outcome of a search over a small, hand-shaped space — not invention —
 * and is always recorded with origin "grammar_search".
 *
 *   controls      own finished store (85% if one exists); own shelter (50% if one exists)
 *   bond          none 40% · 1 or 2 of whichever of root / ration / wood the proposer holds most
 *   founders      3 (60%) · 2 (20%) · 4 (20%)        entry  open 65% · vote 35%
 *   decides by    majority 50% (quorum none or half) · two thirds 25% · unanimity 25%
 *   period        one day 80% · half a day 20%      lifetime  open-ended 80% · 20–40 days
 *   rules         one to three, without repeating a form:
 *                 must_deposit  1–2 food a period; always, or outside winter
 *                 may_withdraw  a flat 1–3 · more when visibly hungry · more in winter · a fair share of the stock
 *                 must_not_gather  berries, roots, fish or wood within 8/12/16 tiles above 2–6 a period; always, or in spring
 *                 must_supply   1–2 wood a period to a hearth the proposer knows near home; always, or in winter
 *   sanction      note 25% · suspend 1–3 periods 45% · forfeit 1 (needs a bond) 20% · expel 10%
 */
import { below, Stream } from "../core/rng";
import { Item, NodeKind, StructureKind, TICKS_PER_DAY } from "../model/constants";
import type { Agent, WorldState } from "../model/types";
import { judgeCharter, signingBar } from "./judge";
import { GRAMMAR_VERSION, type Charter, type Expr, type Rule, type Sanction } from "./types";
import { validateCharter } from "./validate";

/** How many charters a proposer draws before choosing. */
export const SEARCH_DRAWS = 8;

function ownStructures(world: WorldState, agent: Agent, kind: number): number[] {
  const out: number[] = [];
  for (const s of world.structures) {
    if (s.removed || !s.complete || s.kind !== kind || s.bound >= 0) continue;
    if (s.founder === agent.id || s.builders.includes(agent.id)) out.push(s.id);
  }
  return out;
}

/** Draw one charter. `draw` distinguishes the candidates of one search. */
export function sampleCharter(world: WorldState, agent: Agent, draw: number): Charter {
  const seed = world.config.seed;
  let n = 0;
  const pick = (k: number): number => below(k, seed, Stream.Institution, world.tick, agent.id, draw * 64 + n++);
  const pct = (): number => pick(100);

  const stores = ownStructures(world, agent, StructureKind.store);
  const shelters = ownStructures(world, agent, StructureKind.shelter);
  const controls: number[] = [];
  if (stores.length && pct() < 85) controls.push(stores[0] as number);
  if (shelters.length && pct() < 50) controls.push(shelters[0] as number);
  const hasStore = controls.some((id) => world.structures[id]!.kind === StructureKind.store);

  let bond: Charter["bond"] = null;
  if (pct() >= 40) {
    const candidates = [Item.root, Item.ration, Item.wood].sort((p, q) => (agent.inv[q] as number) - (agent.inv[p] as number) || p - q);
    bond = { item: candidates[0] as number, qty: 1 + pick(2) };
  }
  const f = pct();
  const minFounders = f < 60 ? 3 : f < 80 ? 2 : 4;
  const d = pct();
  const decide: Charter["decide"] = d < 50 ? { rule: "majority", quorum: pick(2) * 500 } : d < 75 ? { rule: "two_thirds", quorum: 0 } : { rule: "unanimity", quorum: 0 };

  const sanction = (): Sanction => {
    const s = pct();
    if (s < 25) return { t: "note" };
    if (s < 70) return { t: "suspend", periods: 1 + pick(3) };
    if (s < 90 && bond) return { t: "forfeit", qty: 1 };
    if (s < 90) return { t: "suspend", periods: 2 };
    return { t: "expel" };
  };
  const notWinter: Expr = { o: "lt", a: { v: "season" }, b: { c: 3 } };

  const forms: (() => Rule)[] = [];
  if (hasStore) {
    forms.push(() => ({ r: "must_deposit", who: { t: "all" }, item: -1, qty: { c: 1 + pick(2) }, ...(pct() < 50 ? { when: notWinter } : {}), else: sanction() }));
    forms.push(() => {
      const shape = pick(4);
      const quota: Expr =
        shape === 0
          ? { c: 1 + pick(3) }
          : shape === 1
            ? { o: "if", a: { o: "ge", a: { v: "hunger" }, b: { c: 2 } }, b: { c: 2 + pick(3) }, e: { c: pick(2) } }
            : shape === 2
              ? { o: "if", a: { o: "eq", a: { v: "season" }, b: { c: 3 } }, b: { c: 1 + pick(3) }, e: { c: pick(2) } }
              : { o: "min", a: { c: 2 + pick(3) }, b: { o: "div", a: { v: "stock", i: -1 }, b: { o: "max", a: { v: "members" }, b: { c: 1 } } } };
      return { r: "may_withdraw", who: { t: "all" }, item: -1, quota };
    });
  }
  forms.push(() => {
    const kinds = [NodeKind.berry_bush, NodeKind.root_patch, NodeKind.fishing_water, NodeKind.tree];
    return {
      r: "must_not_gather",
      who: { t: "all" },
      kind: kinds[pick(kinds.length)] as number,
      within: [8, 12, 16][pick(3)] as number,
      over: { c: [2, 3, 4, 6][pick(4)] as number },
      ...(pct() < 30 ? { when: { o: "eq", a: { v: "season" }, b: { c: 0 } } as Expr } : {}),
      else: sanction(),
    };
  });

  // a finished hearth the proposer knows near its home can be kept in fuel by undertaking
  const hx = agent.mind.homeX >= 0 ? agent.mind.homeX : agent.x;
  const hy = agent.mind.homeX >= 0 ? agent.mind.homeY : agent.y;
  const hearth = agent.mind.structs.find((k) => k.kind === StructureKind.campfire && k.state >= 1 && Math.max(Math.abs(k.x - hx), Math.abs(k.y - hy)) <= 4 && world.structures[k.id] && !world.structures[k.id]!.removed);
  if (hearth) {
    forms.push(() => ({
      r: "must_supply",
      who: { t: "all" },
      structure: hearth.id,
      worth: { c: 8 * (1 + pick(2)) },
      ...(pct() < 60 ? { when: { o: "eq", a: { v: "season" }, b: { c: 3 } } as Expr } : {}),
      else: sanction(),
    }));
  }

  const want = 1 + pick(3);
  const rules: Rule[] = [];
  const order = forms.map((_, i) => i);
  // a keyed shuffle of the applicable forms
  for (let i = order.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  for (const i of order) {
    if (rules.length >= want) break;
    rules.push(forms[i]!());
  }
  // a store nobody may draw from is a hole in the ground: if dues were drawn, make sure something can come out
  if (hasStore && rules.some((r) => r.r === "must_deposit") && !rules.some((r) => r.r === "may_withdraw")) rules.push(forms[1]!());

  return {
    grammar: GRAMMAR_VERSION,
    name: `Compact of ${agent.name}`,
    purpose: "",
    minFounders,
    maxMembers: 8 + pick(33),
    entry: pct() < 65 ? "open" : "vote",
    bond,
    roles: [],
    decide,
    period: pct() < 80 ? TICKS_PER_DAY : TICKS_PER_DAY / 2,
    stores: controls,
    rules,
    days: pct() < 80 ? 0 : 20 + pick(21),
  };
}

/**
 * Search: draw `SEARCH_DRAWS` charters, keep those the validator accepts, and return the one
 * this agent rates highest if it clears the agent's own signing bar (it must be willing to
 * live under what it proposes).
 */
export function searchCharter(world: WorldState, agent: Agent): { charter: Charter; score: number; why: string } | null {
  let best: { charter: Charter; score: number; why: string } | null = null;
  for (let k = 0; k < SEARCH_DRAWS; k++) {
    const v = validateCharter(world, agent.id, sampleCharter(world, agent, k));
    if (!v.ok) continue;
    const j = judgeCharter(world, agent, v.value, [agent.id]);
    if (!best || j.score > best.score) best = { charter: v.value, score: j.score, why: j.why };
  }
  if (!best || best.score < signingBar(agent)) return null;
  return best;
}
