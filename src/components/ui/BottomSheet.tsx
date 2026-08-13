"use client";

import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { useSheetDrag } from "@/components/ui/useSheetDrag";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/**
 * A thumb-accessible sheet that rises from the bottom of the screen.
 *
 * This is the MOBILE presentation only — it is rendered by callers that have
 * already decided the viewport is compact (see `useIsCompact`). Desktop keeps
 * whatever it had: a centred modal, or an inline panel. Nothing here is
 * reachable above `lg`, which is what keeps the desktop layout untouched.
 *
 * Anchored to the bottom because that is where thumbs are. The controls it
 * holds — filters, configuration — are the ones a user reaches for repeatedly
 * while reading, and a centred dialog puts those at the least reachable part
 * of a phone held one-handed.
 */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const { offset, handleProps } = useSheetDrag(onClose);

  // Escape closes, and the page behind must not scroll while a sheet is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          "qb-sheet qb-card flex max-h-[85vh] w-full flex-col rounded-b-none",
          // While dragging, follow the finger with no transition; on release
          // the offset resets to 0 and this eases it home.
          offset === 0 && "transition-transform duration-200",
        )}
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle. Also the drag surface — dragging the sheet body would
            fight the scrolling of the content inside it. */}
        <div
          {...handleProps}
          className="flex shrink-0 cursor-grab touch-none flex-col items-center gap-2 px-5 pb-2 pt-3"
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-white/20" />
          <span className="w-full text-xs font-medium uppercase tracking-wide text-ink-muted">
            {title}
          </span>
        </div>

        <div
          className="overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
