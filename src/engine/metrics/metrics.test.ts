import { describe, expect, it } from "vitest";
import { makeConfig } from "../model/config";
import { Item, TICKS_PER_DAY } from "../model/constants";
import { Activity } from "../model/types";
import { createWorld } from "../world/create";
import { run } from "../sim/step";
import { commonsHealthPermille, giniPermille, reciprocityPermille, specializationPermille, summarize } from "./accumulate";

describe("Gini coefficient", () => {
  it("is zero for fewer than two values and for a zero total (the registered convention)", () => {
    expect(giniPermille([])).toBe(0);
    expect(giniPermille([5])).toBe(0);
    expect(giniPermille([0, 0, 0, 0])).toBe(0);
  });

  it("is zero under perfect equality", () => {
    expect(giniPermille([3, 3, 3, 3, 3])).toBe(0);
  });

  it("equals (n − 1) / n when one agent holds everything", () => {
    expect(giniPermille([0, 0, 0, 10])).toBe(750);
    expect(giniPermille([0, 7])).toBe(500);
    const fifty = new Array<number>(49).fill(0).concat([100]);
    expect(giniPermille(fifty)).toBe(980);
  });

  it("matches hand-computed cases and is order- and scale-invariant", () => {
    // x = 1,2,3,4: G = (2·(1+4+9+16))/(4·10) − 5/4 = 0.25
    expect(giniPermille([1, 2, 3, 4])).toBe(250);
    expect(giniPermille([4, 1, 3, 2])).toBe(250);
    expect(giniPermille([10, 20, 30, 40])).toBe(250);
    // x = 1,1,2,4: G = (2·(1+2+6+16))/(4·8) − 5/4 = 0.3125
    expect(giniPermille([1, 1, 2, 4])).toBe(313);
  });
});

describe("state-derived measures", () => {
  it("specialization is 1 when everyone does a single kind of work and 0 when work is spread evenly", () => {
    const world = createWorld(makeConfig("first_light", 2, { population: 6 }));
    for (const a of world.agents) {
      a.stats.activity.fill(0);
      a.stats.activity[Activity.fish] = 400;
    }
    expect(specializationPermille(world)).toBe(1000);
    for (const a of world.agents) {
      a.stats.activity.fill(0);
      for (const c of [Activity.forage, Activity.fish, Activity.wood, Activity.mine, Activity.craft, Activity.build, Activity.farm]) {
        a.stats.activity[c] = 100;
      }
      a.stats.activity[Activity.travel] = 5000; // non-work time must not affect the index
    }
    expect(specializationPermille(world)).toBe(0);
    // two activities, half each: 1 − ln 2 / ln 7 ≈ 0.6438
    for (const a of world.agents) {
      a.stats.activity.fill(0);
      a.stats.activity[Activity.forage] = 200;
      a.stats.activity[Activity.wood] = 200;
    }
    expect(specializationPermille(world)).toBe(644);
    // agents with almost no work time are skipped rather than counted as specialists
    for (const a of world.agents) a.stats.activity.fill(0);
    expect(specializationPermille(world)).toBe(0);
  });

  it("reciprocity counts directed giving dyads that are returned", () => {
    const world = createWorld(makeConfig("first_light", 2, { population: 4 }));
    expect(reciprocityPermille(world)).toBe(0);
    const [a, b, c] = [world.agents[0]!, world.agents[1]!, world.agents[2]!];
    a.mind.gave[b.id] = 10; // a→b
    expect(reciprocityPermille(world)).toBe(0);
    b.mind.gave[a.id] = 4; // b→a: both dyads are now reciprocated
    expect(reciprocityPermille(world)).toBe(1000);
    c.mind.gave[a.id] = 7; // c→a unreturned: 2 of 3 dyads reciprocated
    expect(reciprocityPermille(world)).toBe(667);
  });

  it("commons health is the mean stock ratio of bushes and fishing waters", () => {
    const world = createWorld(makeConfig("first_light", 2, { population: 4 }));
    const start = commonsHealthPermille(world);
    expect(start).toBeGreaterThan(550);
    expect(start).toBeLessThanOrEqual(1000);
    for (let n = 0; n < world.nodes.count; n++) world.nodes.amount[n] = 0;
    expect(commonsHealthPermille(world)).toBe(0);
    for (let n = 0; n < world.nodes.count; n++) world.nodes.amount[n] = world.nodes.cap[n] as number;
    expect(commonsHealthPermille(world)).toBe(1000);
  });

  it("summaries stay within their defined ranges on a real run", () => {
    const world = createWorld(makeConfig("first_light", 2, { policy: "reflex" }));
    run(world, 3 * TICKS_PER_DAY);
    const s = summarize(world);
    expect(s.day).toBe(3);
    expect(s.population).toBe(50);
    for (const v of [s.survival, s.welfare, s.welfareLiving, s.gini, s.reciprocity, s.specialization, s.commonsMin]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1000);
    }
    expect(s.welfare).toBeLessThanOrEqual(s.welfareLiving);
    expect(s.decisions).toBeGreaterThan(100);
    expect(s.productivity).toBeGreaterThan(0);
    // welfare including mortality counts the dead as zero for the rest of the run
    const before = summarize(world).welfare;
    for (const a of world.agents.slice(0, 25)) {
      a.alive = false;
      a.inv[Item.berry] = 0;
    }
    run(world, TICKS_PER_DAY);
    expect(summarize(world).welfare).toBeLessThan(before);
  });
});
