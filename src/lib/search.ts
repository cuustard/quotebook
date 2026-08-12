/**
 * Feed control engine: fuzzy keyword search, stacked filters and sorting.
 *
 * Operates entirely on the in-memory `QuoteWithLines[]` that components load
 * from Dexie, so it is instant and works offline. Fuse.js provides the
 * typo-tolerant fuzzy matching across every textual field of a quote and its
 * dialogue lines.
 */

import Fuse from "fuse.js";
import { hasIssues } from "@/lib/integrity";
import { weekdayIndex } from "@/lib/stats";
import type { FeedFilters, QuoteWithLines } from "@/lib/types";

/**
 * Distinct people who can be filtered on: the speakers across all lines.
 * Case-insensitive dedupe ("Jake" and "jake" are the same person); the
 * first-seen casing is kept for display.
 */
export function collectSpeakers(quotes: QuoteWithLines[]): string[] {
  const byKey = new Map<string, string>();
  for (const q of quotes) {
    for (const l of q.lines) {
      const s = l.speaker.trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, s);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
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

// The Fuse index is cached per quotes-array identity (useLiveQuery hands the
// same array reference between data changes), so typing in the search box
// doesn't rebuild the index on every keystroke.
const fuseCache = new WeakMap<QuoteWithLines[], Fuse<QuoteWithLines>>();

function getFuse(quotes: QuoteWithLines[]): Fuse<QuoteWithLines> {
  let fuse = fuseCache.get(quotes);
  if (!fuse) {
    fuse = new Fuse(quotes, {
      ignoreLocation: true,
      threshold: 0.4, // tolerant of minor typos / variations
      minMatchCharLength: 2,
      keys: [
        { name: "tags", weight: 1.5 },
        { name: "lines.speaker", weight: 1.5 },
        { name: "lines.line_text", weight: 1.5 },
        { name: "quote_context", weight: 0.5 },
        { name: "lines.line_context", weight: 0.5 },
      ],
    });
    fuseCache.set(quotes, fuse);
  }
  return fuse;
}

/**
 * Apply fuzzy search, then the structured filter stack, then sort.
 * Fuzzy runs first so the cached index over the full feed can be reused;
 * per-quote matching is independent of the other filters, so the result set
 * is identical either way.
 */
export function applyFeed(
  quotes: QuoteWithLines[],
  filters: FeedFilters,
): QuoteWithLines[] {
  let result = quotes;

  // --- Fuzzy keyword search ---------------------------------------------
  const query = filters.query.trim();
  if (query) {
    result = getFuse(quotes).search(query).map((r) => r.item);
  }

  // --- Speaker filter (configurable AND / OR / ONLY, case-insensitive) ----
  // OR   → at least one selected speaker has a line in the quote.
  // AND  → every selected speaker has a line in the quote (they interact).
  // ONLY → the quote's cast is EXACTLY the selection: all of them, nobody else.
  if (filters.speakers.length > 0) {
    const wanted = new Set(filters.speakers.map((s) => s.toLowerCase()));
    result = result.filter((q) => {
      // Blank speakers are deliberately NOT stripped here. Under `only` an
      // unattributed line reads as an outsider — a half-labelled quote can't
      // honestly be certified as "just these people" — and the empty string is
      // never in `wanted`, so it inflates the cast size and fails the match.
      const present = new Set(q.lines.map((l) => l.speaker.trim().toLowerCase()));
      switch (filters.speakerMode) {
        case "and":
          return [...wanted].every((s) => present.has(s));
        case "only":
          // Equal sizes + every selected speaker present ⇒ the two sets are
          // identical, so this also rules out anyone extra. A quote with no
          // lines has an empty cast and can never equal a non-empty selection.
          return (
            present.size === wanted.size && [...wanted].every((s) => present.has(s))
          );
        default:
          return [...wanted].some((s) => present.has(s));
      }
    });
  }

  // --- Tag filter (configurable AND / OR / ONLY) -------------------------
  if (filters.tags.length > 0) {
    const wantedTags = new Set(filters.tags);
    result = result.filter((q) => {
      const tagSet = new Set(q.tags);
      switch (filters.tagMode) {
        case "and":
          return [...wantedTags].every((t) => tagSet.has(t));
        case "only":
          return (
            tagSet.size === wantedTags.size &&
            [...wantedTags].every((t) => tagSet.has(t))
          );
        default:
          return [...wantedTags].some((t) => tagSet.has(t));
      }
    });
  }

  // --- Hour of day -------------------------------------------------------
  // Wall-clock, same as the stats page: the stored "HH:mm" is read directly
  // rather than via Date, so a machine timezone can't shift a quote's hour.
  if (filters.hours.length > 0) {
    const wanted = new Set(filters.hours);
    result = result.filter((q) => wanted.has(Number(q.quote_time?.slice(0, 2))));
  }

  // --- Weekday (Monday-first, matching the stats chart) ------------------
  if (filters.weekdays.length > 0) {
    const wanted = new Set(filters.weekdays);
    result = result.filter((q) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q.quote_date ?? "");
      if (!m) return false;
      return wanted.has(weekdayIndex(Number(m[1]), Number(m[2]), Number(m[3])));
    });
  }

  // --- Incomplete-only ("what needs fixing?") ----------------------------
  if (filters.onlyIncomplete) {
    result = result.filter(hasIssues);
  }

  // --- Timeline window (inclusive bounds on quote_date) ------------------
  if (filters.since) {
    result = result.filter((q) => q.quote_date >= filters.since!);
  }
  if (filters.before) {
    result = result.filter((q) => q.quote_date <= filters.before!);
  }

  // --- Sorting -----------------------------------------------------------
  // Always applied: the explicit sort axis wins over Fuse's relevance
  // ranking so result order stays predictable.
  const dir = filters.sortDir === "asc" ? 1 : -1;
  result = [...result].sort(
    (a, b) => (sortInstant(a, filters.sortKey) - sortInstant(b, filters.sortKey)) * dir,
  );

  return result;
}
