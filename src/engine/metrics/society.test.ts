import { describe, expect, it } from "vitest";
import { makeConfig } from "../model/config";
import { TICKS_PER_DAY } from "../model/constants";
import type { SimEvent, WorldState } from "../model/types";
import { forkWorld } from "../save/snapshot";
import { applyIntervention } from "../sim/environment";
import { scratchOf } from "../sim/scratch";
import { run, step } from "../sim/step";
import { createWorld } from "../world/create";
import { commonsHealthPermille, giniPermille, summarize } from "./accumulate";
import { SocietyTracker, modularity } from "./society";

const DAY = TICKS_PER_DAY;
let nextId = 0;
const ev = (t: number, k: SimEvent["k"], a: number, rest: Partial<SimEvent> = {}): SimEvent => ({ id: nextId++, t, k, a, ...rest });
const key = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a);

function quietWorld(population: number, days: number): WorldState {
  const world = createWorld(makeConfig("first_light", 3, { population, institutions: "open" }));
  world.tick = days * DAY;
  return world;
}

describe("metric correctness on hand-computed cases", () => {
  it("Gini: zero for equality, for nothing at all and for one person; (n−1)/n when one holds everything", () => {
    expect(giniPermille([5, 5, 5, 5])).toBe(0);
    expect(giniPermille([0, 0, 0])).toBe(0);
    expect(giniPermille([7])).toBe(0);
    expect(giniPermille([])).toBe(0);
    expect(giniPermille([0, 0, 0, 8])).toBe(750);
    expect(giniPermille([1, 2, 3, 4])).toBe(250); // (2·(1·1+2·2+3·3+4·4)/(4·10)) − 5/4 = 0.25
  });

  it("modularity: two triangles joined by one tie split in two with Q = 5/14", () => {
    const ties = new Map<number, number>();
    for (const [a, b] of [[0, 1], [1, 2], [0, 2], [3, 4], [4, 5], [3, 5], [2, 3]] as const) ties.set(key(a, b), 1);
    const m = modularity(ties);
    expect(m).toMatchObject({ people: 6, ties: 7, weight: 7, communities: 2 });
    expect(m.modularity).toBe(357); // 2 × (3/7 − (7/14)²) = 0.357…
  });

  it("modularity: a clique is one community with Q = 0; no ties gives zeros; weights matter", () => {
    const k4 = new Map<number, number>();
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) k4.set(key(a, b), 1);
    expect(modularity(k4)).toMatchObject({ communities: 1, modularity: 0 });
    expect(modularity(new Map())).toEqual({ people: 0, ties: 0, weight: 0, communities: 0, modularity: 0 });
    // two strong pairs held together by a weak tie stay apart
    const pairs = new Map<number, number>([[key(0, 1), 10], [key(2, 3), 10], [key(1, 2), 1]]);
    const m = modularity(pairs);
    expect(m.communities).toBe(2);
    expect(m.modularity).toBe(Math.round((2 * (10 / 21 - (21 / 42) ** 2)) * 1000));
  });

  it("reciprocity counts directed dyads answered within five days, and only those", () => {
    const world = quietWorld(4, 12);
    const tr = new SocietyTracker(4);
    tr.push(ev(0, "give", 0, { b: 1, q: 3 }));
    tr.push(ev(4 * DAY, "give", 1, { b: 0, q: 1 })); // answered within the window
    tr.push(ev(5 * DAY, "give", 0, { b: 2, q: 2 })); // never answered
    tr.push(ev(5 * DAY, "give", 2, { b: 3, q: 1 }));
    tr.push(ev(11 * DAY, "give", 3, { b: 2, q: 1 })); // answered six days later: too late
    const r = tr.report(world);
    expect(r.gifts).toBe(5);
    expect(r.giftUnits).toBe(8);
    // dyads: 0→1 ✓, 1→0 ✓, 0→2 ✗, 2→3 ✗, 3→2 ✗
    expect(r.reciprocity).toBe(400);
    // 4 people × 12 days = 48 agent-days; cooperation = 5 gifts; trade volume = the 4 units in the answered pair
    expect(r.agentDays).toBe(48);
    expect(r.cooperation).toBe(Math.round((1000 * 5) / 48));
    expect(r.tradeVolume).toBe(Math.round((1000 * 4) / 48));
    expect(r.network).toMatchObject({ people: 4, ties: 3 });
  });

  it("an executed pact is one exchange of both sides' units, reciprocated by construction; deaths shorten the denominator", () => {
    const world = quietWorld(4, 10);
    const tr = new SocietyTracker(4);
    tr.push(ev(2 * DAY, "pact_done", 1, { b: 0, d: { pact: 9, gave: 4, gaveQty: 1, got: 0, gotQty: 3 } }));
    tr.push(ev(5 * DAY, "death", 3, { r: "cold" }));
    const r = tr.report(world);
    expect(r.exchanges).toBe(1);
    expect(r.exchangeUnits).toBe(4);
    expect(r.reciprocity).toBe(1000);
    expect(r.agentDays).toBe(35); // 3 × 10 + 5
    expect(r.cooperation).toBe(Math.round(1000 / 35));
    expect(r.tradeVolume).toBe(Math.round(4000 / 35));
  });

  it("the emergence ladder is read from events, by origin, and a scripted charter is counted apart", () => {
    const world = quietWorld(6, 30);
    const tr = new SocietyTracker(6);
    const log: SimEvent[] = [];
    // institution 1: proposed by search, three founders, used by two members, in force 20 days → E4
    log.push(ev(1 * DAY, "proposal", 0, { d: { inst: 1, origin: "grammar_search" } }));
    log.push(ev(1 * DAY + 5, "ratified", 0, { d: { inst: 1, members: [0, 1, 2] } }));
    log.push(ev(1 * DAY + 6, "rule", -3, { s: 7, r: "bound", d: { inst: 1 } }));
    for (let i = 0; i < 6; i++) log.push(ev(2 * DAY + i, "deposit", i % 2, { s: 7, i: 1, q: 1 }));
    log.push(ev(3 * DAY, "deposit", 4, { s: 7, i: 1, q: 1 })); // an outsider's act does not count as use
    for (let i = 0; i < 4; i++) log.push(ev(4 * DAY + i, "obligation", i % 2, { d: { inst: 1 } }));
    // institution 2: two founders only → never beyond E1 on the registered definition
    log.push(ev(2 * DAY, "proposal", 3, { d: { inst: 2, origin: "grammar_search" } }));
    log.push(ev(2 * DAY + 3, "ratified", 3, { d: { inst: 2, members: [3, 4] } }));
    // institution 3: scripted, three founders, barely used, dissolved after two days → E2
    log.push(ev(5 * DAY, "proposal", 5, { d: { inst: 3, origin: "scripted" } }));
    log.push(ev(5 * DAY + 2, "ratified", 5, { d: { inst: 3, members: [5, 3, 4] } }));
    log.push(ev(7 * DAY, "dissolved", -3, { r: "too_few_members", d: { inst: 3 } }));
    // a proposal nobody signed, and one the validator refused
    log.push(ev(8 * DAY, "proposal", 2, { d: { inst: 4, origin: "llm" } }));
    log.push(ev(8 * DAY, "proposal_rejected", 2, { r: "not_expressible" }));
    // a ledger is in tick order
    log.sort((p, q) => p.t - q.t || p.id - q.id);
    for (const e of log) tr.push(e);
    const r = tr.report(world).institutions;
    expect(r.proposals).toBe(4);
    expect(r.refused).toBe(1);
    expect(r.ratified).toBe(3);
    expect(r.activeAtEnd).toBe(2);
    expect(r.ladder).toEqual({ E1: 4, E2: 2, E3: 1, E4: 1 });
    expect(r.byOrigin.grammar_search).toEqual({ E1: 2, E2: 1, E3: 1, E4: 1 });
    expect(r.byOrigin.scripted).toEqual({ E1: 1, E2: 1, E3: 0, E4: 0 });
    expect(r.byOrigin.llm).toEqual({ E1: 1, E2: 0, E3: 0, E4: 0 });
    const first = r.records.find((x) => x.id === 1)!;
    expect(first).toMatchObject({ uses: 10, users: 2, founders: 3, level: 4 });
    // member-days: inst 1 has 3 members for 29 days less 5 ticks; inst 2 has 2 from day 2; inst 3 had 3 for two days
    const expected = (3 * (29 * DAY - 5) + 2 * (28 * DAY - 3) + 3 * (2 * DAY - 2)) / DAY;
    expect(r.memberDays).toBe(Math.round(expected));
  });

  it("influence concentration is the Gini of ratified proposals and passed motions; exclusion counts doors that did not open", () => {
    const world = quietWorld(4, 10);
    const tr = new SocietyTracker(4);
    tr.push(ev(DAY, "proposal", 0, { d: { inst: 1, origin: "grammar_search" } }));
    tr.push(ev(DAY + 1, "ratified", 0, { d: { inst: 1, members: [0, 1, 2] } }));
    tr.push(ev(2 * DAY, "motion", 0, { d: { inst: 1, motion: 5, m: "grant" } }));
    tr.push(ev(2 * DAY + 3, "motion_result", -3, { r: "passed", d: { inst: 1, motion: 5 } }));
    tr.push(ev(3 * DAY, "motion", 1, { d: { inst: 1, motion: 6, m: "dissolve" } }));
    tr.push(ev(3 * DAY + 3, "motion_result", -3, { r: "failed", d: { inst: 1, motion: 6 } }));
    tr.push(ev(4 * DAY, "rejected", 3, { r: "not_permitted", d: { k: "withdraw" } }));
    tr.push(ev(4 * DAY + 9, "rejected", 3, { r: "not_permitted", d: { k: "withdraw" } }));
    tr.push(ev(4 * DAY + 9, "rejected", 2, { r: "no_item", d: { k: "eat" } }));
    const r = tr.report(world);
    expect(r.influenceConcentration).toBe(giniPermille([2, 0, 0, 0]));
    expect(r.influenceConcentration).toBe(750);
    expect(r.exclusion).toEqual({ refusals: 2, people: 1, rate: Math.round(2000 / 40) });
    // with no decisions at all, concentration is defined as zero
    expect(new SocietyTracker(4).report(world).influenceConcentration).toBe(0);
  });
});

describe("the tracker agrees with the engine's own counters on a real run", () => {
  it("gifts, exchanges, proposals and agent-days match; every institution's rung is at most what its record allows", () => {
    const world = createWorld(makeConfig("long_winter", 2, { policy: "planner", institutions: "grammar_search" }));
    const tr = new SocietyTracker(world.agents.length);
    const out: SimEvent[] = [];
    for (let t = 0; t < 24 * DAY; t++) {
      step(world, out);
      for (const e of out) tr.push(e);
      out.length = 0;
    }
    const r = tr.report(world);
    const s = summarize(world);
    expect(r.gifts).toBe(world.metrics.gives);
    expect(r.giftUnits).toBe(world.metrics.giveUnits);
    expect(r.exchanges).toBe(world.metrics.pactTrades);
    expect(r.institutions.proposals).toBe(world.metrics.proposals);
    expect(r.institutions.ratified).toBe(world.metrics.ratified);
    expect(r.institutions.activeAtEnd).toBe(world.inst.institutions.filter((i) => i.ended < 0).length);
    let aliveTicks = 0;
    for (const a of world.agents) aliveTicks += a.stats.aliveTicks;
    expect(Math.abs(r.agentDays - aliveTicks / DAY)).toBeLessThan(1);
    expect(r.cooperation).toBe(s.cooperation);
    expect(r.collectiveAction.completed).toBeLessThanOrEqual(r.collectiveAction.started);
    for (const rec of r.institutions.records) if (rec.level >= 2) expect(rec.founders).toBeGreaterThanOrEqual(3);
  }, 120_000);
});

describe("a scarcity shock shows in the measures", () => {
  it("a drought leaves the commons poorer than in the untouched twin that shares its luck", () => {
    const base = createWorld(makeConfig("first_light", 4, { policy: "planner", institutions: "off" }));
    run(base, 3 * DAY);
    const hit = forkWorld(base, "drought", true);
    applyIntervention(hit, scratchOf(hit), [], { tick: hit.tick, kind: "drought", params: { days: 6 }, origin: "observer" });
    run(base, 6 * DAY);
    run(hit, 6 * DAY);
    expect(commonsHealthPermille(hit)).toBeLessThan(commonsHealthPermille(base) - 30);
    expect(summarize(hit).commonsMin).toBeLessThanOrEqual(summarize(base).commonsMin);
  }, 120_000);
});
