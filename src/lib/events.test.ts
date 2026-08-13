/**
 * Local event log — the module itself, and the repo wiring that feeds it.
 *
 * The wiring is the part worth guarding hardest: an audit trail is only worth
 * anything if it is complete, so these assert that every write path leaves a
 * record, that a cascade logs the rows it actually touched rather than one
 * vague top-level entry, and that an edit reports the fields that really
 * changed.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sync", () => ({ requestSync: () => {} }));
vi.mock("@/lib/session", () => ({
  getCurrentUserId: () => "user-1",
  setCurrentUserId: () => {},
}));

const { db } = await import("@/db/dexie");
const {
  eventsForEntity,
  markEventsSynced,
  pruneEvents,
  recentEvents,
  recordEvent,
  unsyncedEvents,
} = await import("@/lib/events");
const {
  createQuote,
  createQuotebook,
  deleteQuote,
  deleteQuotebook,
  renameQuotebook,
  updateQuote,
} = await import("@/lib/repo");

const baseInput = (over: Partial<Parameters<typeof createQuote>[1]> = {}) => ({
  quote_date: "2026-08-07",
  quote_time: "20:00",
  quote_context: "",
  tags: [] as string[],
  lines: [{ speaker: "Jake", line_text: "milk a cow", line_context: "" }],
  ...over,
});

/** Events for one entity type, oldest first. */
const eventsOf = async (entity: string) =>
  (await db.events.orderBy("seq").toArray()).filter((e) => e.entity === entity);

beforeEach(async () => {
  await Promise.all([
    db.events.clear(),
    db.quotebooks.clear(),
    db.quotes.clear(),
    db.quote_lines.clear(),
    db.members.clear(),
  ]);
});

describe("event log module", () => {
  it("stamps each entry with actor, action and the mutation's tick", async () => {
    await recordEvent({
      entity: "quote",
      entity_id: "q1",
      action: "update",
      fields: ["tags"],
      tick: 1234.5,
    });

    const [e] = await db.events.toArray();
    expect(e).toMatchObject({
      entity: "quote",
      entity_id: "q1",
      action: "update",
      fields: ["tags"],
      actor_id: "user-1",
      tick: 1234.5,
      _synced: 0,
    });
    expect(e.id).toBeTruthy(); // stable global id, distinct from the local seq
    expect(Date.parse(e.at)).not.toBeNaN();
  });

  it("assigns a monotonically increasing local sequence", async () => {
    for (let i = 0; i < 5; i++) {
      await recordEvent({ entity: "quote", entity_id: `q${i}`, action: "create", tick: i });
    }
    const seqs = (await db.events.orderBy("seq").toArray()).map((e) => e.seq!);
    expect(seqs).toHaveLength(5);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // already ordered
    expect(new Set(seqs).size).toBe(5); // and unique
  });

  it("returns a per-row trail, oldest first, scoped to that row", async () => {
    await recordEvent({ entity: "quote", entity_id: "q1", action: "create", tick: 1 });
    await recordEvent({ entity: "quote", entity_id: "q2", action: "create", tick: 2 });
    await recordEvent({ entity: "quote", entity_id: "q1", action: "update", fields: ["tags"], tick: 3 });

    const trail = await eventsForEntity("quote", "q1");
    expect(trail.map((e) => e.action)).toEqual(["create", "update"]);
    expect(trail.every((e) => e.entity_id === "q1")).toBe(true);
  });

  it("does not confuse rows of different entities that share an id", async () => {
    // The compound index is [entity+entity_id] precisely so this cannot bleed.
    await recordEvent({ entity: "quote", entity_id: "same", action: "create", tick: 1 });
    await recordEvent({ entity: "quote_line", entity_id: "same", action: "create", tick: 2 });

    expect(await eventsForEntity("quote", "same")).toHaveLength(1);
    expect(await eventsForEntity("quote_line", "same")).toHaveLength(1);
  });

  it("surfaces recent activity newest first", async () => {
    for (const id of ["a", "b", "c"]) {
      await recordEvent({ entity: "quote", entity_id: id, action: "create", tick: 1 });
    }
    expect((await recentEvents(2)).map((e) => e.entity_id)).toEqual(["c", "b"]);
  });
});

describe("sync backlog", () => {
  it("hands back unsynced entries in order and marks them shipped", async () => {
    for (const id of ["a", "b", "c"]) {
      await recordEvent({ entity: "quote", entity_id: id, action: "create", tick: 1 });
    }

    const backlog = await unsyncedEvents();
    expect(backlog.map((e) => e.entity_id)).toEqual(["a", "b", "c"]);

    await markEventsSynced(backlog.slice(0, 2).map((e) => e.seq!));
    expect((await unsyncedEvents()).map((e) => e.entity_id)).toEqual(["c"]);
  });
});

describe("pruning", () => {
  it("trims the oldest SYNCED entries once over the cap", async () => {
    for (let i = 0; i < 10; i++) {
      await recordEvent({ entity: "quote", entity_id: `q${i}`, action: "create", tick: i });
    }
    const all = await db.events.orderBy("seq").toArray();
    await markEventsSynced(all.map((e) => e.seq!));

    const removed = await pruneEvents(4);

    expect(removed).toBe(6);
    expect(await db.events.count()).toBe(4);
    // The survivors are the newest.
    expect((await db.events.orderBy("seq").toArray()).map((e) => e.entity_id)).toEqual([
      "q6", "q7", "q8", "q9",
    ]);
  });

  it("never drops an entry still owed to a server", async () => {
    // A long offline stretch must not silently lose mutations, so an unsynced
    // backlog is allowed to exceed the cap rather than be trimmed.
    for (let i = 0; i < 10; i++) {
      await recordEvent({ entity: "quote", entity_id: `q${i}`, action: "create", tick: i });
    }
    const removed = await pruneEvents(4);
    expect(removed).toBe(0);
    expect(await db.events.count()).toBe(10);
  });

  it("is a no-op below the cap", async () => {
    await recordEvent({ entity: "quote", entity_id: "q1", action: "create", tick: 1 });
    expect(await pruneEvents(100)).toBe(0);
  });
});

describe("repo writes are logged", () => {
  it("logs a quote and each of its lines on create", async () => {
    const book = await createQuotebook("Book");
    const quoteId = await createQuote(
      book.id,
      baseInput({
        lines: [
          { speaker: "Jake", line_text: "first", line_context: "" },
          { speaker: "Keya", line_text: "second", line_context: "" },
        ],
      }),
    );

    expect((await eventsForEntity("quote", quoteId)).map((e) => e.action)).toEqual(["create"]);
    const lineEvents = await eventsOf("quote_line");
    expect(lineEvents).toHaveLength(2);
    expect(lineEvents.every((e) => e.action === "create")).toBe(true);
    // And the book that contains them was logged too.
    expect((await eventsForEntity("quotebook", book.id)).map((e) => e.action)).toEqual(["create"]);
  });

  it("records a rename as an update naming the field", async () => {
    const book = await createQuotebook("Before");
    await renameQuotebook(book.id, "After");

    const trail = await eventsForEntity("quotebook", book.id);
    expect(trail.map((e) => e.action)).toEqual(["create", "update"]);
    expect(trail[1].fields).toEqual(["name"]);
  });

  it("reports only the fields an edit actually changed", async () => {
    const book = await createQuotebook("Book");
    const quoteId = await createQuote(book.id, baseInput({ tags: ["farm"] }));
    await db.events.clear();

    await updateQuote(quoteId, {
      ...baseInput({ tags: ["farm"] }),
      quote_date: "2026-09-01", // the only real change
    });

    const [e] = await eventsForEntity("quote", quoteId);
    // `version` always increments and every field is re-stamped, so an
    // unfiltered log would claim the whole record was rewritten.
    expect(e.fields).toEqual(["quote_date"]);
  });

  it("logs nothing for the quote when only its lines changed", async () => {
    const book = await createQuotebook("Book");
    const quoteId = await createQuote(book.id, baseInput());
    // Carry the existing line's id, or updateQuote reads it as a replacement
    // (a create plus a tombstone) rather than an edit of that line.
    const [existing] = await db.quote_lines.where("quote_id").equals(quoteId).toArray();
    await db.events.clear();

    await updateQuote(quoteId, baseInput({
      lines: [
        { id: existing.id, speaker: "Jake", line_text: "changed text", line_context: "" },
      ],
    }));

    expect(await eventsForEntity("quote", quoteId)).toHaveLength(0);
    const lineEvents = await eventsOf("quote_line");
    expect(lineEvents).toHaveLength(1);
    expect(lineEvents[0].fields).toContain("line_text");
  });

  it("logs added and removed lines distinctly", async () => {
    const book = await createQuotebook("Book");
    const quoteId = await createQuote(
      book.id,
      baseInput({
        lines: [
          { speaker: "Jake", line_text: "keep", line_context: "" },
          { speaker: "Keya", line_text: "drop", line_context: "" },
        ],
      }),
    );
    const lines = await db.quote_lines.where("quote_id").equals(quoteId).sortBy("order_index");
    await db.events.clear();

    await updateQuote(quoteId, baseInput({
      lines: [
        { id: lines[0].id, speaker: "Jake", line_text: "keep", line_context: "" },
        { speaker: "Sam", line_text: "brand new", line_context: "" },
      ],
    }));

    const byAction = (await eventsOf("quote_line")).reduce<Record<string, number>>(
      (acc, e) => ({ ...acc, [e.action]: (acc[e.action] ?? 0) + 1 }),
      {},
    );
    expect(byAction).toEqual({ create: 1, delete: 1 });
  });

  it("logs every row a quote deletion tombstones", async () => {
    const book = await createQuotebook("Book");
    const quoteId = await createQuote(
      book.id,
      baseInput({
        lines: [
          { speaker: "Jake", line_text: "one", line_context: "" },
          { speaker: "Keya", line_text: "two", line_context: "" },
        ],
      }),
    );
    await db.events.clear();

    await deleteQuote(quoteId);

    expect((await eventsForEntity("quote", quoteId)).map((e) => e.action)).toEqual(["delete"]);
    expect(await eventsOf("quote_line")).toHaveLength(2);
  });

  it("logs the whole cascade when a quotebook is deleted", async () => {
    const book = await createQuotebook("Doomed");
    await createQuote(book.id, baseInput());
    await db.events.clear();

    await deleteQuotebook(book.id);

    // Not just "a book was deleted" — the trail has to answer "what happened
    // to this quote?" for each row the cascade reached.
    expect((await eventsOf("quotebook")).map((e) => e.action)).toEqual(["delete"]);
    expect((await eventsOf("quote")).map((e) => e.action)).toEqual(["delete"]);
    expect((await eventsOf("quote_line")).map((e) => e.action)).toEqual(["delete"]);
  });

  it("attributes each entry to the acting user", async () => {
    const book = await createQuotebook("Book");
    const trail = await eventsForEntity("quotebook", book.id);
    expect(trail[0].actor_id).toBe("user-1");
  });
});
