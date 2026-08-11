/**
 * Auth store. Wraps Supabase email/password auth and keeps the rest of the app
 * in sync: it pushes the current user id into `session.ts`, claims local guest
 * data on first sign-in, and kicks the sync engine.
 *
 * In guest mode (no Supabase config, or simply not signed in) everything still
 * works — the app reads/writes Dexie and `mode` stays "guest".
 *
 * Leaving an account (sign-out or account switch) PURGES the local mirror:
 * on a shared browser the previous user's quotes must not linger, and stale
 * pull cursors would otherwise hide the next account's history entirely.
 */

import { create } from "zustand";
import { resetLocalData } from "@/db/dexie";
import { claimLocalData } from "@/lib/auth";
import { ensurePrivateQuotebook } from "@/lib/repo";
import { setCurrentUserId } from "@/lib/session";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { restartRealtime, syncNow } from "@/lib/sync";
import { useSyncStore } from "@/store/useSyncStore";

export interface AuthUser {
  id: string;
  email: string | null;
}

interface AuthState {
  user: AuthUser | null;
  ready: boolean; // initial session resolved
  mode: "guest" | "authed";
  error: string | null;

  init: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ error?: string }>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  updatePassword: (password: string) => Promise<{ error?: string }>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Live onAuthStateChange listener, so a re-init can replace rather than stack. */
let authSubscription: { unsubscribe: () => void } | null = null;

/** Shared side-effects whenever the active user changes. */
async function onUserChange(
  next: AuthUser | null,
  prev: AuthUser | null,
): Promise<void> {
  // Leaving an account: purge its local mirror + pull cursors first.
  if (prev && prev.id !== next?.id) {
    await resetLocalData();
  }

  setCurrentUserId(next?.id ?? null);
  // Presence label: the email's local part identifies a collaborator well
  // enough without broadcasting the full address over the realtime channel.
  useSyncStore
    .getState()
    .setMyLabel(next?.email ? next.email.split("@")[0] : "A guest");

  if (next) {
    await claimLocalData(next.id); // seamless guest → account hand-off
    restartRealtime();
    // First pull BEFORE anything decides whether a private book must be
    // created — otherwise a fresh device would mint a duplicate. Bounded so
    // a dead network can't hang sign-in; the periodic engine catches up.
    await Promise.race([syncNow(), sleep(8000)]);
    await ensurePrivateQuotebook();
  } else {
    useSyncStore.getState().setStatus("disabled");
    if (prev) {
      // Post-purge guest session needs its anchored private book back.
      await ensurePrivateQuotebook();
    }
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  mode: "guest",
  error: null,

  init: async () => {
    const supabase = getSupabase();
    if (!isSupabaseConfigured || !supabase) {
      set({ ready: true, mode: "guest" });
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user
      ? { id: session.user.id, email: session.user.email ?? null }
      : null;
    await onUserChange(user, null);
    set({ user, mode: user ? "authed" : "guest", ready: true });

    // React to future auth events (token refresh, sign-out from another tab…).
    // Drop any previous listener first: init() is guarded to run once by the
    // Providers boot promise, but a second call must not leave two live
    // subscriptions both driving onUserChange.
    authSubscription?.unsubscribe();
    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      const next = nextSession?.user
        ? { id: nextSession.user.id, email: nextSession.user.email ?? null }
        : null;
      const prev = get().user;
      if (next?.id !== prev?.id) {
        await onUserChange(next, prev);
        set({ user: next, mode: next ? "authed" : "guest" });
      }
    });
    authSubscription = authListener.subscription;
  },

  signUp: async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) return { error: "Sync backend not configured." };
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      set({ error: error.message });
      return { error: error.message };
    }
    const user = data.user
      ? { id: data.user.id, email: data.user.email ?? null }
      : null;
    if (data.session && user) {
      await onUserChange(user, get().user);
      set({ user, mode: "authed", error: null });
    }
    return {};
  },

  signIn: async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) return { error: "Sync backend not configured." };
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      set({ error: error.message });
      return { error: error.message };
    }
    const user = data.user
      ? { id: data.user.id, email: data.user.email ?? null }
      : null;
    await onUserChange(user, get().user);
    set({ user, mode: user ? "authed" : "guest", error: null });
    return {};
  },

  signOut: async () => {
    // Signing out wipes this device's local mirror — warn if any of it never
    // reached Supabase.
    const pending = useSyncStore.getState().pendingCount;
    if (
      pending > 0 &&
      typeof window !== "undefined" &&
      !window.confirm(
        `${pending} change(s) haven't synced yet and will be removed from this device. Sign out anyway?`,
      )
    ) {
      return;
    }
    const prev = get().user;
    const supabase = getSupabase();
    await supabase?.auth.signOut();
    await onUserChange(null, prev);
    set({ user: null, mode: "guest" });
  },

  resetPassword: async (email) => {
    const supabase = getSupabase();
    if (!supabase) return { error: "Sync backend not configured." };
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/reset-password`
        : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    return error ? { error: error.message } : {};
  },

  updatePassword: async (password) => {
    const supabase = getSupabase();
    if (!supabase) return { error: "Sync backend not configured." };
    const { error } = await supabase.auth.updateUser({ password });
    return error ? { error: error.message } : {};
  },
}));
