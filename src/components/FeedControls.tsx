"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useIsCompact } from "@/lib/useMediaQuery";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { WEEKDAY_LABELS } from "@/lib/stats";
import { DEFAULT_FILTERS, type FeedFilters } from "@/lib/types";
import { DateRangePicker, formatShortDate } from "@/components/ui/DateRangePicker";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";

interface FeedControlsProps {
  filters: FeedFilters;
  setFilters: (next: FeedFilters) => void;
  speakers: string[];
  tags: string[];
  /** How many quotes in this book are missing something mandatory. */
  incompleteCount: number;
  /** Quotes left after filters/search are applied. */
  resultCount: number;
  /** Quotes in the book before any filtering. */
  totalCount: number;
}

export function FeedControls({
  filters,
  setFilters,
  speakers,
  tags,
  incompleteCount,
  resultCount,
  totalCount,
}: FeedControlsProps) {
  const [showFilters, setShowFilters] = useState(false);
  const patch = (p: Partial<FeedFilters>) => setFilters({ ...filters, ...p });
  // Presentation only — the same filter state drives both forms. Below `lg`
  // the panel becomes a bottom sheet; at and above it, the established
  // inline panel under the Filters button is untouched.
  const isCompact = useIsCompact();

  const activeCount =
    filters.speakers.length +
    filters.tags.length +
    (filters.since ? 1 : 0) +
    (filters.before ? 1 : 0) +
    filters.hours.length +
    filters.weekdays.length +
    (filters.onlyIncomplete ? 1 : 0);
  const isFiltered = activeCount > 0 || filters.query.trim().length > 0;

  /**
   * One removable chip per active filter. Arriving from a stats link means
   * filters were applied without the user touching this panel, so the feed
   * has to say what it's showing and let each part be peeled off.
   */
  const activeChips: Array<{ key: string; label: string; clear: () => void }> = [
    ...filters.speakers.map((s) => ({
      key: `sp:${s}`,
      label: s,
      clear: () => patch({ speakers: filters.speakers.filter((x) => x !== s) }),
    })),
    ...filters.tags.map((t) => ({
      key: `tg:${t}`,
      label: `#${t}`,
      clear: () => patch({ tags: filters.tags.filter((x) => x !== t) }),
    })),
    ...filters.hours.map((h) => ({
      key: `hr:${h}`,
      label: `${String(h).padStart(2, "0")}:00`,
      clear: () => patch({ hours: filters.hours.filter((x) => x !== h) }),
    })),
    ...filters.weekdays.map((w) => ({
      key: `wd:${w}`,
      label: WEEKDAY_LABELS[w],
      clear: () => patch({ weekdays: filters.weekdays.filter((x) => x !== w) }),
    })),
  ];
  if (filters.since || filters.before) {
    activeChips.push({
      key: "range",
      label:
        filters.since && filters.before
          ? filters.since === filters.before
            ? formatShortDate(filters.since)
            : `${formatShortDate(filters.since)} → ${formatShortDate(filters.before)}`
          : filters.since
            ? `from ${formatShortDate(filters.since)}`
            : `to ${formatShortDate(filters.before!)}`,
      clear: () => patch({ since: null, before: null }),
    });
  }
  if (filters.onlyIncomplete) {
    activeChips.push({
      key: "incomplete",
      label: "needs fixing",
      clear: () => patch({ onlyIncomplete: false }),
    });
  }

  const clearAllFilters = () =>
    setFilters({
      ...DEFAULT_FILTERS,
      query: filters.query,
      sortKey: filters.sortKey,
      sortDir: filters.sortDir,
    });

  /**
   * The controls themselves, held in one place so the desktop panel and the
   * mobile sheet are guaranteed to render the SAME thing. Two copies of this
   * JSX would be two things to keep in step, and the first divergence would
   * be a filter that exists on one form factor and not the other.
   */
  const filterGroups = (
    <>
      {/* Quotees + AND/OR */}
      <FilterGroup
        label="Quotees"
        empty={speakers.length === 0}
        aside={
          <Segmented
            label="How to combine selected quotees"
            value={filters.speakerMode}
            onChange={(v) => patch({ speakerMode: v as FeedFilters["speakerMode"] })}
            options={[
              { value: "or", label: "Any", title: "Any of them speaks in the quote" },
              { value: "and", label: "All", title: "All of them speak in the quote — others may too" },
              { value: "only", label: "Only", title: "Exactly these quotees — all of them, and nobody else" },
            ]}
          />
        }
      >
        <MultiSelectDropdown
          options={speakers}
          selected={filters.speakers}
          onChange={(next) => patch({ speakers: next })}
          noun="quotee"
        />
      </FilterGroup>

      {/* Tags + AND/OR */}
      <FilterGroup
        label="Tags"
        empty={tags.length === 0}
        aside={
          <Segmented
            label="How to combine selected tags"
            value={filters.tagMode}
            onChange={(v) => patch({ tagMode: v as FeedFilters["tagMode"] })}
            options={[
              { value: "or", label: "Any", title: "Has at least one of these tags" },
              { value: "and", label: "All", title: "Has all of these tags — others allowed" },
              { value: "only", label: "Only", title: "Has exactly these tags — all of them, and no others" },
            ]}
          />
        }
      >
        <MultiSelectDropdown
          options={tags}
          selected={filters.tags}
          onChange={(next) => patch({ tags: next })}
          prefix="#"
          noun="tag"
        />
      </FilterGroup>

      {/* Timeline window */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Timeline</span>
        <DateRangePicker
          since={filters.since}
          before={filters.before}
          onChange={({ since, before }) => patch({ since, before })}
        />
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Search + sort row. Always stacked — this panel now lives in a narrow
          sticky sidebar rather than a full-width row. */}
      <div className="flex flex-col gap-2">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <input
            className="qb-input pl-9"
            placeholder="Fuzzy search quotes, quotees, tags…"
            value={filters.query}
            onChange={(e) => patch({ query: e.target.value })}
          />
        </div>

        {/* Sort key/direction + filters, kept compact enough to actually fit
            the narrow sidebar column without wrapping or scrolling. */}
        <div className="flex items-center gap-1.5">
          <Segmented
            value={filters.sortKey}
            onChange={(v) => patch({ sortKey: v as FeedFilters["sortKey"] })}
            options={[
              { value: "quote_date", label: "Date" },
              { value: "created_at", label: "Added" },
            ]}
          />
          {/* Sort direction — icon-only so it doesn't compete for width. */}
          <button
            onClick={() => patch({ sortDir: filters.sortDir === "desc" ? "asc" : "desc" })}
            className="qb-btn-ghost shrink-0 border border-white/10 p-1.5"
            title={filters.sortDir === "desc" ? "Newest first" : "Oldest first"}
            aria-label={filters.sortDir === "desc" ? "Newest first" : "Oldest first"}
          >
            <SortDirIcon className={cn("h-4 w-4", filters.sortDir === "asc" && "rotate-180")} />
          </button>

          {/* Filters toggle — when open, styled to fuse with the panel below
              it like a folder tab: matching background, no bottom border,
              square bottom corners, and pulled down 1px (relative z-10) to
              sit on top of and hide the panel's top border beneath it. */}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "qb-btn-ghost ml-auto shrink-0 whitespace-nowrap border px-3",
              activeCount > 0 && !showFilters && "border-accent/40 text-accent",
              showFilters
                ? "relative z-10 -mb-px rounded-b-none border-white/[0.06] border-b-transparent bg-paper-raised text-accent"
                : "border-white/10",
            )}
          >
            Filters{activeCount > 0 ? ` · ${activeCount}` : ""}
          </button>
        </div>

        {/* Needs-fixing toggle. Hidden when the book is clean, so it only
            ever appears as an actionable prompt. Own row — it can run long
            ("Needs fixing · 12") and the row above has no room to spare. */}
        {(incompleteCount > 0 || filters.onlyIncomplete) && (
          <button
            onClick={() => patch({ onlyIncomplete: !filters.onlyIncomplete })}
            title="Quotes missing a quotee, the words themselves, or a valid date/time"
            aria-pressed={filters.onlyIncomplete}
            className={cn(
              "qb-btn-ghost w-full justify-start border px-3",
              filters.onlyIncomplete
                ? "border-amber-400 bg-amber-500/10 text-amber-300"
                : "border-white/10 text-ink-muted hover:text-ink",
            )}
          >
            ⚠ Needs fixing · {incompleteCount}
          </button>
        )}
      </div>

      {/* Filter panel — kept directly under the search/sort row (rather than
          after the result count / active-chip summary) so that toggling an
          option inside it doesn't grow/shrink content above and shove the
          open panel around while the user's still looking at it. Zero gap
          and a squared-off top-right corner (-mt-3 cancels the parent's
          gap-3) so it reads as attached to the Filters button above it. */}
      {showFilters &&
        (isCompact ? (
          /* On a phone an inline panel pushes the feed off-screen and puts the
             controls at the top of the display, furthest from the thumb. Same
             controls, raised as a sheet instead. */
          <BottomSheet open onClose={() => setShowFilters(false)} title="Filters">
            <div className="flex flex-col gap-4 pb-2">
              {filterGroups}
              <button
                onClick={clearAllFilters}
                className={cn(
                  "qb-btn-ghost w-full border border-white/10 text-accent",
                  activeCount === 0 && "invisible",
                )}
              >
                Clear all filters
              </button>
            </div>
          </BottomSheet>
        ) : (
          <div className="qb-card -mt-3 flex flex-col gap-4 rounded-tr-none p-4">
            {/* Panel header — Clear all lives here so the panel height never
                shifts as filters become active/inactive. */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Filters
              </span>
              <button
                onClick={clearAllFilters}
                title="Clear quotees, tags, timeline and the needs-fixing filter"
                className={cn(
                  "text-xs font-medium text-accent transition hover:underline",
                  activeCount === 0 && "invisible",
                )}
              >
                Clear all filters
              </button>
            </div>
            {filterGroups}
          </div>
        ))}


      {/* Result count — only worth stating once something's actually being
          filtered out; otherwise it's just noise restating the book size. */}
      {isFiltered && (
        <p className="text-xs text-ink-muted">
          <span className="font-medium text-ink">{resultCount}</span> of {totalCount} quote
          {totalCount === 1 ? "" : "s"}
        </p>
      )}

      {/* Active filters — always visible, so a deep-linked feed explains
          itself even when the filter panel is closed. */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.7rem] uppercase tracking-wide text-ink-muted/70">
            Showing
          </span>
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              onClick={chip.clear}
              title={`Remove "${chip.label}"`}
              className="qb-chip bg-accent-soft text-accent transition hover:bg-accent hover:text-white"
            >
              {chip.label}
              <span aria-hidden="true" className="opacity-60">✕</span>
            </button>
          ))}
          <button
            onClick={() =>
              setFilters({
                ...DEFAULT_FILTERS,
                query: filters.query,
                sortKey: filters.sortKey,
                sortDir: filters.sortDir,
              })
            }
            className="ml-1 text-[0.7rem] font-medium text-ink-muted transition hover:text-ink"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

// --- helpers ---------------------------------------------------------------
function SortDirIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function FilterGroup({
  label,
  children,
  aside,
  empty,
}: {
  label: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
        {aside}
      </div>
      {empty ? <span className="text-sm text-ink-muted/70">None yet.</span> : children}
    </div>
  );
}

/**
 * A segmented switch.
 *
 * With exactly TWO options it stays a single click surface — clicking anywhere
 * on it (either label) flips to the other side, which is the nicer affordance
 * for a binary toggle and is how the sort switch has always behaved. With
 * three or more that trick is meaningless, so each segment becomes its own
 * button that selects itself.
 */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  /** Accessible name for the group when segments are individually selectable. */
  label?: string;
}) {
  const shell = "flex shrink-0 rounded-lg border border-white/10 bg-paper p-0.5 text-xs";
  const seg = (active: boolean) =>
    cn(
      "flex-1 whitespace-nowrap rounded-md px-2.5 py-1 text-center font-medium transition",
      active ? "bg-accent text-white" : "text-ink-muted",
    );

  if (options.length === 2) {
    const [left, right] = options;
    return (
      <button
        type="button"
        onClick={() => onChange(value === left.value ? right.value : left.value)}
        className={shell}
      >
        {options.map((o) => (
          <span key={o.value} className={seg(value === o.value)}>
            {o.label}
          </span>
        ))}
      </button>
    );
  }

  return (
    <div className={shell} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          title={o.title}
          aria-pressed={value === o.value}
          className={cn(seg(value === o.value), "hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
