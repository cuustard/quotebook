/**
 * Feed filters ⇄ URL query string.
 *
 * Putting filters in the URL is what lets the stats page deep-link into a
 * filtered feed ("show me July 2021", "show me Keya's quotes"), and it makes
 * any filtered view shareable and bookmarkable for free.
 *
 * Two rules keep the URLs sane:
 *  - Only non-default values are written, so an unfiltered feed has a clean
 *    URL and `encode(DEFAULT_FILTERS)` is the empty string.
 *  - List values use REPEATED params (`?sp=Jake+Evans&sp=Keya+Patel`) rather
 *    than a delimiter, because speaker names and tags are user text and may
 *    contain any character a delimiter might claim.
 *
 * Decoding never throws: anything malformed falls back to the default for
 * that field, so a hand-edited or truncated URL degrades instead of breaking.
 */

import { DEFAULT_FILTERS, type FeedFilters, type SortDir, type SortKey } from "@/lib/types";

/** Minimal read surface shared by URLSearchParams and Next's readonly variant. */
export interface ReadableParams {
  get(key: string): string | null;
  getAll(key: string): string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function uniqueInts(values: string[], min: number, max: number): number[] {
  const out = new Set<number>();
  for (const raw of values) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= min && n <= max) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function cleanStrings(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const t = v.trim();
    if (t) out.add(t);
  }
  return [...out];
}

/** Read filters out of a query string. Unknown params are ignored. */
export function decodeFeedFilters(params: ReadableParams): FeedFilters {
  const since = params.get("from");
  const before = params.get("to");
  const sortKey = params.get("sk");
  const sortDir = params.get("sd");

  return {
    ...DEFAULT_FILTERS,
    query: params.get("q")?.trim() || "",
    speakers: cleanStrings(params.getAll("sp")),
    speakerMode: params.get("spm") === "and" ? "and" : DEFAULT_FILTERS.speakerMode,
    tags: cleanStrings(params.getAll("tg")),
    tagMode: params.get("tgm") === "or" ? "or" : DEFAULT_FILTERS.tagMode,
    since: since && DATE_RE.test(since) ? since : null,
    before: before && DATE_RE.test(before) ? before : null,
    hours: uniqueInts(params.getAll("hr"), 0, 23),
    weekdays: uniqueInts(params.getAll("wd"), 0, 6),
    onlyIncomplete: params.get("inc") === "1",
    sortKey: (sortKey === "created_at" || sortKey === "quote_date"
      ? sortKey
      : DEFAULT_FILTERS.sortKey) as SortKey,
    sortDir: (sortDir === "asc" || sortDir === "desc"
      ? sortDir
      : DEFAULT_FILTERS.sortDir) as SortDir,
  };
}

/**
 * Serialise filters to a query string WITHOUT the leading "?".
 * Returns "" when nothing differs from the defaults.
 */
export function encodeFeedFilters(filters: FeedFilters): string {
  const p = new URLSearchParams();

  if (filters.query.trim()) p.set("q", filters.query.trim());
  for (const s of filters.speakers) p.append("sp", s);
  if (filters.speakerMode !== DEFAULT_FILTERS.speakerMode) p.set("spm", filters.speakerMode);
  for (const t of filters.tags) p.append("tg", t);
  if (filters.tagMode !== DEFAULT_FILTERS.tagMode) p.set("tgm", filters.tagMode);
  if (filters.since) p.set("from", filters.since);
  if (filters.before) p.set("to", filters.before);
  for (const h of filters.hours) p.append("hr", String(h));
  for (const w of filters.weekdays) p.append("wd", String(w));
  if (filters.onlyIncomplete) p.set("inc", "1");
  if (filters.sortKey !== DEFAULT_FILTERS.sortKey) p.set("sk", filters.sortKey);
  if (filters.sortDir !== DEFAULT_FILTERS.sortDir) p.set("sd", filters.sortDir);

  return p.toString();
}

/**
 * Link from the stats page into the feed with exactly one dimension applied.
 * Starts from the defaults so a stats click always yields a clean,
 * single-purpose view rather than compounding whatever was set before.
 */
export function feedHref(bookId: string, overrides: Partial<FeedFilters>): string {
  const qs = encodeFeedFilters({ ...DEFAULT_FILTERS, ...overrides });
  return qs ? `/quotebook/${bookId}?${qs}` : `/quotebook/${bookId}`;
}

/** Inclusive first/last day of a "YYYY-MM" month, for the timeline links. */
export function monthBounds(monthKey: string): { since: string; before: string } {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  // Day 0 of the *next* month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    since: `${monthKey}-01`,
    before: `${monthKey}-${String(lastDay).padStart(2, "0")}`,
  };
}
