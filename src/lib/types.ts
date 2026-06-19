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
  primary_quotee: string;
  /** ISO date (YYYY-MM-DD) — when the quote actually happened. */
  quote_date: string;
  /** 24h time (HH:mm) — when the quote actually happened. */
  quote_time: string;
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

// --- Feed control value objects -------------------------------------------

export type SortKey = "quote_date" | "created_at";
export type SortDir = "desc" | "asc"; // desc = newest first

export interface FeedFilters {
  /** Fuzzy free-text query. */
  query: string;
  /** Selected quotees/speakers; a line match surfaces the whole block. */
  speakers: string[];
  /** Selected tags. */
  tags: string[];
  /** AND = quote must contain every selected tag; OR = any. */
  tagMode: "and" | "or";
  /** Inclusive ISO date bounds (YYYY-MM-DD) or null. */
  since: string | null;
  before: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
}

export const DEFAULT_FILTERS: FeedFilters = {
  query: "",
  speakers: [],
  tags: [],
  tagMode: "or",
  since: null,
  before: null,
  sortKey: "quote_date",
  sortDir: "desc",
};

// --- Field-length sanity caps (keep the feed scannable) --------------------
export const MAX_LINE_TEXT = 500;
export const MAX_CONTEXT = 1000;
