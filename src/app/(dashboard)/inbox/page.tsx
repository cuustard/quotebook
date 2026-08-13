"use client";

/**
 * Inbox — the capture review queue.
 *
 * Shows every capture that isn't reviewed yet:
 *   - "pending" / "failed": convert manually via the QuoteModal (prefilled
 *     with the raw text; works fully offline).
 *   - "parsed" (Phase 1): the AI already created a quote — confirm or edit it.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/dexie";
import {
  completeCapture,
  deleteCapture,
  INBOX_STATUSES,
  isQuickAddAIEnabled,
  retryCapture,
} from "@/lib/captures";
import { pickPrivateBook } from "@/lib/repo";
import { CaptureStatusChip } from "@/components/CaptureStatusChip";
import { SwipeableRow } from "@/components/SwipeableRow";
import { useAuthStore } from "@/store/useAuthStore";
import { useUIStore } from "@/store/useUIStore";
import type { Capture } from "@/lib/types";

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function InboxPage() {
  const user = useAuthStore((s) => s.user);
  const openConvertCapture = useUIStore((s) => s.openConvertCapture);

  const captures =
    useLiveQuery(
      async () =>
        (await db.captures.where("status").anyOf([...INBOX_STATUSES]).toArray())
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
      [],
    ) ?? [];
  const booksRaw = useLiveQuery(
    async () => (await db.quotebooks.toArray()).filter((b) => !b.deleted),
    [],
  );
  const books = useMemo(() => booksRaw ?? [], [booksRaw]);

  const bookName = useMemo(() => {
    const map = new Map(books.map((b) => [b.id, b.name]));
    return (id: string) => map.get(id) ?? "(deleted book)";
  }, [books]);

  const handleConvert = (capture: Capture) => {
    // If the capture's book was deleted since, fall back to the private book.
    const target = books.some((b) => b.id === capture.quotebook_id)
      ? capture.quotebook_id
      : pickPrivateBook(books, user?.id ?? null)?.id;
    if (!target) return;
    openConvertCapture(target, {
      id: capture.id,
      text: capture.text,
      created_at: capture.created_at,
    });
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <h1 className="font-heading text-3xl font-semibold text-ink">Inbox</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Raw captures from{" "}
        <Link href="/quick" className="text-accent hover:underline">
          Quick Add
        </Link>
        , waiting to become quotes.
      </p>

      {captures.length === 0 ? (
        <div className="qb-card mt-6 flex flex-col items-center gap-3 p-10 text-center">
          <p className="font-heading text-lg text-ink">Inbox zero</p>
          <p className="max-w-sm text-sm text-ink-muted">
            Nothing waiting. Capture a thought in Quick Add and it will show up
            here.
          </p>
          <Link href="/quick" className="qb-btn-primary mt-1">
            + Quick Add
          </Link>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {captures.map((c) => (
            /* Swipe is additive triage for touch: right commits the card's own
               affirmative action (confirm a parsed capture, otherwise open the
               converter), left deletes — the same two things the buttons below
               already do. On desktop the gesture cannot fire at all, so the
               buttons remain the only route. */
            <SwipeableRow
              key={c.id}
              rightLabel={c.status === "parsed" && c.quote_id ? "Confirm" : "Convert"}
              leftLabel="Delete"
              onSwipeRight={() =>
                c.status === "parsed" && c.quote_id
                  ? void completeCapture(c.id)
                  : handleConvert(c)
              }
              onSwipeLeft={() => void deleteCapture(c.id)}
            >
            <article className="qb-card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 whitespace-pre-wrap text-sm leading-snug text-ink">
                  {c.text}
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  {c.status === "parsed" && c.confidence === "low" && (
                    <span
                      className="qb-chip bg-amber-500/10 text-[0.65rem] text-amber-300"
                      title="The AI wasn't sure about this one — check the quotee, timing and wording."
                    >
                      ⚠ Check closely
                    </span>
                  )}
                  <CaptureStatusChip status={c.status} />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-muted/80">
                  {bookName(c.quotebook_id)} · {timeAgo(c.created_at)}
                  {c.status === "failed" && c.error && (
                    <span className="ml-2 text-red-400">{c.error}</span>
                  )}
                </p>
                <div className="flex items-center gap-1.5">
                  {c.status === "parsed" && c.quote_id ? (
                    <>
                      <Link
                        href={`/quotebook/${c.quotebook_id}`}
                        className="qb-btn-ghost border border-white/10 px-3 py-1.5 text-xs"
                      >
                        View quote
                      </Link>
                      <button
                        onClick={() => void completeCapture(c.id)}
                        className="qb-btn-primary px-3 py-1.5 text-xs"
                      >
                        Confirm
                      </button>
                    </>
                  ) : (
                    c.status !== "parsing" && (
                      <>
                        {c.status === "failed" && isQuickAddAIEnabled && (
                          <button
                            onClick={() => void retryCapture(c.id)}
                            className="qb-btn-ghost border border-white/10 px-3 py-1.5 text-xs"
                          >
                            Retry AI
                          </button>
                        )}
                        <button
                          onClick={() => handleConvert(c)}
                          className="qb-btn-primary px-3 py-1.5 text-xs"
                        >
                          Convert to quote
                        </button>
                      </>
                    )
                  )}
                  <button
                    onClick={() => void deleteCapture(c.id)}
                    className="qb-btn-ghost px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
            </SwipeableRow>
          ))}
        </div>
      )}
    </div>
  );
}
