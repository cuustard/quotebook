/**
 * Quick Add capture engine.
 *
 * ───────────────────────────── Strategy ─────────────────────────────
 * A capture is a raw thought saved to Dexie INSTANTLY — it never waits on the
 * network, works offline, and is never lost to a failed parse. Turning it
 * into a structured quote happens afterwards, as an enhancement:
 *
 *   - Phase 1 (AI): a background sweep sends pending captures to the
 *     `parse-capture` Supabase Edge Function, creates the quote via the
 *     normal repo path, and flips the capture to "parsed" (= review queue).
 *   - Manual (always available, offline included): the user converts the
 *     capture in the Inbox via the existing QuoteModal.
 *
 * ──────────────────────── Offline / stability ───────────────────────
 * Resolution mirrors the sync engine's guards: offline, guest, or an
 * unconfigured backend leaves captures "pending" — a queue, not a failure.
 * Because the `online` event often fires the moment a flaky radio blips up,
 * we wait STABLE_ONLINE_GRACE_MS before attempting parses, and re-check
 * navigator.onLine after the grace period. `navigator.onLine` can still lie
 * (captive portals), so the parse request itself is the real connectivity
 * test: a failed attempt is harmless — the capture stays pending and retries
 * with exponential backoff.
 */

import { db } from "@/db/dexie";
import { errorMessage } from "@/lib/errors";
import { nowIso, uuid } from "@/lib/id";
import { validateParsedQuote } from "@/lib/parse";
import { createQuote, getQuotesWithLines, type QuoteInput } from "@/lib/repo";
import { collectSpeakers, collectTags } from "@/lib/search";
import { getCurrentUserId } from "@/lib/session";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Capture, CaptureStatus } from "@/lib/types";

// ──────────────────────────── Thresholds ────────────────────────────
/** Wait this long after the `online` event before trusting the connection. */
const STABLE_ONLINE_GRACE_MS = 4000;
/** Safety-net sweep for retry backoff and missed triggers. */
const SWEEP_INTERVAL_MS = 30_000;
/** After this many failed parse attempts the capture flips to "failed". */
const MAX_ATTEMPTS = 5;
/** Keep captures scannable; the modal caps line text separately. */
export const MAX_CAPTURE_TEXT = 2000;

/**
 * AI parsing is opt-in: set NEXT_PUBLIC_QUICKADD_AI=true once the
 * `parse-capture` Edge Function is deployed. Without it captures simply wait
 * in the Inbox for manual conversion — no failed parses, no noise.
 */
export const isQuickAddAIEnabled =
  isSupabaseConfigured && process.env.NEXT_PUBLIC_QUICKADD_AI === "true";

// ───────────────────── Pure helpers (unit-tested) ─────────────────────

/** Exponential backoff for parse retries: 5s, 10s, 20s… capped at 5 min. */
export function retryDelayMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 300_000);
}

/** Has this capture waited out its backoff window? */
export function isRetryDue(
  capture: Pick<Capture, "attempts" | "attempted_at">,
  nowMs: number,
): boolean {
  if (capture.attempts === 0 || !capture.attempted_at) return true;
  return (
    nowMs >=
    new Date(capture.attempted_at).getTime() + retryDelayMs(capture.attempts)
  );
}

/** Legal status transitions — anything else is a bug. */
const TRANSITIONS: Record<CaptureStatus, readonly CaptureStatus[]> = {
  pending: ["parsing", "done"], // AI pickup, or manual conversion
  parsing: ["parsed", "failed", "pending"], // success, give-up, or retry later
  parsed: ["done"], // reviewed
  failed: ["pending", "done"], // manual retry, or manual conversion
  done: [],
};

export function canTransition(from: CaptureStatus, to: CaptureStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Why AI resolution can't run right now (null = go ahead). Pure so the guard
 * logic is testable; callers feed in the live environment.
 */
export function resolutionBlocked(env: {
  online: boolean;
  signedIn: boolean;
  configured: boolean;
}): string | null {
  if (!env.configured) return "backend not configured";
  if (!env.signedIn) return "sign in to use AI parsing";
  if (!env.online) return "offline";
  return null;
}

/** Statuses that count toward the Inbox badge (everything not yet reviewed). */
export const INBOX_STATUSES: readonly CaptureStatus[] = [
  "pending",
  "parsing",
  "parsed",
  "failed",
];

// ───────────────────────────── CRUD ─────────────────────────────

/**
 * Save a raw capture. Local-only, instant, offline-safe — this function
 * NEVER awaits the network. Resolution happens in the background.
 */
export async function createCapture(
  text: string,
  quotebookId: string,
): Promise<string | null> {
  const trimmed = text.trim().slice(0, MAX_CAPTURE_TEXT);
  if (!trimmed) return null;

  const capture: Capture = {
    id: uuid(),
    text: trimmed,
    quotebook_id: quotebookId,
    created_at: nowIso(),
    status: "pending",
    quote_id: null,
    confidence: null,
    error: null,
    attempts: 0,
    attempted_at: null,
  };
  await db.captures.put(capture);
  requestResolve(); // background; no-ops while the parser isn't deployed
  return capture.id;
}

/** Mark a capture reviewed/converted. `quoteId` links a manual conversion. */
export async function completeCapture(
  id: string,
  quoteId?: string,
): Promise<void> {
  await db.captures.update(id, {
    status: "done" as CaptureStatus,
    ...(quoteId ? { quote_id: quoteId } : {}),
  });
}

/** Hard delete — captures are local scratch, no tombstone needed. */
export async function deleteCapture(id: string): Promise<void> {
  await db.captures.delete(id);
}

/** Put a failed capture back in the queue with a fresh retry ladder. */
export async function retryCapture(id: string): Promise<void> {
  await db.captures.update(id, {
    status: "pending" as CaptureStatus,
    attempts: 0,
    attempted_at: null,
    error: null,
  });
  requestResolve();
}

// ───────────────────────── AI resolution ─────────────────────────

/** A rejection no retry can fix (bad input, model refusal, failed validation). */
class PermanentParseError extends Error {}

/**
 * Daily-cap backstop: when the Edge Function returns 429 there is no point
 * sweeping again until the local day rolls over.
 */
let cappedUntilMs = 0;

function endOfLocalDayMs(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/**
 * Invoke `parse-capture` and validate the result.
 *
 * The Edge Function's JSON schema guarantees shape provider-side, but the
 * client re-checks everything and enforces the verbatim rule itself
 * (`src/lib/parse.ts`) — a hallucinated attribution must never reach the
 * record just because a remote service said it was fine.
 */
async function requestParse(
  capture: Capture,
): Promise<{ input: QuoteInput; confidence: "high" | "low" }> {
  const supabase = getSupabase();
  if (!supabase) throw new PermanentParseError("Sync backend not configured.");

  // Existing speakers/tags in the target book, so the model reuses "Jake"
  // and "science" instead of inventing near-duplicates.
  const existing = await getQuotesWithLines(capture.quotebook_id);

  const { data, error } = await supabase.functions.invoke("parse-capture", {
    body: {
      text: capture.text,
      captured_at_local: new Date(capture.created_at).toLocaleString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      known_speakers: collectSpeakers(existing),
      known_tags: collectTags(existing),
    },
  });

  if (error) {
    // supabase-js wraps non-2xx in FunctionsHttpError with the raw Response.
    const context = (error as { context?: Response }).context;
    const status = context?.status ?? 0;
    let message = error.message;
    try {
      const body = await context?.clone().json();
      if (body?.error) message = String(body.error);
    } catch {
      /* body wasn't JSON — keep the transport message */
    }

    // 429: out of quota for today. Transient (tomorrow works), but stop
    // sweeping so we don't burn attempts on a known-closed door.
    if (status === 429) {
      cappedUntilMs = endOfLocalDayMs();
      throw new Error(message);
    }
    // 422: bad input or unusable model output — retrying changes nothing.
    if (status === 422) throw new PermanentParseError(message);
    // 401 (expired token), 5xx, network: retry with backoff.
    throw new Error(message);
  }

  const result = validateParsedQuote(data, capture.text);
  if (!result.ok) throw new PermanentParseError(result.error);
  return { input: result.input, confidence: result.confidence };
}

async function resolveCapture(capture: Capture): Promise<void> {
  if (!canTransition(capture.status, "parsing")) return;

  const attempts = capture.attempts + 1;
  await db.captures.update(capture.id, {
    status: "parsing" as CaptureStatus,
    attempts,
    attempted_at: nowIso(),
  });

  try {
    const { input, confidence } = await requestParse(capture);
    const quoteId = await createQuote(capture.quotebook_id, input);
    await db.captures.update(capture.id, {
      status: "parsed" as CaptureStatus,
      quote_id: quoteId,
      confidence,
      error: null,
    });
  } catch (err) {
    const message = errorMessage(err, "Parsing failed.");
    // A permanent rejection skips the retry ladder entirely.
    const permanent = err instanceof PermanentParseError;
    if (permanent || attempts >= MAX_ATTEMPTS) {
      // Out of road — surface it in the Inbox for manual conversion.
      await db.captures.update(capture.id, {
        status: "failed" as CaptureStatus,
        error: message,
      });
    } else {
      // Back to the queue; isRetryDue() enforces the backoff window. A
      // quota rejection didn't really spend an attempt, so give it back.
      await db.captures.update(capture.id, {
        status: "pending" as CaptureStatus,
        attempts: cappedUntilMs > Date.now() ? capture.attempts : attempts,
        error: message,
      });
    }
  }
}

let resolving = false;

/** Sweep every due pending capture through the parser. Safe to call often. */
export async function resolvePendingCaptures(): Promise<void> {
  if (!isQuickAddAIEnabled || resolving) return;
  if (Date.now() < cappedUntilMs) return; // daily quota exhausted
  if (
    resolutionBlocked({
      online: typeof navigator === "undefined" ? false : navigator.onLine,
      signedIn: Boolean(getCurrentUserId()),
      configured: isSupabaseConfigured,
    })
  ) {
    return;
  }

  resolving = true;
  try {
    const pending = await db.captures
      .where("status")
      .equals("pending")
      .toArray();
    const now = Date.now();
    for (const capture of pending) {
      if (isRetryDue(capture, now)) await resolveCapture(capture);
    }
  } finally {
    resolving = false;
  }
}

function requestResolve(): void {
  if (typeof window === "undefined") return;
  void resolvePendingCaptures();
}

// ───────────────────────────── Engine ─────────────────────────────

let started = false;
let sweepId: ReturnType<typeof setInterval> | null = null;
let graceId: ReturnType<typeof setTimeout> | null = null;

// Named handler so stopCaptureEngine can remove it (same pattern as sync.ts).
const handleCaptureOnline = (): void => {
  // The `online` event often fires the moment a flaky radio blips up — wait
  // for the connection to stabilise, then re-check before sweeping.
  if (graceId) clearTimeout(graceId);
  graceId = setTimeout(() => {
    graceId = null;
    if (navigator.onLine) void resolvePendingCaptures();
  }, STABLE_ONLINE_GRACE_MS);
};

/** Boot the engine: reconnect listener + periodic retry sweep + first sweep. */
export function startCaptureEngine(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("online", handleCaptureOnline);
  sweepId = setInterval(() => void resolvePendingCaptures(), SWEEP_INTERVAL_MS);
  void resolvePendingCaptures();
}

export function stopCaptureEngine(): void {
  if (typeof window !== "undefined") {
    window.removeEventListener("online", handleCaptureOnline);
  }
  if (sweepId) clearInterval(sweepId);
  if (graceId) clearTimeout(graceId);
  sweepId = null;
  graceId = null;
  started = false;
}
