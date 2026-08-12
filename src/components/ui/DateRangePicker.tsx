"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface DateRangePickerProps {
  since: string | null;
  before: string | null;
  onChange: (next: { since: string | null; before: string | null }) => void;
}

const MONTH_NAMES = Array.from({ length: 12 }, (_, m) =>
  new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2000, m, 1)),
);
const WEEKDAY_HEADERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** yyyy-mm-dd in local time, matching what a native `<input type="date">` produces. */
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function formatShortDate(s: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(
    fromISODate(s),
  );
}

/**
 * A single popover calendar for picking a since/before range in one click
 * flow, replacing the two native `<input type="date">` fields — those render
 * a different (and dated-looking) picker per browser/OS.
 */
export function DateRangePicker({ since, before, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => fromISODate(since ?? before ?? toISODate(new Date())));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A generous, static span — cheap to compute and wide enough to cover any
  // realistic quote history without needing the book's actual date range
  // wired through just for this.
  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: 26 }, (_, i) => currentYear + 1 - i),
    [currentYear],
  );

  const weeks = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    // Monday-first offset (getDay(): 0=Sun..6=Sat).
    const startOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - startOffset);

    const days: Date[] = [];
    for (let i = 0; i < 42; i++) days.push(new Date(year, month, 1 - startOffset + i));

    const out: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    void gridStart;
    return out;
  }, [cursor]);

  const label =
    since || before
      ? `${since ? formatShortDate(since) : "Any"} → ${before ? formatShortDate(before) : "Any"}`
      : "Any date";

  const pick = (day: Date) => {
    const iso = toISODate(day);
    // First click (or a click before the current start) sets `since` and
    // clears `before`; the next click fills in `before`, swapping order if
    // the user picked backwards.
    if (!since || before || iso < since) {
      onChange({ since: iso, before: null });
    } else {
      onChange({ since, before: iso });
      setOpen(false);
    }
  };

  const inRange = (day: Date) => {
    const iso = toISODate(day);
    return !!since && !!before && iso >= since && iso <= before;
  };
  const isEndpoint = (day: Date) => toISODate(day) === since || toISODate(day) === before;

  return (
    // No `relative`: nothing is positioned against this any more now that the
    // calendar is part of the flow rather than an overlay.
    <div ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "qb-btn-ghost w-full justify-start border border-white/10 px-3 text-left",
          (since || before) && "border-accent/40 text-accent",
        )}
      >
        <CalendarIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </button>

      {/* Expands INLINE rather than floating: it's part of the filter section,
          so it takes up space and pushes everything below it down instead of
          covering the feed. No absolute positioning, no z-index, no shadow —
          all of which existed only to manage an overlay.
          `-mx-4` cancels the filter panel's own `p-4` so the open calendar
          spans the panel edge to edge, which both reads as a section of the
          panel and buys back the 32px the padding would otherwise cost. That
          matters: within the padding there is ~230px of content width, and
          the one-row month+year header needs ~252px, so it would be squeezed.
          The selects use a custom arrow (`appearance-none` + an absolutely
          positioned chevron) rather than the OS-native one: the native
          indicator's reserved width varies by browser/OS (roughly 18–25px),
          which is a third of the small year select and would make the
          one-row header budget a guess rather than a measurement. */}
      {open && (
        <div className="-mx-4 mt-2 border-y border-white/[0.06] bg-surface-sunken px-3 py-3">
          {/* Each nav pair flanks the dropdown it steps through — month
              arrows hug the month select, year arrows hug the year select —
              so it's visually obvious what each button jumps. Centred as a
              unit: `justify-between` would shove each pair to an opposite
              edge, which only looks deliberate if they fill the row. */}
          <div className="mb-2 flex items-center justify-center gap-2">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
                className="rounded-md p-1 text-ink-muted hover:bg-white/5 hover:text-ink"
                aria-label="Previous month"
                title="Previous month"
              >
                <ChevronIcon className="h-3 w-3 rotate-180" />
              </button>
              <NavSelect
                value={cursor.getMonth()}
                onChange={(v) => setCursor((c) => new Date(c.getFullYear(), v, 1))}
                options={MONTH_NAMES.map((m, i) => [i, m] as const)}
                label="Month"
                widthClassName="w-[6.25rem]"
              />
              <button
                type="button"
                onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
                className="rounded-md p-1 text-ink-muted hover:bg-white/5 hover:text-ink"
                aria-label="Next month"
                title="Next month"
              >
                <ChevronIcon className="h-3 w-3" />
              </button>
            </div>

            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setCursor((c) => new Date(c.getFullYear() - 1, c.getMonth(), 1))}
                className="rounded-md p-1 text-ink-muted hover:bg-white/5 hover:text-ink"
                aria-label="Previous year"
                title="Previous year"
              >
                <DoubleChevronIcon className="h-3 w-3 rotate-180" />
              </button>
              <NavSelect
                value={cursor.getFullYear()}
                onChange={(v) => setCursor((c) => new Date(v, c.getMonth(), 1))}
                options={years.map((y) => [y, String(y)] as const)}
                label="Year"
                widthClassName="w-16"
              />
              <button
                type="button"
                onClick={() => setCursor((c) => new Date(c.getFullYear() + 1, c.getMonth(), 1))}
                className="rounded-md p-1 text-ink-muted hover:bg-white/5 hover:text-ink"
                aria-label="Next year"
                title="Next year"
              >
                <DoubleChevronIcon className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center text-[0.7rem] text-ink-muted">
            {WEEKDAY_HEADERS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          {weeks.map((week, i) => (
            <div key={i} className="grid grid-cols-7 gap-y-1 text-center text-xs">
              {week.map((day) => {
                const outOfMonth = day.getMonth() !== cursor.getMonth();
                const iso = toISODate(day);
                const today = iso === toISODate(new Date());
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => pick(day)}
                    className={cn(
                      "mx-auto flex h-7 w-7 items-center justify-center rounded-full transition",
                      outOfMonth && "text-ink-muted/40",
                      !outOfMonth && !isEndpoint(day) && "text-ink hover:bg-white/5",
                      inRange(day) && !isEndpoint(day) && "bg-accent-soft text-accent",
                      isEndpoint(day) && "bg-accent text-white",
                      today && !isEndpoint(day) && "ring-1 ring-white/20",
                    )}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          ))}

          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2">
            <button
              type="button"
              onClick={() => onChange({ since: null, before: null })}
              className="text-xs font-medium text-ink-muted transition hover:text-ink"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-accent transition hover:underline"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
    </svg>
  );
}
/**
 * A compact `<select>` for the month/year nav row: `appearance-none` with a
 * small custom chevron rather than the OS-native indicator. The native one's
 * reserved width varies by browser/OS (roughly 18–25px) and eats
 * disproportionately into a select this small — a custom arrow costs a known,
 * fixed few pixels either way, which is what makes the tight width budget
 * (see the comment above the popover) predictable rather than a guess.
 */
function NavSelect({
  value,
  onChange,
  options,
  label,
  widthClassName,
}: {
  value: number;
  onChange: (v: number) => void;
  options: ReadonlyArray<readonly [number, string]>;
  label: string;
  widthClassName: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          // pr-4 exactly clears the chevron below (right-1 + w-3 = 16px), so
          // no more of the box is reserved for the arrow than it occupies.
          "appearance-none rounded-md border border-white/10 bg-paper py-1 pl-2 pr-4 text-left text-sm font-medium text-ink outline-none hover:bg-white/5",
          widthClassName,
        )}
        aria-label={label}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v} className="bg-paper-raised text-ink">
            {text}
          </option>
        ))}
      </select>
      <ChevronIcon className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-ink-muted" />
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DoubleChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m7 18 6-6-6-6M13 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
