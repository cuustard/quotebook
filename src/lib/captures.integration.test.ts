/**
 * End-to-end test of the Quick Add resolution pipeline against a stubbed
 * Edge Function: capture → parse → validate → quote, including the paths
 * where the provider misbehaves.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The parse engine talks to Supabase and reads the signed-in user; stub both
// so the test exercises OUR pipeline, not the network.
const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({ functions: { invoke } }),
}));
vi.mock("@/lib/session", () => ({
  getCurrentUserId: () => "user-1",
  setCurrentUserId: () => {},
}));

// Enable the AI path (module reads this at import time).
vi.stubEnv("NEXT_PUBLIC_QUICKADD_AI", "true");

const { db } = await import("@/db/dexie");
const { createCapture, resolvePendingCaptures } = await import("@/lib/captures");

const SOURCE = "Jake said hes going to milk a cow at 8pm";

function providerReturns(over: Record<string, unknown> = {}) {
  invoke.mockResolvedValue({
    data: {
      quote_date: "2026-08-07",
      quote_time: "20:00",
      quote_context: "",
      tags: ["farm"],
      lines: [
        { speaker: "Jake", line_text: "he's going to milk a cow", line_context: "" },
      ],
      confidence: "high",
      notes: null,
      ...over,
    },
    error: null,
  });
}

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
  });
  return id;
}

beforeEach(async () => {
  invoke.mockReset();
  vi.stubGlobal("navigator", { onLine: true });
  await Promise.all([
    db.captures.clear(),
    db.quotes.clear(),
    db.quote_lines.clear(),
    db.quotebooks.clear(),
  ]);
});

describe("capture resolution pipeline", () => {
  it("turns a capture into a quote and queues it for review", async () => {
    const bookId = await seedBook();
    const id = (await createCapture(SOURCE, bookId))!;
    providerReturns();

    await resolvePendingCaptures();

    const capture = await db.captures.get(id);
    expect(capture?.status).toBe("parsed");
    expect(capture?.confidence).toBe("high");
    expect(capture?.quote_id).toBeTruthy();
    // The raw text survives untouched — it's the provenance record.
    expect(capture?.text).toBe(SOURCE);

    const quote = await db.quotes.get(capture!.quote_id!);
    expect(quote?.quote_date).toBe("2026-08-07");
    expect(quote?.quote_time).toBe("20:00");
    expect(quote?.tags).toEqual(["farm"]);

    const lines = await db.quote_lines.where("quote_id").equals(quote!.id).toArray();
    expect(lines).toHaveLength(1);
    expect(lines[0].speaker).toBe("Jake");
  });

  it("REJECTS a fabricated quote instead of writing it to the book", async () => {
    const bookId = await seedBook();
    const id = (await createCapture(SOURCE, bookId))!;
    providerReturns({
      lines: [
        {
          speaker: "Jake",
          line_text: "I have always dreamed of owning a dairy farm",
          line_context: "",
        },
      ],
    });

    await resolvePendingCaptures();

    const capture = await db.captures.get(id);
    expect(capture?.status).toBe("failed"); // permanent — no retry ladder
    expect(capture?.error).toMatch(/didn't match/i);
    expect(await db.quotes.count()).toBe(0); // nothing entered the record
  });

  it("flags a drifting parse for review but still saves it", async () => {
    const bookId = await seedBook();
    const id = (await createCapture(SOURCE, bookId))!;
    providerReturns({
      lines: [
        {
          speaker: "Jake",
          line_text: "going to milk a cow tomorrow morning early",
          line_context: "",
        },
      ],
    });

    await resolvePendingCaptures();

    const capture = await db.captures.get(id);
    expect(capture?.status).toBe("parsed");
    expect(capture?.confidence).toBe("low");
    expect(await db.quotes.count()).toBe(1);
  });

  it("keeps a capture queued when the function fails transiently", async () => {
    const bookId = await seedBook();
    const id = (await createCapture(SOURCE, bookId))!;
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("boom"), {
        context: new Response("{}", { status: 503 }),
      }),
    });

    await resolvePendingCaptures();

    const capture = await db.captures.get(id);
    expect(capture?.status).toBe("pending"); // still retryable
    expect(capture?.attempts).toBe(1);
    expect(await db.quotes.count()).toBe(0);
  });

  it("does not call the provider while offline", async () => {
    const bookId = await seedBook();
    const id = (await createCapture(SOURCE, bookId))!;
    vi.stubGlobal("navigator", { onLine: false });

    await resolvePendingCaptures();

    expect(invoke).not.toHaveBeenCalled();
    const capture = await db.captures.get(id);
    expect(capture?.status).toBe("pending"); // queued, not failed
    expect(capture?.attempts).toBe(0); // no attempt was spent
  });
});
