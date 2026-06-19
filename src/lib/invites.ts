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
  return (data ?? []) as InviteCode[];
}

export async function revokeInvite(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("invite_codes").delete().eq("id", id);
  await db.invites.delete(id);
}

/**
 * Redeem a code: validates it, joins the user to the book, and pulls the book's
 * data down via a sync pass. Returns the joined quotebook id.
 */
export async function redeemInvite(rawCode: string): Promise<string> {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  if (!supabase || !userId) {
    throw new Error("Sign in to join a quotebook.");
  }

  const code = rawCode.trim().toUpperCase();
  const { data: invite, error } = await supabase
    .from("invite_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (error) throw error;
  if (!invite) throw new Error("Invite code not found.");
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    throw new Error("This invite code has expired.");
  }

  // Flat permissions model: simply add the user as a member.
  const { error: joinError } = await supabase.from("quotebook_members").upsert(
    {
      id: uuid(),
      quotebook_id: invite.quotebook_id,
      user_id: userId,
      joined_at: nowIso(),
    },
    { onConflict: "quotebook_id,user_id" },
  );
  if (joinError) throw joinError;

  requestSync(); // pull the newly-accessible book + its quotes into Dexie
  return invite.quotebook_id as string;
}
