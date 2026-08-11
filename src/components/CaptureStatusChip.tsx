"use client";

import { cn } from "@/lib/cn";
import type { CaptureStatus } from "@/lib/types";

const MAP: Record<CaptureStatus, { label: string; dot: string; cls: string }> = {
  pending: { label: "To convert", dot: "bg-amber-500", cls: "bg-amber-500/10 text-amber-300" },
  parsing: { label: "Parsing…", dot: "bg-sky-500 animate-pulse", cls: "bg-sky-500/10 text-sky-400" },
  parsed: { label: "Review", dot: "bg-emerald-500", cls: "bg-emerald-500/10 text-emerald-400" },
  failed: { label: "Needs attention", dot: "bg-red-500", cls: "bg-red-500/10 text-red-400" },
  done: { label: "Done", dot: "bg-ink-muted", cls: "bg-white/5 text-ink-muted" },
};

/** Compact badge for a capture's lifecycle state (Quick Add + Inbox). */
export function CaptureStatusChip({ status }: { status: CaptureStatus }) {
  const s = MAP[status];
  return (
    <span className={cn("qb-chip text-[0.65rem]", s.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}
