"use client";

import { cn } from "@/lib/cn";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSyncStore } from "@/store/useSyncStore";

/** Compact live badge reflecting the background sync engine state. */
export function SyncIndicator() {
  const status = useSyncStore((s) => s.status);
  const pending = useSyncStore((s) => s.pendingCount);
  const online = useSyncStore((s) => s.online);

  // In pure guest/offline-only mode there's nothing to sync — say so plainly.
  if (!isSupabaseConfigured) {
    return (
      <span className="qb-chip bg-black/5 text-ink-muted" title="Stored locally on this device">
        <Dot className="bg-ink-muted" /> Local only
      </span>
    );
  }

  const map: Record<string, { label: string; dot: string; cls: string }> = {
    idle: { label: "Synced", dot: "bg-emerald-500", cls: "bg-emerald-50 text-emerald-700" },
    syncing: { label: "Syncing…", dot: "bg-amber-500 animate-pulse", cls: "bg-amber-50 text-amber-700" },
    offline: { label: "Offline", dot: "bg-ink-muted", cls: "bg-black/5 text-ink-muted" },
    error: { label: "Sync error", dot: "bg-red-500", cls: "bg-red-50 text-red-700" },
    disabled: { label: "Guest (local)", dot: "bg-ink-muted", cls: "bg-black/5 text-ink-muted" },
  };
  const s = map[online ? status : "offline"] ?? map.idle;

  return (
    <span className={cn("qb-chip", s.cls)} title={`${pending} change(s) pending`}>
      <Dot className={s.dot} />
      {s.label}
      {pending > 0 && status !== "idle" ? ` · ${pending}` : ""}
    </span>
  );
}

function Dot({ className }: { className?: string }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full", className)} />;
}
