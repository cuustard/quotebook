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

  const quotebooks: BackupFile["quotebooks"] = [];
  for (const book of books) {
    const quotes = (await db.quotes.where("quotebook_id").equals(book.id).toArray())
      .filter((q) => !q.deleted);
    const withLines: QuoteWithLines[] = [];
    for (const q of quotes) {
      const lines = (await db.quote_lines.where("quote_id").equals(q.id).toArray())
        .filter((l) => !l.deleted)
        .sort((a, b) => a.order_index - b.order_index);
      withLines.push({ ...q, lines });
    }
    quotebooks.push({
      id: book.id,
      name: book.name,
      is_private: book.is_private,
      created_at: book.created_at,
      quotes: withLines,
    });
  }

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
  URL.revokeObjectURL(url);
}
