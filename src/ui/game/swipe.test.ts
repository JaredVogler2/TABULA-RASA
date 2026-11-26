import { describe, expect, it } from "vitest";
import { SWIPE_CLOSE_PX, SWIPE_FLICK_PX, SWIPE_FLICK_SPEED, SWIPE_OPEN_PX, TAP_SLOP_PX, closesOnRelease, opensOnRelease } from "./swipe";

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

describe("pulling a drawn-back sheet up: when letting go opens it", () => {
  it("opens when pulled up far enough, and not by a touch that barely moved or went down", () => {
    expect(opensOnRelease(-SWIPE_OPEN_PX)).toBe(true);
    expect(opensOnRelease(-200)).toBe(true);
    expect(opensOnRelease(-SWIPE_OPEN_PX + 1)).toBe(false);
    expect(opensOnRelease(0)).toBe(false);
    expect(opensOnRelease(140)).toBe(false);
  });

  it("a tap is not a pull: what opens a sheet is further than what counts as a tap", () => {
    expect(SWIPE_OPEN_PX).toBeGreaterThan(TAP_SLOP_PX);
    // and a pull up never closes anything
    expect(closesOnRelease(-SWIPE_OPEN_PX, 40)).toBe(false);
  });
});
