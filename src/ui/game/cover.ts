"use client";

/**
 * Keeps the camera told of how much of the map the interface covers.
 *
 * On a narrow screen the inspector is a sheet over the lower part of the map. The camera used to hold
 * whatever it looked at — a followed citizen, a place jumped to from the Chronicle — at the middle of
 * the canvas, and the middle of the canvas was behind the sheet: the button said "Following" and the
 * person followed could not be seen. The controller measures what is left of the map
 * (`measureCover`); this calls it whenever that can have changed: a bar or a sheet added or taken
 * away, any of them changing size (a sheet on its way up or down, a bar wrapping onto another row),
 * the window resized.
 */
import { useEffect, useLayoutEffect } from "react";
import { useGame } from "@/store/game";
import type { GameController } from "./controller";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useMapCover(controller: GameController): void {
  // the interface over the map exists only while a world is on screen
  const phase = useGame((s) => s.phase);

  useIsoLayoutEffect(() => {
    const measure = (): void => controller.measureCover();
    measure();
    const hud = document.querySelector("[data-hud]");
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const watchParts = (): void => {
      sizes?.disconnect();
      if (hud) for (const part of Array.from(hud.children)) sizes?.observe(part);
    };
    watchParts();
    const parts =
      hud && typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            watchParts();
            measure();
          })
        : null;
    if (hud) parts?.observe(hud, { childList: true });
    window.addEventListener("resize", measure);
    return () => {
      sizes?.disconnect();
      parts?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [controller, phase]);
}
