/**
 * Field-level Last-Write-Wins merge core.
 *
 * Pure functions extracted from the sync engine so they can be unit-tested
 * without touching Dexie or Supabase.
 */

import { tickToIso } from "@/lib/id";
import type { SyncMeta } from "@/lib/types";

/** Highest LWW tick in a record's field clock (0 for an empty clock). */
export function clockMax(row: SyncMeta): number {
  const ticks = Object.values(row.field_updated_at ?? {});
  return ticks.length > 0 ? Math.max(...ticks) : 0;
}

/**
 * Field-level LWW merge of a remote row into the local row.
 * Returns the merged record plus flags describing what to do with it.
 */
export function mergeRecord<T extends SyncMeta & { id: string }>(
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
  // Guard: an empty clock must not reset updated_at to the 1970 epoch —
  // that would pin the row below every pull cursor forever.
  const ticks = Object.values(mergedClock);
  if (ticks.length > 0) {
    merged.updated_at = tickToIso(Math.max(...ticks));
  }

  return { merged, changedLocally, localIsNewer };
}
