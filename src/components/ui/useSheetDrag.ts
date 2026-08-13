"use client";

import { useCallback, useRef, useState } from "react";
import { capturePointer } from "@/components/ui/capturePointer";

/** Drag past this many pixels and releasing dismisses the sheet. */
const DISMISS_THRESHOLD_PX = 96;

export interface SheetDrag {
  /** Current downward offset in px; 0 when not dragging. */
  offset: number;
  /** Spread onto the drag handle. */
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

/**
 * Drag-to-dismiss for a bottom sheet.
 *
 * TOUCH ONLY, deliberately. Every handler returns early unless
 * `pointerType === "touch"`, so a mouse cannot start a drag at all. That is
 * what makes this additive: on desktop the handlers are attached but inert, so
 * clicking, selecting text and every existing mouse interaction behave exactly
 * as they did before. It also avoids the usual failure of drag affordances —
 * a stray mousedown-and-move swallowing what the user meant as a click.
 *
 * Downward only (`Math.max(0, …)`): dragging up would let a sheet be pulled
 * off the top of its own container, which has no meaning here.
 */
export function useSheetDrag(onDismiss: () => void): SheetDrag {
  const [offset, setOffset] = useState(0);
  const startY = useRef<number | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    startY.current = e.clientY;
    // Capture so the gesture survives the pointer leaving the handle, which it
    // does immediately — the handle moves with the sheet as it is dragged.
    capturePointer(e);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || startY.current === null) return;
    setOffset(Math.max(0, e.clientY - startY.current));
  }, []);

  const finish = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== "touch" || startY.current === null) return;
      const travelled = Math.max(0, e.clientY - startY.current);
      startY.current = null;
      setOffset(0);
      if (travelled > DISMISS_THRESHOLD_PX) onDismiss();
    },
    [onDismiss],
  );

  return {
    offset,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}
