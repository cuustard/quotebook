"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/dexie";
import { deleteQuote, getQuotesWithLines } from "@/lib/repo";
import { applyFeed, collectSpeakers, collectTags } from "@/lib/search";
import { DEFAULT_FILTERS, type FeedFilters } from "@/lib/types";
import { FeedControls } from "@/components/FeedControls";
import { QuoteCard } from "@/components/QuoteCard";
import { useSyncStore } from "@/store/useSyncStore";
import { useUIStore } from "@/store/useUIStore";

export default function QuotebookFeedPage({ params }: { params: { id: string } }) {
  const bookId = params.id;
  const openCreateQuote = useUIStore((s) => s.openCreateQuote);
  const openEditQuote = useUIStore((s) => s.openEditQuote);
  const joinBook = useSyncStore((s) => s.joinBook);
  const leaveBook = useSyncStore((s) => s.leaveBook);

  const [filters, setFilters] = useState<FeedFilters>(DEFAULT_FILTERS);

  // Live data straight from Dexie — instant + offline.
  const book = useLiveQuery(() => db.quotebooks.get(bookId), [bookId]);
  const quotes = useLiveQuery(() => getQuotesWithLines(bookId), [bookId]) ?? [];
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
        <p className="font-serif text-xl text-ink">Quotebook not found</p>
        <Link href="/" className="qb-btn-primary mt-4 inline-flex">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/" className="text-xs text-ink-muted hover:text-ink">← All spaces</Link>
          <h1 className="mt-1 font-serif text-2xl font-semibold text-ink">{book.name}</h1>
          <p className="text-xs text-ink-muted">
            {book.is_private ? "Private space" : `Collaborative · ${memberCount ?? 1} member(s)`}
            {" · "}
            {quotes.length} quote(s)
          </p>
        </div>
        <button onClick={() => openCreateQuote(bookId)} className="qb-btn-primary">
          + New quote
        </button>
      </div>

      {/* Controls */}
      <div className="mb-6">
        <FeedControls filters={filters} setFilters={setFilters} speakers={speakers} tags={tags} />
      </div>

      {/* Feed */}
      {visible.length === 0 ? (
        <div className="qb-card flex flex-col items-center gap-3 p-10 text-center">
          <p className="font-serif text-lg text-ink">
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
        <div className="flex flex-col gap-4">
          {visible.map((quote) => (
            <QuoteCard
              key={quote.id}
              quote={quote}
              onEdit={(id) => openEditQuote(bookId, id)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
