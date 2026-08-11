/**
 * Auth helpers + the guest → account data migration.
 *
 * Anonymous users accumulate data locally with `owner_id` / `created_by` left
 * null. The moment they secure an account we "claim" that local data by
 * stamping their new user id onto it and marking it dirty, so the very next
 * sync pass pushes their notebook to Supabase — a seamless hand-off.
 */

import { db } from "@/db/dexie";
import { nowIso, tick, tickToIso, uuid } from "@/lib/id";

/**
 * Assign ownership of all un-owned local records to `userId` and ensure the
 * matching membership rows exist. Idempotent: already-owned records are skipped.
 */
export async function claimLocalData(userId: string): Promise<void> {
  await db.transaction(
    "rw",
    db.quotebooks,
    db.quotes,
    db.members,
    async () => {
      const t = tick();
      const iso = tickToIso(t);

      // Quotebooks created as a guest.
      const books = await db.quotebooks.toArray();
      for (const book of books) {
        if (!book.owner_id) {
          await db.quotebooks.put({
            ...book,
            owner_id: userId,
            field_updated_at: { ...book.field_updated_at, owner_id: t },
            updated_at: iso,
            _dirty: 1,
          });
        }
        // Make sure the owner has a membership row (needed for RLS reads).
        const member = await db.members
          .where("[quotebook_id+user_id]")
          .equals([book.id, userId])
          .first();
        if (!member) {
          await db.members.put({
            id: uuid(),
            quotebook_id: book.id,
            user_id: userId,
            joined_at: nowIso(),
            _dirty: 1,
          });
        }
      }

      // Quotes typed as a guest.
      const quotes = await db.quotes.toArray();
      for (const q of quotes) {
        if (!q.created_by) {
          await db.quotes.put({
            ...q,
            created_by: userId,
            field_updated_at: { ...q.field_updated_at, created_by: t },
            updated_at: iso,
            _dirty: 1,
          });
        }
      }
    },
  );
}
