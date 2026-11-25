import { describe, expect, it } from "vitest";
import { SCENARIOS, TICKS_PER_DAY, createWorld, makeConfig, restoreWorld, serializeWorld, step, type SimEvent, type WorldState } from "@/engine";
import { firstWinterEnd, ordinal, readAim, readAims, scheduledDrought, shoreWellBeing } from "./aims";
import type { DaySample } from "./protocol";

/**
 * The aim on a scenario's card, counted. These hold the definitions: who counts, when an aim is
 * decided, that it is decided from the state alone, and that the drought is not foretold.
 */

const world = (scenario: string, seed = 1): WorldState => createWorld(makeConfig(scenario, seed));

/** Mark a person as having died at `tick` (the engine's own two fields, and the flag). */
function kill(w: WorldState, id: number, tick: number, cause = "hunger"): void {
  const a = w.agents[id]!;
  a.alive = false;
  a.diedTick = tick;
  a.deathCause = cause;
}

const day = (n: number): number => (n - 1) * TICKS_PER_DAY; // the first tick of the day shown as day n

describe("the aim on a scenario's card, counted", () => {
  it("every scenario has an aim this reading knows, and says it in the card's own words", () => {
    for (const s of SCENARIOS) {
      const aim = readAim(world(s.id), []);
      expect(aim, s.id).not.toBeNull();
      expect(aim?.id).toBe(s.objective.id);
      expect(aim?.text).toBe(s.objective.text);
      expect(aim?.lines.length).toBeGreaterThan(0);
    }
  });

  it("names numbers as a reader would", () => {
    expect([1, 2, 3, 11, 12, 13, 21, 22, 23, 24, 101, 111, 112].map(ordinal)).toEqual(["first", "second", "third", "eleventh", "twelfth", "13th", "21st", "22nd", "23rd", "24th", "101st", "111th", "112th"]);
  });

  it("the first winter ends on the first morning of the spring after it, whatever season the world began in", () => {
    // First Light begins on the first day of spring with four seasons of ten days: the winter is days 31–40
    expect(firstWinterEnd(world("first_light"))).toBe(40 * TICKS_PER_DAY);
    // The Long Winter begins twelve days into a year of 8 + 8 + 8 + 16: spring comes back on the 29th morning
    expect(firstWinterEnd(world("long_winter"))).toBe(28 * TICKS_PER_DAY);
  });

  it("First Light: open until the winter ends, lost by the eleventh death before then, met otherwise — and never changed by what comes after", () => {
    const w = world("first_light");
    const open = readAim(w, [])!;
    expect(open.state).toBe("open");
    expect(open.decidedDay).toBeNull();
    expect(open.figure).toBe("50 of 50 alive");
    expect(open.lines).toEqual(["50 of the 50 who began are alive. Four in five is 40.", "The first winter ends on the morning of day 41."]);

    // ten may die and it is still open
    for (let i = 0; i < 10; i++) kill(w, i, day(5) + i);
    w.tick = day(20);
    expect(readAim(w, [])!.state).toBe("open");
    expect(readAim(w, [])!.lines[0]).toBe("40 of the 50 who began are alive. Four in five is 40.");

    // the eleventh loses it, on the day it happened
    kill(w, 10, day(23) + 7);
    w.tick = day(24);
    const lost = readAim(w, [])!;
    expect(lost.state).toBe("lost");
    expect(lost.decidedDay).toBe(23);
    expect(lost.lines).toEqual(["Lost on day 23: the eleventh death left 39 of the 50 who began, and four in five is 40."]);

    // more deaths, and the winter ending, do not move the day it was lost
    kill(w, 11, day(30));
    w.tick = day(45);
    const later = readAim(w, [])!;
    expect(later.state).toBe("lost");
    expect(later.decidedDay).toBe(23);
    expect(later.lines).toEqual(["Lost on day 23: the eleventh death left 39 of the 50 who began, and four in five is 40.", "38 are alive now."]);
    expect(later.figure).toBe("38 of 50 alive");
  });

  it("First Light: met on the morning the winter ends, by those who saw it out; a death after that morning takes nothing back", () => {
    const w = world("first_light");
    for (let i = 0; i < 4; i++) kill(w, i, day(33));
    w.tick = 40 * TICKS_PER_DAY - 1;
    expect(readAim(w, [])!.state).toBe("open");
    w.tick = 40 * TICKS_PER_DAY;
    const met = readAim(w, [])!;
    expect(met.state).toBe("met");
    expect(met.decidedDay).toBe(41);
    expect(met.figure).toBe("46 of 50 saw the winter out");
    expect(met.lines).toEqual(["Met on day 41: 46 of the 50 who began saw the winter out. Four in five is 40."]);
    // twenty die in the second spring
    for (let i = 4; i < 24; i++) kill(w, i, day(44));
    w.tick = day(50);
    const after = readAim(w, [])!;
    expect(after.state).toBe("met");
    expect(after.lines).toEqual(["Met on day 41: 46 of the 50 who began saw the winter out. Four in five is 40.", "26 are alive now."]);
  });

  it("counts the people the world began with: newcomers brought by the observer's hand neither help nor hurt", () => {
    const w = world("first_light");
    const before = readAim(w, [])!;
    // a newcomer arrives and dies: one more body in the world, not one of the fifty
    const stranger = structuredClone(w.agents[0]!);
    stranger.id = w.agents.length;
    w.agents.push(stranger);
    expect(readAim(w, [])).toEqual(before);
    kill(w, stranger.id, day(2));
    w.tick = day(3);
    expect(readAim(w, [])!.lines[0]).toBe("50 of the 50 who began are alive. Four in five is 40.");
  });

  it("The Long Winter asks for three in five by spring: thirty of fifty, and the twenty-first death loses it", () => {
    const w = world("long_winter");
    expect(readAim(w, [])!.lines).toEqual(["50 of the 50 who began are alive. Three in five is 30.", "Spring comes on the morning of day 29."]);
    for (let i = 0; i < 20; i++) kill(w, i, day(14), "cold");
    w.tick = day(20);
    expect(readAim(w, [])!.state).toBe("open");
    kill(w, 20, day(25), "cold");
    w.tick = day(26);
    const lost = readAim(w, [])!;
    expect(lost.state).toBe("lost");
    expect(lost.lines).toEqual(["Lost on day 25: the 21st death left 29 of the 50 who began, and three in five is 30."]);
  });

  it("Thin Commons is decided at the end of the year, and says how the commons stand from the almanac's own record", () => {
    const w = world("thin_commons");
    const series: DaySample[] = [
      { day: 1, alive: 50, welfare: 700, food: 0, wild: 0, commons: 640, gini: 0, structures: 0 },
      { day: 2, alive: 50, welfare: 700, food: 0, wild: 0, commons: 120, gini: 0, structures: 0 },
      { day: 3, alive: 50, welfare: 700, food: 0, wild: 0, commons: 300, gini: 0, structures: 0 },
    ];
    const open = readAim(w, series)!;
    expect(open.state).toBe("open");
    expect(open.lines[1]).toBe("The year ends on the morning of day 41.");
    // the lowest morning on record is named with the day it shows as, and only if it was lower than now
    expect(open.lines[2]).toMatch(/^The groves and fishing waters are \d+% full on average; their emptiest morning on record was day 3, at 12%\.$/);
    expect(readAim(w, [])!.lines[2]).toMatch(/^The groves and fishing waters are \d+% full on average\.$/);
    w.tick = 40 * TICKS_PER_DAY;
    expect(readAim(w, series)!.state).toBe("met");
    expect(readAim(w, series)!.figure).toBe("50 of 50 saw the year out");
  });

  it("Dry Year: the drought is not foretold; once it has come its day is said, and the aim is decided the morning it ends", () => {
    const w = world("dry_year", 3);
    const d = scheduledDrought(w)!;
    expect(d.begun).toBe(false);
    expect(d.start % TICKS_PER_DAY).toBe(0);
    const before = readAim(w, [])!;
    expect(before.state).toBe("open");
    expect(before.lines).toEqual(["50 of the 50 who began are alive. Four in five is 40.", "The drought has not come yet."]);
    // nothing in what is shown gives the day away
    const startDay = Math.floor(d.start / TICKS_PER_DAY) + 1;
    const endDay = Math.floor(d.end / TICKS_PER_DAY) + 1;
    expect(JSON.stringify(before)).not.toContain(`day ${startDay}`);
    expect(JSON.stringify(before)).not.toContain(`day ${endDay}`);

    // live it until the scenario's own drought has begun
    const out: SimEvent[] = [];
    while (!scheduledDrought(w)!.begun) {
      step(w, out);
      out.length = 0;
    }
    const begun = scheduledDrought(w)!;
    expect(begun.start).toBe(d.start);
    expect(begun.end).toBe(d.end);
    const during = readAim(w, [])!;
    expect(during.state).toBe("open");
    expect(during.lines[1]).toBe(`The drought began on day ${startDay} and has not ended.`);
    // …and to the morning it ends
    while (w.tick < d.end) {
      step(w, out);
      out.length = 0;
    }
    const after = readAim(w, [])!;
    expect(["met", "lost"]).toContain(after.state);
    if (after.state === "met") expect(after.decidedDay).toBe(endDay);
  }, 60_000);

  it("Two Shores is a reading, never a verdict: well-being of those who began on each shore, the dead counted as nought", () => {
    const w = world("two_shores", 2);
    const start = shoreWellBeing(w)!;
    expect(start.beganA + start.beganB).toBe(50);
    expect(start.aliveA).toBe(start.beganA);
    const aim = readAim(w, [])!;
    expect(aim.state).toBe("reading");
    expect(aim.decidedDay).toBeNull();
    expect(aim.figure).toBe(`a gap of ${Math.abs(start.a - start.b)}`);
    expect(aim.lines[1]).toContain("this aim has no day of reckoning");

    // everyone who began on the first shore dies: that shore's well-being is nought, not "nobody left to ask"
    const before = shoreWellBeing(w)!;
    // (who began there is found by asking the reading itself, one person at a time, of an untouched copy)
    const firstShore = w.agents
      .map((a) => a.id)
      .filter((id) => {
        const probe = structuredClone(w);
        kill(probe, id, 5);
        return shoreWellBeing(probe)!.aliveA < before.aliveA;
      });
    let killed = 0;
    for (const id of firstShore) {
      kill(w, id, 5);
      killed++;
    }
    expect(killed).toBe(before.beganA);
    const emptied = shoreWellBeing(w)!;
    expect(emptied.a).toBe(0);
    expect(emptied.aliveA).toBe(0);
    expect(emptied.b).toBe(before.b);
    expect(readAim(w, [])!.figure).toBe(`a gap of ${before.b}`);
  });

  it("is read from the state alone: a world saved and opened again gives the same answer, and so does its twin", () => {
    const w = world("long_winter", 2);
    const out: SimEvent[] = [];
    for (let t = 0; t < 30 * TICKS_PER_DAY; t++) {
      step(w, out);
      out.length = 0;
    }
    const aim = readAim(w, [])!;
    expect(["met", "lost"]).toContain(aim.state);
    const reopened = restoreWorld(serializeWorld(w));
    expect(readAim(reopened, [])).toEqual(aim);
    // the reading of a pair is the reading of each
    expect(readAims(w, [], reopened, [])).toEqual({ yours: aim, twin: aim });
    expect(readAims(w, [], null, []).twin).toBeNull();
  }, 60_000);
});
