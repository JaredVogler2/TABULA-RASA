import { describe, expect, it } from "vitest";
import { runsOf } from "./runs";

const line = (id: number, tick: number, text: string, parents: number[] = []) => ({ id, tick, text, parents });

describe("lines of the Chronicle that say the same thing at the same hour", () => {
  it("are gathered into one, in order, and nothing is dropped", () => {
    const entries = [line(9, 600, "A root patch began to recover."), line(8, 600, "A root patch began to recover."), line(7, 600, "A root patch began to recover."), line(6, 600, "A berry bush began to recover."), line(5, 596, "Teshiam lit a fire.")];
    const runs = runsOf(entries);
    expect(runs.map((r) => [r.first.id, r.rest.map((e) => e.id)])).toEqual([
      [9, [8, 7]],
      [6, []],
      [5, []],
    ]);
    expect(runs.flatMap((r) => [r.first, ...r.rest])).toEqual(entries);
  });

  it("the same words at another hour, or with other lines between, are not the same run", () => {
    const runs = runsOf([line(4, 700, "It began to rain."), line(3, 696, "It began to rain."), line(2, 696, "Kelu ate."), line(1, 696, "It began to rain.")]);
    expect(runs.map((r) => r.rest.length)).toEqual([0, 0, 0, 0]);
  });

  it("a line with a recorded cause keeps to itself: what led to it is its own", () => {
    const runs = runsOf([line(3, 500, "A shelter was finished.", [1]), line(2, 500, "A shelter was finished.", [1]), line(1, 500, "A shelter was finished.")]);
    expect(runs.map((r) => [r.first.id, r.rest.length])).toEqual([
      [3, 0],
      [2, 0],
      [1, 0],
    ]);
    // and a causeless line does not join one that has a cause, whichever comes first
    expect(runsOf([line(2, 500, "x"), line(1, 500, "x", [9])]).length).toBe(2);
  });

  it("an empty Chronicle has no runs", () => {
    expect(runsOf([])).toEqual([]);
  });
});
