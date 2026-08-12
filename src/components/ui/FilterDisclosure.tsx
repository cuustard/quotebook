"use client";

import { cn } from "@/lib/cn";

interface FilterDisclosureProps {
  open: boolean;
  onToggle: () => void;
  /** Summary shown on the trigger — the current selection, or a placeholder. */
  label: string;
  /** Optional leading glyph (the timeline filter shows a calendar). */
  icon?: React.ReactNode;
  /** Highlights the trigger when the filter is actually narrowing the feed. */
  active?: boolean;
  children: React.ReactNode;
}

/**
 * The open/close shell shared by every filter in the sidebar — quotees, tags
 * and the timeline all render through this, so they look and behave the same
 * rather than each having its own trigger and panel treatment.
 *
 * Open, the trigger fuses with its section like a folder tab: matching
 * background, no bottom border, square bottom corners, and pulled down 1px
 * (`relative z-10` + `-mb-px`) so it covers the section's top border. That is
 * the same treatment the "Filters" button uses on the panel as a whole, which
 * is what makes a nested filter read as a smaller instance of the same idea.
 *
 * The section is `-mx-4` to cancel the filter panel's own `p-4`, so it spans
 * the panel edge to edge — the folder body sitting wider than its tab. That
 * also buys back 32px of width, which the calendar's one-row month/year header
 * needs and would not otherwise have.
 *
 * Sections stay open until their trigger is toggled: they occupy layout rather
 * than floating over it, so dismissing one on an outside click would collapse
 * the panel and shift everything under the pointer mid-interaction.
 */
export function FilterDisclosure({
  open,
  onToggle,
  label,
  icon,
  active = false,
  children,
}: FilterDisclosureProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "qb-btn-ghost w-full justify-between border px-3 text-left",
          active && !open && "border-accent/40 text-accent",
          open
            ? "relative z-10 -mb-px rounded-b-none border-white/[0.06] border-b-transparent bg-surface-sunken"
            : "border-white/10",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <ChevronIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="-mx-4 border-y border-white/[0.06] bg-surface-sunken px-3 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
