/**
 * Background synchronization engine.
 *
 * ───────────────────────────── Strategy ─────────────────────────────
 * The UI only ever reads/writes Dexie. This engine reconciles Dexie with
 * Supabase whenever the device is online and a user is signed in:
 *
 *   1. PULL  — fetch rows changed since a per-table cursor (RLS scopes them to
 *              the books the user belongs to) and merge them locally. The
 *              cursor compares `updated_at`, which Postgres assigns itself
 *              (trigger in supabase/schema.sql), so client clock skew can
 *              never make the cursor skip a peer's writes.
 *   2. MERGE — field-level Last-Write-Wins using each record's `field_updated_at`
 *              clock (see src/lib/merge.ts). Concurrent edits to *different*
 *              fields both survive; edits to the *same* field are resolved by
 *              the higher fractional-ms tick.
 *   3. PUSH  — upsert every locally `_dirty` record. Because we pull+merge first,
 *              a push can never clobber a newer remote field. Each pull/push
 *              step is isolated: one failing table can't block the others'
 *              outboxes.
 *
 * Realtime postgres_changes events nudge an immediate sync so collaborators see
 * each other's writes within a second or two.
 *
 * ──────────────────────────── Thresholds ────────────────────────────
 */
const PUSH_DEBOUNCE_MS = 1500; // batch a flurry of local edits into one push
const FULL_SYNC_INTERVAL_MS = 15000; // periodic safety-net reconcile
const PULL_PAGE_SIZE = 1000; // rows per pull page (paginated until drained)
// (Presence soft-lock TTL lives in the sync store.)

import { db, getMeta, setMeta } from "@/db/dexie";
import { errorMessage } from "@/lib/errors";
import { clockMax, mergeRecord } from "@/lib/merge";
import { getCurrentUserId } from "@/lib/session";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useSyncStore } from "@/store/useSyncStore";
import type { Quote, QuoteLine, Quotebook, SyncMeta } from "@/lib/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Mutable fields that participate in field-level LWW, per table.
const MUTABLE_FIELDS = {
  quotebooks: ["name", "is_private", "deleted"],
  quotes: [
    "quote_date",
    "quote_time",
    "quote_context",
    "tags",
    "version",
    "deleted",
  ],
  quote_lines: ["speaker", "line_text", "line_context", "order_index", "deleted"],
} as const;

let started = false;
let intervalId: ReturnType<typeof setInterval> | null = null;
let debounceId: ReturnType<typeof setTimeout> | null = null;
let syncing = false;
let realtimeChannel: RealtimeChannel | null = null;

// ───────────────────────────── Pull ─────────────────────────────

/** Normalize Supabase's `HH:MM:SS` time back to the local `HH:mm` form. */
function normalizeQuote(row: Quote): Quote {
  if (row.quote_time && row.quote_time.length > 5) {
    row.quote_time = row.quote_time.slice(0, 5);
  }
  return row;
}

async function pullTable<T extends SyncMeta & { id: string }>(
  table: "quotebooks" | "quotes" | "quote_lines",
  fields: readonly string[],
  normalize?: (row: T) => T,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const cursorKey = `cursor:${table}`;
  let cursor = (await getMeta(cursorKey)) ?? "1970-01-01T00:00:00Z";
  const dexieTable = (db as unknown as Record<string, typeof db.quotes>)[table];

  // Paginate until the table is drained — a single capped fetch would strand
  // rows whenever more than one page changed since the cursor.
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .gt("updated_at", cursor)
      .order("updated_at", { ascending: true })
      .limit(PULL_PAGE_SIZE);

    if (error) throw error;
    if (!data || data.length === 0) return;

    const remotes = data.map((raw) =>
      normalize ? normalize(raw as T) : (raw as T),
    ) as T[];

    let maxUpdatedAt = cursor;
    for (const remote of remotes) {
      if (remote.updated_at > maxUpdatedAt) maxUpdatedAt = remote.updated_at;
    }

    // One batched read + one batched write per page. Doing this per row meant
    // two sequential IndexedDB round trips each — ~2000 for a full page, with
    // every await paying the microtask + transaction cost on its own.
    const locals = (await dexieTable.bulkGet(remotes.map((r) => r.id))) as Array<
      T | undefined
    >;

    const writes: T[] = [];
    for (let i = 0; i < remotes.length; i++) {
      const remote = remotes[i];
      const local = locals[i];
      const { merged, changedLocally, localIsNewer } = mergeRecord(local, remote, fields);

      if (changedLocally || localIsNewer) {
        merged._dirty = localIsNewer ? 1 : 0;
        writes.push(merged);
      } else if (local?._dirty) {
        // already in sync; clear stale dirty flag
        writes.push({ ...(local as object), _dirty: 0 } as T);
      }
    }
    if (writes.length > 0) await dexieTable.bulkPut(writes as never[]);

    // Last page — everything is drained, so the newest timestamp is safe.
    if (data.length < PULL_PAGE_SIZE) {
      await setMeta(cursorKey, maxUpdatedAt);
      return;
    }

    // A FULL page may have cut through a group of rows sharing one timestamp:
    // the rest of that group is still on the server, and since the next query
    // filters `> cursor`, advancing to the max would skip them forever. Rewind
    // to the newest timestamp strictly below the max and let that group be
    // re-fetched next round — merging is idempotent, so re-applying the rows we
    // just wrote costs nothing, whereas losing them is silent data loss.
    let rewind = "";
    for (const remote of remotes) {
      const at = remote.updated_at;
      if (at < maxUpdatedAt && at > rewind) rewind = at;
    }
    if (!rewind) {
      // Every row in a full page shares ONE timestamp: there is nothing to
      // rewind to and nothing we can advance to without skipping. The server
      // stamps updated_at with clock_timestamp() (see supabase/schema.sql),
      // which keeps rows distinct even within a bulk push, so this means the
      // backend predates that fix. Say so instead of looping.
      console.error(
        `[sync] pull ${table} stalled: all ${data.length} rows in a full page ` +
          `share updated_at ${maxUpdatedAt} — the backend schema is out of date`,
      );
      await setMeta(cursorKey, maxUpdatedAt);
      return;
    }

    // `rewind` is the second-highest distinct value in a page whose rows are
    // all > cursor, so the cursor strictly advances and the loop terminates.
    await setMeta(cursorKey, rewind);
    cursor = rewind;
  }
}

async function pullMembers(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const cursorKey = "cursor:members";
  let cursor = (await getMeta(cursorKey)) ?? "1970-01-01T00:00:00Z";

  for (;;) {
    const { data, error } = await supabase
      .from("quotebook_members")
      .select("*")
      .gt("joined_at", cursor)
      .order("joined_at", { ascending: true })
      .limit(PULL_PAGE_SIZE);
    if (error) throw error;
    if (!data || data.length === 0) return;

    let maxJoined = cursor;
    for (const m of data) {
      if (m.joined_at > maxJoined) maxJoined = m.joined_at;
    }
    await db.members.bulkPut(data); // one write, not one per row

    if (data.length < PULL_PAGE_SIZE) {
      await setMeta(cursorKey, maxJoined);
      return;
    }

    // Same page-boundary hazard as pullTable: a full page can cut through a
    // group sharing one joined_at, so rewind rather than skip the remainder.
    let rewind = "";
    for (const m of data) {
      if (m.joined_at < maxJoined && m.joined_at > rewind) rewind = m.joined_at;
    }
    if (!rewind) {
      console.error(
        `[sync] pull members stalled: all ${data.length} rows in a full page ` +
          `share joined_at ${maxJoined} — the backend schema is out of date`,
      );
      await setMeta(cursorKey, maxJoined);
      return;
    }
    await setMeta(cursorKey, rewind);
    cursor = rewind;
  }
}

// ───────────────────────────── Push ─────────────────────────────

/** Drop local-only columns Supabase doesn't have. */
function serialize<T extends SyncMeta>(row: T): Record<string, unknown> {
  const { _dirty, ...rest } = row as T & { _dirty?: number };
  return rest as Record<string, unknown>;
}

async function pushTable(
  table: "quotebooks" | "quotes" | "quote_lines",
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const dexieTable = (db as unknown as Record<string, typeof db.quotes>)[table];
  const dirty = (await dexieTable
    .where("_dirty")
    .equals(1)
    .toArray()) as Array<SyncMeta & { id: string }>;
  if (dirty.length === 0) return;

  const payload = dirty.map(serialize);
  const { error } = await supabase.from(table).upsert(payload, { onConflict: "id" });
  if (error) throw error;

  // Clear dirty flags — but only where the record wasn't edited again while
  // the push was in flight (its LWW clock would have advanced past the
  // snapshot we just sent; those rows must stay dirty for the next pass).
  await db.transaction("rw", dexieTable, async () => {
    for (const sent of dirty) {
      const current = (await dexieTable.get(sent.id)) as
        | (SyncMeta & { id: string })
        | undefined;
      if (current?._dirty && clockMax(current) === clockMax(sent)) {
        await dexieTable.update(sent.id, { _dirty: 0 } as never);
      }
    }
  });
}

async function pushMembers(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  // Only rows this client created (owner self-registration) are ever dirty;
  // memberships gained via redeem_invite() are inserted server-side and
  // arrive through pullMembers.
  const dirty = await db.members.where("_dirty").equals(1).toArray();
  if (dirty.length === 0) return;

  // One round trip for the whole outbox rather than one per row. upsert on the
  // (quotebook_id, user_id) unique constraint replaces the previous
  // insert-and-tolerate-23505 dance: a membership already registered by another
  // device is a no-op, which is exactly "synced".
  const payload = dirty.map(({ _dirty, ...rest }) => rest);
  const { error } = await supabase
    .from("quotebook_members")
    .upsert(payload, { onConflict: "quotebook_id,user_id", ignoreDuplicates: true });
  if (error) throw error;

  await db.members.bulkPut(dirty.map((m) => ({ ...m, _dirty: 0 })));
}

// ───────────────────────────── Orchestration ─────────────────────────────

async function countPending(): Promise<number> {
  const [a, b, c, d] = await Promise.all([
    db.quotebooks.where("_dirty").equals(1).count(),
    db.quotes.where("_dirty").equals(1).count(),
    db.quote_lines.where("_dirty").equals(1).count(),
    db.members.where("_dirty").equals(1).count(),
  ]);
  return a + b + c + d;
}

/** Run one full reconcile cycle (pull → merge → push). Safe to call often. */
export async function syncNow(): Promise<void> {
  const store = useSyncStore.getState();

  const supabase = getSupabase();
  if (!isSupabaseConfigured || !supabase || !getCurrentUserId()) {
    store.setStatus("disabled");
    return;
  }
  if (!navigator.onLine) {
    store.setStatus("offline");
    store.setPendingCount(await countPending());
    return;
  }
  // Claim the lock BEFORE the first await. Checking it and then yielding (to
  // getSession below) would let the 15s interval, a realtime nudge and a manual
  // "Sync now" all pass the check and run overlapping pull/push cycles —
  // interleaved cursor writes and double upserts.
  if (syncing) return;
  syncing = true;

  try {
    // Our cached user id can outlive the client's actual session (an expired
    // token, or one signed by a rotated key that can no longer refresh). When
    // that happens supabase-js silently falls back to the anon/publishable key,
    // so every write goes out as `anon` and RLS rejects it with an opaque
    // "violates row-level security policy". Refuse to push in that state and
    // say plainly what's wrong instead.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      store.setStatus("error");
      store.setError("Your session has expired — sign out and back in to resume syncing.");
      store.setPendingCount(await countPending());
      return;
    }

    store.setStatus("syncing");

    // Each step runs in isolation so one bad table (e.g. a rejected upsert)
    // can't starve every other outbox indefinitely.
    const failures: string[] = [];
    const step = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        console.error(`[sync] ${name} failed`, err);
        // Name the step: "push quotebooks" vs "pull quotes" is half the diagnosis.
        failures.push(`${name}: ${errorMessage(err, "unknown error")}`);
      }
    };

    // PULL first so every subsequent push is already merged against remote.
    await step("pull quotebooks", () =>
      pullTable<Quotebook>("quotebooks", MUTABLE_FIELDS.quotebooks),
    );
    await step("pull members", pullMembers);
    await step("pull quotes", () =>
      pullTable<Quote>("quotes", MUTABLE_FIELDS.quotes, normalizeQuote),
    );
    await step("pull quote_lines", () =>
      pullTable<QuoteLine>("quote_lines", MUTABLE_FIELDS.quote_lines),
    );

    // PUSH local changes (order respects server-side foreign keys).
    await step("push quotebooks", () => pushTable("quotebooks"));
    await step("push members", pushMembers);
    await step("push quotes", () => pushTable("quotes"));
    await step("push quote_lines", () => pushTable("quote_lines"));

    store.setPendingCount(await countPending());
    if (failures.length > 0) {
      store.setError(failures[0]);
      store.setStatus("error");
    } else {
      store.setLastSyncedAt(new Date().toISOString());
      store.setError(null);
      store.setStatus("idle");
    }
  } finally {
    syncing = false;
  }
}

/**
 * Request a sync soon. Debounced so a burst of local edits collapses into a
 * single push after `PUSH_DEBOUNCE_MS` of quiet.
 */
export function requestSync(): void {
  if (typeof window === "undefined") return;
  if (debounceId) clearTimeout(debounceId);
  debounceId = setTimeout(() => {
    debounceId = null;
    void syncNow();
  }, PUSH_DEBOUNCE_MS);
}

/** Subscribe to remote changes so collaborators' edits pull in promptly. */
function startRealtime(): void {
  const supabase = getSupabase();
  if (!supabase || realtimeChannel) return;

  realtimeChannel = supabase
    .channel("quotebook-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, () =>
      requestSync(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "quote_lines" },
      () => requestSync(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "quotebooks" },
      () => requestSync(),
    )
    .subscribe();
}

function stopRealtime(): void {
  const supabase = getSupabase();
  if (realtimeChannel && supabase) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// Named handlers so stopSyncEngine can actually remove them — anonymous
// closures would accumulate across engine restarts (e.g. Strict Mode).
const handleOnline = (): void => {
  useSyncStore.getState().setOnline(true);
  void syncNow();
};
const handleOffline = (): void => {
  useSyncStore.getState().setOnline(false);
  useSyncStore.getState().setStatus("offline");
};

/** Boot the engine: online/offline listeners, periodic loop, realtime, first sync. */
export function startSyncEngine(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  useSyncStore.getState().setOnline(navigator.onLine);

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  intervalId = setInterval(() => void syncNow(), FULL_SYNC_INTERVAL_MS);

  startRealtime();
  void syncNow();
}

export function stopSyncEngine(): void {
  if (typeof window !== "undefined") {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  }
  if (intervalId) clearInterval(intervalId);
  if (debounceId) clearTimeout(debounceId);
  intervalId = null;
  debounceId = null;
  stopRealtime();
  started = false;
}

/** Called by the auth store when the user signs out / in to reset realtime. */
export function restartRealtime(): void {
  stopRealtime();
  startRealtime();
}
