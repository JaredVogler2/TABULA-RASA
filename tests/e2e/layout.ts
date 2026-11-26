import type { Page } from "@playwright/test";

/**
 * Measurements of the page as it is laid out, for the things a still does not show and a test of
 * words does not notice. Both were reported by the owner from a real phone after every test here
 * had passed:
 *
 *   – the Recordings sheet: the name of a recording squeezed into a sliver and broken one word to a
 *     line, and what was said about it running off the edge of the sheet;
 *   – Follow: the button said "Following" and the person followed was behind the inspector.
 *
 * Headless Chromium is not a phone, and the first report also showed something only its engine
 * does (a name drawn over the paragraph above it), which cannot be reproduced here. What can be
 * measured in any engine is measured: boxes, lines and what stands over a point.
 */

/**
 * What is wrong with a list of rows (a name, and what is said about it), in words. An empty answer
 * means every row is whole:
 *
 *   – nothing in a row reaches past the edges of the list, and the sheet does not scroll sideways;
 *   – no row is drawn over the row before it, nor the first over what stands above the list;
 *   – no name is squeezed: a name broken over several lines has (nearly) the whole row to itself.
 */
export async function rowProblems(page: Page, listTestId: string): Promise<string[]> {
  return page.evaluate((testId) => {
    const list = document.querySelector(`[data-testid="${testId}"]`);
    if (!list) return [`there is no list "${testId}" on the page`];
    const out: string[] = [];
    const frame = list.getBoundingClientRect();
    /** On how many lines the words (and icons) inside an element are set. */
    const lines = (el: Element): number => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = Array.from(range.getClientRects())
        .filter((r) => r.width > 0.5 && r.height > 0.5)
        .sort((p, q) => p.top - q.top);
      let count = 0;
      let bottom = Number.NEGATIVE_INFINITY;
      for (const r of rects) {
        if (r.top >= bottom - 2) count++;
        bottom = Math.max(bottom, r.bottom);
      }
      return count;
    };
    const above = list.previousElementSibling?.getBoundingClientRect();
    let floor = above && above.height > 0 ? above.bottom : frame.top;
    const rows = Array.from(list.children);
    if (rows.length === 0) out.push("the list has no rows");
    rows.forEach((row, i) => {
      const box = row.getBoundingClientRect();
      const label = `row ${i + 1}`;
      for (const el of Array.from(row.querySelectorAll("*"))) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        if (b.right > frame.right + 1) {
          out.push(`${label}: reaches ${Math.round(b.right - frame.right)}px past the right edge of the list`);
          break;
        }
        if (b.left < frame.left - 1) {
          out.push(`${label}: starts ${Math.round(frame.left - b.left)}px before the left edge of the list`);
          break;
        }
        if (b.top < floor - 1) {
          out.push(`${label}: is drawn ${Math.round(floor - b.top)}px over what is above it`);
          break;
        }
      }
      const name = row.querySelector("button, b") ?? row.firstElementChild;
      if (name) {
        const n = name.getBoundingClientRect();
        const set = lines(name);
        if (set > 1 && n.width < Math.min(120, box.width * 0.4)) out.push(`${label}: its name is squeezed to ${Math.round(n.width)}px of a ${Math.round(box.width)}px row and broken over ${set} lines`);
      }
      floor = box.bottom;
    });
    // the sheet (or panel) the list is in must not have to be scrolled sideways to read it
    for (let el = list.parentElement; el && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (!/(auto|scroll)/.test(`${style.overflowY} ${style.overflowX}`)) continue;
      if (el.scrollWidth > el.clientWidth + 1) out.push(`what holds the list scrolls sideways (${el.scrollWidth}px of content in ${el.clientWidth}px)`);
      break;
    }
    return out;
  }, listTestId);
}

/** Whom the inspector is open on: the citizen's number, or null when no citizen is selected. */
export async function selectedCitizen(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const picked = window.__tr?.selected() ?? null;
    return picked && picked.type === "agent" && typeof picked.id === "number" ? picked.id : null;
  });
}

export interface Sighting {
  /** Where the citizen is drawn, in CSS pixels; null when they are outside the picture. */
  at: { x: number; y: number } | null;
  /** What stands over that point of the map ("" when nothing does and the map itself is there). */
  under: string;
  /** How far from the middle of the uncovered part of the map they are drawn, in CSS pixels (-1 when not drawn). */
  fromMiddle: number;
  /** The uncovered part of the map at the column they are drawn in: its top and bottom, in CSS pixels. */
  clear: { top: number; bottom: number };
}

/**
 * Where a citizen is drawn and whether they can be seen there: the topmost thing at that point of
 * the page is the map itself, not a bar, a sheet or a panel. (The name tag and speech marks are drawn
 * over the map and take no part: they are not in the way of a pointer and they are not opaque.)
 */
export async function sight(page: Page, agent: number): Promise<Sighting> {
  return page.evaluate((id) => {
    const canvas = document.querySelector('[data-testid="world-canvas"]');
    const at = window.__tr?.screenOf(id) ?? null;
    const map = canvas?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const name = (el: Element | null): string => {
      if (!el) return "nothing (outside the page)";
      if (el === canvas) return "";
      const held = el.closest("[data-testid], [aria-label]");
      return held?.getAttribute("data-testid") ?? held?.getAttribute("aria-label") ?? el.tagName.toLowerCase();
    };
    // the column the citizen is drawn in (the middle of the map when they are not drawn at all)
    const x = at ? at.x : (map.left + map.right) / 2;
    // the longest run of that column where the map itself is on top
    let best = { top: map.top, bottom: map.top };
    let run: { top: number; bottom: number } | null = null;
    for (let y = Math.ceil(map.top) + 1; y < map.bottom - 1; y += 2) {
      const clear = document.elementFromPoint(x, y) === canvas;
      if (clear) {
        if (!run) run = { top: y, bottom: y };
        run.bottom = y;
        if (run.bottom - run.top > best.bottom - best.top) best = run;
      } else run = null;
    }
    if (!at) return { at: null, under: "outside the picture", fromMiddle: -1, clear: best };
    const under = name(document.elementFromPoint(at.x, at.y));
    return { at, under, fromMiddle: Math.abs(at.y - (best.top + best.bottom) / 2), clear: best };
  }, agent);
}
