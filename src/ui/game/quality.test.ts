import { describe, expect, it } from "vitest";
import { simplerOf, simplified, stepDown } from "./quality";

describe("graphics presets: what simpler means", () => {
  it("steps down one preset at a time and stops at the simplest", () => {
    expect(stepDown("high")).toBe("medium");
    expect(stepDown("medium")).toBe("low");
    expect(stepDown("low")).toBeNull();
  });

  it("only an automatic choice is ever simplified: what the visitor chose is left alone", () => {
    expect(simplified("auto", null, "high")).toBe("medium");
    expect(simplified("auto", null, "medium")).toBe("low");
    expect(simplified("auto", null, "low")).toBeNull();
    expect(simplified("high", null, "high")).toBeNull();
    expect(simplified("medium", null, "medium")).toBeNull();
    // a preset given in the address (captures, tests) is a choice too
    expect(simplified("auto", "high", "high")).toBeNull();
  });

  it("a ceiling only ever lowers an automatic choice", () => {
    expect(simplerOf("high", "medium")).toBe("medium");
    expect(simplerOf("medium", "high")).toBe("medium");
    expect(simplerOf("low", "high")).toBe("low");
    expect(simplerOf("medium", "low")).toBe("low");
    expect(simplerOf("high", "high")).toBe("high");
  });
});
