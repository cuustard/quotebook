/**
 * Supabase browser client.
 *
 * Quotebook is local-first: if these env vars are absent the whole app still
 * works in guest mode (Dexie only). Consumers must therefore treat the client
 * as optional and check `isSupabaseConfigured` before using it.
 *
 * Key naming: Supabase replaced the `anon` JWT with a *publishable* key
 * (`sb_publishable_…`). Legacy anon keys still work but are deprecated, so
 * either is accepted — the publishable key wins when both are set. Both are
 * referenced literally because Next.js inlines `process.env.NEXT_PUBLIC_*` at
 * build time and can't resolve a computed lookup.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const legacyAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const apiKey = publishableKey || legacyAnonKey;

export const isSupabaseConfigured = Boolean(url && apiKey);

/**
 * Lazily-created singleton. Returns `null` when Supabase is not configured so
 * callers degrade gracefully to offline/guest behaviour.
 */
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!_client) {
    _client = createClient(url as string, apiKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    // Dev-only debugging handle. Exposes the *same* client the app uses, so
    // console probes exercise the real auth path rather than a hand-rolled
    // fetch with different headers. Never present in a production build.
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>).__supabase = _client;
    }
  }
  return _client;
}
