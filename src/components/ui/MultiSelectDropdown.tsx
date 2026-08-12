"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface MultiSelectDropdownProps {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Prefix rendered before each label, e.g. "#" for tags. */
  prefix?: string;
  /** Noun used in the trigger/placeholder text, e.g. "speaker" or "tag". */
  noun: string;
  /** Show the search box once there are more than this many options. */
  searchThreshold?: number;
}

/**
 * A single-trigger popover checklist for picking any number of speakers/tags
 * — replaces a wall of always-visible pills with one compact control whose
 * height doesn't grow with the option count.
 */
export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  prefix = "",
  noun,
  searchThreshold = 8,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Opening is an EVENT, so the state it resets belongs in the handler, not in
  // an effect — resetting during the post-open effect renders the stale query
  // once before clearing it, which is what react-hooks/set-state-in-effect
  // warns about. Focus stays in the effect: it touches the DOM after paint,
  // which is exactly what an effect is for.
  const setOpenState = (next: boolean) => {
    if (next) setQuery("");
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenState(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenState(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Fixed order — reordering by selection made the list jump around under
    // the cursor while picking multiple options.
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (value: string) => {
    onChange(selectedSet.has(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const label =
    selected.length === 0
      ? `Any ${noun}`
      : selected.length <= 2
        ? selected.map((s) => `${prefix}${s}`).join(", ")
        : `${selected.length} ${noun}s selected`;

  return (
    // No `relative`: the list is part of the flow now, not an overlay.
    <div ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpenState(!open)}
        className={cn(
          "qb-btn-ghost w-full justify-between border border-white/10 px-3 text-left",
          selected.length > 0 && "border-accent/40 text-accent",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronIcon className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {/* Expands INLINE, matching the date picker: part of the filter section
          rather than a layer over the feed, so it pushes what follows down.
          `-mx-4` cancels the filter panel's `p-4` so the open list spans the
          panel edge to edge and reads as a section of it. The options list
          keeps its own max-height, so a book with many quotees grows the
          panel by a bounded amount rather than without limit. */}
      {open && (
        <div className="-mx-4 mt-2 border-y border-white/[0.06] bg-surface-sunken px-3 py-2">
          {options.length > searchThreshold && (
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${noun}s…`}
              className="qb-input mb-2 py-1 text-xs"
            />
          )}

          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-ink-muted/70">No matches.</p>
            ) : (
              filtered.map((value) => {
                const active = selectedSet.has(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggle(value)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition",
                      active ? "text-ink" : "text-ink-muted hover:bg-white/5 hover:text-ink",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded border transition",
                        active ? "border-accent bg-accent text-white" : "border-white/20",
                      )}
                    >
                      {active && <CheckIcon className="h-3 w-3" />}
                    </span>
                    <span className="truncate">
                      {prefix}
                      {value}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {selected.length > 0 && (
            <div className="mt-1 flex items-center justify-between border-t border-white/[0.06] pt-2">
              <span className="text-[0.7rem] text-ink-muted">{selected.length} selected</span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs font-medium text-ink-muted transition hover:text-ink"
              >
                Clear
              </button>
            </div>
          )}
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
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
