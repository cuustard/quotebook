"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { useSheetDrag } from "@/components/ui/useSheetDrag";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Wider modal for the quote editor. */
  size?: "md" | "lg";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible, mobile-friendly modal: backdrop click + Escape to dismiss,
 * focus trapped inside while open and restored to the opener on close.
 */
export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Touch-only, so on desktop these handlers are attached but can never fire —
  // the centred modal behaves exactly as it did before.
  const { offset, handleProps } = useSheetDrag(onClose);

  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    const focusables = (): HTMLElement[] =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];

    // Move focus inside — unless something in the modal (e.g. an autoFocus
    // input) already claimed it during mount.
    if (panel && !panel.contains(document.activeElement)) {
      focusables()[0]?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // Trap Tab: cycle within the modal instead of escaping to the page.
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = panel?.contains(active) ?? false;
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      restoreTo?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        className={cn(
          "qb-card flex max-h-[92vh] w-full flex-col overflow-hidden rounded-b-none sm:rounded-2xl",
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md",
          // `qb-sheet` only animates below `sm` (see globals.css); above that
          // this is a centred modal and the class is inert.
          "qb-sheet",
          offset === 0 && "transition-transform duration-200",
        )}
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle for drag-to-dismiss. Mobile only: on desktop the modal
            is centred, so there is no edge to drag it toward. */}
        <div
          {...handleProps}
          aria-hidden
          className="flex shrink-0 touch-none justify-center pb-1 pt-3 sm:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-white/20" />
        </div>

        {title && (
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <h2 className="font-heading text-lg font-semibold text-ink">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-ink-muted transition hover:bg-white/5"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
