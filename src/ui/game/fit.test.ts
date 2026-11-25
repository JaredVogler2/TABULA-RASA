import { describe, expect, it } from "vitest";
import { NARROW_FORK, ROW_STATES, SQUEEZES, WRAPPED_STATES, firstThatFits } from "./fit";

describe("the top bar's states", () => {
  it("the first that fits is taken, in order, and none is skipped", () => {
    const tried: number[] = [];
    expect(firstThatFits(5, (i) => (tried.push(i), i >= 3))).toBe(3);
    expect(tried).toEqual([0, 1, 2, 3]);
    expect(firstThatFits(4, () => false)).toBe(4);
    expect(firstThatFits(0, () => true)).toBe(0);
  });

  it("start with everything shown, and never hide a word the stylesheet does not know", () => {
    expect(ROW_STATES[0]).toBe("");
    const known = new Set(["optional", "twin", "fork", "label", "tools", "compare", "forkday"]);
    expect(NARROW_FORK[0]).toBe("");
    for (const state of [...ROW_STATES, ...WRAPPED_STATES, ...NARROW_FORK]) for (const word of state.split(" ").filter(Boolean)) expect(known.has(word), `${state}: ${word}`).toBe(true);
    expect(new Set(ROW_STATES).size).toBe(ROW_STATES.length);
  });

  it("give words up one at a time while the tools keep theirs, and take the tools' words last", () => {
    const sets = ROW_STATES.map((s) => new Set(s.split(" ").filter(Boolean)));
    const firstWithoutToolWords = sets.findIndex((s) => s.has("tools"));
    expect(firstWithoutToolWords).toBeGreaterThan(0);
    // before the tools lose their words, each state hides everything the one before it hid, and one thing more
    for (let i = 1; i < firstWithoutToolWords; i++) {
      for (const word of sets[i - 1]!) expect(sets[i]!.has(word)).toBe(true);
      expect(sets[i]!.size).toBe(sets[i - 1]!.size + 1);
    }
    // afterwards they never get them back, and again one thing goes at a time
    for (let i = firstWithoutToolWords; i < sets.length; i++) expect(sets[i]!.has("tools")).toBe(true);
    for (let i = firstWithoutToolWords + 1; i < sets.length; i++) expect(sets[i]!.size).toBe(sets[i - 1]!.size + 1);
    // the season and the weather's name are the first to go and never come back on a single row
    for (let i = 1; i < sets.length; i++) expect(sets[i]!.has("optional")).toBe(true);
    // with a row of its own the status has room for them again, and the tools keep their words if they can
    for (const state of WRAPPED_STATES) expect(state.split(" ")).not.toContain("optional");
    expect(WRAPPED_STATES[0]!.split(" ")).not.toContain("tools");
    expect(WRAPPED_STATES[WRAPPED_STATES.length - 1]!.split(" ")).toContain("tools");
    expect(SQUEEZES).toBe(4);
  });
});
