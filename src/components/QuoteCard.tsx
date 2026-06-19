"use client";

import { cn } from "@/lib/cn";
import type { QuoteWithLines } from "@/lib/types";
import { useSyncStore } from "@/store/useSyncStore";

interface QuoteCardProps {
  quote: QuoteWithLines;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

const PALETTE = [
  "bg-accent-soft text-accent",
  "bg-emerald-50 text-emerald-700",
  "bg-sky-50 text-sky-700",
  "bg-violet-50 text-violet-700",
  "bg-amber-50 text-amber-700",
];

/** Deterministic colour per speaker so a person reads consistently. */
function speakerColor(speaker: string): string {
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) hash = (hash * 31 + speaker.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function QuoteCard({ quote, onEdit, onDelete }: QuoteCardProps) {
  // Reactive soft-lock: re-renders when a collaborator starts/stops editing.
  const beacon = useSyncStore((s) => s.editing[quote.id]);
  const myDeviceId = useSyncStore((s) => s.myDeviceId);
  const locked =
    beacon && beacon.deviceId !== myDeviceId && Date.now() - beacon.at < 30000
      ? beacon
      : null;

  const isDialogue = quote.lines.length > 1;
  const when = formatWhen(quote.quote_date, quote.quote_time);

  return (
    <article className={cn("qb-card p-4 transition", locked && "ring-2 ring-amber-300/60")}>
      {/* Header */}
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-base font-semibold text-ink">
            {quote.primary_quotee || "Untitled"}
          </h3>
          <p className="text-xs text-ink-muted">{when}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {locked ? (
            <span className="qb-chip bg-amber-50 text-amber-700" title="Locked while another person edits">
              ✎ {locked.label} is editing…
            </span>
          ) : (
            <>
              <button
                onClick={() => onEdit(quote.id)}
                className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-black/5 hover:text-ink"
              >
                Edit
              </button>
              <button
                onClick={() => onDelete(quote.id)}
                className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-red-50 hover:text-red-600"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </header>

      {/* Overarching context */}
      {quote.quote_context && (
        <p className="mb-3 border-l-2 border-black/10 pl-3 text-sm italic text-ink-muted">
          {quote.quote_context}
        </p>
      )}

      {/* Lines */}
      {isDialogue ? (
        <div className="flex flex-col gap-2">
          {quote.lines.map((line) => {
            const speaker = line.speaker || quote.primary_quotee;
            return (
              <div key={line.id} className="flex flex-col">
                <div className="flex items-baseline gap-2">
                  <span className={cn("qb-chip shrink-0", speakerColor(speaker))}>{speaker}</span>
                  <p className="text-sm text-ink">{line.line_text}</p>
                </div>
                {line.line_context && (
                  <p className="ml-1 mt-0.5 text-xs text-ink-muted/80">↳ {line.line_context}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <blockquote className="font-serif text-lg leading-snug text-ink">
          “{quote.lines[0]?.line_text}”
          {quote.lines[0]?.speaker && quote.lines[0].speaker !== quote.primary_quotee && (
            <footer className="mt-1 text-sm not-italic text-ink-muted">— {quote.lines[0].speaker}</footer>
          )}
          {quote.lines[0]?.line_context && (
            <p className="mt-1 text-xs italic text-ink-muted/80">↳ {quote.lines[0].line_context}</p>
          )}
        </blockquote>
      )}

      {/* Tags */}
      {quote.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {quote.tags.map((t) => (
            <span key={t} className="qb-chip bg-black/5 text-ink-muted">#{t}</span>
          ))}
        </div>
      )}
    </article>
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
