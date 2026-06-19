/**
 * Supabase browser client.
 *
 * Quotebook is local-first: if these env vars are absent the whole app still
 * works in guest mode (Dexie only). Consumers must therefore treat the client
 * as optional and check `isSupabaseConfigured` before using it.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Lazily-created singleton. Returns `null` when Supabase is not configured so
 * callers degrade gracefully to offline/guest behaviour.
 */
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!_client) {
    _client = createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return _client;
}
