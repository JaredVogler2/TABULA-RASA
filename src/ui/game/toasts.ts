/**
 * The one place on screen for a passing message, and who may take it from whom.
 *
 * There are two kinds. A **notice** is something the player has to be told: a save refused, the
 * picture simplified, "another tab is keeping the autosave" (said once, and never again). **News**
 * is a new line in the field journal, which the journal keeps and its button counts whether the
 * message is read or not.
 *
 * Both used to share the place on equal terms: the newest replaced whatever was there. At the
 * fastest speed something new is witnessed every few seconds, so a notice could be on screen for
 * one frame — the two-tabs test caught the autosave notice replaced by "Field journal · A gift"
 * before it could be read. Now a notice keeps the place for its whole time unless another notice
 * needs it, and news that arrives meanwhile waits its turn (the latest only: the journal has
 * the rest).
 */

/** How long a message stays, in milliseconds. */
export const TOAST_MS = 5200;

export type ToastKind = "notice" | "news";

export interface ToastClock {
  now(): number;
  later(run: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

const realClock: ToastClock = {
  now: () => performance.now(),
  later: (run, ms) => setTimeout(run, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class Toasts {
  private timer: unknown = null;
  private noticeUntil = 0;
  private waiting: string | null = null;

  /** `show` is told what the place holds now: a message, or null when it is empty. */
  constructor(
    private readonly show: (message: string | null) => void,
    private readonly clock: ToastClock = realClock,
  ) {}

  say(message: string, kind: ToastKind = "notice"): void {
    if (kind === "news" && this.clock.now() < this.noticeUntil) {
      this.waiting = message;
      return;
    }
    if (kind === "notice") this.noticeUntil = this.clock.now() + TOAST_MS;
    this.put(message);
  }

  /** Empty the place and forget what was waiting (the world on screen was replaced, or the game was left). */
  clear(): void {
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = null;
    this.waiting = null;
    this.noticeUntil = 0;
    this.show(null);
  }

  private put(message: string): void {
    this.show(message);
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = this.clock.later(() => {
      this.timer = null;
      const next = this.waiting;
      this.waiting = null;
      if (next !== null) this.put(next);
      else this.show(null);
    }, TOAST_MS);
  }
}
