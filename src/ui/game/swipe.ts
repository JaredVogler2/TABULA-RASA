/**
 * Pulling a bottom sheet down by its header closes it.
 *
 * On a phone the panels rise from the bottom edge and carry a small bar at the top: that bar
 * is an invitation to drag, so dragging has to work. The header follows the finger; let go
 * past a third of a hand's width, or with a flick, and the sheet closes; otherwise it settles
 * back. Only touch and pen do this, and only where the panels are bottom sheets (narrow
 * windows): a mouse has the close button, and a centred dialog is not something to fling.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/** Narrow windows are where panels are bottom sheets (the same width the stylesheet switches at). */
const SHEET_QUERY = "(max-width: 880px)";
/** Dragged further than this, the sheet closes when let go. */
export const SWIPE_CLOSE_PX = 96;
/** …or sooner, if it was flicked: at least this far, at this speed (px per ms). */
export const SWIPE_FLICK_PX = 28;
export const SWIPE_FLICK_SPEED = 0.55;

/** Whether letting go here closes the sheet: far enough, or a short fast flick downwards. */
export function closesOnRelease(dy: number, elapsedMs: number): boolean {
  if (dy >= SWIPE_CLOSE_PX) return true;
  return dy >= SWIPE_FLICK_PX && dy / Math.max(1, elapsedMs) >= SWIPE_FLICK_SPEED;
}

export interface SwipeHandlers {
  onPointerDown(e: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(e: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(e: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(e: ReactPointerEvent<HTMLElement>): void;
}

/** Handlers for a sheet's header. The sheet is the nearest `section` or `aside` above it. */
export function useSwipeDown(onClose: () => void): SwipeHandlers {
  const drag = useRef<{ y: number; t: number; sheet: HTMLElement; id: number } | null>(null);
  const settle = (sheet: HTMLElement): void => {
    sheet.style.transition = "transform 0.18s ease-out";
    sheet.style.transform = "";
    window.setTimeout(() => {
      sheet.style.transition = "";
    }, 200);
  };
  return {
    onPointerDown(e) {
      if (e.pointerType === "mouse") return;
      if (typeof window === "undefined" || !window.matchMedia(SHEET_QUERY).matches) return;
      // a press on the close button, or anything else that acts, is that thing's business
      if ((e.target as HTMLElement).closest("button, a, input, select")) return;
      const sheet = e.currentTarget.closest<HTMLElement>("section, aside");
      if (!sheet) return;
      drag.current = { y: e.clientY, t: e.timeStamp, sheet, id: e.pointerId };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e) {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dy = Math.max(0, e.clientY - d.y);
      d.sheet.style.transition = "none";
      d.sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
    },
    onPointerUp(e) {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      const dy = e.clientY - d.y;
      if (closesOnRelease(dy, e.timeStamp - d.t)) {
        d.sheet.style.transition = "";
        d.sheet.style.transform = "";
        onClose();
      } else {
        settle(d.sheet);
      }
    },
    onPointerCancel(e) {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      settle(d.sheet);
    },
  };
}
