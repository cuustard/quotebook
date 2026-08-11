/**
 * Repository write-layer tests.
 *
 * These cover the mutations every screen funnels through: line diffing on
 * edit, and the soft-delete cascades. The cascades in particular are the only
 * thing standing between "delete this book" and orphaned quotes that keep
 * syncing back, so they are asserted down to the tombstone + dirty flag.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The repo calls requestSync() after every mutation; the sync engine itself is
// not under test here (and importing it would pull in Supabase).
vi.mock("@/lib/sync", () => ({ requestSync: () => {} }));
vi.mock("@/lib/session", () => ({
  getCurrentUserId: () => "user-1",
  setCurrentUserId: () => {},
}));

const { db } = await import("@/db/dexie");
const {
  createQuote,
  createQuotebook,
  deleteQuote,
  deleteQuotebook,
  getQuotesWithLines,
  pickPrivateBook,
  updateQuote,
} = await import("@/lib/repo");
const { MAX_LINE_TEXT } = await import("@/lib/types");

type QuotebookRow = Awaited<ReturnType<typeof createQuotebook>>;

function baseInput(over: Partial<Parameters<typeof createQuote>[1]> = {}) {
  return {
    quote_date: "2026-08-07",
    quote_time: "20:00",
    quote_context: "",
    tags: [],
    lines: [{ speaker: "Jake", line_text: "milk a cow", line_context: "" }],
    ...over,
  };
}

async function seedPrivateBook(id = "book-private"): Promise<QuotebookRow> {
  const book = {
    id,
    owner_id: "user-1",
    name: "My Quotebook",
    is_private: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    field_updated_at: {},
    deleted: false,
  } as QuotebookRow;
  await db.quotebooks.put(book);
  return book;
}

/** Lines for a quote, in stored order, including tombstones. */
async function linesOf(quoteId: string) {
  return (await db.quote_lines.where("quote_id").equals(quoteId).toArray()).sort(
    (a, b) => a.order_index - b.order_index,
  );
}

beforeEach(async () => {
  await Promise.all([
    db.quotebooks.clear(),
    db.quotes.clear(),
    db.quote_lines.clear(),
    db.members.clear(),
  ]);
});

describe("createQuote", () => {
  it("stores lines in array order and normalizes tags", async () => {
    const book = await seedPrivateBook();
    const id = await createQuote(
      book.id,
      baseInput({
        tags: ["Farm", "farm", "  Cows  "],
        lines: [
          { speaker: "Jake", line_text: "first", line_context: "" },
          { speaker: "Keya", line_text: "second", line_context: "" },
        ],
      }),
    );

    const quote = await db.quotes.get(id);
    expect(quote?.tags).toEqual(["farm", "cows"]); // lowercased + deduped
    expect(quote?._dirty).toBe(1);

    const lines = await linesOf(id);
    expect(lines.map((l) => l.line_text)).toEqual(["first", "second"]);
    expect(lines.map((l) => l.order_index)).toEqual([0, 1]);
  });

  it("hard-caps line text to what the Postgres CHECK constraint accepts", async () => {
    const book = await seedPrivateBook();
    const id = await createQuote(
      book.id,
      baseInput({
        lines: [{ speaker: "Jake", line_text: "x".repeat(MAX_LINE_TEXT + 50), line_context: "" }],
      }),
    );
    // Over-long text would be rejected server-side and strand the row in the
    // outbox forever, so it must never be persisted locally either.
    const [line] = await linesOf(id);
    expect(line.line_text).toHaveLength(MAX_LINE_TEXT);
  });
});

describe("updateQuote", () => {
  it("keeps surviving lines by id, reorders them, and tombstones removals", async () => {
    const book = await seedPrivateBook();
    const quoteId = await createQuote(
      book.id,
      baseInput({
        lines: [
          { speaker: "Jake", line_text: "first", line_context: "" },
          { speaker: "Keya", line_text: "second", line_context: "" },
          { speaker: "Sam", line_text: "third", line_context: "" },
        ],
      }),
    );
    const [first, second, third] = await linesOf(quoteId);

    // Swap the first two, drop the third, append a brand-new line.
    await updateQuote(quoteId, {
      quote_date: "2026-08-08",
      quote_time: "21:00",
      quote_context: "in the barn",
      tags: [],
      lines: [
        { id: second.id, speaker: "Keya", line_text: "second", line_context: "" },
        { id: first.id, speaker: "Jake", line_text: "first (edited)", line_context: "" },
        { speaker: "New", line_text: "fourth", line_context: "" },
      ],
    });

    const live = (await linesOf(quoteId)).filter((l) => !l.deleted);
    expect(live.map((l) => l.line_text)).toEqual(["second", "first (edited)", "fourth"]);
    // Surviving lines keep their identity — a reorder must not recreate rows,
    // or every collaborator would see a delete + insert instead of a move.
    expect(live[0].id).toBe(second.id);
    expect(live[1].id).toBe(first.id);

    const dropped = await db.quote_lines.get(third.id);
    expect(dropped?.deleted).toBe(true);
    expect(dropped?._dirty).toBe(1);

    const quote = await db.quotes.get(quoteId);
    expect(quote?.quote_context).toBe("in the barn");
    expect(quote?.version).toBe(2); // bumped for optimistic checks
  });

  it("advances the LWW clock only for fields that changed", async () => {
    const book = await seedPrivateBook();
    const quoteId = await createQuote(book.id, baseInput({ tags: ["farm"] }));
    const before = await db.quotes.get(quoteId);

    await updateQuote(quoteId, {
      quote_date: "2026-09-01", // changed
      quote_time: before!.quote_time,
      quote_context: "",
      tags: ["farm"],
      lines: [{ speaker: "Jake", line_text: "milk a cow", line_context: "" }],
    });

    const after = await db.quotes.get(quoteId);
    // created_at is not an editable field, so its tick must be untouched —
    // otherwise a no-op edit would win every merge against a real remote edit.
    expect(after!.field_updated_at.created_at).toBe(before!.field_updated_at.created_at);
    expect(after!.field_updated_at.quote_date).toBeGreaterThan(
      before!.field_updated_at.quote_date,
    );
  });

  it("is a no-op for a quote that doesn't exist", async () => {
    await expect(updateQuote("nope", baseInput())).resolves.toBeUndefined();
    expect(await db.quotes.count()).toBe(0);
  });
});

describe("deleteQuote", () => {
  it("tombstones the quote and every one of its lines", async () => {
    const book = await seedPrivateBook();
    const quoteId = await createQuote(
      book.id,
      baseInput({
        lines: [
          { speaker: "Jake", line_text: "first", line_context: "" },
          { speaker: "Keya", line_text: "second", line_context: "" },
        ],
      }),
    );

    await deleteQuote(quoteId);

    const quote = await db.quotes.get(quoteId);
    expect(quote?.deleted).toBe(true);
    expect(quote?._dirty).toBe(1); // the tombstone itself must sync

    const lines = await linesOf(quoteId);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.deleted && l._dirty === 1)).toBe(true);

    // And it disappears from the feed read path.
    expect(await getQuotesWithLines(book.id)).toHaveLength(0);
  });
});

describe("deleteQuotebook", () => {
  it("cascades soft-deletes to every quote and line in the book", async () => {
    const book = await createQuotebook("Shared book");
    const a = await createQuote(book.id, baseInput());
    const b = await createQuote(
      book.id,
      baseInput({
        lines: [
          { speaker: "Keya", line_text: "one", line_context: "" },
          { speaker: "Sam", line_text: "two", line_context: "" },
        ],
      }),
    );

    await deleteQuotebook(book.id);

    expect((await db.quotebooks.get(book.id))?.deleted).toBe(true);
    for (const id of [a, b]) {
      expect((await db.quotes.get(id))?.deleted).toBe(true);
      const lines = await linesOf(id);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((l) => l.deleted)).toBe(true);
    }
    expect(await getQuotesWithLines(book.id)).toHaveLength(0);
  });

  it("does not touch quotes belonging to a different book", async () => {
    const doomed = await createQuotebook("Doomed");
    const keeper = await createQuotebook("Keeper");
    const survivor = await createQuote(keeper.id, baseInput());
    await createQuote(doomed.id, baseInput());

    await deleteQuotebook(doomed.id);

    expect((await db.quotes.get(survivor))?.deleted).toBe(false);
    const lines = await linesOf(survivor);
    expect(lines.every((l) => !l.deleted)).toBe(true);
  });

  it("refuses to delete the anchored private book", async () => {
    const book = await seedPrivateBook();
    const quoteId = await createQuote(book.id, baseInput());

    await deleteQuotebook(book.id);

    expect((await db.quotebooks.get(book.id))?.deleted).toBe(false);
    expect((await db.quotes.get(quoteId))?.deleted).toBe(false);
  });
});

describe("pickPrivateBook", () => {
  const mk = (over: Partial<QuotebookRow>) =>
    ({
      id: "x",
      owner_id: null,
      name: "b",
      is_private: true,
      deleted: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      field_updated_at: {},
    }) as QuotebookRow & { [k: string]: unknown };

  it("prefers a book owned by the current user", () => {
    const mine = { ...mk({}), id: "b", owner_id: "user-1" };
    const theirs = { ...mk({}), id: "a", owner_id: "user-2" };
    expect(pickPrivateBook([theirs, mine], "user-1")?.id).toBe("b");
  });

  it("breaks a same-timestamp tie by id so the choice is deterministic", () => {
    // Duplicate private books born from a sync race share a created_at ms.
    const a = { ...mk({}), id: "aaa", owner_id: null };
    const b = { ...mk({}), id: "bbb", owner_id: null };
    expect(pickPrivateBook([b, a], null)?.id).toBe("aaa");
    expect(pickPrivateBook([a, b], null)?.id).toBe("aaa");
  });

  it("ignores deleted and non-private books", () => {
    const deleted = { ...mk({}), id: "d", deleted: true };
    const shared = { ...mk({}), id: "s", is_private: false };
    expect(pickPrivateBook([deleted, shared], null)).toBeNull();
  });
});
