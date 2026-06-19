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
  if (ms === lastMs) {
    // up to 1000 distinct ticks per ms before we roll into the next ms band
    counter = Math.min(counter + 1, 999);
  } else {
    lastMs = ms;
    counter = 0;
  }
  return ms + counter / 1000;
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
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint8Array(len);
  if (typeof crypto !== "undefined") crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
