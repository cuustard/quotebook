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
import { cn } from "@/lib/cn";
import { pickPrivateBook } from "@/lib/repo";
import { appendTranscript } from "@/lib/transcript";
import { useSpeechDictation } from "@/lib/useSpeechDictation";
import { CaptureStatusChip } from "@/components/CaptureStatusChip";
import { useAuthStore } from "@/store/useAuthStore";

const LAST_BOOK_KEY = "quickadd:last_book";

export default function QuickAddPage() {
  const user = useAuthStore((s) => s.user);
  const [text, setText] = useState("");
  const [bookId, setBookId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Dictation appends rather than replaces, so speaking can extend something
  // already typed (and several phrases in a row accumulate). `appendTranscript`
  // cleans the recogniser's artefacts and drops unusable phrases — a cough must
  // not append a stray space — while leaving the words themselves alone.
  const dictation = useSpeechDictation((phrase) => {
    setText((prev) => appendTranscript(prev, phrase, MAX_CAPTURE_TEXT));
  });

  // The launch effect below runs once on mount and must not re-run when
  // dictation's identity changes, so it reaches `start` through a ref rather
  // than listing it as a dependency.
  const startDictationRef = useRef(dictation.start);
  useEffect(() => {
    startDictationRef.current = dictation.start;
  });

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
  //
  // The setState below is flagged by react-hooks/set-state-in-effect, and the
  // usual remedy — a lazy `useState` initializer — is WRONG here. This route is
  // statically prerendered (`○ Static` in the build output), so `window` does
  // not exist when the initializer would run, and seeding from it client-side
  // would make the hydrated markup disagree with the prerendered HTML. Reading
  // location after mount is the hydration-safe way to do this, and the effect
  // also has to run `history.replaceState`, which is a side effect regardless.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared =
      params.get("text") || params.get("title") || params.get("url") || "";
    // `?dictate=1` is the manifest's "Dictate a quote" shortcut: the app opens
    // already listening, so launching from the home screen and speaking is one
    // action rather than three.
    const wantsDictation = params.get("dictate") === "1";
    if (!shared && !wantsDictation) return;

    if (shared) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above: prerender + hydration safety
      setText(shared.slice(0, MAX_CAPTURE_TEXT));
    }
    // Strip either param so a refresh or back-navigation doesn't resurrect an
    // already-saved share, or restart the microphone unbidden.
    window.history.replaceState(null, "", window.location.pathname);

    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        // Land the caret at the end so the user can keep typing.
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
      // Started here rather than on mount so it runs after the strip above:
      // if the browser refuses without a user gesture, the hook reports not
      // listening and the button is still there to press.
      if (wantsDictation) startDictationRef.current();
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

        {/* Live partial phrase. Shown outside the field so a half-heard
            sentence never lands in the text the user is about to save. */}
        {dictation.interim && (
          <p className="-mt-1 truncate text-sm italic text-ink-muted/70" aria-live="polite">
            {dictation.interim}…
          </p>
        )}

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
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Keyboard hint is desktop guidance; on a phone there is no
                Shift+Enter and the row needs the width for the controls. */}
            <span className="hidden text-xs text-ink-muted/70 sm:inline">
              Enter to save · Shift+Enter for a new line
            </span>

            {/* Hidden entirely where the browser has no speech API, rather
                than shown as a button that cannot work. */}
            {dictation.supported && (
              <button
                type="button"
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                aria-pressed={dictation.listening}
                aria-label={dictation.listening ? "Stop dictation" : "Dictate a capture"}
                title={dictation.listening ? "Stop dictation" : "Dictate a capture"}
                className={cn(
                  // max-sm sizing only: desktop keeps the compact control it
                  // had, phones get a target past the ~44px guideline.
                  "qb-btn-ghost shrink-0 border px-3 max-sm:min-h-11 max-sm:min-w-11",
                  dictation.listening
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-white/10 text-ink-muted hover:text-ink",
                )}
              >
                <MicIcon className={cn("h-4 w-4", dictation.listening && "animate-pulse")} />
              </button>
            )}

            <button
              onClick={() => void handleSave()}
              disabled={!text.trim() || !effectiveBookId}
              className="qb-btn-primary max-sm:min-h-11 max-sm:flex-1"
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

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" strokeLinecap="round" />
    </svg>
  );
}
