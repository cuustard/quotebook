"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

export default function SignupPage() {
  const router = useRouter();
  const signUp = useAuthStore((s) => s.signUp);
  const user = useAuthStore((s) => s.user);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    const { error } = await signUp(email, password);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    // If a session was established immediately we're signed in; otherwise the
    // project requires email confirmation.
    if (useAuthStore.getState().user) router.push("/");
    else setNeedsConfirm(true);
  };

  if (needsConfirm && !user) {
    return (
      <div>
        <h1 className="mb-2 font-heading text-2xl font-semibold">Check your inbox</h1>
        <p className="text-sm text-ink-muted">
          We sent a confirmation link to <span className="font-medium text-ink">{email}</span>. Confirm it,
          then sign in — your guest quotes will migrate automatically.
        </p>
        <Link href="/login" className="qb-btn-primary mt-5 w-full">Back to sign in</Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 font-heading text-2xl font-semibold">Secure your account</h1>
      <p className="mb-5 text-sm text-ink-muted">
        Your existing guest quotes will migrate seamlessly when you sign up.
      </p>

      {!isSupabaseConfigured && (
        <p className="mb-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
          Supabase isn&apos;t configured, so accounts are disabled. Quotebook still works fully as a guest.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input className="qb-input" type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="qb-input" type="password" placeholder="Password (min 6 chars)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={busy || !isSupabaseConfigured} className="qb-btn-primary">
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
