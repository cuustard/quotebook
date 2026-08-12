/**
 * Shared domain types. These mirror the Supabase schema (see
 * `supabase/schema.sql`) and the local Dexie tables (`src/db/dexie.ts`).
 *
 * Timestamps:
 *  - `created_at` / `updated_at` are ISO-8601 strings (human/portable).
 *  - `field_updated_at` is a map of column-name -> fractional epoch-ms used
 *    purely for field-level Last-Write-Wins conflict resolution. Sub-ms
 *    fractions act as a monotonic tie-breaker (see `src/lib/id.ts`).
 */

export type FieldClock = Record<string, number>;

/** Fields shared by every locally-synced record. */
export interface SyncMeta {
  /** ISO timestamp of the most recent change to any field. */
  updated_at: string;
  /** Field-level LWW clock: column -> fractional epoch ms. */
  field_updated_at: FieldClock;
  /** Local-only: record has unsynced changes pending a push to Supabase. */
  _dirty?: 0 | 1;
  /** Local-only: soft-deleted; tombstone is synced then garbage-collected. */
  deleted?: boolean;
}

export interface Quotebook extends SyncMeta {
  id: string;
  owner_id: string | null;
  name: string;
  is_private: boolean;
  created_at: string;
}

export interface Quote extends SyncMeta {
  id: string;
  quotebook_id: string;
  /** ISO date (YYYY-MM-DD) — when the quote actually happened. */
  quote_date: string;
  /** 24h time (HH:mm) — when the quote actually happened. */
  quote_time: string;
  /**
   * The situation the whole exchange happened in ("walking in the dark").
   * Distinct from a line's `line_context`, which annotates one utterance
   * ("sarcastically"). Empty string when there's nothing to say.
   */
  quote_context: string;
  tags: string[];
  created_by: string | null;
  created_at: string;
  version: number;
}

export interface QuoteLine extends SyncMeta {
  id: string;
  quote_id: string;
  speaker: string;
  line_text: string;
  line_context: string;
  order_index: number;
}

export interface QuotebookMember {
  id: string;
  quotebook_id: string;
  user_id: string;
  joined_at: string;
  /** Local-only: membership row not yet pushed to Supabase. */
  _dirty?: 0 | 1;
}

export interface InviteCode {
  id: string;
  quotebook_id: string;
  code: string;
  created_by: string | null;
  expires_at: string;
  created_at: string;
}

/** A quote joined with its ordered dialogue lines — the unit the UI renders. */
export interface QuoteWithLines extends Quote {
  lines: QuoteLine[];
}

// --- Quick Add captures (local-only, never synced) --------------------------

/**
 * Capture lifecycle:
 *   pending → parsing → parsed → done      (AI path, Phase 1)
 *   pending ————————————————————→ done      (manual conversion)
 *   parsing → failed → done                 (parse rejected; manual rescue)
 *
 * "parsed" doubles as the review queue: the quote exists, the capture waits
 * for the user to confirm it.
 */
export type CaptureStatus = "pending" | "parsing" | "parsed" | "failed" | "done";

export interface Capture {
  id: string;
  /** Raw input, verbatim. Never mutated — it's the provenance record. */
  text: string;
  /** Book the quote will land in (chosen at capture time). */
  quotebook_id: string;
  created_at: string;
  status: CaptureStatus;
  /** Set once a quote exists (AI-parsed or manually converted). */
  quote_id: string | null;
  /** Parse self-assessment; low-confidence parses sort first for review. */
  confidence: "high" | "low" | null;
  /** Human-readable reason when status is "failed". */
  error: string | null;
  /** Parse attempts so far (drives retry backoff). */
  attempts: number;
  /** ISO timestamp of the most recent parse attempt. */
  attempted_at: string | null;
}

// --- Feed control value objects -------------------------------------------

export type SortKey = "quote_date" | "created_at";
export type SortDir = "desc" | "asc"; // desc = newest first

/**
 * How a multi-select filter combines its selections.
 *
 *   or    — the quote has AT LEAST ONE of the selected values ("any of these")
 *   and   — the quote has EVERY selected value ("all of these", others allowed)
 *   only  — the quote has EXACTLY the selected values ("these and nobody else")
 *
 * `only` is the exclusive one, and it is a genuinely different question from
 * `and`: selecting just "Jake" under `and` still returns quotes where Jake
 * talks *with* Keya, because Jake is present. Under `only` those are excluded —
 * you get Jake's solo quotes.
 *
 * With several selected, `only` is an EXACT match on the set, not a subset:
 * picking Jake + Keya returns the quotes those two share, and neither of their
 * solo quotes. Read it as "a quote by exactly these people".
 */
export type FilterMode = "and" | "or" | "only";

export interface FeedFilters {
  /** Fuzzy free-text query. */
  query: string;
  /** Selected quotees/speakers; a line match surfaces the whole block. */
  speakers: string[];
  /** See {@link FilterMode}. */
  speakerMode: FilterMode;
  /** Selected tags. */
  tags: string[];
  /** See {@link FilterMode}. */
  tagMode: FilterMode;
  /** Inclusive ISO date bounds (YYYY-MM-DD) or null. */
  since: string | null;
  before: string | null;
  /** Hours-of-day (0–23) to keep. Empty = no hour filter. */
  hours: number[];
  /** Weekdays to keep, Monday-first (0=Mon … 6=Sun). Empty = no filter. */
  weekdays: number[];
  /** Show only quotes missing something mandatory (see `lib/integrity.ts`). */
  onlyIncomplete: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
}

export const DEFAULT_FILTERS: FeedFilters = {
  query: "",
  speakers: [],
  speakerMode: "or", // speakers default to "Any"
  tags: [],
  tagMode: "and", // tags default to "All"
  since: null,
  before: null,
  hours: [],
  weekdays: [],
  onlyIncomplete: false,
  sortKey: "quote_date",
  sortDir: "desc",
};

// --- Field-length sanity caps (keep the feed scannable) --------------------
export const MAX_LINE_TEXT = 500;
export const MAX_CONTEXT = 1000;
/** Cap for the quote-level situation line. */
export const MAX_QUOTE_CONTEXT = 500;
