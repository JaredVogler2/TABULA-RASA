import { describe, expect, it } from "vitest";
import { TOAST_MS, Toasts, type ToastClock } from "./toasts";

/** A clock the test moves by hand. */
function handClock(): ToastClock & { advance(ms: number): void } {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    later(run, ms) {
      const id = next++;
      due.set(id, { at: now + ms, run });
      return id;
    },
    cancel(handle) {
      due.delete(handle as number);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const first = [...due.entries()].filter(([, d]) => d.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!first) break;
        now = first[1].at;
        due.delete(first[0]);
        first[1].run();
      }
      now = until;
    },
  };
}

function place(): { toasts: Toasts; clock: ReturnType<typeof handClock>; shown: (string | null)[]; now: () => string | null } {
  const clock = handClock();
  const shown: (string | null)[] = [];
  const toasts = new Toasts((m) => shown.push(m), clock);
  return { toasts, clock, shown, now: () => shown[shown.length - 1] ?? null };
}

describe("the place for passing messages", () => {
  it("shows a message for its time and then empties", () => {
    const { toasts, clock, now } = place();
    toasts.say("Saved.");
    expect(now()).toBe("Saved.");
    clock.advance(TOAST_MS - 1);
    expect(now()).toBe("Saved.");
    clock.advance(1);
    expect(now()).toBeNull();
  });

  it("a notice is never displaced by news: the news waits, and is shown when the notice has had its time", () => {
    const { toasts, clock, now, shown } = place();
    toasts.say("Another tab is keeping the autosave.");
    clock.advance(40); // the very next frame
    toasts.say("Field journal · A gift", "news");
    expect(now()).toBe("Another tab is keeping the autosave.");
    clock.advance(TOAST_MS - 41);
    expect(now()).toBe("Another tab is keeping the autosave.");
    clock.advance(1);
    expect(now()).toBe("Field journal · A gift");
    clock.advance(TOAST_MS);
    expect(now()).toBeNull();
    // the place was never empty between the two
    expect(shown).toEqual(["Another tab is keeping the autosave.", "Field journal · A gift", null]);
  });

  it("of several pieces of news that arrive during a notice, the latest is the one shown (the journal keeps them all)", () => {
    const { toasts, clock, now } = place();
    toasts.say("The picture was simplified.");
    toasts.say("Field journal · First fire", "news");
    toasts.say("Field journal · A gift", "news");
    clock.advance(TOAST_MS);
    expect(now()).toBe("Field journal · A gift");
  });

  it("a notice takes the place at once, from news and from another notice, and what was waiting is not lost", () => {
    const { toasts, clock, now } = place();
    toasts.say("Field journal · First fire", "news");
    expect(now()).toBe("Field journal · First fire");
    toasts.say("Could not save.");
    expect(now()).toBe("Could not save.");
    toasts.say("Field journal · A gift", "news");
    clock.advance(1000);
    toasts.say("Saved.");
    expect(now()).toBe("Saved.");
    // the second notice starts its own time; the news waits for the end of that one
    clock.advance(TOAST_MS - 1);
    expect(now()).toBe("Saved.");
    clock.advance(1);
    expect(now()).toBe("Field journal · A gift");
  });

  it("news replaces news at once, and may take the place as soon as no notice holds it", () => {
    const { toasts, clock, now } = place();
    toasts.say("Field journal · First fire", "news");
    toasts.say("Field journal · A gift", "news");
    expect(now()).toBe("Field journal · A gift");
    clock.advance(TOAST_MS);
    expect(now()).toBeNull();
    toasts.say("Saved.");
    clock.advance(TOAST_MS);
    toasts.say("Field journal · A path", "news");
    expect(now()).toBe("Field journal · A path");
  });

  it("clearing empties the place, drops what was waiting and leaves no timer behind", () => {
    const { toasts, clock, now, shown } = place();
    toasts.say("Another tab is keeping the autosave.");
    toasts.say("Field journal · A gift", "news");
    toasts.clear();
    expect(now()).toBeNull();
    const count = shown.length;
    clock.advance(TOAST_MS * 3);
    expect(shown.length).toBe(count);
    // and news is free to take the place again
    toasts.say("Field journal · A path", "news");
    expect(now()).toBe("Field journal · A path");
  });
});
