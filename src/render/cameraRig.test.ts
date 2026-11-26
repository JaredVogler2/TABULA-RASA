/**
 * The camera rig, without a browser: where on the picture the thing it looks at is drawn, and what
 * lets go of a citizen who is being followed.
 *
 * Both were reported from a real phone. The inspector is a sheet over the lower half of a phone's map,
 * the rig held a followed citizen at the middle of the canvas, and the middle of the canvas was behind
 * the sheet: "Following" was pressed and the person could not be seen.
 */
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CameraRig } from "./cameraRig";
import type { HeightField } from "./heightfield";
import { frameSteps } from "./timing";

type Handler = (event: unknown) => void;

/** A rig on a flat island, with a stand-in for the canvas that only keeps the listeners it is given. */
function stage(reducedMotion = false) {
  const handlers = new Map<string, Handler[]>();
  const dom = {
    clientHeight: 600,
    addEventListener: (type: string, fn: Handler) => {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    },
    removeEventListener: () => undefined,
    setPointerCapture: () => undefined,
  };
  let userMoves = 0;
  const field = { w: 64, h: 64, heightAt: () => 0 };
  const rig = new CameraRig(dom as unknown as HTMLElement, field as unknown as HeightField, {
    reducedMotion,
    onTap: () => undefined,
    onHover: () => undefined,
    onUserMove: () => {
      userMoves++;
    },
  });
  const fire = (type: string, event: Record<string, unknown>): void => {
    for (const fn of handlers.get(type) ?? []) fn({ preventDefault: () => undefined, pointerType: "touch", button: 0, altKey: false, ctrlKey: false, metaKey: false, ...event });
  };
  /** Enough frames for every eased value to arrive. */
  const settle = (): void => {
    for (let i = 0; i < 240; i++) rig.update(1 / 60);
  };
  return { rig, fire, settle, userMoves: () => userMoves };
}

/** Where a point of the world is drawn, in pixels from the left and from the top of a picture of this size. */
function drawnAt(rig: CameraRig, point: Vector3, width: number, height: number): { x: number; y: number } {
  const v = point.clone().project(rig.camera);
  return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
}

describe("camera rig: what it looks at is drawn where it can be seen", () => {
  it("draws it at the middle of the picture when nothing is covered", () => {
    const { rig, settle } = stage();
    rig.resize(390, 600);
    settle();
    const at = drawnAt(rig, rig.target, 390, 600);
    expect(at.x).toBeCloseTo(195, 3);
    expect(at.y).toBeCloseTo(300, 3);
    expect(rig.focusY()).toBe(300);
    expect(rig.camera.view?.enabled ?? false).toBe(false);
  });

  it("draws it at the middle of what the interface leaves uncovered", () => {
    const { rig, settle } = stage();
    rig.resize(390, 600);
    // bars over the top 150 px, a sheet over the bottom 250 px: the map shows between 150 and 350
    rig.setInsets(150, 250, true);
    settle();
    const at = drawnAt(rig, rig.target, 390, 600);
    expect(at.x).toBeCloseTo(195, 3);
    expect(at.y).toBeCloseTo(250, 3);
    expect(rig.focusY()).toBe(250);
  });

  it("looks through the same lens: only where the picture is cut from it changes", () => {
    const { rig, settle } = stage();
    rig.resize(390, 600);
    settle();
    // two points of the ground, a tile apart across the picture
    const a = rig.target.clone();
    const b = a.clone().add(new Vector3(Math.cos(0.62), 0, -Math.sin(0.62)));
    const before = { a: drawnAt(rig, a, 390, 600), b: drawnAt(rig, b, 390, 600) };
    rig.setInsets(150, 250, true);
    settle();
    const after = { a: drawnAt(rig, a, 390, 600), b: drawnAt(rig, b, 390, 600) };
    // everything is moved up by the same 50 px; nothing is scaled or turned
    expect(after.a.y - before.a.y).toBeCloseTo(-50, 3);
    expect(after.b.y - before.b.y).toBeCloseTo(-50, 3);
    expect(after.a.x).toBeCloseTo(before.a.x, 3);
    expect(after.b.x).toBeCloseTo(before.b.x, 3);
  });

  it("moves there over several frames, and at once when motion is reduced", () => {
    const eased = stage();
    eased.rig.resize(390, 600);
    eased.settle();
    eased.rig.setInsets(150, 250);
    eased.rig.update(1 / 60);
    const first = drawnAt(eased.rig, eased.rig.target, 390, 600).y;
    expect(first).toBeLessThan(300);
    expect(first).toBeGreaterThan(250);
    eased.settle();
    expect(drawnAt(eased.rig, eased.rig.target, 390, 600).y).toBeCloseTo(250, 3);

    const still = stage(true);
    still.rig.resize(390, 600);
    still.rig.update(1 / 60);
    still.rig.setInsets(150, 250);
    still.rig.update(1 / 60);
    expect(drawnAt(still.rig, still.rig.target, 390, 600).y).toBeCloseTo(250, 3);
  });

  it("keeps the middle inside the picture whatever it is told, and follows the picture's size", () => {
    const { rig, settle } = stage();
    rig.resize(390, 600);
    rig.setInsets(0, 5000, true);
    settle();
    // never more than four tenths of the height from the middle
    expect(drawnAt(rig, rig.target, 390, 600).y).toBeCloseTo(60, 3);
    rig.setInsets(-40, -40, true);
    settle();
    expect(drawnAt(rig, rig.target, 390, 600).y).toBeCloseTo(300, 3);

    rig.setInsets(150, 250, true);
    rig.resize(390, 700);
    settle();
    expect(drawnAt(rig, rig.target, 390, 700).y).toBeCloseTo(300, 3);
    // nothing covered again: the ordinary lens, with no window cut from it
    rig.setInsets(0, 0, true);
    expect(rig.camera.view?.enabled ?? false).toBe(false);
  });
});

describe("camera rig: following", () => {
  it("keeps the person followed where the rig looks, as they move", () => {
    const { rig, settle } = stage();
    rig.resize(390, 600);
    rig.setInsets(150, 250, true);
    const who = new Vector3(5, 0, -3);
    rig.follow(() => who, 26);
    settle();
    expect(rig.target.x).toBeCloseTo(5, 3);
    expect(rig.target.z).toBeCloseTo(-3, 3);
    who.set(9, 0, 2);
    settle();
    expect(rig.target.x).toBeCloseTo(9, 3);
    expect(rig.target.z).toBeCloseTo(2, 3);
    // and they are drawn at the middle of the uncovered map
    const at = drawnAt(rig, who, 390, 600);
    expect(at.x).toBeCloseTo(195, 2);
    expect(at.y).toBeCloseTo(250, 2);
  });

  it("is not ended by zooming, turning or tilting — by keys, the wheel, an Alt-drag or two fingers", () => {
    const { rig, fire, settle, userMoves } = stage();
    rig.resize(390, 600);
    const who = new Vector3(5, 0, -3);
    rig.follow(() => who, 26);
    rig.zoom(0.8);
    rig.rotate(0.3);
    rig.tilt(-0.1);
    fire("wheel", { deltaY: -100 });
    // a pinch: two fingers down, one of them moved
    fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 300 });
    fire("pointerdown", { pointerId: 2, clientX: 200, clientY: 300 });
    fire("pointermove", { pointerId: 2, clientX: 250, clientY: 320 });
    fire("pointerup", { pointerId: 2, clientX: 250, clientY: 320 });
    fire("pointerup", { pointerId: 1, clientX: 100, clientY: 300 });
    // a mouse turning the view with Alt held
    fire("pointerdown", { pointerId: 3, pointerType: "mouse", altKey: true, clientX: 100, clientY: 300 });
    fire("pointermove", { pointerId: 3, pointerType: "mouse", altKey: true, clientX: 160, clientY: 310 });
    fire("pointerup", { pointerId: 3, pointerType: "mouse", clientX: 160, clientY: 310 });
    expect(rig.isFollowing()).toBe(true);
    expect(userMoves()).toBe(0);
    who.set(-4, 0, 6);
    settle();
    expect(rig.target.x).toBeCloseTo(-4, 3);
    expect(rig.target.z).toBeCloseTo(6, 3);
  });

  it("is ended by moving the view across the ground: a one-finger drag, or the arrow keys", () => {
    const dragged = stage();
    dragged.rig.resize(390, 600);
    dragged.rig.follow(() => new Vector3(5, 0, -3), 26);
    dragged.fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 300 });
    // a finger that barely moves is a tap, not a drag
    dragged.fire("pointermove", { pointerId: 1, clientX: 102, clientY: 301 });
    expect(dragged.rig.isFollowing()).toBe(true);
    dragged.fire("pointermove", { pointerId: 1, clientX: 140, clientY: 300 });
    expect(dragged.rig.isFollowing()).toBe(false);
    expect(dragged.userMoves()).toBeGreaterThan(0);

    const keyed = stage();
    keyed.rig.resize(390, 600);
    keyed.rig.follow(() => new Vector3(5, 0, -3), 26);
    keyed.rig.nudge(12, 0);
    expect(keyed.rig.isFollowing()).toBe(false);
    expect(keyed.userMoves()).toBe(1);
  });

  it("does not fall behind a walker when frames are slow, given the time that has really passed", () => {
    // four tiles a second across the island, drawn at two and a half frames a second
    const lagAfter = (step: number): number => {
      const { rig } = stage();
      rig.resize(390, 600);
      const who = new Vector3(-10, 0, 0);
      rig.follow(() => who, 26);
      for (let i = 0; i < 40; i++) rig.update(1 / 60);
      for (let i = 0; i < 12; i++) {
        who.x += 4 * 0.4;
        rig.update(step);
      }
      return Math.abs(who.x - rig.target.x);
    };
    const slow = frameSteps(400);
    expect(slow).toEqual({ animation: 0.1, camera: 0.4 });
    // with the camera's own step the walker stays within a tenth of a tile of where the rig looks…
    expect(lagAfter(slow.camera)).toBeLessThan(0.1);
    // …and with the step that animation takes (the one the rig used to be given) they were over a tile away
    expect(lagAfter(slow.animation)).toBeGreaterThan(1);
  });

  it("takes an ordinary frame as it is, and never a frame longer than a second", () => {
    expect(frameSteps(16)).toEqual({ animation: 0.016, camera: 0.016 });
    expect(frameSteps(100)).toEqual({ animation: 0.1, camera: 0.1 });
    expect(frameSteps(3_600_000)).toEqual({ animation: 0.1, camera: 1 });
    expect(frameSteps(-5)).toEqual({ animation: 0, camera: 0 });
  });

  it("ends by itself when the person followed is no longer there", () => {
    const { rig } = stage();
    rig.resize(390, 600);
    let there = true;
    const who = new Vector3(5, 0, -3);
    rig.follow(() => (there ? who : null), 26);
    rig.update(1 / 60);
    expect(rig.isFollowing()).toBe(true);
    there = false;
    rig.update(1 / 60);
    expect(rig.isFollowing()).toBe(false);
  });
});
