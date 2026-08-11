"use client";

import { cn } from "@/lib/cn";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSyncStore } from "@/store/useSyncStore";

/** Compact live badge reflecting the background sync engine state. */
export function SyncIndicator() {
  const status = useSyncStore((s) => s.status);
  const pending = useSyncStore((s) => s.pendingCount);
  const online = useSyncStore((s) => s.online);
  const error = useSyncStore((s) => s.error);

  // In pure guest/offline-only mode there's nothing to sync — say so plainly.
  if (!isSupabaseConfigured) {
    return (
      <span className="qb-chip bg-white/5 text-ink-muted" title="Stored locally on this device">
        <Dot className="bg-ink-muted" /> Local only
      </span>
    );
  }

  const map: Record<string, { label: string; dot: string; cls: string }> = {
    idle: { label: "Synced", dot: "bg-emerald-500", cls: "bg-emerald-500/10 text-emerald-400" },
    syncing: { label: "Syncing…", dot: "bg-amber-500 animate-pulse", cls: "bg-amber-500/10 text-amber-300" },
    offline: { label: "Offline", dot: "bg-ink-muted", cls: "bg-white/5 text-ink-muted" },
    error: { label: "Sync error", dot: "bg-red-500", cls: "bg-red-500/10 text-red-400" },
    disabled: { label: "Guest (local)", dot: "bg-ink-muted", cls: "bg-white/5 text-ink-muted" },
  };
  const s = map[online ? status : "offline"] ?? map.idle;

  return (
    <span
      className={cn("qb-chip", s.cls)}
      // Surface the reason on hover; the full text lives in Settings → Sync.
      title={error ? `${error}\n\n${pending} change(s) pending` : `${pending} change(s) pending`}
    >
      <Dot className={s.dot} />
      {s.label}
      {pending > 0 && status !== "idle" ? ` · ${pending}` : ""}
    </span>
  );
}

function Dot({ className }: { className?: string }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full", className)} />;
}
