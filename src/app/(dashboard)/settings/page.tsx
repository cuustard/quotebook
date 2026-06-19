"use client";

import Link from "next/link";
import { useState } from "react";
import { downloadBackup } from "@/lib/export";
import { isSupabaseConfigured } from "@/lib/supabase";
import { syncNow } from "@/lib/sync";
import { useAuthStore } from "@/store/useAuthStore";
import { useSyncStore } from "@/store/useSyncStore";

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const pending = useSyncStore((s) => s.pendingCount);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadBackup();
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
      <h1 className="font-serif text-3xl font-semibold text-ink">Settings</h1>

      {/* Account */}
      <Section title="Account">
        {user ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink">{user.email}</p>
              <p className="text-xs text-ink-muted">Your quotes sync across devices.</p>
            </div>
            <button onClick={() => signOut()} className="qb-btn-ghost border border-black/10">Sign out</button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink">Guest</p>
              <p className="text-xs text-ink-muted">
                {isSupabaseConfigured
                  ? "Secure an account to back up and sync your data."
                  : "Running locally — no backend configured."}
              </p>
            </div>
            {isSupabaseConfigured && (
              <Link href="/signup" className="qb-btn-primary">Secure Account</Link>
            )}
          </div>
        )}
      </Section>

      {/* Sync */}
      {isSupabaseConfigured && (
        <Section title="Sync">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <p className="font-medium text-ink capitalize">{status}</p>
              <p className="text-xs text-ink-muted">
                {pending > 0 ? `${pending} change(s) pending · ` : ""}
                {lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : "Not synced yet"}
              </p>
            </div>
            <button onClick={() => syncNow()} className="qb-btn-ghost border border-black/10">Sync now</button>
          </div>
        </Section>
      )}

      {/* Data portability */}
      <Section title="Data portability">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-ink-muted">
            Download a clean JSON snapshot of every quotebook stored on this device — yours to keep.
          </p>
          <button onClick={handleExport} disabled={exporting} className="qb-btn-primary shrink-0">
            {exporting ? "Preparing…" : "Export JSON"}
          </button>
        </div>
      </Section>

      <p className="mt-8 text-center text-xs text-ink-muted/70">
        Quotebook — local-first. Your data lives on your device and only syncs when you choose to.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">{title}</h2>
      <div className="qb-card p-4">{children}</div>
    </section>
  );
}
