/**
 * Data portability — clean JSON backup of the user's local data.
 *
 * Reads straight from Dexie so it works fully offline. Tombstoned (deleted)
 * records are excluded so the export is a clean, human-readable snapshot.
 */

import { db } from "@/db/dexie";
import type { QuoteWithLines } from "@/lib/types";

export interface BackupFile {
  app: "quotebook";
  version: 1;
  exported_at: string;
  quotebooks: Array<{
    id: string;
    name: string;
    is_private: boolean;
    created_at: string;
    quotes: QuoteWithLines[];
  }>;
}

/** Build a portable backup object. Optionally scope to a single quotebook. */
export async function buildBackup(quotebookId?: string): Promise<BackupFile> {
  const books = (await db.quotebooks.toArray()).filter(
    (b) => !b.deleted && (!quotebookId || b.id === quotebookId),
  );

  // Three table scans + in-memory grouping, regardless of size. This used to be
  // one query per book plus ONE QUERY PER QUOTE. Note the scans are deliberate:
  // the obvious `.where(...).anyOf(ids)` rewrite is far WORSE than the N+1 it
  // replaces (measured ~5.1s vs ~0.15s for 2000 quotes) because anyOf does an
  // index seek per key. A linear pass over each table is ~0.03s.
  const bookIds = new Set(books.map((b) => b.id));
  const quotes = (await db.quotes.toArray()).filter(
    (q) => !q.deleted && bookIds.has(q.quotebook_id),
  );

  const wanted = new Set(quotes.map((q) => q.id));
  const allLines = (await db.quote_lines.toArray()).filter(
    (l) => !l.deleted && wanted.has(l.quote_id),
  );

  const linesByQuote = new Map<string, QuoteWithLines["lines"]>();
  for (const line of allLines) {
    const arr = linesByQuote.get(line.quote_id) ?? [];
    arr.push(line);
    linesByQuote.set(line.quote_id, arr);
  }
  for (const arr of linesByQuote.values()) {
    arr.sort((a, b) => a.order_index - b.order_index);
  }

  const quotesByBook = new Map<string, QuoteWithLines[]>();
  for (const q of quotes) {
    const arr = quotesByBook.get(q.quotebook_id) ?? [];
    arr.push({ ...q, lines: linesByQuote.get(q.id) ?? [] });
    quotesByBook.set(q.quotebook_id, arr);
  }

  const quotebooks: BackupFile["quotebooks"] = books.map((book) => ({
    id: book.id,
    name: book.name,
    is_private: book.is_private,
    created_at: book.created_at,
    quotes: quotesByBook.get(book.id) ?? [],
  }));

  return {
    app: "quotebook",
    version: 1,
    exported_at: new Date().toISOString(),
    quotebooks,
  };
}

/** Trigger a browser download of the backup JSON. */
export async function downloadBackup(quotebookId?: string): Promise<void> {
  const backup = await buildBackup(quotebookId);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `quotebook-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously races the browser's own read of the blob and can
  // cancel the download outright (Firefox/Safari). One turn of the event loop
  // is enough for the click to have been consumed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
