"use client";

import { cn } from "@/lib/cn";
import { findQuoteIssues, ISSUE_LABELS } from "@/lib/integrity";
import type { QuoteWithLines } from "@/lib/types";
import { useSyncStore } from "@/store/useSyncStore";

interface QuoteCardProps {
  quote: QuoteWithLines;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export function QuoteCard({ quote, onEdit, onDelete }: QuoteCardProps) {
  // Reactive soft-lock: re-renders when a collaborator starts/stops editing
  // (beacon updates and TTL pruning both mutate `editing`, which this
  // selector reads through lockedBy).
  const locked = useSyncStore((s) => s.lockedBy(quote.id));

  const when = formatWhen(quote.quote_date, quote.quote_time);
  const ago = relativeWhen(quote.quote_date, quote.quote_time);
  // Surfaced everywhere, not just under the filter — a half-recorded quote is
  // worth noticing whenever you happen to scroll past it.
  const issues = findQuoteIssues(quote);

  return (
    <article
      className={cn(
        "qb-card group flex gap-3 p-3 transition",
        locked && "ring-2 ring-amber-400/50",
        issues.length > 0 && !locked && "ring-1 ring-amber-400/40",
      )}
    >
      {/* Dialogue — read like a script: left-aligned cues with a uniform divider. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Stage direction for the whole exchange, before anyone speaks. */}
        {quote.quote_context && (
          <p className="text-[0.7rem] italic leading-snug text-ink-muted/70">
            {quote.quote_context}
          </p>
        )}
        {quote.lines.length === 0 && (
          <p className="text-sm italic leading-snug text-ink-muted/60">
            (no lines)
          </p>
        )}
        {quote.lines.map((line) => (
          <div key={line.id} className="grid grid-cols-[4rem_1fr] gap-x-2 sm:grid-cols-[5rem_1fr]">
            <span className="truncate pt-px font-semibold uppercase tracking-wide text-[0.7rem] leading-snug text-ink-muted">
              {line.speaker}
            </span>
            <div className="border-l border-white/10 pl-2.5">
              <p className="text-sm leading-snug text-ink">&ldquo;{line.line_text}&rdquo;</p>
              {line.line_context && (
                <p className="pl-2 text-[0.7rem] italic leading-snug text-ink-muted/60">
                  {line.line_context}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Right sidebar: timestamp on top; tags + actions at the bottom. */}
      <aside className="flex shrink-0 flex-col items-end gap-2">
        <div className="text-right text-[0.7rem] leading-tight text-ink-muted/80">
          <div>{when}</div>
          {ago && <div className="text-ink-muted/60">{ago}</div>}
        </div>

        {issues.length > 0 && (
          <button
            onClick={() => onEdit(quote.id)}
            title="Something mandatory is missing — click to fill it in"
            className="qb-chip bg-amber-500/10 text-[0.65rem] text-amber-300 hover:bg-amber-500/20"
          >
            ⚠ {issues.map((i) => ISSUE_LABELS[i]).join(" · ")}
          </button>
        )}

        <div className="mt-auto flex items-center gap-2">
          {locked ? (
            <span
              className="qb-chip bg-amber-500/10 text-[0.65rem] text-amber-300"
              title={`${locked.label} is editing…`}
            >
              ✎ editing…
            </span>
          ) : (
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <button
                onClick={() => onEdit(quote.id)}
                aria-label="Edit quote"
                title="Edit"
                className="rounded-md p-1.5 text-ink-muted/40 transition hover:bg-white/5 hover:text-ink"
              >
                <EditIcon />
              </button>
              <button
                onClick={() => onDelete(quote.id)}
                aria-label="Delete quote"
                title="Delete"
                className="rounded-md p-1.5 text-ink-muted/40 transition hover:bg-red-500/10 hover:text-red-400"
              >
                <TrashIcon />
              </button>
            </div>
          )}

          {quote.tags.length > 0 && (
            <div className="flex items-center gap-x-1.5 whitespace-nowrap text-[0.7rem] text-ink-muted/50">
              {quote.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          )}
        </div>
      </aside>
    </article>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function formatWhen(date: string, time: string): string {
  try {
    const d = new Date(`${date}T${time || "00:00"}:00`);
    const datePart = d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    return time ? `${datePart} · ${time}` : datePart;
  } catch {
    return date;
  }
}

/** Human "2 years and 3 months ago" style elapsed time since the quote. */
function relativeWhen(date: string, time: string): string {
  const then = new Date(`${date}T${time || "00:00"}:00`);
  if (Number.isNaN(then.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return "";

  // Whole calendar months elapsed (calendar-aware, not just /30 days).
  let months =
    (now.getFullYear() - then.getFullYear()) * 12 +
    (now.getMonth() - then.getMonth());
  if (now.getDate() < then.getDate()) months -= 1;

  if (months >= 1) {
    const years = Math.floor(months / 12);
    const rem = months % 12;
    const parts: string[] = [];
    if (years) parts.push(`${years} year${years > 1 ? "s" : ""}`);
    if (rem) parts.push(`${rem} month${rem > 1 ? "s" : ""}`);
    return `${parts.join(" and ")} ago`;
  }

  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) return `${days} day${days > 1 ? "s" : ""} ago`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const mins = Math.floor(diffMs / 60_000);
  if (mins >= 1) return `${mins} minute${mins > 1 ? "s" : ""} ago`;
  return "just now";
}
