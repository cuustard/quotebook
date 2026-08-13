"use client";

import { useCallback, useRef, useState } from "react";
import { capturePointer } from "@/components/ui/capturePointer";

/** Past this much horizontal travel, releasing commits the action. */
const COMMIT_PX = 110;
/** Below this, the gesture is a tap and nothing is suppressed. */
const TAP_SLOP_PX = 8;

export interface SwipeAction {
  /** Signed horizontal offset; positive is right. 0 when idle. */
  offset: number;
  /** Which action a release would commit right now, if any. */
  armed: "left" | "right" | null;
  /** Spread onto the swipeable element. */
  swipeProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
}

/**
 * Horizontal swipe-to-act for a list row.
 *
 * TOUCH ONLY. Every handler returns early unless `pointerType === "touch"`,
 * which is what makes this purely additive: a mouse cannot start a swipe, so
 * on desktop the row keeps exactly the click behaviour it had and the buttons
 * inside it are unaffected. It also sidesteps the classic drag-affordance bug
 * where a slightly-moved mousedown eats the click the user intended.
 *
 * Two more things keep it from stealing input it should not:
 *   - The gesture only engages once horizontal travel exceeds vertical, so a
 *     vertical flick scrolls the list instead of arming an action. Pair with
 *     `touch-action: pan-y` on the element so the browser still owns scrolling.
 *   - A swipe past the tap slop swallows the click that the browser synthesises
 *     on release, so ending a swipe on top of a button does not also press it.
 *
 * The commit distance is deliberately long. Swipe-left deletes, and a short
 * throw would make an accidental brush destructive.
 */
export function useSwipeAction(opts: {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
}): SwipeAction {
  const { onSwipeRight, onSwipeLeft } = opts;
  const [offset, setOffset] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const engaged = useRef(false);
  const swallowClick = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    start.current = { x: e.clientX, y: e.clientY };
    engaged.current = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || !start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;

    if (!engaged.current) {
      // Undecided: let a mostly-vertical move go to the scroller untouched.
      if (Math.abs(dx) < TAP_SLOP_PX && Math.abs(dy) < TAP_SLOP_PX) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        start.current = null;
        return;
      }
      engaged.current = true;
      capturePointer(e);
    }
    setOffset(dx);
  }, []);

  const finish = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== "touch" || !start.current) return;
      const dx = e.clientX - start.current.x;
      start.current = null;
      engaged.current = false;
      setOffset(0);

      if (Math.abs(dx) > TAP_SLOP_PX) swallowClick.current = true;
      if (dx > COMMIT_PX) onSwipeRight?.();
      else if (dx < -COMMIT_PX) onSwipeLeft?.();
    },
    [onSwipeLeft, onSwipeRight],
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const armed = offset > COMMIT_PX ? "right" : offset < -COMMIT_PX ? "left" : null;

  return {
    offset,
    armed,
    swipeProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onClickCapture,
    },
  };
}
