"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

export default function LoginPage() {
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) setError(error);
    else router.push("/");
  };

  return (
    <div>
      <h1 className="mb-1 font-serif text-2xl font-semibold">Welcome back</h1>
      <p className="mb-5 text-sm text-ink-muted">Sign in to sync your quotebooks.</p>

      {!isSupabaseConfigured && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Supabase isn't configured, so accounts are disabled. You can still use Quotebook as a guest.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input className="qb-input" type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="qb-input" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy || !isSupabaseConfigured} className="qb-btn-primary">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between text-sm">
        <Link href="/signup" className="text-accent hover:underline">Create account</Link>
        <Link href="/reset-password" className="text-ink-muted hover:text-ink">Forgot password?</Link>
      </div>
    </div>
  );
}
