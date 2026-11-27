import { describe, expect, it } from "vitest";
import type { SimEvent } from "@/engine";
import type { StaticAgentView } from "@/worker/protocol";
import { chronicle } from "./text";

/**
 * The Chronicle's sentences for what a world with crafts adds (engine 0.8.0). The browser tests
 * no longer look for one of these among the Chronicle's newest lines: a world at the fastest
 * speed lives more than a day a second, and a page that is slow to take a click is days past
 * the entry before it can be read. What the entry says is held here instead; that the day of
 * an age is kept and shown is held by the Atlas's ladder in `tests/e2e/goal.spec.ts`.
 */
const roster = [{ name: "Anwen" }, { name: "Bedo" }] as unknown as StaticAgentView[];
const event = (over: Partial<SimEvent> & { k: SimEvent["k"] }): SimEvent => ({ id: 7, t: 960, a: 0, ...over }) as SimEvent;
const said = (e: SimEvent): string | undefined => chronicle(e, null, roster)?.text;

describe("the Chronicle on crafts, works, newcomers and ages", () => {
  it("an age is entered once, as a reading, and says nobody on the island was told", () => {
    const entry = chronicle(event({ k: "age", a: -1, q: 1, r: "hearths" }), null, roster);
    expect(entry?.text).toBe("The Age of Hearths began: a reading of what stands on the island. Nobody on it was told.");
    expect(entry?.group).toBe("making");
    expect(entry?.weight).toBe(3);
    expect(entry?.agents).toEqual([]);
    expect(said(event({ k: "age", a: -1, q: 5, r: "letters" }))).toBe("The Age of Letters began: a reading of what stands on the island. Nobody on it was told.");
  });

  it("a craft found says who found it and that nobody showed them; one learned says from whom, or from where", () => {
    expect(said(event({ k: "discovered", q: 0, r: "practice" }))).toMatch(/^Anwen .+\. Nobody showed them\.$/);
    expect(said(event({ k: "discovered", q: 3, r: "illness" }))).toMatch(/^Anwen .+, getting over an illness\. Nobody showed them\.$/);
    expect(said(event({ k: "learned", a: 1, b: 0, q: 2, r: "watching" }))).toBe("Bedo learned masonry by watching Anwen at work.");
    expect(chronicle(event({ k: "learned", a: 1, b: 0, q: 2, r: "watching" }), null, roster)?.agents).toEqual([1, 0]);
    expect(said(event({ k: "learned", a: 1, q: 4, r: "reading" }))).toBe("Bedo learned millwrighting at a record house.");
    expect(said(event({ k: "inscribed", q: 5 }))).toBe("Anwen wrote record keeping down in a record house.");
  });

  it("a newcomer is told apart: drawn by plenty, a stranger with a craft, or simply come ashore", () => {
    expect(said(event({ k: "arrival", r: "drawn" }))).toBe("Anwen came ashore, drawn by a settlement with beds and food to spare.");
    expect(said(event({ k: "arrival", r: "stranger", q: 4 }))).toBe("Anwen came ashore: a stranger who knows millwrighting.");
    expect(said(event({ k: "arrival" }))).toBe("Anwen came ashore.");
  });
});
