import { describe, expect, it } from "vitest";
import type { ProgressView } from "@/worker/protocol";
import { worthLines, worthOf, worthShort } from "./worth";

/** A reading of a world with crafts, with only what the comparison looks at filled in. */
function reading(over: Partial<ProgressView> & { total: number }): ProgressView {
  return {
    reached: 0,
    standing: 0,
    ticks: [0, -1, -1, -1, -1, -1],
    next: null,
    legacy: { total: over.total, people: 0, crafts: 0, works: 0, ages: 0 },
    knowers: [0, 0, 0, 0, 0, 0],
    recorded: 0,
    living: 50,
    works: { fields: 0, granaries: 0, houses: 0, healingHouses: 0, mills: 0, recordHouses: 0 },
    twin: null,
    ...over,
  };
}

const day = (n: number): number => (n - 1) * 96;

describe("what the observer's hand has been worth, against the untouched twin", () => {
  it("says nothing while there is no twin: a world nobody changed has nothing to be set beside", () => {
    const p = reading({ total: 500 });
    expect(worthOf(p)).toBeNull();
    expect(worthShort(p)).toBe("");
    expect(worthLines(p)).toEqual([]);
  });

  it("counts legacy and people as differences, and says which way", () => {
    const ahead = reading({ total: 2785, living: 75, twin: { reached: 0, legacy: 2300, living: 63, ticks: [0, -1, -1, -1, -1, -1] } });
    expect(worthOf(ahead)).toEqual({ legacy: 485, living: 12, age: null });
    expect(worthShort(ahead)).toBe("+485 on the twin");
    expect(worthLines(ahead)).toEqual(["So far your hand has been worth 485 more legacy than leaving the island alone: 2,785 here, 2,300 in the untouched twin.", "12 more are alive here (75) than there (63)."]);

    const behind = reading({ total: 1200, living: 40, twin: { reached: 0, legacy: 1320, living: 41, ticks: [0, -1, -1, -1, -1, -1] } });
    expect(worthShort(behind)).toBe("−120 on the twin");
    expect(worthLines(behind)).toEqual(["So far your hand has been worth 120 less legacy than leaving the island alone: 1,200 here, 1,320 in the untouched twin.", "1 fewer is alive here (40) than there (41)."]);

    const level = reading({ total: 500, twin: { reached: 0, legacy: 500, living: 50, ticks: [0, -1, -1, -1, -1, -1] } });
    expect(worthShort(level)).toBe("level with the twin");
    expect(worthLines(level)).toEqual(["So far your hand has changed nothing that the legacy counts: 500 here and in the untouched twin.", "As many are alive here as there (50)."]);
  });

  it("compares the furthest age either world has reached: days sooner or later, or which world is not there yet", () => {
    const sooner = reading({ total: 900, reached: 2, ticks: [0, day(10), day(40), -1, -1, -1], twin: { reached: 2, legacy: 800, living: 50, ticks: [0, day(10), day(52), -1, -1, -1] } });
    expect(worthOf(sooner)?.age).toEqual({ index: 2, sooner: 12, only: null });
    expect(worthLines(sooner)[2]).toBe("The Age of Fields came 12 days sooner here than in the twin.");

    const later = reading({ total: 900, reached: 1, ticks: [0, day(11), -1, -1, -1, -1], twin: { reached: 1, legacy: 900, living: 50, ticks: [0, day(10), -1, -1, -1, -1] } });
    expect(worthLines(later)[2]).toBe("The Age of Hearths came 1 day later here than in the twin.");

    const same = reading({ total: 900, reached: 1, ticks: [0, day(10), -1, -1, -1, -1], twin: { reached: 1, legacy: 900, living: 50, ticks: [0, day(10), -1, -1, -1, -1] } });
    expect(worthLines(same)[2]).toBe("The Age of Hearths came on the same day in both.");

    const onlyHere = reading({ total: 1500, reached: 3, ticks: [0, day(10), day(40), day(90), -1, -1], twin: { reached: 2, legacy: 900, living: 50, ticks: [0, day(10), day(52), -1, -1, -1] } });
    expect(worthOf(onlyHere)?.age).toEqual({ index: 3, sooner: null, only: "here" });
    expect(worthLines(onlyHere)[2]).toBe("The Age of Stone has been reached here; the twin stands in the Age of Fields.");

    const onlyTwin = reading({ total: 700, reached: 1, ticks: [0, day(10), -1, -1, -1, -1], twin: { reached: 2, legacy: 900, living: 50, ticks: [0, day(10), day(52), -1, -1, -1] } });
    expect(worthLines(onlyTwin)[2]).toBe("The twin has reached the Age of Fields; this world stands in the Age of Hearths.");
  });
});
