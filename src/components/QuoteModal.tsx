"use client";

/**
 * QuoteModal — dynamic creation & edit form.
 *
 * Supports single-line quotes and multi-line dialogues: the "Add line" button
 * appends a new {speaker, line_text, line_context} row with an implicit order
 * index (its position in the list). Date/time autofill to "now" but stay fully
 * editable for back-dating. Per-field character caps keep the feed scannable.
 *
 * When editing a quote inside a collaborative book it broadcasts a soft-lock so
 * other viewers see "You're editing…" and can't edit concurrently.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "@/db/dexie";
import { completeCapture } from "@/lib/captures";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { uuid } from "@/lib/id";
import { createQuote, updateQuote, type LineInput } from "@/lib/repo";
import { normalizeTags } from "@/lib/tags";
import { MAX_CONTEXT, MAX_LINE_TEXT, MAX_QUOTE_CONTEXT } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { useSyncStore } from "@/store/useSyncStore";
import { useUIStore } from "@/store/useUIStore";

function dateParts(d: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// Draft lines always carry a stable id so React can key reorderable rows by
// identity (index keys make focus/caret jump when lines move). The same id
// becomes the QuoteLine id on save.
type DraftLine = LineInput & { id: string };

const emptyLine = (): DraftLine => ({
  id: uuid(),
  speaker: "",
  line_text: "",
  line_context: "",
});

export function QuoteModal() {
  const { open, quotebookId, editQuoteId, capture } = useUIStore((s) => s.quoteModal);
  const close = useUIStore((s) => s.closeQuoteModal);
  const startEditing = useSyncStore((s) => s.startEditing);
  const stopEditing = useSyncStore((s) => s.stopEditing);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [quoteContext, setQuoteContext] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (Re)initialise the form whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);

    (async () => {
      if (editQuoteId) {
        const quote = await db.quotes.get(editQuoteId);
        const quoteLines = (
          await db.quote_lines.where("quote_id").equals(editQuoteId).toArray()
        )
          .filter((l) => !l.deleted)
          .sort((a, b) => a.order_index - b.order_index);
        if (cancelled || !quote) return;
        setDate(quote.quote_date);
        setTime(quote.quote_time);
        setQuoteContext(quote.quote_context ?? "");
        setTags(quote.tags);
        setLines(
          quoteLines.length
            ? quoteLines.map((l) => ({
                id: l.id,
                speaker: l.speaker,
                line_text: l.line_text,
                line_context: l.line_context,
              }))
            : [emptyLine()],
        );
        // Announce the soft-lock to collaborators.
        void startEditing(editQuoteId);
      } else {
        // Converting a capture: default to when the thought was captured, and
        // seed line 1 with the raw text so only the speaker needs typing.
        const base = capture ? new Date(capture.created_at) : new Date();
        const { date, time } = dateParts(
          Number.isNaN(base.getTime()) ? new Date() : base,
        );
        setDate(date);
        setTime(time);
        setQuoteContext("");
        setTags([]);
        setTagDraft("");
        setLines(
          capture
            ? [
                {
                  id: uuid(),
                  speaker: "",
                  line_text: capture.text.slice(0, MAX_LINE_TEXT),
                  line_context: "",
                },
              ]
            : [emptyLine()],
        );
      }
    })();

    return () => {
      cancelled = true;
      if (editQuoteId) stopEditing(editQuoteId);
    };
  }, [open, editQuoteId, capture, startEditing, stopEditing]);

  // --- line helpers --------------------------------------------------------
  const setLine = useCallback((i: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }, []);
  const addLine = useCallback(
    () => setLines((prev) => [...prev, emptyLine()]),
    [],
  );
  const removeLine = useCallback(
    (i: number) => setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i))),
    [],
  );
  const moveLine = useCallback((i: number, dir: -1 | 1) => {
    setLines((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  // --- tag helpers ---------------------------------------------------------
  const commitTag = useCallback(() => {
    const next = normalizeTags([...tags, tagDraft]);
    setTags(next);
    setTagDraft("");
  }, [tags, tagDraft]);

  const onTagKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (tagDraft.trim()) commitTag();
    } else if (e.key === "Backspace" && !tagDraft && tags.length) {
      setTags(tags.slice(0, -1));
    }
  };

  // --- validation ----------------------------------------------------------
  const canSave = useMemo(() => {
    const withText = lines.filter((l) => l.line_text.trim().length > 0);
    // Need at least one spoken line, and every spoken line needs a speaker.
    const valid =
      withText.length > 0 && withText.every((l) => l.speaker.trim().length > 0);
    return valid && !saving;
  }, [lines, saving]);

  const handleSave = async () => {
    if (!quotebookId || !canSave) return;
    setSaving(true);
    setError(null);
    const payloadTags = tagDraft.trim() ? normalizeTags([...tags, tagDraft]) : tags;
    const input = {
      quote_date: date,
      quote_time: time,
      quote_context: quoteContext,
      tags: payloadTags,
      // Match the validation: only lines with spoken text persist — a
      // speaker with nothing said would otherwise save as a blank line.
      lines: lines.filter((l) => l.line_text.trim()),
    };
    try {
      if (editQuoteId) {
        await updateQuote(editQuoteId, input);
      } else {
        const quoteId = await createQuote(quotebookId, input);
        // Manual conversion: retire the capture and link the quote it became.
        if (capture) await completeCapture(capture.id, quoteId);
      }
      close();
    } catch (err) {
      console.error("[quote-modal] save failed", err);
      setError(errorMessage(err, "Couldn't save the quote."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={editQuoteId ? "Edit quote" : "New quote"}
    >
      <div className="flex flex-col gap-3">
        {/* When */}
        <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
          <Field label="Date">
            <input
              type="date"
              className="qb-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Time">
            <input
              type="time"
              className="qb-input"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>

        {/* Situation for the whole exchange */}
        <Field label="Context" hint="optional — the situation this happened in">
          <input
            className="qb-input"
            value={quoteContext}
            maxLength={MAX_QUOTE_CONTEXT}
            onChange={(e) => setQuoteContext(e.target.value)}
            placeholder="e.g. walking home in the dark"
          />
        </Field>

        {/* Dialogue lines */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Lines</span>
            <span className="text-xs text-ink-muted">{lines.length} line(s)</span>
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((line, i) => (
              <div key={line.id} className="rounded-xl border border-white/[0.06] bg-paper p-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                    {i + 1}
                  </span>
                  <input
                    className="qb-input flex-1"
                    value={line.speaker}
                    onChange={(e) => setLine(i, { speaker: e.target.value })}
                    placeholder="Quotee"
                    autoFocus={i === 0}
                  />
                  <div className="flex shrink-0 items-center gap-1">
                    <IconBtn label="Move up" disabled={i === 0} onClick={() => moveLine(i, -1)}>↑</IconBtn>
                    <IconBtn label="Move down" disabled={i === lines.length - 1} onClick={() => moveLine(i, 1)}>↓</IconBtn>
                    <IconBtn label="Remove line" disabled={lines.length <= 1} onClick={() => removeLine(i)}>✕</IconBtn>
                  </div>
                </div>
                <textarea
                  className="qb-input min-h-[34px] resize-y"
                  rows={1}
                  value={line.line_text}
                  maxLength={MAX_LINE_TEXT}
                  onChange={(e) => setLine(i, { line_text: e.target.value })}
                  placeholder="What was said…"
                />
                <CharCount value={line.line_text.length} max={MAX_LINE_TEXT} />
                <input
                  className="qb-input mt-1.5"
                  value={line.line_context}
                  maxLength={MAX_CONTEXT}
                  onChange={(e) => setLine(i, { line_context: e.target.value })}
                  placeholder="Context for this line (optional)"
                />
              </div>
            ))}
          </div>
          <button onClick={addLine} className="qb-btn-ghost mt-2 w-full border border-dashed border-white/15">
            + Add line
          </button>
        </div>

        {/* Tags */}
        <Field label="Tags">
          <div className="qb-input flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
              <span key={t} className="qb-chip bg-accent-soft text-accent">
                #{t}
                <button onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
                  ✕
                </button>
              </span>
            ))}
            <input
              className="min-w-[8ch] flex-1 bg-transparent text-sm outline-none"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={onTagKey}
              onBlur={() => tagDraft.trim() && commitTag()}
              placeholder={tags.length ? "" : "Add tags, press Enter"}
            />
          </div>
        </Field>

        {/* Actions */}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={close} className="qb-btn-ghost">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!canSave} className="qb-btn-primary">
            {saving ? "Saving…" : editQuoteId ? "Save changes" : "Add quote"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// --- small presentational helpers -----------------------------------------
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink">
        {label}
        {hint && <span className="ml-2 font-normal text-xs text-ink-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function CharCount({ value, max }: { value: number; max: number }) {
  // Only surface the counter as the user approaches the cap — keeps the form
  // compact the rest of the time.
  if (value <= max * 0.8) return null;
  return (
    <span className={cn("mt-0.5 block text-right text-[11px]", value > max * 0.9 ? "text-accent" : "text-ink-muted/70")}>
      {value}/{max}
    </span>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-md text-ink-muted transition hover:bg-white/5 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
