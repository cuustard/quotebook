/**
 * Background synchronization engine.
 *
 * ───────────────────────────── Strategy ─────────────────────────────
 * The UI only ever reads/writes Dexie. This engine reconciles Dexie with
 * Supabase whenever the device is online and a user is signed in:
 *
 *   1. PULL  — fetch rows changed since a per-table cursor (RLS scopes them to
 *              the books the user belongs to) and merge them locally.
 *   2. MERGE — field-level Last-Write-Wins using each record's `field_updated_at`
 *              clock. Concurrent edits to *different* fields both survive; edits
 *              to the *same* field are resolved by the higher fractional-ms tick.
 *   3. PUSH  — upsert every locally `_dirty` record. Because we pull+merge first,
 *              a push can never clobber a newer remote field.
 *
 * Realtime postgres_changes events nudge an immediate sync so collaborators see
 * each other's writes within a second or two.
 *
 * ──────────────────────────── Thresholds ────────────────────────────
 */
const PUSH_DEBOUNCE_MS = 1500; // batch a flurry of local edits into one push
const FULL_SYNC_INTERVAL_MS = 15000; // periodic safety-net reconcile
// (Presence soft-lock TTL lives in the sync store.)

import { db, getMeta, setMeta } from "@/db/dexie";
import { tickToIso } from "@/lib/id";
import { getCurrentUserId } from "@/lib/session";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useSyncStore } from "@/store/useSyncStore";
import type { Quote, QuoteLine, Quotebook, SyncMeta } from "@/lib/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Mutable fields that participate in field-level LWW, per table.
const MUTABLE_FIELDS = {
  quotebooks: ["name", "is_private", "deleted"],
  quotes: [
    "primary_quotee",
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

// ───────────────────────────── Merge core ─────────────────────────────

/**
 * Field-level LWW merge of a remote row into the local row.
 * Returns the merged record plus flags describing what to do with it.
 */
function mergeRecord<T extends SyncMeta & { id: string }>(
  local: T | undefined,
  remote: T,
  fields: readonly string[],
): { merged: T; changedLocally: boolean; localIsNewer: boolean } {
  if (!local) {
    // First time we see this row — adopt remote wholesale, nothing to push.
    return { merged: remote, changedLocally: true, localIsNewer: false };
  }

  const localClock = local.field_updated_at ?? {};
  const remoteClock = remote.field_updated_at ?? {};
  const mergedClock: Record<string, number> = { ...localClock };
  const merged = { ...local } as T;

  let changedLocally = false;
  let localIsNewer = false;

  for (const field of fields) {
    const lt = localClock[field] ?? 0;
    const rt = remoteClock[field] ?? 0;
    if (rt > lt) {
      // remote wins this field
      (merged as Record<string, unknown>)[field] = (remote as Record<string, unknown>)[field];
      mergedClock[field] = rt;
      changedLocally = true;
    } else if (lt > rt) {
      // local wins this field → we'll need to push it back
      localIsNewer = true;
    }
    // lt === rt → identical write; keep local value (already there)
  }

  merged.field_updated_at = mergedClock;
  const maxTick = Math.max(0, ...Object.values(mergedClock));
  merged.updated_at = tickToIso(maxTick);

  return { merged, changedLocally, localIsNewer };
}

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
  const cursor = (await getMeta(cursorKey)) ?? "1970-01-01T00:00:00Z";

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .gt("updated_at", cursor)
    .order("updated_at", { ascending: true })
    .limit(1000);

  if (error) throw error;
  if (!data || data.length === 0) return;

  let maxUpdatedAt = cursor;
  const dexieTable = (db as unknown as Record<string, typeof db.quotes>)[
    table === "quote_lines" ? "quote_lines" : table
  ];

  for (const raw of data) {
    const remote = (normalize ? normalize(raw as T) : (raw as T)) as T;
    if (remote.updated_at > maxUpdatedAt) maxUpdatedAt = remote.updated_at;

    const local = (await dexieTable.get(remote.id)) as T | undefined;
    const { merged, changedLocally, localIsNewer } = mergeRecord(local, remote, fields);

    if (changedLocally || localIsNewer) {
      merged._dirty = localIsNewer ? 1 : 0;
      await dexieTable.put(merged as never);
    } else if (local?._dirty) {
      // already in sync; clear stale dirty flag
      await dexieTable.put({ ...(local as object), _dirty: 0 } as never);
    }
  }

  await setMeta(cursorKey, maxUpdatedAt);
}

async function pullMembers(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const cursorKey = "cursor:members";
  const cursor = (await getMeta(cursorKey)) ?? "1970-01-01T00:00:00Z";

  const { data, error } = await supabase
    .from("quotebook_members")
    .select("*")
    .gt("joined_at", cursor)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return;

  let maxJoined = cursor;
  for (const m of data) {
    if (m.joined_at > maxJoined) maxJoined = m.joined_at;
    await db.members.put(m);
  }
  await setMeta(cursorKey, maxJoined);
}

// ───────────────────────────── Push ─────────────────────────────

/** Drop local-only columns Supabase doesn't have. */
function serialize<T extends SyncMeta>(row: T): Record<string, unknown> {
  const { _dirty, ...rest } = row as T & { _dirty?: number };
  return rest as Record<string, unknown>;
}

async function pushTable(
  table: "quotebooks" | "quotes" | "quote_lines",
): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;

  const dexieTable = (db as unknown as Record<string, typeof db.quotes>)[table];
  const dirty = (await dexieTable
    .where("_dirty")
    .equals(1)
    .toArray()) as Array<SyncMeta & { id: string }>;
  if (dirty.length === 0) return 0;

  const payload = dirty.map(serialize);
  const { error } = await supabase.from(table).upsert(payload, { onConflict: "id" });
  if (error) throw error;

  // Clear dirty flags now that Supabase has accepted the rows.
  await Promise.all(
    dirty.map((r) => dexieTable.update(r.id, { _dirty: 0 } as never)),
  );
  return dirty.length;
}

async function pushMembers(): Promise<void> {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  if (!supabase || !userId) return;
  // Only push memberships the current user owns (RLS rejects others anyway).
  const mine = await db.members.where("user_id").equals(userId).toArray();
  if (mine.length === 0) return;
  await supabase.from("quotebook_members").upsert(mine, { onConflict: "id" });
}

// ───────────────────────────── Orchestration ─────────────────────────────

async function countPending(): Promise<number> {
  const [a, b, c] = await Promise.all([
    db.quotebooks.where("_dirty").equals(1).count(),
    db.quotes.where("_dirty").equals(1).count(),
    db.quote_lines.where("_dirty").equals(1).count(),
  ]);
  return a + b + c;
}

/** Run one full reconcile cycle (pull → merge → push). Safe to call often. */
export async function syncNow(): Promise<void> {
  const store = useSyncStore.getState();

  if (!isSupabaseConfigured || !getCurrentUserId()) {
    store.setStatus("disabled");
    return;
  }
  if (!navigator.onLine) {
    store.setStatus("offline");
    store.setPendingCount(await countPending());
    return;
  }
  if (syncing) return;

  syncing = true;
  store.setStatus("syncing");
  try {
    // PULL first so every subsequent push is already merged against remote.
    await pullTable<Quotebook>("quotebooks", MUTABLE_FIELDS.quotebooks);
    await pullMembers();
    await pullTable<Quote>("quotes", MUTABLE_FIELDS.quotes, normalizeQuote);
    await pullTable<QuoteLine>("quote_lines", MUTABLE_FIELDS.quote_lines);

    // PUSH local changes.
    await pushTable("quotebooks");
    await pushMembers();
    await pushTable("quotes");
    await pushTable("quote_lines");

    store.setLastSyncedAt(new Date().toISOString());
    store.setError(null);
    store.setPendingCount(await countPending());
    store.setStatus("idle");
  } catch (err) {
    console.error("[sync] cycle failed", err);
    store.setError(err instanceof Error ? err.message : String(err));
    store.setStatus("error");
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

/** Boot the engine: online/offline listeners, periodic loop, realtime, first sync. */
export function startSyncEngine(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  const store = useSyncStore.getState();
  store.setOnline(navigator.onLine);

  window.addEventListener("online", () => {
    useSyncStore.getState().setOnline(true);
    void syncNow();
  });
  window.addEventListener("offline", () => {
    useSyncStore.getState().setOnline(false);
    useSyncStore.getState().setStatus("offline");
  });

  intervalId = setInterval(() => void syncNow(), FULL_SYNC_INTERVAL_MS);

  startRealtime();
  void syncNow();
}

export function stopSyncEngine(): void {
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
