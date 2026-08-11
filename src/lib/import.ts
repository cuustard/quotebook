/**
 * Importing a Quotebook backup file.
 *
 * The counterpart to `export.ts`, and the destination for migrations (see
 * scripts/export-quoteguessgame.mjs). Everything lands through the normal
 * `createQuote()` path, so imported quotes get the same LWW clocks, length
 * caps and tag normalization as anything typed by hand — and sync carries
 * them up on its own.
 *
 * Imports are RESUMABLE: each quote's `source_id` is recorded once it lands,
 * so re-running a partially-completed import skips what already exists
 * instead of duplicating it.
 */

import { db, getMeta, setMeta } from "@/db/dexie";
import { createQuote, createQuotebook, type QuoteInput } from "@/lib/repo";
import { MAX_QUOTE_CONTEXT } from "@/lib/types";

export interface ImportResult {
  /** Quotes written to Dexie this run. */
  created: number;
  /** Quotes skipped because a previous run already imported them. */
  skipped: number;
  /** Quotes rejected as malformed, with the reason. */
  errors: string[];
  quotebookId: string | null;
  quotebookName: string | null;
}

export interface ImportOptions {
  /** Called after each quote so the UI can show progress. */
  onProgress?: (done: number, total: number) => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Key under which a source's already-imported ids are remembered. */
function ledgerKey(source: string): string {
  return `import:${source}`;
}

async function readLedger(source: string): Promise<Set<string>> {
  const raw = await getMeta(ledgerKey(source));
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

/**
 * Coerce one entry from a backup file into a QuoteInput.
 * Returns null (with a reason) rather than throwing, so one bad row can't
 * abort an otherwise good import.
 */
export function toQuoteInput(
  raw: unknown,
  index: number,
): { ok: true; input: QuoteInput } | { ok: false; error: string } {
  const at = `quote #${index + 1}`;
  if (!isRecord(raw)) return { ok: false, error: `${at}: not an object` };

  const { quote_date, quote_time } = raw;
  if (typeof quote_date !== "string" || !DATE_RE.test(quote_date)) {
    return { ok: false, error: `${at}: bad quote_date` };
  }
  if (typeof quote_time !== "string" || !TIME_RE.test(quote_time)) {
    return { ok: false, error: `${at}: bad quote_time` };
  }

  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  const lines = rawLines
    .filter(isRecord)
    .map((l) => ({
      speaker: typeof l.speaker === "string" ? l.speaker.trim() : "",
      line_text: typeof l.line_text === "string" ? l.line_text.trim() : "",
      line_context: typeof l.line_context === "string" ? l.line_context.trim() : "",
      order_index: typeof l.order_index === "number" ? l.order_index : 0,
    }))
    .sort((a, b) => a.order_index - b.order_index)
    .filter((l) => l.line_text.length > 0);
  if (lines.length === 0) return { ok: false, error: `${at}: no lines with text` };

  return {
    ok: true,
    input: {
      quote_date,
      quote_time,
      quote_context:
        typeof raw.quote_context === "string"
          ? raw.quote_context.trim().slice(0, MAX_QUOTE_CONTEXT)
          : "",
      tags: Array.isArray(raw.tags)
        ? raw.tags.filter((t): t is string => typeof t === "string")
        : [],
      // createQuote assigns order_index from array position.
      lines: lines.map(({ speaker, line_text, line_context }) => ({
        speaker,
        line_text,
        line_context,
      })),
    },
  };
}

/** Import a parsed backup object. Reuses a same-named book if one exists. */
export async function importBackup(
  data: unknown,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const result: ImportResult = {
    created: 0,
    skipped: 0,
    errors: [],
    quotebookId: null,
    quotebookName: null,
  };

  if (!isRecord(data) || data.app !== "quotebook") {
    result.errors.push("Not a Quotebook backup file.");
    return result;
  }
  const books = Array.isArray(data.quotebooks) ? data.quotebooks.filter(isRecord) : [];
  if (books.length === 0) {
    result.errors.push("Backup contains no quotebooks.");
    return result;
  }

  // Ledger is per source file so two different migrations don't collide.
  const source = typeof data.source === "string" ? data.source : "backup";
  const imported = await readLedger(source);

  const book = books[0];
  const name = typeof book.name === "string" && book.name.trim() ? book.name.trim() : "Imported quotes";
  const quotes = Array.isArray(book.quotes) ? book.quotes : [];

  // Reuse a book of the same name so a resumed import doesn't make a second one.
  const existing = (await db.quotebooks.toArray()).find(
    (b) => !b.deleted && b.name === name,
  );
  const target = existing ?? (await createQuotebook(name));
  result.quotebookId = target.id;
  result.quotebookName = target.name;

  for (let i = 0; i < quotes.length; i++) {
    const raw = quotes[i];
    const sourceId =
      isRecord(raw) && raw.source_id != null ? String(raw.source_id) : null;

    if (sourceId && imported.has(sourceId)) {
      result.skipped++;
      opts.onProgress?.(i + 1, quotes.length);
      continue;
    }

    const parsed = toQuoteInput(raw, i);
    if (!parsed.ok) {
      result.errors.push(parsed.error);
      opts.onProgress?.(i + 1, quotes.length);
      continue;
    }

    await createQuote(target.id, parsed.input);
    result.created++;
    if (sourceId) {
      imported.add(sourceId);
      // Persist as we go: an interrupted import resumes rather than repeats.
      if (result.created % 25 === 0) {
        await setMeta(ledgerKey(source), JSON.stringify([...imported]));
      }
    }
    opts.onProgress?.(i + 1, quotes.length);
  }

  await setMeta(ledgerKey(source), JSON.stringify([...imported]));
  return result;
}

/** Read a user-selected .json file and import it. */
export async function importBackupFile(
  file: File,
  opts?: ImportOptions,
): Promise<ImportResult> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return {
      created: 0,
      skipped: 0,
      errors: ["That file isn't valid JSON."],
      quotebookId: null,
      quotebookName: null,
    };
  }
  return importBackup(data, opts);
}
