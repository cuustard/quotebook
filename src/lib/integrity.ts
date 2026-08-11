/**
 * Quote integrity checks — "what's missing from this quote?"
 *
 * A quote is only meaningful if you know WHAT was said, WHO said it, and
 * WHEN. Anything optional (tags, either level of context) is never an issue.
 * Pure functions so the feed, the badge and the tests all agree.
 */

import type { QuoteWithLines } from "@/lib/types";

export type QuoteIssue =
  | "no-lines"
  | "empty-line"
  | "missing-speaker"
  | "invalid-date"
  | "invalid-time";

/** Short, human labels — used on the card chip and in the filter tooltip. */
export const ISSUE_LABELS: Record<QuoteIssue, string> = {
  "no-lines": "no lines",
  "empty-line": "empty line",
  "missing-speaker": "no speaker",
  "invalid-date": "bad date",
  "invalid-time": "bad time",
};

/** True for a real calendar date in YYYY-MM-DD (rejects e.g. 2021-02-30). */
export function isValidQuoteDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/** True for 24h HH:mm. */
export function isValidQuoteTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? "");
}

/**
 * Everything structurally missing from a quote, in the order a reader would
 * notice it. Empty array = the quote is complete.
 */
export function findQuoteIssues(quote: QuoteWithLines): QuoteIssue[] {
  const issues: QuoteIssue[] = [];
  const lines = quote.lines.filter((l) => !l.deleted);

  if (lines.length === 0) {
    issues.push("no-lines");
  } else {
    if (lines.some((l) => l.line_text.trim().length === 0)) issues.push("empty-line");
    if (lines.some((l) => l.speaker.trim().length === 0)) issues.push("missing-speaker");
  }

  if (!isValidQuoteDate(quote.quote_date)) issues.push("invalid-date");
  if (!isValidQuoteTime(quote.quote_time)) issues.push("invalid-time");

  return issues;
}

/** Convenience for the feed filter and the badge count. */
export function hasIssues(quote: QuoteWithLines): boolean {
  return findQuoteIssues(quote).length > 0;
}
