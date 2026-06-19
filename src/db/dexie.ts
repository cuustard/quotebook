/**
 * Local-first store (IndexedDB via Dexie).
 *
 * Every screen in the app reads from these tables through `useLiveQuery`, so
 * navigation, search and filtering are instant and fully offline-capable. The
 * background sync engine (`src/lib/sync.ts`) reconciles them with Supabase.
 *
 * Tables mirror `supabase/schema.sql`. Local-only columns:
 *   _dirty   1 = has changes not yet pushed to Supabase
 *   deleted  soft-delete tombstone (synced, then GC'd)
 *
 * Compound/marker indexes used by the sync engine and feed:
 *   quotes._dirty, quote_lines._dirty, quotebooks._dirty  -> outbox scans
 *   quotes.quotebook_id, quote_lines.quote_id             -> feed reads
 */

import Dexie, { type Table } from "dexie";
import type {
  InviteCode,
  Quote,
  QuoteLine,
  Quotebook,
  QuotebookMember,
} from "@/lib/types";

/** Key/value table for sync bookkeeping (last pull cursor, device id, …). */
export interface Meta {
  key: string;
  value: string;
}

export class QuotebookDB extends Dexie {
  quotebooks!: Table<Quotebook, string>;
  quotes!: Table<Quote, string>;
  quote_lines!: Table<QuoteLine, string>;
  members!: Table<QuotebookMember, string>;
  invites!: Table<InviteCode, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super("quotebook");

    this.version(1).stores({
      // `_dirty` is indexed so the sync engine can cheaply find pending pushes.
      quotebooks: "id, owner_id, is_private, _dirty, updated_at",
      quotes: "id, quotebook_id, _dirty, updated_at, quote_date, created_at",
      quote_lines: "id, quote_id, _dirty, order_index",
      members: "id, quotebook_id, user_id, [quotebook_id+user_id]",
      invites: "id, quotebook_id, code, expires_at",
      meta: "key",
    });
  }
}

export const db = new QuotebookDB();

// --- Meta helpers ----------------------------------------------------------

export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

/** Stable per-device id used for realtime presence + sync diagnostics. */
export async function getDeviceId(): Promise<string> {
  let id = await getMeta("device_id");
  if (!id) {
    id = crypto.randomUUID();
    await setMeta("device_id", id);
  }
  return id;
}
