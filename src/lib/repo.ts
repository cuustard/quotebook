/**
 * Repository layer — all writes go through here.
 *
 * Every mutation is applied to Dexie *synchronously from the UI's perspective*
 * (local-first), stamping field-level LWW clocks and marking records `_dirty`
 * so the background sync engine can later flush them to Supabase. The UI never
 * talks to Supabase for CRUD; it only ever reads/writes Dexie.
 */

import { db } from "@/db/dexie";
import { nowIso, tick, tickToIso, uuid } from "@/lib/id";
import { getCurrentUserId } from "@/lib/session";
import { requestSync } from "@/lib/sync";
import type {
  Quote,
  QuoteLine,
  Quotebook,
  QuoteWithLines,
  SyncMeta,
} from "@/lib/types";

const GUEST_BOOK_NAME = "My Quotebook";

/**
 * Stamp a partial update with field-level LWW metadata.
 * Each changed key gets the same monotonic `tick()`; `updated_at` is the ISO
 * form of that tick; the record is flagged dirty for the next sync pass.
 */
function stamp<T extends SyncMeta>(base: T, patch: Partial<T>): T {
  const t = tick();
  const clock = { ...base.field_updated_at };
  for (const key of Object.keys(patch)) clock[key] = t;
  return {
    ...base,
    ...patch,
    field_updated_at: clock,
    updated_at: tickToIso(t),
    _dirty: 1,
  };
}

/** Build a brand-new record with every field stamped at creation time. */
function fresh<T extends Record<string, unknown>>(fields: T): T & SyncMeta {
  const t = tick();
  const clock: Record<string, number> = {};
  for (const key of Object.keys(fields)) clock[key] = t;
  return {
    ...fields,
    field_updated_at: clock,
    updated_at: tickToIso(t),
    _dirty: 1,
    deleted: false,
  };
}

// =========================================================================
// Quotebooks
// =========================================================================

/**
 * Guarantee the user always has their single anchored Private Quotebook.
 * Runs on boot in both guest and authenticated states.
 */
export async function ensurePrivateQuotebook(): Promise<Quotebook> {
  const userId = getCurrentUserId();
  const existing = await db.quotebooks
    .filter((b) => b.is_private === true && !b.deleted)
    .first();
  if (existing) return existing;

  const book = fresh({
    id: uuid(),
    owner_id: userId,
    name: GUEST_BOOK_NAME,
    is_private: true,
    created_at: nowIso(),
  }) as Quotebook;
  await db.quotebooks.put(book);
  requestSync();
  return book;
}

export async function createQuotebook(name: string): Promise<Quotebook> {
  const userId = getCurrentUserId();
  const book = fresh({
    id: uuid(),
    owner_id: userId,
    name: name.trim() || "Untitled Quotebook",
    is_private: false,
    created_at: nowIso(),
  }) as Quotebook;
  await db.quotebooks.put(book);

  // The owner is implicitly a member.
  if (userId) {
    await db.members.put({
      id: uuid(),
      quotebook_id: book.id,
      user_id: userId,
      joined_at: nowIso(),
    });
  }
  requestSync();
  return book;
}

export async function renameQuotebook(id: string, name: string): Promise<void> {
  const book = await db.quotebooks.get(id);
  if (!book) return;
  await db.quotebooks.put(stamp(book, { name: name.trim() }));
  requestSync();
}

export async function deleteQuotebook(id: string): Promise<void> {
  const book = await db.quotebooks.get(id);
  if (!book || book.is_private) return; // never delete the anchored private book
  // Soft-delete the book and cascade soft-deletes to its quotes/lines.
  await db.quotebooks.put(stamp(book, { deleted: true }));
  const quotes = await db.quotes.where("quotebook_id").equals(id).toArray();
  for (const q of quotes) {
    await db.quotes.put(stamp(q, { deleted: true }));
    const lines = await db.quote_lines.where("quote_id").equals(q.id).toArray();
    for (const l of lines) await db.quote_lines.put(stamp(l, { deleted: true }));
  }
  requestSync();
}

// =========================================================================
// Quotes + lines
// =========================================================================

export interface LineInput {
  id?: string;
  speaker: string;
  line_text: string;
  line_context: string;
}

export interface QuoteInput {
  primary_quotee: string;
  quote_date: string;
  quote_time: string;
  quote_context: string;
  tags: string[];
  lines: LineInput[];
}

export async function createQuote(
  quotebookId: string,
  input: QuoteInput,
): Promise<string> {
  const userId = getCurrentUserId();
  const quoteId = uuid();

  const quote = fresh({
    id: quoteId,
    quotebook_id: quotebookId,
    primary_quotee: input.primary_quotee.trim(),
    quote_date: input.quote_date,
    quote_time: input.quote_time,
    quote_context: input.quote_context.trim(),
    tags: normalizeTags(input.tags),
    created_by: userId,
    created_at: nowIso(),
    version: 1,
  }) as Quote;

  const lines: QuoteLine[] = input.lines.map((line, index) =>
    fresh({
      id: line.id ?? uuid(),
      quote_id: quoteId,
      speaker: line.speaker.trim(),
      line_text: line.line_text.trim(),
      line_context: line.line_context.trim(),
      order_index: index,
    }) as QuoteLine,
  );

  await db.transaction("rw", db.quotes, db.quote_lines, async () => {
    await db.quotes.put(quote);
    await db.quote_lines.bulkPut(lines);
  });
  requestSync();
  return quoteId;
}

/**
 * Replace a quote's editable fields and its full set of lines.
 *
 * Lines are diffed against what's stored: surviving lines are stamped (so
 * field-level LWW still applies per line), removed lines are tombstoned, and
 * new lines are created. `version` is bumped for optimistic checks.
 */
export async function updateQuote(
  quoteId: string,
  input: QuoteInput,
): Promise<void> {
  const quote = await db.quotes.get(quoteId);
  if (!quote) return;

  await db.transaction("rw", db.quotes, db.quote_lines, async () => {
    await db.quotes.put(
      stamp(quote, {
        primary_quotee: input.primary_quotee.trim(),
        quote_date: input.quote_date,
        quote_time: input.quote_time,
        quote_context: input.quote_context.trim(),
        tags: normalizeTags(input.tags),
        version: quote.version + 1,
      }),
    );

    const existing = await db.quote_lines
      .where("quote_id")
      .equals(quoteId)
      .toArray();
    const existingById = new Map(existing.map((l) => [l.id, l]));
    const keptIds = new Set<string>();

    for (let index = 0; index < input.lines.length; index++) {
      const line = input.lines[index];
      const prev = line.id ? existingById.get(line.id) : undefined;
      if (prev) {
        keptIds.add(prev.id);
        await db.quote_lines.put(
          stamp(prev, {
            speaker: line.speaker.trim(),
            line_text: line.line_text.trim(),
            line_context: line.line_context.trim(),
            order_index: index,
            deleted: false,
          }),
        );
      } else {
        await db.quote_lines.put(
          fresh({
            id: line.id ?? uuid(),
            quote_id: quoteId,
            speaker: line.speaker.trim(),
            line_text: line.line_text.trim(),
            line_context: line.line_context.trim(),
            order_index: index,
          }) as QuoteLine,
        );
      }
    }

    // Tombstone lines the user removed.
    for (const prev of existing) {
      if (!keptIds.has(prev.id) && !prev.deleted) {
        await db.quote_lines.put(stamp(prev, { deleted: true }));
      }
    }
  });
  requestSync();
}

export async function deleteQuote(quoteId: string): Promise<void> {
  const quote = await db.quotes.get(quoteId);
  if (!quote) return;
  await db.transaction("rw", db.quotes, db.quote_lines, async () => {
    await db.quotes.put(stamp(quote, { deleted: true }));
    const lines = await db.quote_lines.where("quote_id").equals(quoteId).toArray();
    for (const l of lines) await db.quote_lines.put(stamp(l, { deleted: true }));
  });
  requestSync();
}

// =========================================================================
// Reads (used directly or via useLiveQuery in components)
// =========================================================================

export async function getQuotesWithLines(
  quotebookId: string,
): Promise<QuoteWithLines[]> {
  const quotes = await db.quotes
    .where("quotebook_id")
    .equals(quotebookId)
    .filter((q) => !q.deleted)
    .toArray();

  const quoteIds = quotes.map((q) => q.id);
  const allLines = await db.quote_lines
    .where("quote_id")
    .anyOf(quoteIds)
    .filter((l) => !l.deleted)
    .toArray();

  const linesByQuote = new Map<string, QuoteLine[]>();
  for (const line of allLines) {
    const arr = linesByQuote.get(line.quote_id) ?? [];
    arr.push(line);
    linesByQuote.set(line.quote_id, arr);
  }

  return quotes.map((q) => ({
    ...q,
    lines: (linesByQuote.get(q.id) ?? []).sort(
      (a, b) => a.order_index - b.order_index,
    ),
  }));
}

// =========================================================================
// Helpers
// =========================================================================

/** Lowercase, trim, de-dupe and drop empties. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
