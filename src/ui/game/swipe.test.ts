import { describe, expect, it } from "vitest";
import { SWIPE_CLOSE_PX, SWIPE_FLICK_PX, SWIPE_FLICK_SPEED, closesOnRelease } from "./swipe";

describe("pulling a sheet down: when letting go closes it", () => {
  it("far enough closes it however slowly it was pulled", () => {
    expect(closesOnRelease(SWIPE_CLOSE_PX, 5000)).toBe(true);
    expect(closesOnRelease(SWIPE_CLOSE_PX + 200, 900)).toBe(true);
    expect(closesOnRelease(SWIPE_CLOSE_PX - 1, 5000)).toBe(false);
  });

  it("a short pull closes it only as a flick", () => {
    const quick = SWIPE_FLICK_PX / SWIPE_FLICK_SPEED;
    expect(closesOnRelease(SWIPE_FLICK_PX, quick)).toBe(true);
    expect(closesOnRelease(SWIPE_FLICK_PX, quick * 3)).toBe(false);
    expect(closesOnRelease(SWIPE_FLICK_PX - 1, 1)).toBe(false);
  });

  it("a touch that does not move, or moves up, never closes anything", () => {
    expect(closesOnRelease(0, 80)).toBe(false);
    expect(closesOnRelease(-140, 60)).toBe(false);
    expect(closesOnRelease(3, 1)).toBe(false);
  });
});
