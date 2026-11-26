/**
 * How much of the map the interface covers: the arithmetic, apart from the page it is measured on
 * (`cover.ts` keeps it measured; `controller.measureCover` reads the boxes).
 */

/** A box on the page: the map, or a part of the interface standing on it. */
export interface Box {
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * How much of the map the parts of the interface cover, from its top and from its bottom, in pixels.
 * A part stands over the top or over the bottom by which half of the map its middle is in: the bars
 * are above, the time bar and any sheet that has risen are below, and a part that is not laid out
 * (no width or no height) covers nothing. What reaches furthest in from each edge is what counts.
 */
export function coverOf(map: Pick<Box, "top" | "bottom">, parts: readonly Box[]): { top: number; bottom: number } {
  const middle = (map.top + map.bottom) / 2;
  let top = 0;
  let bottom = 0;
  for (const part of parts) {
    if (part.width <= 0 || part.height <= 0) continue;
    if ((part.top + part.bottom) / 2 < middle) top = Math.max(top, part.bottom - map.top);
    else bottom = Math.max(bottom, map.bottom - part.top);
  }
  return { top, bottom };
}
