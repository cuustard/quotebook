/**
 * Append-only local event log.
 *
 * The record tables carry field-level LWW clocks, which is enough to MERGE two
 * versions of a row but says nothing about how a row got there. This module is
 * the missing half: an ordered, immutable account of what changed, who changed
 * it, and when.
 *
 * ───────────────────────────── Why now ─────────────────────────────
 * An audit trail cannot be backfilled — history that was never recorded cannot
 * be invented later. Three planned capabilities all need this to have been
 * running from the start:
 *
 *   - AUDIT LOGGING — "who edited this quote, and when", per row.
 *   - EVENT-SOURCED SYNC — `unsyncedEvents()` is an ordered mutation stream a
 *     server can consume, as an alternative (or a complement) to the current
 *     whole-row LWW upserts. `sync.ts` does not read it yet; the boundary is
 *     deliberate, so the reconciliation model can change without the write
 *     path changing with it.
 *   - RBAC — attributing a change to an actor is a precondition for deciding
 *     whether that actor was allowed to make it.
 *
 * ──────────────────────── Guarantees and limits ────────────────────────
 * Entries are appended inside the SAME Dexie transaction as the mutation they
 * describe (see `src/lib/repo.ts`), so the log can never disagree with the
 * data: either both land or neither does.
 *
 * `seq` is Dexie's auto-increment key, giving a total order of local
 * mutations — a deterministic replay order per device. It is explicitly NOT a
 * global clock: ordering events across devices is the reconciler's job, which
 * is why each entry also carries the LWW `tick` of the mutation itself.
 *
 * Field NAMES are recorded, never values. The log is an audit trail, not a
 * second copy of the database — storing old values would quietly resurrect
 * content a user soft-deleted, and would double the storage cost of every
 * edit on a device where storage is the scarce resource.
 */

import { db } from "@/db/dexie";
import { nowIso, uuid } from "@/lib/id";
import { getCurrentUserId } from "@/lib/session";
import type { EventAction, EventEntity, LocalEvent } from "@/lib/types";

/**
 * Cap on retained entries, enforced by `pruneEvents()`. Local-first means the
 * device owns this data indefinitely, so the log needs a ceiling or it grows
 * without bound. Only already-synced entries are eligible for pruning.
 */
export const MAX_RETAINED_EVENTS = 5000;

export interface EventInput {
  entity: EventEntity;
  entity_id: string;
  action: EventAction;
  /** Field names touched. Empty for creates/deletes, where the action says it. */
  fields?: string[];
  /** LWW tick of the mutation, so the entry can be lined up against the row. */
  tick: number;
}

/** Build an entry without writing it — shared by both append paths below. */
function buildEvent(input: EventInput): LocalEvent {
  return {
    id: uuid(),
    entity: input.entity,
    entity_id: input.entity_id,
    action: input.action,
    fields: input.fields ?? [],
    actor_id: getCurrentUserId(),
    at: nowIso(),
    tick: input.tick,
    _synced: 0,
  };
}

/**
 * Append entries to the log.
 *
 * Call this from INSIDE the caller's existing Dexie transaction (with
 * `db.events` among its tables) so the log commits atomically with the
 * mutation. Dexie scopes transactions per async context, so simply awaiting
 * this within `db.transaction(...)` joins it rather than starting a new one.
 */
export async function recordEvents(inputs: EventInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await db.events.bulkAdd(inputs.map(buildEvent));
}

/** Convenience for the single-mutation case. */
export async function recordEvent(input: EventInput): Promise<void> {
  await recordEvents([input]);
}

/**
 * Audit trail for one row, oldest first.
 *
 * Uses the `[entity+entity_id]` compound index: ids are UUIDs and so unique in
 * practice, but scoping by entity keeps the query honest and lets the index
 * serve per-table reads later without a schema change.
 */
export async function eventsForEntity(
  entity: EventEntity,
  entityId: string,
): Promise<LocalEvent[]> {
  const rows = await db.events
    .where("[entity+entity_id]")
    .equals([entity, entityId])
    .toArray();
  return rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

/** Most recent entries first — the shape an activity feed wants. */
export async function recentEvents(limit = 50): Promise<LocalEvent[]> {
  const rows = await db.events.orderBy("seq").reverse().limit(limit).toArray();
  return rows;
}

/**
 * The ordered backlog an event-sourced sync would ship, oldest first.
 *
 * Nothing consumes this yet — `sync.ts` still reconciles whole rows by LWW.
 * It is the seam: a server that wants mutations rather than end states can be
 * added without touching a single write path.
 */
export async function unsyncedEvents(limit = 500): Promise<LocalEvent[]> {
  const rows = await db.events.where("_synced").equals(0).toArray();
  return rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).slice(0, limit);
}

/** Mark shipped entries, so the next backlog read skips them. */
export async function markEventsSynced(seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  await db.transaction("rw", db.events, async () => {
    for (const seq of seqs) {
      await db.events.update(seq, { _synced: 1 } as Partial<LocalEvent>);
    }
  });
}

/**
 * Trim the log to `keep` entries, oldest first, and return how many went.
 *
 * Only synced entries are eligible: an unsynced entry is still owed to a
 * server, and dropping it would lose a mutation. That means a device that is
 * offline for a long time keeps everything — which is the correct trade, since
 * the alternative is silent data loss.
 */
export async function pruneEvents(keep = MAX_RETAINED_EVENTS): Promise<number> {
  return db.transaction("rw", db.events, async () => {
    const total = await db.events.count();
    if (total <= keep) return 0;

    const synced = await db.events.where("_synced").equals(1).toArray();
    synced.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

    const overBy = total - keep;
    const doomed = synced.slice(0, overBy).map((e) => e.seq!);
    if (doomed.length === 0) return 0;

    await db.events.bulkDelete(doomed);
    return doomed.length;
  });
}
