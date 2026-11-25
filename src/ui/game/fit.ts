/**
 * The top bar shows as many of its words as fit, and finds out by measuring.
 *
 * It used to give words up at fixed window widths. Those widths were measured for one set of
 * labels and were wrong for longer ones — a four-digit day, "Cold snap", a fork on day 1888:
 * `scripts/topbar.mjs` found the game's name squeezed at 1366 px, the tools off the screen at
 * 1120 px and the status row spilling on every phone. They also had to assume that the fork
 * pill was there, so a world nobody had touched (most of them) lost words it had room for.
 *
 * So the bar is tried in each of the states below, most generous first, and takes the first in
 * which nothing is squeezed, clipped or off the screen. Whatever word goes, its control keeps
 * its icon, its tooltip and its accessible name.
 */

/**
 * What gives way on a single row, least needed first. A state is the set of things hidden in
 * it (the stylesheet reads the words: `.topbar[data-hide~="twin"]`).
 */
export const ROW_STATES: readonly string[] = [
  "",
  "optional",
  "optional twin",
  "optional twin fork",
  "optional twin fork label",
  // once the tools are down to their icons there is room for the world's label and the fork's words again
  "optional twin tools",
  "optional twin tools fork",
  "optional twin tools fork label",
];

/**
 * When no single row fits, the status takes a row of its own, with room for all its words, and
 * the first row is the name, the fork pill and the tools: with the tools' words if they fit
 * beside the others (all of them, or all but Compare's), without if not.
 */
export const WRAPPED_STATES: readonly string[] = ["twin label", "twin label compare", "twin label tools"];

/**
 * How far a status row is squeezed when it has a row to itself and still does not fit (a
 * narrow phone late in a long game): 0 everything, 1 no season or weather word, 2 tighter
 * spacing as well, 3 without the size of the founding population too.
 */
export const SQUEEZES = 4;

/** On a narrow window only the fork pill is fitted: whole, without "Forked on", or down to its number. */
export const NARROW_FORK: readonly string[] = ["", "fork", "fork forkday"];

/** A world label cut to less than this many pixels says nothing: better gone. */
const MIN_LABEL = 56;

/** Below this the stylesheet lays the bar out in rows of its own accord (see "phones and narrow windows"). */
const NARROW = "(max-width: 880px)";

/** The first of `count` candidates that fits, in order; `count` itself if none does. */
export function firstThatFits(count: number, fits: (index: number) => boolean): number {
  for (let i = 0; i < count; i++) if (fits(i)) return i;
  return count;
}

const spills = (el: Element): boolean => el.scrollWidth > el.clientWidth + 1;

/**
 * Measure the bar and set the most generous state that fits. Reads layout several times, so
 * it is called when what the bar holds changes width or the window changes size — not on
 * every frame.
 */
export function fitTopBar(bar: HTMLElement): void {
  const status = bar.querySelector<HTMLElement>('[data-part="status"]');
  if (!status) return;
  const label = bar.querySelector<HTMLElement>('[data-part="label"]');
  const parts = [...bar.children];
  const rowFits = (): boolean => {
    if (spills(bar)) return false;
    for (const part of parts) if (spills(part)) return false;
    if (label && label.scrollWidth > 0 && label.clientWidth < Math.min(label.scrollWidth, MIN_LABEL)) return false;
    return true;
  };
  // with the status below, the rest fits if it is still one row: nothing has dropped under the name
  const first = parts.filter((part): part is HTMLElement => part !== status && part instanceof HTMLElement);
  const stillOneRow = (): boolean => {
    const head = first[0];
    if (!head) return true;
    const floor = head.offsetTop + head.offsetHeight;
    return first.every((part) => part.offsetTop < floor && !spills(part));
  };
  status.dataset.squeeze = "0";
  delete bar.dataset.wrap;
  if (window.matchMedia(NARROW).matches) {
    bar.dataset.hide = "";
    // the fork pill belongs beside the name: if its words push it onto a row of its own, they go —
    // "Forked on" first, then "day", which leaves the fork's sign and the number
    const name = bar.querySelector<HTMLElement>('[data-part="brand"]');
    const fork = bar.querySelector<HTMLElement>('[data-part="fork"]');
    if (name && fork) {
      firstThatFits(NARROW_FORK.length, (i) => {
        bar.dataset.hide = NARROW_FORK[i] as string;
        return fork.offsetTop < name.offsetTop + name.offsetHeight;
      });
    }
  } else if (
    firstThatFits(ROW_STATES.length, (i) => {
      bar.dataset.hide = ROW_STATES[i] as string;
      return rowFits();
    }) === ROW_STATES.length
  ) {
    bar.dataset.wrap = "true";
    // if even the last of them does not fit, it stays: there is nothing simpler to try
    firstThatFits(WRAPPED_STATES.length, (i) => {
      bar.dataset.hide = WRAPPED_STATES[i] as string;
      return stillOneRow();
    });
  }
  // on a row of its own the status is as wide as the window: it gives up only what it must
  firstThatFits(SQUEEZES, (i) => {
    status.dataset.squeeze = String(i);
    return !spills(status);
  });
}
