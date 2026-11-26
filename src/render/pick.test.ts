import { describe, expect, it } from "vitest";
import { samePick } from "./pick";

describe("selections: the same thing or another", () => {
  it("a citizen is the same citizen and nobody else", () => {
    expect(samePick({ type: "agent", id: 3 }, { type: "agent", id: 3 })).toBe(true);
    expect(samePick({ type: "agent", id: 3 }, { type: "agent", id: 4 })).toBe(false);
    expect(samePick({ type: "agent", id: 3 }, { type: "tile", x: 3, y: 3 })).toBe(false);
    expect(samePick({ type: "tile", x: 3, y: 3 }, { type: "agent", id: 3 })).toBe(false);
  });

  it("a place is one place whatever stands on it", () => {
    expect(samePick({ type: "tile", x: 5, y: 9 }, { type: "tile", x: 5, y: 9 })).toBe(true);
    expect(samePick({ type: "tile", x: 5, y: 9 }, { type: "node", id: 2, x: 5, y: 9 })).toBe(true);
    expect(samePick({ type: "structure", id: 1, x: 5, y: 9 }, { type: "tile", x: 5, y: 9 })).toBe(true);
    expect(samePick({ type: "tile", x: 5, y: 9 }, { type: "tile", x: 9, y: 5 })).toBe(false);
  });

  it("nothing is the same as nothing", () => {
    expect(samePick(null, null)).toBe(false);
    expect(samePick(null, { type: "agent", id: 0 })).toBe(false);
    expect(samePick({ type: "agent", id: 0 }, null)).toBe(false);
  });
});
