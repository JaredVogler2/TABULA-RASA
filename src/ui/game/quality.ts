/**
 * Which graphics preset to draw with when the visitor has not chosen one, and what "simpler"
 * means when the renderer cannot keep up. Presets change only how the world is drawn.
 */
import type { Quality } from "@/render/WorldRenderer";

/** A first guess from what the browser says about the device: phones and small screens get the middle preset, as do machines with few cores. */
export function autoQuality(): Quality {
  if (typeof window === "undefined") return "medium";
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (coarse || small) return "medium";
  return cores >= 6 ? "high" : "medium";
}

const QUALITY_ORDER: readonly Quality[] = ["low", "medium", "high"];

/** The simpler of two presets. */
export function simplerOf(a: Quality, b: Quality): Quality {
  return QUALITY_ORDER.indexOf(a) <= QUALITY_ORDER.indexOf(b) ? a : b;
}

/** The preset one step simpler, or null if there is none. */
export function stepDown(q: Quality): Quality | null {
  const i = QUALITY_ORDER.indexOf(q);
  return i > 0 ? (QUALITY_ORDER[i - 1] as Quality) : null;
}

/**
 * What the preset should become when the renderer is at its lowest resolution and still cannot
 * keep up — or null if nothing should change: a preset the visitor chose (in the menu, or in
 * the address) is theirs, and below the simplest there is nothing.
 */
export function simplified(setting: "auto" | Quality, override: Quality | null, current: Quality): Quality | null {
  if (override !== null || setting !== "auto") return null;
  return stepDown(current);
}
