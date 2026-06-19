"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/dexie";
import { createQuotebook } from "@/lib/repo";
import { isSupabaseConfigured } from "@/lib/supabase";
import { QuotebookCard } from "@/components/QuotebookCard";
import { useAuthStore } from "@/store/useAuthStore";

/** Relative "time ago" for recent-activity hints. */
function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  // Single live query that aggregates everything the dashboard renders.
  const data = useLiveQuery(async () => {
    const books = (await db.quotebooks.toArray()).filter((b) => !b.deleted);
    const quotes = (await db.quotes.toArray()).filter((q) => !q.deleted);
    const members = await db.members.toArray();

    const quoteCount = new Map<string, number>();
    const lastActivity = new Map<string, string>();
    for (const q of quotes) {
      quoteCount.set(q.quotebook_id, (quoteCount.get(q.quotebook_id) ?? 0) + 1);
      const prev = lastActivity.get(q.quotebook_id);
      if (!prev || q.updated_at > prev) lastActivity.set(q.quotebook_id, q.updated_at);
    }
    const memberCount = new Map<string, number>();
    for (const m of members) {
      memberCount.set(m.quotebook_id, (memberCount.get(m.quotebook_id) ?? 0) + 1);
    }

    return { books, quoteCount, memberCount, lastActivity };
  }, []);

  const { privateBook, collaborative } = useMemo(() => {
    const books = data?.books ?? [];
    return {
      privateBook: books.find((b) => b.is_private) ?? null,
      collaborative: books
        .filter((b) => !b.is_private)
        .sort((a, b) => (b.created_at > a.created_at ? 1 : -1)),
    };
  }, [data]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createQuotebook(newName);
    setNewName("");
    setCreating(false);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-ink">Your spaces</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {user ? `Welcome back, ${user.email}.` : "You're browsing as a guest — everything is saved on this device."}
          </p>
        </div>
        <button onClick={() => setCreating((v) => !v)} className="qb-btn-primary">
          + New collaborative book
        </button>
      </div>

      {creating && (
        <div className="qb-card mb-8 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <input
            className="qb-input flex-1"
            placeholder="Name your collaborative quotebook…"
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <div className="flex gap-2">
            <button onClick={() => setCreating(false)} className="qb-btn-ghost">Cancel</button>
            <button onClick={handleCreate} disabled={!newName.trim()} className="qb-btn-primary">Create</button>
          </div>
          {!user && isSupabaseConfigured && (
            <p className="text-xs text-ink-muted sm:ml-2">
              Sign in to invite others — it'll sync once you do.
            </p>
          )}
        </div>
      )}

      {/* Anchored private book */}
      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Personal space
        </h2>
        {privateBook ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <QuotebookCard
              book={privateBook}
              primary
              quoteCount={data?.quoteCount.get(privateBook.id) ?? 0}
              memberCount={1}
              lastActivity={timeAgo(data?.lastActivity.get(privateBook.id) ?? null)}
            />
          </div>
        ) : (
          <div className="qb-card p-6 text-sm text-ink-muted">Setting up your private quotebook…</div>
        )}
      </section>

      {/* Collaborative books */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Collaborative quotebooks
        </h2>
        {collaborative.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collaborative.map((book) => (
              <QuotebookCard
                key={book.id}
                book={book}
                quoteCount={data?.quoteCount.get(book.id) ?? 0}
                memberCount={data?.memberCount.get(book.id) ?? 0}
                lastActivity={timeAgo(data?.lastActivity.get(book.id) ?? null)}
              />
            ))}
          </div>
        ) : (
          <div className="qb-card flex flex-col items-start gap-2 p-6">
            <p className="text-sm text-ink-muted">
              No collaborative quotebooks yet. Create one above, or join one with an invite code in{" "}
              <span className="font-medium text-ink">Manage Quotebooks</span>.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
