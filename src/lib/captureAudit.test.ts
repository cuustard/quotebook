/**
 * Capture pipeline: audit trail + the defensive-capture guarantee.
 *
 * Two things are asserted here that nothing else in the suite covers:
 *
 *   1. THE RAW INPUT SURVIVES. A parse failure must never cost the user the
 *      words they captured. This is the constraint the whole "capture first,
 *      parse later" design exists to honour, and it fails silently — the row
 *      still looks fine, it just says something the user never typed.
 *   2. THE TRAIL IS COMPLETE. Every transition is logged, so "what did the
 *      machine do to my words" is answerable after the fact.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({ functions: { invoke } }),
}));
vi.mock("@/lib/session", () => ({
  getCurrentUserId: () => "user-1",
  setCurrentUserId: () => {},
}));
vi.mock("@/lib/sync", () => ({ requestSync: () => {} }));
vi.stubEnv("NEXT_PUBLIC_QUICKADD_AI", "true");

const { db } = await import("@/db/dexie");
const { createCapture, completeCapture, deleteCapture, retryCapture, resolvePendingCaptures } =
  await import("@/lib/captures");
const { eventsForEntity } = await import("@/lib/events");

const SOURCE = "Jake said hes going to milk a cow at 8pm";

async function seedBook(): Promise<string> {
  const id = "book-1";
  await db.quotebooks.put({
    id,
    owner_id: "user-1",
    name: "My Quotebook",
    is_private: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    field_updated_at: {},
    deleted: false,
  } as never);
  return id;
}

/** Actions logged against a capture, oldest first. */
const trail = async (id: string) =>
  (await eventsForEntity("capture", id)).map((e) => e.action);

beforeEach(async () => {
  invoke.mockReset();
  vi.stubGlobal("navigator", { onLine: true });
  await Promise.all([
    db.captures.clear(),
    db.quotes.clear(),
    db.quote_lines.clear(),
    db.quotebooks.clear(),
    db.events.clear(),
  ]);
});

describe("defensive capture", () => {
  it("keeps the raw text verbatim when the parser rejects it", async () => {
    const bookId = await seedBook();
    const id = (await createCapture(SOURCE, bookId))!;
    // A fabricated line: validateParsedQuote rejects it permanently.
    invoke.mockResolvedValue({
      data: {
        quote_date: "2026-08-07",
        quote_time: "20:00",
        quote_context: "",
        tags: [],
        lines: [
          { speaker: "Jake", line_text: "I have always dreamed of dairy farming", line_context: "" },
        ],
        confidence: "high",
        notes: "",
      },
      error: null,
    });

    await resolvePendingCaptures();

    const capture = await db.captures.get(id);
    expect(capture?.status).toBe("failed");
    // THE POINT: the words are still exactly what was captured.
    expect(capture?.text).toBe(SOURCE);
    // Still reachable for manual conversion rather than dropped.
    expect(capture?.error).toBeTruthy();
    expect(await db.quotes.count()).toBe(0);
  });

  it("keeps the raw text when the parser is unreachable", async () => {
    const bookId = await seedBook();
    const id = (await createCapture(SOURCE, bookId))!;
    invoke.mockRejectedValue(new Error("network down"));

    await resolvePendingCaptures();

    const capture = await db.captures.get(id);
    expect(capture?.text).toBe(SOURCE);
    // Transient: back in the queue rather than burnt.
    expect(capture?.status).toBe("pending");
  });

  it("keeps the raw text across the whole retry ladder to failure", async () => {
    const bookId = await seedBook();
    const id = (await createCapture(SOURCE, bookId))!;
    invoke.mockRejectedValue(new Error("still down"));

    // Exhaust the attempts; isRetryDue gates on attempted_at, so clear it.
    for (let i = 0; i < 6; i++) {
      await db.captures.update(id, { attempted_at: null });
      await resolvePendingCaptures();
    }

    const capture = await db.captures.get(id);
    expect(capture?.status).toBe("failed");
    expect(capture?.text).toBe(SOURCE);
  });
});

describe("capture audit trail", () => {
  it("logs the capture the moment it is queued", async () => {
    const bookId = await seedBook();
    const id = (await createCapture(SOURCE, bookId))!;
    expect(await trail(id)).toEqual(["create"]);

    const [entry] = await eventsForEntity("capture", id);
    expect(entry).toMatchObject({ entity: "capture", actor_id: "user-1", _synced: 0 });
  });

  it("logs each step of a successful parse", async () => {
    const bookId = await seedBook();
    const id = (await createCapture(SOURCE, bookId))!;
    invoke.mockResolvedValue({
      data: {
        quote_date: "2026-08-07",
        quote_time: "20:00",
        quote_context: "",
        tags: ["farm"],
        lines: [{ speaker: "Jake", line_text: "he's going to milk a cow", line_context: "" }],
        confidence: "high",
        notes: "",
      },
      error: null,
    });

    await resolvePendingCaptures();

    // create → parsing → parsed: the machine's work is on the record.
    expect(await trail(id)).toEqual(["create", "update", "update"]);
    const entries = await eventsForEntity("capture", id);
    expect(entries[2].fields).toContain("quote_id");
  });

  it("logs a failure as well as a success", async () => {
    const bookId = await seedBook();
    const id = (await createCapture(SOURCE, bookId))!;
    invoke.mockResolvedValue({
      data: {
        quote_date: "2026-08-07", quote_time: "20:00", quote_context: "", tags: [],
        lines: [{ speaker: "X", line_text: "entirely invented sentence here", line_context: "" }],
        confidence: "high", notes: "",
      },
      error: null,
    });

    await resolvePendingCaptures();

    const entries = await eventsForEntity("capture", id);
    expect(entries.map((e) => e.action)).toEqual(["create", "update", "update"]);
    expect(entries[2].fields).toContain("error");
  });

  it("logs review, retry and deletion", async () => {
    const bookId = await seedBook();

    const reviewed = (await createCapture("one", bookId))!;
    await completeCapture(reviewed, "quote-1");
    expect(await trail(reviewed)).toEqual(["create", "update"]);

    const retried = (await createCapture("two", bookId))!;
    await retryCapture(retried);
    expect(await trail(retried)).toEqual(["create", "update"]);

    const removed = (await createCapture("three", bookId))!;
    await deleteCapture(removed);
    // The row is gone but its history is not — that is the point of a log.
    expect(await trail(removed)).toEqual(["create", "delete"]);
    expect(await db.captures.get(removed)).toBeUndefined();
  });

  it("orders capture events against the quote events they lead to", async () => {
    // The trail has to read end to end: raw text arrived, then this quote
    // exists. That only works if both share one monotonic sequence.
    const bookId = await seedBook();
    await createCapture(SOURCE, bookId);
    invoke.mockResolvedValue({
      data: {
        quote_date: "2026-08-07", quote_time: "20:00", quote_context: "", tags: [],
        lines: [{ speaker: "Jake", line_text: "he's going to milk a cow", line_context: "" }],
        confidence: "high", notes: "",
      },
      error: null,
    });
    await resolvePendingCaptures();

    const all = await db.events.orderBy("seq").toArray();
    const first = all.findIndex((e) => e.entity === "capture");
    const quoteCreated = all.findIndex((e) => e.entity === "quote" && e.action === "create");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(quoteCreated).toBeGreaterThan(first);
  });
});
