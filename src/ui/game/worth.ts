/**
 * What the observer's hand has been worth: the world they changed, set beside its untouched
 * twin — the same island, people, weather and luck with nothing done to it. This is the one
 * honest measure of skill the game has, because the twin is not an estimate: it is run.
 *
 * It is a comparison of one pair of histories. It says what happened in these two, not what
 * a change "causes" in general (D-012), and the pages that show it say so.
 */
import { AGES, ageTitle } from "@/engine";
import type { ProgressView } from "@/worker/protocol";

const TICKS_PER_DAY = 96;
const fmt = (n: number): string => n.toLocaleString("en-GB");
const days = (n: number): string => (n === 1 ? "1 day" : `${fmt(n)} days`);

export interface Worth {
  /** Legacy here minus the twin's. */
  legacy: number;
  /** People alive here minus the twin's. */
  living: number;
  /**
   * The furthest age either world has reached, and how the two compare on it: days sooner
   * here (negative = later), or which world has not reached it.
   */
  age: { index: number; sooner: number | null; only: "here" | "twin" | null } | null;
}

/** The comparison as numbers; null while there is no twin. */
export function worthOf(p: ProgressView): Worth | null {
  if (!p.twin) return null;
  const top = Math.max(p.reached, p.twin.reached);
  let age: Worth["age"] = null;
  if (top > 0) {
    const mine = p.ticks[top] ?? -1;
    const theirs = p.twin.ticks[top] ?? -1;
    if (mine >= 0 && theirs >= 0) age = { index: top, sooner: Math.floor(theirs / TICKS_PER_DAY) - Math.floor(mine / TICKS_PER_DAY), only: null };
    else age = { index: top, sooner: null, only: mine >= 0 ? "here" : "twin" };
  }
  return { legacy: p.legacy.total - p.twin.legacy, living: p.living - p.twin.living, age };
}

/** "+485 on the twin" · "−120 on the twin" · "level with the twin": the short form, for the bar. */
export function worthShort(p: ProgressView): string {
  const w = worthOf(p);
  if (!w) return "";
  if (w.legacy === 0) return "level with the twin";
  return `${w.legacy > 0 ? "+" : "−"}${fmt(Math.abs(w.legacy))} on the twin`;
}

/** The comparison in sentences, for the Atlas and the closing page. Empty while there is no twin. */
export function worthLines(p: ProgressView): string[] {
  const w = worthOf(p);
  if (!w || !p.twin) return [];
  const lines: string[] = [];
  lines.push(
    w.legacy === 0
      ? `So far your hand has changed nothing that the legacy counts: ${fmt(p.legacy.total)} here and in the untouched twin.`
      : `So far your hand has been worth ${w.legacy > 0 ? `${fmt(w.legacy)} more` : `${fmt(-w.legacy)} less`} legacy than leaving the island alone: ${fmt(p.legacy.total)} here, ${fmt(p.twin.legacy)} in the untouched twin.`,
  );
  lines.push(w.living === 0 ? `As many are alive here as there (${p.living}).` : `${Math.abs(w.living)} ${w.living > 0 ? "more" : "fewer"} ${Math.abs(w.living) === 1 ? "is" : "are"} alive here (${p.living}) than there (${p.twin.living}).`);
  if (w.age) {
    const name = ageTitle(w.age.index);
    if (w.age.only === "here") lines.push(`The ${name} has been reached here; the twin stands in the ${ageTitle(p.twin.reached)}.`);
    else if (w.age.only === "twin") lines.push(`The twin has reached the ${name}; this world stands in the ${ageTitle(p.reached)}.`);
    else if (w.age.sooner === 0) lines.push(`The ${name} came on the same day in both.`);
    else lines.push(`The ${name} came ${days(Math.abs(w.age.sooner as number))} ${(w.age.sooner as number) > 0 ? "sooner" : "later"} here than in the twin.`);
  }
  return lines;
}

/** Named so that a reader can see the ladder this compares along. */
export const WORTH_AGES = AGES;
