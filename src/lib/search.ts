/**
 * Feed control engine: fuzzy keyword search, stacked filters and sorting.
 *
 * Operates entirely on the in-memory `QuoteWithLines[]` that components load
 * from Dexie, so it is instant and works offline. Fuse.js provides the
 * typo-tolerant fuzzy matching across every textual field of a quote and its
 * dialogue lines.
 */

import Fuse from "fuse.js";
import type { FeedFilters, QuoteWithLines } from "@/lib/types";

/** Distinct people who can be filtered on: primary quotees + line speakers. */
export function collectSpeakers(quotes: QuoteWithLines[]): string[] {
  const set = new Set<string>();
  for (const q of quotes) {
    if (q.primary_quotee) set.add(q.primary_quotee);
    for (const l of q.lines) if (l.speaker) set.add(l.speaker);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Distinct tags across the feed, sorted for stable filter UIs. */
export function collectTags(quotes: QuoteWithLines[]): string[] {
  const set = new Set<string>();
  for (const q of quotes) for (const t of q.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Sortable instant for a quote based on the chosen key. */
function sortInstant(q: QuoteWithLines, key: FeedFilters["sortKey"]): number {
  if (key === "created_at") return new Date(q.created_at).getTime();
  // quote_date + quote_time describe when the moment actually happened.
  const t = q.quote_time && q.quote_time.length >= 4 ? q.quote_time : "00:00";
  return new Date(`${q.quote_date}T${t}:00`).getTime();
}

/**
 * Apply the full filter stack, then fuzzy search, then sort.
 * Order matters: cheap structured filters prune first, fuzzy ranking last.
 */
export function applyFeed(
  quotes: QuoteWithLines[],
  filters: FeedFilters,
): QuoteWithLines[] {
  let result = quotes;

  // --- Speaker filter ----------------------------------------------------
  // A match on ANY line's speaker (or the primary quotee) surfaces the WHOLE
  // dialogue block, preserving conversational context.
  if (filters.speakers.length > 0) {
    const wanted = new Set(filters.speakers);
    result = result.filter((q) => {
      if (wanted.has(q.primary_quotee)) return true;
      return q.lines.some((l) => wanted.has(l.speaker));
    });
  }

  // --- Tag filter (configurable AND / OR) --------------------------------
  if (filters.tags.length > 0) {
    result = result.filter((q) => {
      const tagSet = new Set(q.tags);
      return filters.tagMode === "and"
        ? filters.tags.every((t) => tagSet.has(t))
        : filters.tags.some((t) => tagSet.has(t));
    });
  }

  // --- Timeline window (inclusive bounds on quote_date) ------------------
  if (filters.since) {
    result = result.filter((q) => q.quote_date >= filters.since!);
  }
  if (filters.before) {
    result = result.filter((q) => q.quote_date <= filters.before!);
  }

  // --- Fuzzy keyword search ---------------------------------------------
  const query = filters.query.trim();
  if (query) {
    const fuse = new Fuse(result, {
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.4, // tolerant of minor typos / variations
      minMatchCharLength: 2,
      keys: [
        { name: "primary_quotee", weight: 2 },
        { name: "quote_context", weight: 1 },
        { name: "tags", weight: 1.5 },
        { name: "lines.speaker", weight: 1 },
        { name: "lines.line_text", weight: 1.5 },
        { name: "lines.line_context", weight: 0.5 },
      ],
    });
    result = fuse.search(query).map((r) => r.item);

    // When fuzzy-searching we keep Fuse's relevance order *unless* the user is
    // also sorting; sorting always wins for predictability.
  }

  // --- Sorting -----------------------------------------------------------
  const dir = filters.sortDir === "asc" ? 1 : -1;
  result = [...result].sort(
    (a, b) => (sortInstant(a, filters.sortKey) - sortInstant(b, filters.sortKey)) * dir,
  );

  return result;
}
