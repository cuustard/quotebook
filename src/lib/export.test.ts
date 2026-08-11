/**
 * Backup builder tests.
 *
 * `buildBackup` fans a flat set of Dexie rows back out into a nested
 * book → quotes → lines shape. It does that with batched queries and in-memory
 * grouping rather than a query per quote, so the thing worth pinning down is
 * that every line still lands under the right quote and every quote under the
 * right book — including when ids interleave across books.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

const { db } = await import("@/db/dexie");
const { buildBackup } = await import("@/lib/export");

let seq = 0;
const stamp = () => ({
  updated_at: new Date().toISOString(),
  field_updated_at: {},
  deleted: false,
});

async function addBook(id: string, over: Record<string, unknown> = {}) {
  await db.quotebooks.put({
    id,
    owner_id: "user-1",
    name: `Book ${id}`,
    is_private: false,
    created_at: "2026-01-01T00:00:00.000Z",
    ...stamp(),
    ...over,
  } as never);
}

async function addQuote(id: string, bookId: string, over: Record<string, unknown> = {}) {
  await db.quotes.put({
    id,
    quotebook_id: bookId,
    quote_date: "2026-08-07",
    quote_time: "20:00",
    quote_context: "",
    tags: [],
    created_by: "user-1",
    created_at: `2026-01-01T00:00:0${seq++}.000Z`,
    version: 1,
    ...stamp(),
    ...over,
  } as never);
}

async function addLine(
  id: string,
  quoteId: string,
  text: string,
  orderIndex: number,
  over: Record<string, unknown> = {},
) {
  await db.quote_lines.put({
    id,
    quote_id: quoteId,
    speaker: "Jake",
    line_text: text,
    line_context: "",
    order_index: orderIndex,
    ...stamp(),
    ...over,
  } as never);
}

beforeEach(async () => {
  seq = 0;
  await Promise.all([db.quotebooks.clear(), db.quotes.clear(), db.quote_lines.clear()]);
});

describe("buildBackup", () => {
  it("nests each line under its own quote and each quote under its own book", async () => {
    await addBook("book-a");
    await addBook("book-b");
    // Interleave: quotes for the two books alternate, and so do their lines.
    await addQuote("q-a1", "book-a");
    await addQuote("q-b1", "book-b");
    await addQuote("q-a2", "book-a");
    await addLine("l-1", "q-b1", "b1 only", 0);
    await addLine("l-2", "q-a1", "a1 only", 0);
    await addLine("l-3", "q-a2", "a2 only", 0);

    const backup = await buildBackup();
    const byId = new Map(backup.quotebooks.map((b) => [b.id, b]));

    expect(byId.get("book-a")!.quotes.map((q) => q.id).sort()).toEqual(["q-a1", "q-a2"]);
    expect(byId.get("book-b")!.quotes.map((q) => q.id)).toEqual(["q-b1"]);

    const quoteLines = new Map(
      backup.quotebooks
        .flatMap((b) => b.quotes)
        .map((q) => [q.id, q.lines.map((l) => l.line_text)]),
    );
    expect(quoteLines.get("q-a1")).toEqual(["a1 only"]);
    expect(quoteLines.get("q-a2")).toEqual(["a2 only"]);
    expect(quoteLines.get("q-b1")).toEqual(["b1 only"]);
  });

  it("orders lines by order_index regardless of insertion order", async () => {
    await addBook("book-a");
    await addQuote("q-1", "book-a");
    await addLine("l-c", "q-1", "third", 2);
    await addLine("l-a", "q-1", "first", 0);
    await addLine("l-b", "q-1", "second", 1);

    const backup = await buildBackup();
    expect(backup.quotebooks[0].quotes[0].lines.map((l) => l.line_text)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("excludes tombstoned books, quotes and lines", async () => {
    await addBook("book-live");
    await addBook("book-dead", { deleted: true });
    await addQuote("q-live", "book-live");
    await addQuote("q-dead", "book-live", { deleted: true });
    await addQuote("q-orphan", "book-dead");
    await addLine("l-live", "q-live", "keep me", 0);
    await addLine("l-dead", "q-live", "drop me", 1, { deleted: true });

    const backup = await buildBackup();

    expect(backup.quotebooks.map((b) => b.id)).toEqual(["book-live"]);
    expect(backup.quotebooks[0].quotes.map((q) => q.id)).toEqual(["q-live"]);
    expect(backup.quotebooks[0].quotes[0].lines.map((l) => l.line_text)).toEqual(["keep me"]);
  });

  it("scopes to a single quotebook when given an id", async () => {
    await addBook("book-a");
    await addBook("book-b");
    await addQuote("q-a", "book-a");
    await addQuote("q-b", "book-b");
    await addLine("l-a", "q-a", "a", 0);
    await addLine("l-b", "q-b", "b", 0);

    const backup = await buildBackup("book-a");

    expect(backup.quotebooks).toHaveLength(1);
    expect(backup.quotebooks[0].id).toBe("book-a");
    expect(backup.quotebooks[0].quotes.map((q) => q.id)).toEqual(["q-a"]);
  });

  it("emits a book with no quotes rather than dropping it", async () => {
    await addBook("book-empty");
    const backup = await buildBackup();
    expect(backup.quotebooks).toHaveLength(1);
    expect(backup.quotebooks[0].quotes).toEqual([]);
  });

  it("carries the backup envelope the importer checks for", async () => {
    await addBook("book-a");
    const backup = await buildBackup();
    // importBackup() rejects anything without app === "quotebook".
    expect(backup.app).toBe("quotebook");
    expect(backup.version).toBe(1);
    expect(Date.parse(backup.exported_at)).not.toBeNaN();
  });
});
