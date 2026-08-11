/**
 * Sync engine pull/push tests against a stubbed Supabase.
 *
 * The pull path reads a page of remote rows, merges each against its local
 * counterpart, and writes the survivors back in one batch. That batching is
 * positional — local row N must be merged against remote row N — so these
 * tests deliberately mix "exists locally", "new to this device" and "locally
 * newer" within a single page, which is exactly where an off-by-one in the
 * batched read would corrupt records rather than fail loudly.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  updated_at: string;
  field_updated_at: Record<string, number>;
  [k: string]: unknown;
}

/** Remote tables the stub serves pulls from. */
const remote: Record<string, Row[]> = {
  quotebooks: [],
  quotes: [],
  quote_lines: [],
  quotebook_members: [],
};
/** Every payload the engine pushed, by table. */
const pushed: Record<string, unknown[][]> = {};

const PAGE = 1000; // must match PULL_PAGE_SIZE in sync.ts

/**
 * Minimal PostgREST-shaped query builder: chainable, and awaitable at the end
 * of the chain. `gt` captures the cursor so pagination behaves like the server.
 */
function makeBuilder(table: string) {
  let cursorCol = "";
  let cursor = "";
  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    gt: (col: string, value: string) => {
      cursorCol = col;
      cursor = value;
      return builder;
    },
    upsert: (payload: unknown[]) => {
      (pushed[table] ??= []).push(payload);
      return Promise.resolve({ data: null, error: null });
    },
    then: (resolve: (r: { data: Row[]; error: null }) => unknown) => {
      const rows = (remote[table] ?? [])
        .filter((r) => String(r[cursorCol]) > cursor)
        .sort((a, b) => String(a[cursorCol]).localeCompare(String(b[cursorCol])))
        .slice(0, PAGE);
      return Promise.resolve(resolve({ data: rows, error: null }));
    },
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => makeBuilder(table),
    channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} }),
    removeChannel: () => {},
  }),
}));
vi.mock("@/lib/session", () => ({
  getCurrentUserId: () => "user-1",
  setCurrentUserId: () => {},
}));

const { db } = await import("@/db/dexie");
const { syncNow } = await import("@/lib/sync");

const iso = (ms: number) => new Date(ms).toISOString();

function remoteQuote(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    quotebook_id: "book-1",
    quote_date: "2026-08-07",
    quote_time: "20:00:00", // Postgres `time` form — the engine normalizes it
    quote_context: "",
    tags: [],
    created_by: "user-1",
    created_at: iso(1000),
    version: 1,
    deleted: false,
    updated_at: iso(5000),
    field_updated_at: { quote_context: 5000 },
    ...over,
  } as Row;
}

async function localQuote(id: string, over: Record<string, unknown> = {}) {
  await db.quotes.put({
    ...remoteQuote(id),
    quote_time: "20:00",
    _dirty: 0,
    ...over,
  } as never);
}

beforeEach(async () => {
  for (const k of Object.keys(remote)) remote[k] = [];
  for (const k of Object.keys(pushed)) delete pushed[k];
  vi.stubGlobal("navigator", { onLine: true });
  await Promise.all([
    db.quotebooks.clear(),
    db.quotes.clear(),
    db.quote_lines.clear(),
    db.members.clear(),
    db.meta.clear(),
  ]);
});

describe("pull", () => {
  it("merges a mixed page against the right local row for each remote row", async () => {
    // a: new to this device · b: remote edit wins · c: local edit is newer
    await localQuote("b", { quote_context: "local b", field_updated_at: { quote_context: 1 } });
    await localQuote("c", {
      quote_context: "local c",
      field_updated_at: { quote_context: 9999 },
      _dirty: 1,
    });
    remote.quotes = [
      remoteQuote("a", { quote_context: "remote a", updated_at: iso(5001) }),
      remoteQuote("b", { quote_context: "remote b", updated_at: iso(5002) }),
      remoteQuote("c", { quote_context: "remote c", updated_at: iso(5003) }),
    ];

    await syncNow();

    // Each row must have merged against ITS OWN local counterpart.
    expect((await db.quotes.get("a"))?.quote_context).toBe("remote a");
    expect((await db.quotes.get("b"))?.quote_context).toBe("remote b");
    expect((await db.quotes.get("c"))?.quote_context).toBe("local c");

    // The locally-newer row is flagged dirty by the merge and then carried up
    // by the push in the same cycle — so what proves it survived is that it
    // reached the wire, not the flag (which is legitimately cleared by then).
    const sent = (pushed.quotes?.[0] ?? []) as Array<{ id: string; quote_context: string }>;
    expect(sent.map((r) => r.id)).toEqual(["c"]);
    expect(sent[0].quote_context).toBe("local c");
    // The row that lost to remote had nothing to send.
    expect((await db.quotes.get("b"))?._dirty).toBe(0);
  });

  it("normalizes the Postgres time form to HH:mm", async () => {
    remote.quotes = [remoteQuote("a", { quote_time: "20:00:00" })];
    await syncNow();
    expect((await db.quotes.get("a"))?.quote_time).toBe("20:00");
  });

  it("advances the cursor to the newest row it saw", async () => {
    remote.quotes = [
      remoteQuote("a", { updated_at: iso(5001) }),
      remoteQuote("b", { updated_at: iso(7777) }),
    ];
    await syncNow();
    expect((await db.meta.get("cursor:quotes"))?.value).toBe(iso(7777));

    // A second pass with nothing new must not re-apply or rewind.
    await syncNow();
    expect((await db.meta.get("cursor:quotes"))?.value).toBe(iso(7777));
  });

  it("paginates past a full page instead of stopping at the limit", async () => {
    // Distinct timestamps per row — what clock_timestamp() guarantees server
    // side, and what lets the cursor advance through more than one page.
    remote.quotes = Array.from({ length: PAGE + 250 }, (_, i) =>
      remoteQuote(`q-${String(i).padStart(5, "0")}`, { updated_at: iso(100000 + i) }),
    );

    await syncNow();

    expect(await db.quotes.count()).toBe(PAGE + 250);
    expect((await db.meta.get("cursor:quotes"))?.value).toBe(iso(100000 + PAGE + 249));
  });

  it("does not lose rows whose timestamp straddles the page boundary", async () => {
    // A page ends mid-group: many rows share the final timestamp, and the
    // limit cuts through them. Advancing the cursor to that timestamp would
    // make the next `> cursor` query skip the remainder permanently.
    const shared = iso(300000);
    remote.quotes = [
      ...Array.from({ length: PAGE - 5 }, (_, i) =>
        remoteQuote(`a-${String(i).padStart(5, "0")}`, { updated_at: iso(100000 + i) }),
      ),
      ...Array.from({ length: 25 }, (_, i) =>
        remoteQuote(`z-${String(i).padStart(5, "0")}`, { updated_at: shared }),
      ),
    ];

    await syncNow();

    expect(await db.quotes.count()).toBe(PAGE + 20); // every row, none stranded
    expect(await db.quotes.get("z-00024")).toBeDefined();
  });

  it("bails instead of spinning when a whole page shares one timestamp", async () => {
    // The pathology the schema's clock_timestamp() exists to prevent: a bulk
    // push under a now()-based trigger stamps every row identically, so the
    // cursor has nowhere to advance to. The client must give up loudly rather
    // than loop forever re-fetching the same page.
    const collided = iso(200000);
    remote.quotes = Array.from({ length: PAGE + 10 }, (_, i) =>
      remoteQuote(`c-${String(i).padStart(5, "0")}`, { updated_at: collided }),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await syncNow();

    expect(await db.quotes.count()).toBe(PAGE); // the page it could see
    expect(errors.mock.calls.flat().join(" ")).toMatch(/stalled/);
    errors.mockRestore();
  });

  it("clears a stale dirty flag when the remote already matches", async () => {
    // Marked dirty locally but identical to remote (e.g. an earlier push whose
    // acknowledgement was lost) — nothing to send, so the flag must clear.
    await localQuote("a", { _dirty: 1 });
    remote.quotes = [remoteQuote("a")];

    await syncNow();

    expect((await db.quotes.get("a"))?._dirty).toBe(0);
  });
});

describe("push", () => {
  it("sends every dirty row in one upsert and clears the flags", async () => {
    await localQuote("a", { _dirty: 1 });
    await localQuote("b", { _dirty: 1 });
    await localQuote("c", { _dirty: 0 });

    await syncNow();

    expect(pushed.quotes).toHaveLength(1); // one round trip, not one per row
    const ids = (pushed.quotes[0] as Array<{ id: string }>).map((r) => r.id).sort();
    expect(ids).toEqual(["a", "b"]);
    expect((await db.quotes.get("a"))?._dirty).toBe(0);
    expect((await db.quotes.get("b"))?._dirty).toBe(0);
  });

  it("strips the local-only _dirty column from the payload", async () => {
    await localQuote("a", { _dirty: 1 });
    await syncNow();
    // Supabase has no such column; sending it fails the whole upsert.
    expect(pushed.quotes[0][0]).not.toHaveProperty("_dirty");
  });

  it("does not push when there is nothing dirty", async () => {
    await localQuote("a", { _dirty: 0 });
    await syncNow();
    expect(pushed.quotes).toBeUndefined();
  });
});

describe("concurrency", () => {
  it("runs a single cycle when called concurrently", async () => {
    await localQuote("a", { _dirty: 1 });

    // Two overlapping callers (the interval, a realtime nudge, a manual "Sync
    // now") must not both run: the guard is claimed before the first await, so
    // the second call returns immediately.
    await Promise.all([syncNow(), syncNow()]);

    expect(pushed.quotes ?? []).toHaveLength(1);
  });
});
