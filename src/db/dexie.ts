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
 *   quotes._dirty, quote_lines._dirty, quotebooks._dirty,
 *   members._dirty                                        -> outbox scans
 *   quotes.quotebook_id, quote_lines.quote_id             -> feed reads
 */

import Dexie, { type Table } from "dexie";
import { tick, tickToIso } from "@/lib/id";
import type {
  Capture,
  FieldClock,
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
  captures!: Table<Capture, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super("quotebook");

    this.version(1).stores({
      quotebooks: "id, owner_id, is_private, _dirty, updated_at",
      quotes: "id, quotebook_id, _dirty, updated_at, quote_date, created_at",
      quote_lines: "id, quote_id, _dirty, order_index",
      members: "id, quotebook_id, user_id, [quotebook_id+user_id]",
      invites: "id, quotebook_id, code, expires_at",
      meta: "key",
    });

    this.version(2)
      .stores({
        // `owner_id` / `is_private` indexes dropped: null and boolean are not
        // valid IndexedDB keys, so those indexes never populated anyway.
        // `_dirty` is indexed so the sync engine can cheaply find pending pushes.
        quotebooks: "id, _dirty, updated_at",
        quotes: "id, quotebook_id, _dirty, updated_at, quote_date, created_at",
        quote_lines: "id, quote_id, _dirty, order_index",
        members: "id, quotebook_id, user_id, _dirty, [quotebook_id+user_id]",
        invites: "id, quotebook_id, code, expires_at",
        meta: "key",
      })
      .upgrade(async (tx) => {
        // Memberships are now dirty-tracked; flag existing rows once so any
        // never-pushed row reaches Supabase (duplicates are ignored on push).
        await tx
          .table<QuotebookMember, string>("members")
          .toCollection()
          .modify((m) => {
            m._dirty = 1;
          });

        // Fold the removed quote-level `primary_quotee` into the first
        // dialogue line's speaker so no captured content is lost.
        // NOTE: `quote_context` is deliberately NOT folded — it is a real
        // field again (the situation for the whole exchange, distinct from a
        // line's own context), so it stays exactly where it is.
        type LegacyQuote = Quote & {
          primary_quotee?: string;
          field_updated_at: FieldClock & { primary_quotee?: number };
        };
        const quotes = (await tx.table("quotes").toArray()) as LegacyQuote[];
        for (const q of quotes) {
          if (q.primary_quotee === undefined) continue;

          const lines = (await tx
            .table<QuoteLine, string>("quote_lines")
            .where("quote_id")
            .equals(q.id)
            .sortBy("order_index")) as QuoteLine[];
          const first = lines.find((l) => !l.deleted);
          if (first && q.primary_quotee && !first.speaker) {
            const t = tick();
            first.speaker = q.primary_quotee;
            first.field_updated_at = { ...first.field_updated_at, speaker: t };
            first.updated_at = tickToIso(t);
            first._dirty = 1;
            await tx.table("quote_lines").put(first);
          }

          delete q.primary_quotee;
          delete q.field_updated_at.primary_quotee;
          await tx.table("quotes").put(q);
        }
      });

    // Quick Add captures — local-only scratch inbox, never synced to Supabase.
    this.version(3).stores({
      captures: "id, status, created_at, quotebook_id",
    });

    // `quote_context` is a first-class field again; backfill "" on rows
    // created while it didn't exist so the type is honest everywhere.
    this.version(4).upgrade(async (tx) => {
      await tx
        .table<Quote, string>("quotes")
        .toCollection()
        .modify((q) => {
          if (typeof q.quote_context !== "string") q.quote_context = "";
        });
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

/**
 * Wipe every synced table plus the pull cursors. Called when a signed-in user
 * leaves the browser (sign-out / account switch) so their data doesn't linger
 * for the next person and stale cursors can't hide the next account's pull.
 * The device id survives — it identifies the device, not the user.
 */
export async function resetLocalData(): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    await Promise.all([
      db.quotebooks.clear(),
      db.quotes.clear(),
      db.quote_lines.clear(),
      db.members.clear(),
      db.invites.clear(),
      // Captures hold raw user text — they must not outlive the account
      // that typed them on a shared browser.
      db.captures.clear(),
    ]);
    const keys = (await db.meta.toCollection().primaryKeys()) as string[];
    await db.meta.bulkDelete(keys.filter((k) => k.startsWith("cursor:")));
  });
}
