"use client";

/**
 * Quick Add — one box, zero friction.
 *
 * Typing + Enter saves the raw text to Dexie instantly (offline-safe, never
 * lost) and keeps focus in the box so several thoughts can be fired off in a
 * row. Captures land in the Inbox, where they're converted into structured
 * quotes — manually, or automatically when AI parsing is enabled.
 *
 * Also the app's Web Share Target: sharing text from another app lands here
 * with the content prefilled (see `share_target` in public/manifest.json).
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getMeta, setMeta } from "@/db/dexie";
import { createCapture, MAX_CAPTURE_TEXT } from "@/lib/captures";
import { pickPrivateBook } from "@/lib/repo";
import { CaptureStatusChip } from "@/components/CaptureStatusChip";
import { useAuthStore } from "@/store/useAuthStore";

const LAST_BOOK_KEY = "quickadd:last_book";

export default function QuickAddPage() {
  const user = useAuthStore((s) => s.user);
  const [text, setText] = useState("");
  const [bookId, setBookId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const booksRaw = useLiveQuery(
    async () => (await db.quotebooks.toArray()).filter((b) => !b.deleted),
    [],
  );
  const books = useMemo(() => booksRaw ?? [], [booksRaw]);
  const recent =
    useLiveQuery(
      async () =>
        (await db.captures.toArray())
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .slice(0, 5),
      [],
    ) ?? [];

  // Book options: private book first, then collaborative alphabetically.
  const options = useMemo(() => {
    const priv = pickPrivateBook(books, user?.id ?? null);
    const rest = books
      .filter((b) => b.id !== priv?.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    return priv ? [priv, ...rest] : rest;
  }, [books, user]);

  // Default to the last-used book (falls back to the private book).
  useEffect(() => {
    let cancelled = false;
    void getMeta(LAST_BOOK_KEY).then((saved) => {
      if (!cancelled && saved) setBookId(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Web Share Target: prefill from ?text= (or ?title=/?url= when the sharing
  // app sends no body). Read from location rather than useSearchParams so the
  // route stays statically rendered, then strip the query so a refresh or a
  // back-navigation doesn't resurrect an already-saved share.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared =
      params.get("text") || params.get("title") || params.get("url") || "";
    if (!shared) return;
    setText(shared.slice(0, MAX_CAPTURE_TEXT));
    window.history.replaceState(null, "", window.location.pathname);
    // Land the caret at the end so the user can keep typing.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  const effectiveBookId =
    (bookId && options.some((b) => b.id === bookId) ? bookId : null) ??
    options[0]?.id ??
    null;

  const handleSave = async () => {
    if (!text.trim() || !effectiveBookId) return;
    await createCapture(text, effectiveBookId);
    void setMeta(LAST_BOOK_KEY, effectiveBookId);
    setText("");
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter saves; Shift+Enter makes a newline for multi-line dialogues.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSave();
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
      <h1 className="font-heading text-3xl font-semibold text-ink">Quick Add</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Type it before you forget it. Captures save instantly — even offline —
        and wait in your <Link href="/inbox" className="text-accent hover:underline">Inbox</Link> to
        become quotes.
      </p>

      <div className="qb-card mt-6 flex flex-col gap-3 p-4">
        <textarea
          ref={inputRef}
          autoFocus
          rows={3}
          maxLength={MAX_CAPTURE_TEXT}
          className="qb-input min-h-[72px] resize-y"
          placeholder={'e.g. Jake said "I\'m going to milk a cow" at 8pm'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <span>Into</span>
            <select
              className="qb-input w-auto py-1.5"
              value={effectiveBookId ?? ""}
              onChange={(e) => setBookId(e.target.value)}
            >
              {options.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-muted/70">
              Enter to save · Shift+Enter for a new line
            </span>
            <button
              onClick={() => void handleSave()}
              disabled={!text.trim() || !effectiveBookId}
              className="qb-btn-primary"
            >
              Capture
            </button>
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Recent captures
          </h2>
          <ul className="flex flex-col gap-2">
            {recent.map((c) => (
              <li
                key={c.id}
                className="qb-card flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <p className="min-w-0 truncate text-sm text-ink">{c.text}</p>
                <CaptureStatusChip status={c.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
