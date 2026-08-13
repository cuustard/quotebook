/**
 * Repository layer — all writes go through here.
 *
 * Every mutation is applied to Dexie *synchronously from the UI's perspective*
 * (local-first), stamping field-level LWW clocks and marking records `_dirty`
 * so the background sync engine can later flush them to Supabase. The UI never
 * talks to Supabase for CRUD; it only ever reads/writes Dexie.
 */

import { db } from "@/db/dexie";
import { recordEvents, type EventInput } from "@/lib/events";
import { nowIso, tick, tickToIso, uuid } from "@/lib/id";
import { clockMax } from "@/lib/merge";
import { getCurrentUserId } from "@/lib/session";
import { requestSync } from "@/lib/sync";
import { normalizeTags } from "@/lib/tags";
import { MAX_CONTEXT, MAX_LINE_TEXT, MAX_QUOTE_CONTEXT } from "@/lib/types";
import type {
  EventEntity,
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

/**
 * Describe a mutation for the event log.
 *
 * The tick is read back off the stamped record rather than threaded through
 * from `stamp()`/`fresh()`: those already write it into the field clock, and
 * re-deriving it keeps the log honest — the entry carries the tick the row
 * actually got, not one a caller believed it would get.
 */
function evt(
  entity: EventEntity,
  row: SyncMeta & { id: string },
  action: EventInput["action"],
  fields?: string[],
): EventInput {
  return { entity, entity_id: row.id, action, fields, tick: clockMax(row) };
}

/** A soft-delete is a `deleted` field write; the action is what carries meaning. */
function deleteEvt(entity: EventEntity, row: SyncMeta & { id: string }): EventInput {
  return evt(entity, row, "delete");
}

/**
 * Keys in `patch` whose value actually differs from `base`.
 *
 * `stamp()` deliberately advances the LWW clock for every key it is handed,
 * changed or not — that is the write path's business. The audit log answers a
 * different question ("what did this edit change?"), and inheriting the write
 * path's over-reporting would make every save look like it rewrote the record.
 * Arrays are compared by value, since `tags` is one and is otherwise always a
 * fresh reference.
 */
function changedKeys<T extends object>(base: T, patch: Partial<T>): string[] {
  return Object.keys(patch).filter((key) => {
    const before = (base as Record<string, unknown>)[key];
    const after = (patch as Record<string, unknown>)[key];
    if (Array.isArray(before) && Array.isArray(after)) {
      return (
        before.length !== after.length || before.some((v, i) => v !== after[i])
      );
    }
    return before !== after;
  });
}

// =========================================================================
// Quotebooks
// =========================================================================

/**
 * Deterministically choose the anchored private book: prefer one owned by the
 * current user, then the oldest. Shared by boot and the dashboard so both
 * always agree on which book is "the" private one, even if a sync race ever
 * produced more than one.
 */
export function pickPrivateBook(
  books: Quotebook[],
  userId: string | null,
): Quotebook | null {
  // id tiebreaker: duplicate private books born from a race share the same
  // created_at millisecond — the pick must still be deterministic.
  const priv = books
    .filter((b) => b.is_private && !b.deleted)
    .sort((a, b) => (a.created_at + a.id < b.created_at + b.id ? -1 : 1));
  if (userId) {
    const owned = priv.find((b) => b.owner_id === userId);
    if (owned) return owned;
  }
  return priv[0] ?? null;
}

/**
 * Guarantee the user always has their single anchored Private Quotebook.
 * Runs on boot (after auth resolves and, when signed in, after a first pull —
 * creating one before pulling would duplicate the private book on every new
 * device).
 */
export async function ensurePrivateQuotebook(): Promise<Quotebook> {
  const userId = getCurrentUserId();
  // Transactional so concurrent boots (React Strict Mode double-mounts the
  // Providers effect in dev) serialize on the read-then-create instead of
  // both seeing an empty table and each minting a private book.
  const book = await db.transaction(
    "rw",
    db.quotebooks,
    db.quotes,
    db.events,
    async () => {
      const books = await db.quotebooks.toArray();
      const existing = pickPrivateBook(books, userId);
      if (existing) {
        // Self-heal duplicates left by past races: retire any OTHER private
        // book, but only if it holds no quotes — never delete content.
        for (const b of books) {
          if (b.is_private && !b.deleted && b.id !== existing.id) {
            const quoteCount = await db.quotes
              .where("quotebook_id")
              .equals(b.id)
              .count();
            if (quoteCount === 0) {
              const retired = stamp(b, { deleted: true });
              await db.quotebooks.put(retired);
              await recordEvents([deleteEvt("quotebook", retired)]);
            }
          }
        }
        return existing;
      }

      const created = fresh({
        id: uuid(),
        owner_id: userId,
        name: GUEST_BOOK_NAME,
        is_private: true,
        created_at: nowIso(),
      }) as Quotebook;
      await db.quotebooks.put(created);
      await recordEvents([evt("quotebook", created, "create")]);
      return created;
    },
  );
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

  // Transactional so the book, its owner membership and the log entry either
  // all land or none do — a book with no owner row is not a state worth
  // being able to reach.
  await db.transaction("rw", db.quotebooks, db.members, db.events, async () => {
    await db.quotebooks.put(book);

    // The owner is implicitly a member.
    if (userId) {
      await db.members.put({
        id: uuid(),
        quotebook_id: book.id,
        user_id: userId,
        joined_at: nowIso(),
        _dirty: 1,
      });
    }
    await recordEvents([evt("quotebook", book, "create")]);
  });
  requestSync();
  return book;
}

export async function renameQuotebook(id: string, name: string): Promise<void> {
  const book = await db.quotebooks.get(id);
  if (!book) return;
  await db.transaction("rw", db.quotebooks, db.events, async () => {
    const renamed = stamp(book, { name: name.trim() });
    await db.quotebooks.put(renamed);
    await recordEvents([evt("quotebook", renamed, "update", ["name"])]);
  });
  requestSync();
}

export async function deleteQuotebook(id: string): Promise<void> {
  const book = await db.quotebooks.get(id);
  if (!book || book.is_private) return; // never delete the anchored private book

  // Soft-delete the book and cascade soft-deletes to its quotes/lines.
  // Transactional and batched: this used to be a sequential put per quote plus
  // a per-quote line query (an N+1), and being outside a transaction meant an
  // interrupted delete could leave the book tombstoned with its quotes live.
  await db.transaction(
    "rw",
    db.quotebooks,
    db.quotes,
    db.quote_lines,
    db.events,
    async () => {
      const tombstoned = stamp(book, { deleted: true });
      await db.quotebooks.put(tombstoned);

      const quotes = await db.quotes.where("quotebook_id").equals(id).toArray();
      // Scan + filter rather than anyOf() over every quote id — see the note in
      // getQuotesWithLines: per-key index seeks are far slower at this scale.
      const wanted = new Set(quotes.map((q) => q.id));
      const lines = (await db.quote_lines.toArray()).filter((l) =>
        wanted.has(l.quote_id),
      );

      const deadQuotes = quotes.map((q) => stamp(q, { deleted: true }));
      const deadLines = lines.map((l) => stamp(l, { deleted: true }));
      await db.quotes.bulkPut(deadQuotes);
      await db.quote_lines.bulkPut(deadLines);

      // The cascade is logged row by row, not just as one book-level entry:
      // an audit trail that only says "a book was deleted" cannot answer
      // "what happened to this quote", which is the question actually asked.
      await recordEvents([
        deleteEvt("quotebook", tombstoned),
        ...deadQuotes.map((q) => deleteEvt("quote", q)),
        ...deadLines.map((l) => deleteEvt("quote_line", l)),
      ]);
    },
  );
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

/**
 * Trim + hard-cap line fields. The caps are also enforced by CHECK
 * constraints in Postgres, so exceeding them locally would strand the record
 * in the outbox — never persist more than the schema accepts.
 */
function cleanLine(line: LineInput): Pick<QuoteLine, "speaker" | "line_text" | "line_context"> {
  return {
    speaker: line.speaker.trim(),
    line_text: line.line_text.trim().slice(0, MAX_LINE_TEXT),
    line_context: line.line_context.trim().slice(0, MAX_CONTEXT),
  };
}

export interface QuoteInput {
  quote_date: string;
  quote_time: string;
  /** Situation for the whole exchange; "" when there isn't one. */
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
    quote_date: input.quote_date,
    quote_time: input.quote_time,
    quote_context: input.quote_context.trim().slice(0, MAX_QUOTE_CONTEXT),
    tags: normalizeTags(input.tags),
    created_by: userId,
    created_at: nowIso(),
    version: 1,
  }) as Quote;

  const lines: QuoteLine[] = input.lines.map((line, index) =>
    fresh({
      id: line.id ?? uuid(),
      quote_id: quoteId,
      ...cleanLine(line),
      order_index: index,
    }) as QuoteLine,
  );

  await db.transaction("rw", db.quotes, db.quote_lines, db.events, async () => {
    await db.quotes.put(quote);
    await db.quote_lines.bulkPut(lines);
    await recordEvents([
      evt("quote", quote, "create"),
      ...lines.map((l) => evt("quote_line", l, "create")),
    ]);
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

  await db.transaction("rw", db.quotes, db.quote_lines, db.events, async () => {
    const quotePatch = {
      quote_date: input.quote_date,
      quote_time: input.quote_time,
      quote_context: input.quote_context.trim().slice(0, MAX_QUOTE_CONTEXT),
      tags: normalizeTags(input.tags),
      version: quote.version + 1,
    };
    const updatedQuote = stamp(quote, quotePatch);
    await db.quotes.put(updatedQuote);

    const existing = await db.quote_lines
      .where("quote_id")
      .equals(quoteId)
      .toArray();
    const existingById = new Map(existing.map((l) => [l.id, l]));
    const keptIds = new Set<string>();

    // Collect every line write, then flush once. Writing them one await at a
    // time held the transaction open across N round trips.
    const writes: QuoteLine[] = [];
    // Report the fields whose values actually differ, minus `version`: it is a
    // bookkeeping counter that increments on every save, so including it would
    // make an edit that touched only a line look like it rewrote the quote.
    // With it excluded, an empty list correctly means "the quote itself was
    // untouched" and no entry is written at all.
    const quoteChanges = changedKeys(quote, quotePatch).filter((k) => k !== "version");
    const events: EventInput[] = quoteChanges.length
      ? [evt("quote", updatedQuote, "update", quoteChanges)]
      : [];

    for (let index = 0; index < input.lines.length; index++) {
      const line = input.lines[index];
      const prev = line.id ? existingById.get(line.id) : undefined;
      if (prev) {
        keptIds.add(prev.id);
        const linePatch = {
          ...cleanLine(line),
          order_index: index,
          deleted: false,
        };
        const updatedLine = stamp(prev, linePatch);
        writes.push(updatedLine);
        const changed = changedKeys(prev, linePatch);
        if (changed.length > 0) {
          events.push(evt("quote_line", updatedLine, "update", changed));
        }
      } else {
        const created = fresh({
          id: line.id ?? uuid(),
          quote_id: quoteId,
          ...cleanLine(line),
          order_index: index,
        }) as QuoteLine;
        writes.push(created);
        events.push(evt("quote_line", created, "create"));
      }
    }

    // Tombstone lines the user removed.
    for (const prev of existing) {
      if (!keptIds.has(prev.id) && !prev.deleted) {
        const removed = stamp(prev, { deleted: true });
        writes.push(removed);
        events.push(deleteEvt("quote_line", removed));
      }
    }

    await db.quote_lines.bulkPut(writes);
    await recordEvents(events);
  });
  requestSync();
}

export async function deleteQuote(quoteId: string): Promise<void> {
  const quote = await db.quotes.get(quoteId);
  if (!quote) return;
  await db.transaction("rw", db.quotes, db.quote_lines, db.events, async () => {
    const tombstoned = stamp(quote, { deleted: true });
    await db.quotes.put(tombstoned);
    const lines = await db.quote_lines.where("quote_id").equals(quoteId).toArray();
    // One batched write rather than holding the transaction open across a
    // sequential put per line.
    const deadLines = lines.map((l) => stamp(l, { deleted: true }));
    await db.quote_lines.bulkPut(deadLines);
    await recordEvents([
      deleteEvt("quote", tombstoned),
      ...deadLines.map((l) => deleteEvt("quote_line", l)),
    ]);
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

  // Deliberately a full scan of quote_lines filtered in memory, NOT
  // `.where("quote_id").anyOf(quoteIds)`. anyOf does one index seek per key, so
  // on a book with a few thousand quotes it degrades badly — measured ~4.9s vs
  // ~1.0s for a 2000-quote book, and 25x worse when the book is a small slice
  // of a large table. This is the feed's read path and useLiveQuery re-runs it
  // on every data change, so it is the one query most worth keeping linear.
  const wanted = new Set(quotes.map((q) => q.id));
  const allLines = (await db.quote_lines.toArray()).filter(
    (l) => !l.deleted && wanted.has(l.quote_id),
  );

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

