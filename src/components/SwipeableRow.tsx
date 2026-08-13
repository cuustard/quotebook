"use client";

import { cn } from "@/lib/cn";
import { useSwipeAction } from "@/components/ui/useSwipeAction";

interface SwipeableRowProps {
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  rightLabel: string;
  leftLabel: string;
  children: React.ReactNode;
}

/**
 * Wraps a list row so it can be triaged by swiping, without altering the row.
 *
 * The row's own markup and buttons are passed straight through as children —
 * this only adds a gesture layer around them. On desktop nothing here can
 * activate (the gesture is touch-only, see `useSwipeAction`), so the row keeps
 * exactly the mouse behaviour it had.
 *
 * The action backdrop sits behind the row and is revealed as the row slides,
 * so the gesture states what it will do before the user commits to it. It only
 * brightens once past the commit distance, which is the difference between
 * "this is what would happen" and "let go and it happens".
 */
export function SwipeableRow({
  onSwipeRight,
  onSwipeLeft,
  rightLabel,
  leftLabel,
  children,
}: SwipeableRowProps) {
  const { offset, armed, swipeProps } = useSwipeAction({ onSwipeRight, onSwipeLeft });
  const dragging = offset !== 0;

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Revealed backdrop. aria-hidden: it is feedback for a gesture, and a
          screen-reader user is served by the row's own buttons instead. */}
      {dragging && (
        <div aria-hidden className="absolute inset-0 flex items-center justify-between">
          <div
            className={cn(
              "flex h-full items-center px-4 text-xs font-semibold uppercase tracking-wide transition-colors",
              armed === "right"
                ? "bg-emerald-500/25 text-emerald-200"
                : "bg-emerald-500/10 text-emerald-300/60",
            )}
          >
            {rightLabel}
          </div>
          <div
            className={cn(
              "flex h-full items-center px-4 text-xs font-semibold uppercase tracking-wide transition-colors",
              armed === "left"
                ? "bg-red-500/25 text-red-200"
                : "bg-red-500/10 text-red-300/60",
            )}
          >
            {leftLabel}
          </div>
        </div>
      )}

      <div
        {...swipeProps}
        // pan-y: the browser keeps vertical scrolling, we take the horizontal
        // axis. Without it the list would fight the gesture on touch.
        className={cn("relative touch-pan-y", !dragging && "transition-transform duration-200")}
        style={dragging ? { transform: `translateX(${offset}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
