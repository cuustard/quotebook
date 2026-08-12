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
    <div ref={rootRef} className="relative">
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

      {/* Width is deliberately kept inside the 18rem filter column. This
          popover lives in a narrow sticky sidebar with the quote feed
          immediately to its right, so anything wider than the column spills
          over the quotes — which is what a single-row header forced it to do.
          Stacking the two nav pairs buys the width back. */}
      {open && (
        <div className="qb-card absolute left-0 top-full z-20 mt-2 w-64 p-3 shadow-xl">
          {/* Each nav pair flanks the dropdown it steps through — month
              arrows hug the month select, year arrows hug the year select —
              so it's visually obvious what each button jumps. One pair per
              row: side by side they don't fit the column. */}
          <div className="mb-2 flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
                className="rounded-md p-1 text-ink-muted hover:bg-white/5 hover:text-ink"
                aria-label="Previous month"
                title="Previous month"
              >
                <ChevronIcon className="h-4 w-4 rotate-180" />
              </button>
              <select
                value={cursor.getMonth()}
                onChange={(e) => setCursor((c) => new Date(c.getFullYear(), Number(e.target.value), 1))}
                className="w-28 rounded-md border border-white/10 bg-paper px-2 py-1 text-center text-sm font-medium text-ink outline-none hover:bg-white/5"
                aria-label="Month"
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i} className="bg-paper-raised text-ink">
                    {m}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
                className="rounded-md p-1 text-ink-muted hover:bg-white/5 hover:text-ink"
                aria-label="Next month"
                title="Next month"
              >
                <ChevronIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setCursor((c) => new Date(c.getFullYear() - 1, c.getMonth(), 1))}
                className="rounded-md p-1 text-ink-muted hover:bg-white/5 hover:text-ink"
                aria-label="Previous year"
                title="Previous year"
              >
                <DoubleChevronIcon className="h-4 w-4 rotate-180" />
              </button>
              <select
                value={cursor.getFullYear()}
                onChange={(e) => setCursor((c) => new Date(Number(e.target.value), c.getMonth(), 1))}
                className="w-28 rounded-md border border-white/10 bg-paper px-2 py-1 text-center text-sm font-medium text-ink outline-none hover:bg-white/5"
                aria-label="Year"
              >
                {years.map((y) => (
                  <option key={y} value={y} className="bg-paper-raised text-ink">
                    {y}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCursor((c) => new Date(c.getFullYear() + 1, c.getMonth(), 1))}
                className="rounded-md p-1 text-ink-muted hover:bg-white/5 hover:text-ink"
                aria-label="Next year"
                title="Next year"
              >
                <DoubleChevronIcon className="h-4 w-4" />
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
