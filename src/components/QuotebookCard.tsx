"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import type { Quotebook } from "@/lib/types";

interface QuotebookCardProps {
  book: Quotebook;
  quoteCount: number;
  memberCount: number;
  lastActivity: string | null;
  primary?: boolean;
}

export function QuotebookCard({
  book,
  quoteCount,
  memberCount,
  lastActivity,
  primary,
}: QuotebookCardProps) {
  return (
    <Link
      href={`/quotebook/${book.id}`}
      className={cn(
        "qb-card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-md",
        primary && "border-accent/30 bg-gradient-to-br from-accent-soft/60 to-paper-raised",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <span
          className={cn(
            "grid h-10 w-10 place-items-center rounded-xl font-heading text-lg font-bold",
            primary ? "bg-accent text-white" : "bg-white/5 text-ink",
          )}
        >
          {book.name.charAt(0).toUpperCase() || "Q"}
        </span>
        <span
          className={cn(
            "qb-chip",
            book.is_private ? "bg-white/5 text-ink-muted" : "bg-emerald-500/10 text-emerald-400",
          )}
        >
          {book.is_private ? "Private" : "Collaborative"}
        </span>
      </div>

      <h3 className="font-heading text-lg font-semibold text-ink group-hover:text-accent">
        {book.name}
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span>{quoteCount} quote{quoteCount === 1 ? "" : "s"}</span>
        {!book.is_private && (
          <span>· {memberCount} member{memberCount === 1 ? "" : "s"}</span>
        )}
        {lastActivity && <span>· {lastActivity}</span>}
      </div>
    </Link>
  );
}
