"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

/**
 * Dual-mode page:
 *  - default: request a reset email.
 *  - recovery: when the user arrives from the emailed link, Supabase emits a
 *    PASSWORD_RECOVERY event and we show a "set new password" form.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const updatePassword = useAuthStore((s) => s.updatePassword);

  const [recovery, setRecovery] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await resetPassword(email);
    setBusy(false);
    setMsg(error ? { ok: false, text: error } : { ok: true, text: "Reset link sent — check your email." });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setMsg({ ok: false, text: "Password must be at least 6 characters." });
      return;
    }
    setBusy(true);
    const { error } = await updatePassword(password);
    setBusy(false);
    if (error) setMsg({ ok: false, text: error });
    else {
      setMsg({ ok: true, text: "Password updated. Redirecting…" });
      setTimeout(() => router.push("/"), 800);
    }
  };

  return (
    <div>
      <h1 className="mb-1 font-serif text-2xl font-semibold">
        {recovery ? "Set a new password" : "Reset password"}
      </h1>
      <p className="mb-5 text-sm text-ink-muted">
        {recovery ? "Choose a new password for your account." : "We'll email you a recovery link."}
      </p>

      {!isSupabaseConfigured && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Supabase isn't configured, so password recovery is unavailable.
        </p>
      )}

      {recovery ? (
        <form onSubmit={handleUpdate} className="flex flex-col gap-3">
          <input className="qb-input" type="password" placeholder="New password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="submit" disabled={busy} className="qb-btn-primary">{busy ? "Updating…" : "Update password"}</button>
        </form>
      ) : (
        <form onSubmit={handleRequest} className="flex flex-col gap-3">
          <input className="qb-input" type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit" disabled={busy || !isSupabaseConfigured} className="qb-btn-primary">{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      )}

      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}

      <p className="mt-4 text-sm text-ink-muted">
        <Link href="/login" className="text-accent hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}
