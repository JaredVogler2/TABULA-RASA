/**
 * Pulling a bottom sheet down by its header closes it. (A sheet that can be drawn back to its head —
 * the inspector — is also opened by pulling its header up, and opened or drawn back by a tap on it.)
 *
 * On a phone the panels rise from the bottom edge and carry a small bar at the top: that bar
 * is an invitation to drag, so dragging has to work. The header follows the finger; let go
 * past a third of a hand's width, or with a flick, and the sheet closes; otherwise it settles
 * back. Only touch and pen do this, and only where the panels are bottom sheets (narrow
 * windows): a mouse has the close button, and a centred dialog is not something to fling.
 */
import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/** Narrow windows are where panels are bottom sheets (the same width the stylesheet switches at). */
const SHEET_QUERY = "(max-width: 880px)";
/** Dragged further than this, the sheet closes when let go. */
export const SWIPE_CLOSE_PX = 96;
/** …or sooner, if it was flicked: at least this far, at this speed (px per ms). */
export const SWIPE_FLICK_PX = 28;
export const SWIPE_FLICK_SPEED = 0.55;

/** Pulled up at least this far, a sheet that can open further opens when let go. */
export const SWIPE_OPEN_PX = 28;
/** A touch that ends within this many pixels of where it began is a tap, not a pull. */
export const TAP_SLOP_PX = 8;

/** Whether letting go here opens a sheet that is drawn back: pulled up far enough. */
export function opensOnRelease(dy: number): boolean {
  return dy <= -SWIPE_OPEN_PX;
}

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
  onClick(e: ReactMouseEvent<HTMLElement>): void;
}

/** What else a sheet's header does, for the sheets that can be drawn back to their head (the inspector). */
export interface SwipeMore {
  /** The header was pulled up. */
  onUp?: () => void;
  /** The header was tapped or clicked, and not on a button. A pull is not a tap. */
  onTap?: () => void;
}

/** Handlers for a sheet's header. The sheet is the nearest `section` or `aside` above it. */
export function useSwipeDown(onClose: () => void, more: SwipeMore = {}): SwipeHandlers {
  const drag = useRef<{ y: number; t: number; sheet: HTMLElement; id: number } | null>(null);
  /** How far the last touch on the header travelled: the click that follows a pull is not a tap. */
  const pulled = useRef(0);
  const settle = (sheet: HTMLElement): void => {
    sheet.style.transition = "transform 0.18s ease-out";
    sheet.style.transform = "";
    window.setTimeout(() => {
      sheet.style.transition = "";
    }, 200);
  };
  return {
    onPointerDown(e) {
      pulled.current = 0;
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
      pulled.current = Math.max(pulled.current, Math.abs(e.clientY - d.y));
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
        if (opensOnRelease(dy)) more.onUp?.();
      }
    },
    onClick(e) {
      if ((e.target as HTMLElement).closest("button, a, input, select")) return;
      const wasPull = pulled.current > TAP_SLOP_PX;
      pulled.current = 0;
      if (!wasPull) more.onTap?.();
    },
    onPointerCancel(e) {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      settle(d.sheet);
    },
  };
}
