/**
 * ID + high-precision clock helpers.
 *
 * The sync engine resolves conflicts with field-level Last-Write-Wins. When
 * two writes land in the same millisecond we still need a deterministic, total
 * ordering, so `tick()` returns a *fractional* epoch-ms value: the integer part
 * is `Date.now()` and the fractional part is a per-millisecond monotonic
 * counter. This gives us a cheap, sortable, sub-millisecond logical clock
 * without depending on `performance.now()` (which is not wall-clock aligned).
 */

let lastMs = 0;
let counter = 0;

/** Monotonic, sortable fractional epoch-ms used for LWW comparisons. */
export function tick(): number {
  const ms = Date.now();
  if (ms > lastMs) {
    lastMs = ms;
    counter = 0;
  } else {
    // Same millisecond, or the wall clock stepped backwards — keep counting
    // within the last band so ticks stay strictly increasing either way.
    counter += 1;
    if (counter > 999) {
      // >1000 ticks in one ms: roll into the next ms band instead of tying.
      lastMs += 1;
      counter = 0;
    }
  }
  return lastMs + counter / 1000;
}

/** ISO-8601 timestamp for the current instant (drops the sub-ms fraction). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Convert a fractional epoch-ms tick back to an ISO timestamp. */
export function tickToIso(t: number): string {
  return new Date(Math.floor(t)).toISOString();
}

/** RFC-4122 v4 UUID. Uses the platform crypto so IDs are stable client-side. */
export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Short, human-friendly invite code (no ambiguous characters). */
export function inviteCode(len = 8): string {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    // Never fall back to predictable codes — these gate quotebook access.
    throw new Error("Secure random source unavailable.");
  }
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  // Rejection sampling: bytes >= limit would bias `% alphabet.length`.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < len) {
    const bytes = crypto.getRandomValues(new Uint8Array(len * 2));
    for (const b of bytes) {
      if (b < limit) {
        out += alphabet[b % alphabet.length];
        if (out.length === len) break;
      }
    }
  }
  return out;
}
