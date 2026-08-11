/**
 * Turning an unknown thrown value into something a human can act on.
 *
 * The trap this exists to avoid: supabase-js rejects with `PostgrestError`,
 * which is a PLAIN OBJECT (`{message, details, hint, code}`), not an Error
 * subclass. The obvious `err instanceof Error ? err.message : String(err)`
 * therefore renders the single most useful error in the app as
 * "[object Object]". Everything that displays a caught value should come
 * through here.
 */

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  const direct = str(err);
  if (direct) return direct;

  if (err instanceof Error && str(err.message)) return err.message;

  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    // PostgrestError / FunctionsError / GoTrueError all use these fields.
    const parts = [str(e.message), str(e.details), str(e.hint)].filter(Boolean);
    const code = str(e.code);
    if (parts.length > 0) {
      return code ? `${parts.join(" — ")} [${code}]` : parts.join(" — ");
    }
    // Last resort: show *something* structural rather than "[object Object]".
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json.slice(0, 300);
    } catch {
      // circular — fall through
    }
  }

  return fallback;
}
