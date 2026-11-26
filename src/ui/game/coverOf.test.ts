import { describe, expect, it } from "vitest";
import { coverOf, type Box } from "./coverOf";

/** A part of the interface, the full width of a 390 px screen. */
const part = (top: number, bottom: number): Box => ({ top, bottom, width: 370, height: bottom - top });
const map = { top: 0, bottom: 844 };

describe("what the interface covers of the map", () => {
  it("nothing, when nothing stands on it", () => {
    expect(coverOf(map, [])).toEqual({ top: 0, bottom: 0 });
  });

  it("the bars from the top, and the time bar from the bottom", () => {
    expect(coverOf(map, [part(10, 155), part(711, 834)])).toEqual({ top: 155, bottom: 133 });
  });

  it("a sheet that has risen covers from its top edge down, whatever is under it", () => {
    // the bars, a card drawn back, the time bar: the map shows between 155 and 416
    expect(coverOf(map, [part(10, 155), part(416, 703), part(711, 834)])).toEqual({ top: 155, bottom: 428 });
    // the card in full, and the Chronicle behind it reaching higher still
    expect(coverOf(map, [part(10, 155), part(330, 703), part(213, 703), part(711, 834)])).toEqual({ top: 155, bottom: 631 });
  });

  it("a banner in a row of its own under the bars counts with them", () => {
    expect(coverOf(map, [part(10, 155), part(163, 215), part(711, 834)])).toEqual({ top: 215, bottom: 133 });
  });

  it("a part that is not laid out covers nothing", () => {
    expect(coverOf(map, [part(10, 155), { top: 400, bottom: 400, width: 0, height: 0 }, { top: 300, bottom: 700, width: 0, height: 400 }])).toEqual({ top: 155, bottom: 0 });
  });

  it("is measured from the map's own edges, wherever the map is on the page", () => {
    expect(coverOf({ top: 100, bottom: 700 }, [part(100, 160), part(600, 700)])).toEqual({ top: 60, bottom: 100 });
  });
});
