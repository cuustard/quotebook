"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/dexie";
import { decodeFeedFilters, encodeFeedFilters } from "@/lib/feedUrl";
import { hasIssues } from "@/lib/integrity";
import { deleteQuote, getQuotesWithLines } from "@/lib/repo";
import { applyFeed, collectSpeakers, collectTags } from "@/lib/search";
import { type FeedFilters } from "@/lib/types";
import { FeedControls } from "@/components/FeedControls";
import { QuoteCard } from "@/components/QuoteCard";
import { useSyncStore } from "@/store/useSyncStore";
import { useUIStore } from "@/store/useUIStore";

/**
 * `useSearchParams` needs a Suspense boundary, and it's what lets the stats
 * page deep-link into a pre-filtered feed.
 */
export default function QuotebookFeedPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-muted">Loading…</div>}>
      <FeedPage bookId={params.id} />
    </Suspense>
  );
}

function FeedPage({ bookId }: { bookId: string }) {
  const openCreateQuote = useUIStore((s) => s.openCreateQuote);
  const openEditQuote = useUIStore((s) => s.openEditQuote);
  const joinBook = useSyncStore((s) => s.joinBook);
  const leaveBook = useSyncStore((s) => s.leaveBook);
  const lockedBy = useSyncStore((s) => s.lockedBy);

  // Seed from the URL so an incoming stats link arrives pre-filtered. After
  // mount the local state is authoritative — we push changes *to* the URL
  // rather than re-deriving from it, which would fight the user's typing.
  const searchParams = useSearchParams();
  const [filters, setFiltersState] = useState<FeedFilters>(() =>
    decodeFeedFilters(searchParams),
  );

  // Keep the address bar in step so any filtered view is shareable, using
  // replaceState so filter tweaks don't each become a back-button stop.
  const setFilters = useCallback(
    (next: FeedFilters) => {
      setFiltersState(next);
      if (typeof window === "undefined") return;
      const qs = encodeFeedFilters(next);
      window.history.replaceState(
        null,
        "",
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
      );
    },
    [],
  );

  // Re-render once a minute so each card's "x ago" label stays current without
  // a manual refresh. Minute granularity is plenty for these labels.
  const [, tickMinute] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tickMinute((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Live data straight from Dexie — instant + offline. Dexie resolves a
  // missing key to `undefined` (same as useLiveQuery's loading state), so map
  // it to `null` to make "not found" distinguishable from "loading".
  const book = useLiveQuery(
    async () => (await db.quotebooks.get(bookId)) ?? null,
    [bookId],
  );
  // Stable array identity while loading — `?? []` inline would mint a fresh
  // array every render, defeating both the useMemos below and the Fuse cache.
  const quotesRaw = useLiveQuery(() => getQuotesWithLines(bookId), [bookId]);
  const quotes = useMemo(() => quotesRaw ?? [], [quotesRaw]);
  const memberCount = useLiveQuery(
    () => db.members.where("quotebook_id").equals(bookId).count(),
    [bookId],
  );

  // Join the realtime presence channel for soft-lock coordination.
  useEffect(() => {
    void joinBook(bookId);
    return () => leaveBook();
  }, [bookId, joinBook, leaveBook]);

  const speakers = useMemo(() => collectSpeakers(quotes), [quotes]);
  const tags = useMemo(() => collectTags(quotes), [quotes]);
  // Counted across the whole book, not the filtered view, so the badge is a
  // stable "how much is left to fix" rather than a function of other filters.
  const incompleteCount = useMemo(() => quotes.filter(hasIssues).length, [quotes]);
  const visible = useMemo(() => applyFeed(quotes, filters), [quotes, filters]);

  const handleDelete = async (id: string) => {
    if (window.confirm("Delete this quote? This can't be undone.")) {
      await deleteQuote(id);
    }
  };

  if (book === undefined) {
    return <div className="p-8 text-sm text-ink-muted">Loading…</div>;
  }
  if (book === null || book.deleted) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="font-heading text-xl text-ink">Quotebook not found</p>
        <Link href="/" className="qb-btn-primary mt-4 inline-flex">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/" className="text-xs text-ink-muted hover:text-ink">← All spaces</Link>
          <h1 className="mt-1 font-heading text-2xl font-semibold text-ink">{book.name}</h1>
          <p className="text-xs text-ink-muted">
            {book.is_private ? "Private space" : `Collaborative · ${memberCount ?? 1} member(s)`}
            {" · "}
            {quotes.length} quote(s)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/quotebook/${bookId}/stats`}
            className="qb-btn-ghost border border-white/10"
          >
            Stats
          </Link>
          <button onClick={() => openCreateQuote(bookId)} className="qb-btn-primary">
            + New quote
          </button>
        </div>
      </div>

      {/* Controls (left) + feed (right). The controls column is sticky so
          sorting/filtering/search stays reachable down a long feed. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="lg:sticky lg:top-6 lg:w-72 lg:shrink-0">
          <FeedControls
            filters={filters}
            setFilters={setFilters}
            speakers={speakers}
            tags={tags}
            incompleteCount={incompleteCount}
            resultCount={visible.length}
            totalCount={quotes.length}
          />
        </div>

        <div className="min-w-0 flex-1">
          {visible.length === 0 ? (
            <div className="qb-card flex flex-col items-center gap-3 p-10 text-center">
              <p className="font-heading text-lg text-ink">
                {quotes.length === 0 ? "No quotes yet" : "No matches"}
              </p>
              <p className="max-w-sm text-sm text-ink-muted">
                {quotes.length === 0
                  ? "Capture the first thing worth remembering — a one-liner or a whole conversation."
                  : "Try loosening your filters or search terms."}
              </p>
              {quotes.length === 0 && (
                <button onClick={() => openCreateQuote(bookId)} className="qb-btn-primary mt-1">
                  + Add a quote
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {visible.map((quote) => (
                <QuoteCard
                  key={quote.id}
                  quote={quote}
                  // Enforce the soft-lock at the entry point too — the card hides
                  // its edit button while locked, but don't rely on that alone.
                  onEdit={(id) => {
                    if (!lockedBy(id)) openEditQuote(bookId, id);
                  }}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
