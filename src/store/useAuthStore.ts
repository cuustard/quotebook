/**
 * Auth store. Wraps Supabase email/password auth and keeps the rest of the app
 * in sync: it pushes the current user id into `session.ts`, claims local guest
 * data on first sign-in, and kicks the sync engine.
 *
 * In guest mode (no Supabase config, or simply not signed in) everything still
 * works — the app reads/writes Dexie and `mode` stays "guest".
 */

import { create } from "zustand";
import { claimLocalData } from "@/lib/auth";
import { setCurrentUserId } from "@/lib/session";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { requestSync, restartRealtime } from "@/lib/sync";
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

/** Shared side-effects whenever the active user changes. */
async function onUserChange(user: AuthUser | null): Promise<void> {
  setCurrentUserId(user?.id ?? null);
  useSyncStore.getState().setMyLabel(user?.email ?? "A guest");

  if (user) {
    await claimLocalData(user.id); // seamless guest → account hand-off
    restartRealtime();
    requestSync();
  } else {
    useSyncStore.getState().setStatus("disabled");
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
    await onUserChange(user);
    set({ user, mode: user ? "authed" : "guest", ready: true });

    // React to future auth events (token refresh, sign-out from another tab…).
    supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      const next = nextSession?.user
        ? { id: nextSession.user.id, email: nextSession.user.email ?? null }
        : null;
      if (next?.id !== get().user?.id) {
        await onUserChange(next);
        set({ user: next, mode: next ? "authed" : "guest" });
      }
    });
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
      await onUserChange(user);
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
    await onUserChange(user);
    set({ user, mode: "authed", error: null });
    return {};
  },

  signOut: async () => {
    const supabase = getSupabase();
    await supabase?.auth.signOut();
    await onUserChange(null);
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
