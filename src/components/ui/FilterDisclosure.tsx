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
 * ───────────────────────── The folder-tab form ─────────────────────────
 * Open, the trigger and its section are ONE elevated unit sitting on the
 * filter panel, rather than a tab floating over a separate box:
 *
 *   ELEVATION IS LIGHTER, NOT DARKER. Both halves take `bg-paper` (#313338),
 *   one step ABOVE the panel's `bg-paper-raised` (#2b2d31). They previously
 *   used the sunken input surface (#1e1f22), which reads as a hole punched
 *   into the panel — the opposite of raised.
 *
 *   ONE CONTINUOUS OUTLINE. Both halves carry the same border colour and are
 *   exactly the same width, so the left and right edges run unbroken down the
 *   whole unit. This is why the section is NOT full-bleed: bleeding it wider
 *   than the trigger would break the outline into two mismatched rectangles.
 *
 *   OUTER CORNERS ROUNDED, SEAM INVISIBLE. Only the outside of the unit is
 *   rounded — the trigger keeps its top corners, the section rounds its bottom
 *   ones by the same amount, and the two edges that meet are squared off. The
 *   trigger's bottom border is transparent rather than removed so it still
 *   occupies its 1px (backgrounds paint under borders, so the fill runs
 *   straight through), while the section has no top border at all, so there is
 *   no doubled-up line at the join.
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
          "qb-btn-ghost w-full justify-between border border-white/10 px-3 text-left",
          active && !open && "border-accent/40 text-accent",
          // Top half of the unit: keep the top corners, square off the bottom
          // ones, and make the bottom border transparent so the fill runs
          // straight into the section with no seam.
          open && "rounded-b-none border-b-transparent bg-paper",
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
        // Bottom half: same width, same border colour and no top border, so
        // the outline continues unbroken from the trigger; `rounded-b-lg`
        // matches the trigger's own top radius so the unit closes off cleanly
        // instead of ending in a squared-off edge.
        <div className="rounded-b-lg border border-t-0 border-white/10 bg-paper px-3 py-3">
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
