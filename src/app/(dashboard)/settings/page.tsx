"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { downloadBackup } from "@/lib/export";
import { importBackupFile, type ImportResult } from "@/lib/import";
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
  const syncError = useSyncStore((s) => s.error);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    setProgress({ done: 0, total: 0 });
    try {
      const result = await importBackupFile(file, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setImportResult(result);
    } catch (e) {
      setImportResult({
        created: 0,
        skipped: 0,
        errors: [errorMessage(e, "Import failed.")],
        quotebookId: null,
        quotebookName: null,
      });
    } finally {
      setImporting(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadBackup();
    } catch (e) {
      setExportError(errorMessage(e, "Couldn't build the backup."));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
      <h1 className="font-heading text-3xl font-semibold text-ink">Settings</h1>

      {/* Account */}
      <Section title="Account">
        {user ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink">{user.email}</p>
              <p className="text-xs text-ink-muted">Your quotes sync across devices.</p>
            </div>
            <button onClick={() => signOut()} className="qb-btn-ghost border border-white/10">Sign out</button>
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
            <button onClick={() => syncNow()} className="qb-btn-ghost border border-white/10">Sync now</button>
          </div>
          {syncError && (
            <p className="mt-3 break-words rounded-lg bg-red-500/10 p-3 font-mono text-xs text-red-400">
              {syncError}
            </p>
          )}
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
        {exportError && <p className="mt-2 text-sm text-red-400">{exportError}</p>}

        <div className="mt-4 border-t border-white/[0.06] pt-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-ink-muted">
              Import a Quotebook backup, or a file produced by a migration
              script. Quotes already imported from the same file are skipped,
              so an interrupted import can be re-run safely.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className="qb-btn-ghost shrink-0 border border-white/10"
            >
              {importing ? "Importing…" : "Import JSON"}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />

          {progress && progress.total > 0 && (
            <p className="mt-2 text-sm text-ink-muted">
              {progress.done} / {progress.total}…
            </p>
          )}

          {importResult && (
            <div className="mt-2 text-sm">
              {importResult.created > 0 || importResult.skipped > 0 ? (
                <p className="text-emerald-400">
                  Imported {importResult.created} quote
                  {importResult.created === 1 ? "" : "s"}
                  {importResult.skipped > 0 && ` · ${importResult.skipped} already there`}
                  {importResult.quotebookName && ` → ${importResult.quotebookName}`}
                </p>
              ) : null}
              {importResult.errors.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-red-400">
                    {importResult.errors.length} problem
                    {importResult.errors.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-1 list-inside list-disc text-xs text-ink-muted">
                    {importResult.errors.slice(0, 10).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
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
