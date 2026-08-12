"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { FilterDisclosure } from "@/components/ui/FilterDisclosure";

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

  // No document-level dismiss listeners: the list occupies layout rather than
  // floating over it, so closing it on an outside click would collapse the
  // panel and shift everything under the pointer. It stays open until its
  // trigger is toggled.
  useEffect(() => {
    if (open) searchRef.current?.focus();
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
    <FilterDisclosure
      open={open}
      onToggle={() => setOpenState(!open)}
      label={label}
      active={selected.length > 0}
    >
      {/* The options list keeps its own max-height, so a book with many
          quotees grows the panel by a bounded amount rather than without
          limit. */}
      <>
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
      </>
    </FilterDisclosure>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
