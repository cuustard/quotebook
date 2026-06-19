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
import { cn } from "@/lib/cn";
import {
  createQuote,
  normalizeTags,
  updateQuote,
  type LineInput,
} from "@/lib/repo";
import { MAX_CONTEXT, MAX_LINE_TEXT } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { useSyncStore } from "@/store/useSyncStore";
import { useUIStore } from "@/store/useUIStore";

function nowParts() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

const emptyLine = (): LineInput => ({ speaker: "", line_text: "", line_context: "" });

export function QuoteModal() {
  const { open, quotebookId, editQuoteId } = useUIStore((s) => s.quoteModal);
  const close = useUIStore((s) => s.closeQuoteModal);
  const startEditing = useSyncStore((s) => s.startEditing);
  const stopEditing = useSyncStore((s) => s.stopEditing);

  const [primaryQuotee, setPrimaryQuotee] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [context, setContext] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [lines, setLines] = useState<LineInput[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  // (Re)initialise the form whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      if (editQuoteId) {
        const quote = await db.quotes.get(editQuoteId);
        const quoteLines = (
          await db.quote_lines.where("quote_id").equals(editQuoteId).toArray()
        )
          .filter((l) => !l.deleted)
          .sort((a, b) => a.order_index - b.order_index);
        if (cancelled || !quote) return;
        setPrimaryQuotee(quote.primary_quotee);
        setDate(quote.quote_date);
        setTime(quote.quote_time);
        setContext(quote.quote_context);
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
        const { date, time } = nowParts();
        setPrimaryQuotee("");
        setDate(date);
        setTime(time);
        setContext("");
        setTags([]);
        setTagDraft("");
        setLines([emptyLine()]);
      }
    })();

    return () => {
      cancelled = true;
      if (editQuoteId) stopEditing(editQuoteId);
    };
  }, [open, editQuoteId, startEditing, stopEditing]);

  // --- line helpers --------------------------------------------------------
  const setLine = useCallback((i: number, patch: Partial<LineInput>) => {
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
    const hasText = lines.some((l) => l.line_text.trim().length > 0);
    return primaryQuotee.trim().length > 0 && hasText && !saving;
  }, [primaryQuotee, lines, saving]);

  const handleSave = async () => {
    if (!quotebookId || !canSave) return;
    setSaving(true);
    const payloadTags = tagDraft.trim() ? normalizeTags([...tags, tagDraft]) : tags;
    const input = {
      primary_quotee: primaryQuotee,
      quote_date: date,
      quote_time: time,
      quote_context: context,
      tags: payloadTags,
      lines: lines.filter((l) => l.line_text.trim() || l.speaker.trim()),
    };
    try {
      if (editQuoteId) await updateQuote(editQuoteId, input);
      else await createQuote(quotebookId, input);
      close();
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
      <div className="flex flex-col gap-4">
        {/* Anchor + when */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Primary quotee" hint="The anchor person being quoted">
            <input
              className="qb-input"
              value={primaryQuotee}
              onChange={(e) => setPrimaryQuotee(e.target.value)}
              placeholder="e.g. Grandpa Joe"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
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
        </div>

        {/* Overarching context */}
        <Field label="Context" hint="Optional — the overarching scene">
          <textarea
            className="qb-input min-h-[60px] resize-y"
            value={context}
            maxLength={MAX_CONTEXT}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Where / when / what was happening…"
          />
          <CharCount value={context.length} max={MAX_CONTEXT} />
        </Field>

        {/* Dialogue lines */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Lines</span>
            <span className="text-xs text-ink-muted">{lines.length} line(s)</span>
          </div>
          <div className="flex flex-col gap-3">
            {lines.map((line, i) => (
              <div key={i} className="rounded-xl border border-black/[0.06] bg-paper p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                    {i + 1}
                  </span>
                  <input
                    className="qb-input flex-1"
                    value={line.speaker}
                    onChange={(e) => setLine(i, { speaker: e.target.value })}
                    placeholder="Speaker (defaults to quotee)"
                  />
                  <div className="flex shrink-0 items-center gap-1">
                    <IconBtn label="Move up" disabled={i === 0} onClick={() => moveLine(i, -1)}>↑</IconBtn>
                    <IconBtn label="Move down" disabled={i === lines.length - 1} onClick={() => moveLine(i, 1)}>↓</IconBtn>
                    <IconBtn label="Remove line" disabled={lines.length <= 1} onClick={() => removeLine(i)}>✕</IconBtn>
                  </div>
                </div>
                <textarea
                  className="qb-input min-h-[44px] resize-y"
                  value={line.line_text}
                  maxLength={MAX_LINE_TEXT}
                  onChange={(e) => setLine(i, { line_text: e.target.value })}
                  placeholder="What was said…"
                />
                <CharCount value={line.line_text.length} max={MAX_LINE_TEXT} />
                <input
                  className="qb-input mt-2"
                  value={line.line_context}
                  maxLength={MAX_CONTEXT}
                  onChange={(e) => setLine(i, { line_context: e.target.value })}
                  placeholder="Footnote / subtext for this line (optional)"
                />
              </div>
            ))}
          </div>
          <button onClick={addLine} className="qb-btn-ghost mt-2 w-full border border-dashed border-black/15">
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
      className="grid h-7 w-7 place-items-center rounded-md text-ink-muted transition hover:bg-black/5 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
