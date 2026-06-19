"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { DEFAULT_FILTERS, type FeedFilters } from "@/lib/types";

interface FeedControlsProps {
  filters: FeedFilters;
  setFilters: (next: FeedFilters) => void;
  speakers: string[];
  tags: string[];
}

export function FeedControls({ filters, setFilters, speakers, tags }: FeedControlsProps) {
  const [showFilters, setShowFilters] = useState(false);
  const patch = (p: Partial<FeedFilters>) => setFilters({ ...filters, ...p });

  const toggleIn = (key: "speakers" | "tags", value: string) => {
    const set = new Set(filters[key]);
    set.has(value) ? set.delete(value) : set.add(value);
    patch({ [key]: [...set] } as Partial<FeedFilters>);
  };

  const activeCount =
    filters.speakers.length +
    filters.tags.length +
    (filters.since ? 1 : 0) +
    (filters.before ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Search + sort row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
            placeholder="Fuzzy search quotes, speakers, tags…"
            value={filters.query}
            onChange={(e) => patch({ query: e.target.value })}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Sort key */}
          <Segmented
            value={filters.sortKey}
            onChange={(v) => patch({ sortKey: v as FeedFilters["sortKey"] })}
            options={[
              { value: "quote_date", label: "Event date" },
              { value: "created_at", label: "Added" },
            ]}
          />
          {/* Sort direction */}
          <button
            onClick={() => patch({ sortDir: filters.sortDir === "desc" ? "asc" : "desc" })}
            className="qb-btn-ghost border border-black/10 px-3"
            title={filters.sortDir === "desc" ? "Newest first" : "Oldest first"}
          >
            {filters.sortDir === "desc" ? "↓ Newest" : "↑ Oldest"}
          </button>
          {/* Filters toggle */}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "qb-btn-ghost border border-black/10 px-3",
              activeCount > 0 && "border-accent/40 text-accent",
            )}
          >
            Filters{activeCount > 0 ? ` · ${activeCount}` : ""}
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="qb-card flex flex-col gap-4 p-4">
          {/* Speakers */}
          <FilterGroup label="Quotees / speakers" empty={speakers.length === 0}>
            {speakers.map((s) => (
              <Chip key={s} active={filters.speakers.includes(s)} onClick={() => toggleIn("speakers", s)}>
                {s}
              </Chip>
            ))}
          </FilterGroup>

          {/* Tags + AND/OR */}
          <FilterGroup
            label="Tags"
            empty={tags.length === 0}
            aside={
              <Segmented
                value={filters.tagMode}
                onChange={(v) => patch({ tagMode: v as FeedFilters["tagMode"] })}
                options={[
                  { value: "or", label: "Any (OR)" },
                  { value: "and", label: "All (AND)" },
                ]}
              />
            }
          >
            {tags.map((t) => (
              <Chip key={t} active={filters.tags.includes(t)} onClick={() => toggleIn("tags", t)}>
                #{t}
              </Chip>
            ))}
          </FilterGroup>

          {/* Timeline window */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Timeline</span>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-ink-muted">Since</span>
                <input
                  type="date"
                  className="qb-input w-auto py-1"
                  value={filters.since ?? ""}
                  onChange={(e) => patch({ since: e.target.value || null })}
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-ink-muted">Before</span>
                <input
                  type="date"
                  className="qb-input w-auto py-1"
                  value={filters.before ?? ""}
                  onChange={(e) => patch({ before: e.target.value || null })}
                />
              </label>
            </div>
          </div>

          {activeCount > 0 && (
            <button
              onClick={() => setFilters({ ...DEFAULT_FILTERS, query: filters.query, sortKey: filters.sortKey, sortDir: filters.sortDir })}
              className="qb-btn-ghost self-start text-accent"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- helpers ---------------------------------------------------------------
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
      {empty ? (
        <span className="text-sm text-ink-muted/70">None yet.</span>
      ) : (
        <div className="flex flex-wrap gap-1.5">{children}</div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "qb-chip border transition",
        active ? "border-accent bg-accent text-white" : "border-black/10 bg-paper text-ink-muted hover:border-black/20",
      )}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-black/10 bg-paper p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition",
            value === o.value ? "bg-accent text-white" : "text-ink-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
