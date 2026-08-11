/**
 * Invite codes for collaborative quotebooks.
 *
 * Invites are inherently an online operation (you can't share a code with
 * someone who is offline), so unlike quotes they talk to Supabase directly
 * rather than going through the offline Dexie sync loop.
 */

import { db } from "@/db/dexie";
import { inviteCode, nowIso, uuid } from "@/lib/id";
import { getCurrentUserId } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";
import { requestSync } from "@/lib/sync";
import type { InviteCode } from "@/lib/types";

/** Default invite lifetime: 24 hours, per the MVP spec. */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export async function generateInvite(
  quotebookId: string,
  ttlMs = INVITE_TTL_MS,
): Promise<InviteCode> {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  if (!supabase || !userId) {
    throw new Error("Sign in to create invite codes.");
  }

  const invite: InviteCode = {
    id: uuid(),
    quotebook_id: quotebookId,
    code: inviteCode(),
    created_by: userId,
    expires_at: new Date(Date.now() + ttlMs).toISOString(),
    created_at: nowIso(),
  };

  const { error } = await supabase.from("invite_codes").insert(invite);
  if (error) throw error;
  await db.invites.put(invite); // cache locally for the manage screen
  return invite;
}

export async function listInvites(quotebookId: string): Promise<InviteCode[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("invite_codes")
    .select("*")
    .eq("quotebook_id", quotebookId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Garbage-collect expired codes while we're here (best-effort) and only
  // surface the live ones.
  const now = Date.now();
  const all = (data ?? []) as InviteCode[];
  const expired = all.filter((i) => new Date(i.expires_at).getTime() < now);
  if (expired.length > 0) {
    void supabase
      .from("invite_codes")
      .delete()
      .in("id", expired.map((i) => i.id));
  }
  return all.filter((i) => new Date(i.expires_at).getTime() >= now);
}

export async function revokeInvite(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("invite_codes").delete().eq("id", id);
  if (error) throw error;
  await db.invites.delete(id);
}

/**
 * Redeem a code via the `redeem_invite` RPC, which validates the code and
 * expiry SERVER-side (RLS forbids clients from inserting themselves into
 * books they don't own). Returns the joined quotebook id.
 */
export async function redeemInvite(rawCode: string): Promise<string> {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  if (!supabase || !userId) {
    throw new Error("Sign in to join a quotebook.");
  }

  const { data, error } = await supabase.rpc("redeem_invite", {
    p_code: rawCode.trim().toUpperCase(),
  });
  if (error) throw new Error(error.message);

  requestSync(); // pull the newly-accessible book + its quotes into Dexie
  return data as string;
}
