/**
 * Validation for AI-parsed captures.
 *
 * The Edge Function's JSON schema guarantees *shape* at the provider level,
 * but the client trusts nothing it didn't check itself: this module re-checks
 * the shape, clamps lengths, and — most importantly — enforces the VERBATIM
 * rule: every line's words must actually come from the captured text. A model
 * that invents or rewrites what someone said either downgrades the parse to
 * low confidence (minor drift) or rejects it outright (fabrication), so a
 * hallucinated attribution can never quietly enter the record.
 */

import { normalizeTags } from "@/lib/tags";
import { MAX_CONTEXT, MAX_LINE_TEXT, MAX_QUOTE_CONTEXT } from "@/lib/types";
import type { QuoteInput } from "@/lib/repo";

/** Below this token coverage the parse is rejected as fabricated. */
const COVERAGE_REJECT = 0.35;
/** Below this token coverage the parse is flagged for review. */
const COVERAGE_LOW = 0.7;
/** Coverage is only meaningful for lines with at least this many tokens. */
const MIN_TOKENS = 3;

const MAX_LINES = 20;
const MAX_TAGS = 8;
const MAX_SPEAKER = 120;

export type ParseValidation =
  | { ok: true; input: QuoteInput; confidence: "high" | "low" }
  | { ok: false; error: string };

/**
 * Tokenize for verbatim comparison: lowercase, apostrophes stripped (so a
 * typo fix like "hes" → "he's" still matches), split on anything that isn't
 * a letter or digit.
 */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Fraction of `line`'s tokens that appear in `source`. 1 = fully verbatim. */
export function verbatimCoverage(line: string, source: string): number {
  const lineTokens = tokens(line);
  if (lineTokens.length === 0) return 0;
  const sourceSet = new Set(tokens(source));
  const hits = lineTokens.filter((t) => sourceSet.has(t)).length;
  return hits / lineTokens.length;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a parse-capture response against the source text. Returns a clean
 * `QuoteInput` ready for `createQuote()`, or a permanent rejection.
 */
export function validateParsedQuote(
  raw: unknown,
  sourceText: string,
): ParseValidation {
  if (!isRecord(raw)) return { ok: false, error: "Malformed parse response." };

  const quote_date = raw.quote_date;
  if (
    typeof quote_date !== "string" ||
    !DATE_RE.test(quote_date) ||
    Number.isNaN(Date.parse(quote_date))
  ) {
    return { ok: false, error: "Parse returned an invalid date." };
  }

  const quote_time = raw.quote_time;
  if (typeof quote_time !== "string" || !TIME_RE.test(quote_time)) {
    return { ok: false, error: "Parse returned an invalid time." };
  }

  // Context is the model's own words describing the situation, so unlike
  // line_text it is not held to the verbatim rule — only clamped.
  const quote_context =
    typeof raw.quote_context === "string"
      ? raw.quote_context.trim().slice(0, MAX_QUOTE_CONTEXT)
      : "";

  const tags = normalizeTags(
    Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string")
      : [],
  ).slice(0, MAX_TAGS);

  if (!Array.isArray(raw.lines) || raw.lines.length === 0) {
    return { ok: false, error: "Parse returned no dialogue lines." };
  }
  const lines = raw.lines
    .slice(0, MAX_LINES)
    .filter(isRecord)
    .map((l) => ({
      speaker:
        typeof l.speaker === "string"
          ? l.speaker.trim().slice(0, MAX_SPEAKER)
          : "",
      line_text:
        typeof l.line_text === "string"
          ? l.line_text.trim().slice(0, MAX_LINE_TEXT)
          : "",
      line_context:
        typeof l.line_context === "string"
          ? l.line_context.trim().slice(0, MAX_CONTEXT)
          : "",
    }))
    .filter((l) => l.line_text.length > 0);
  if (lines.length === 0) {
    return { ok: false, error: "Parse returned no usable dialogue lines." };
  }

  // The verbatim gate. Very short lines ("No.") are exempt — coverage on one
  // or two tokens is noise.
  let minCoverage = 1;
  for (const line of lines) {
    if (tokens(line.line_text).length < MIN_TOKENS) continue;
    minCoverage = Math.min(minCoverage, verbatimCoverage(line.line_text, sourceText));
  }
  if (minCoverage < COVERAGE_REJECT) {
    return {
      ok: false,
      error: "The AI's output didn't match the captured text.",
    };
  }

  let confidence: "high" | "low" = raw.confidence === "high" ? "high" : "low";
  if (minCoverage < COVERAGE_LOW) confidence = "low";
  if (lines.every((l) => l.speaker.length === 0)) confidence = "low";

  return {
    ok: true,
    input: { quote_date, quote_time, quote_context, tags, lines },
    confidence,
  };
}
