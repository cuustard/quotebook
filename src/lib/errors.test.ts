import { describe, expect, it } from "vitest";
import { errorMessage } from "@/lib/errors";

describe("errorMessage", () => {
  // The regression this module exists for: supabase-js rejects with a plain
  // object, so `instanceof Error` misses it and String() gives [object Object].
  it("reads a PostgrestError-shaped plain object", () => {
    const pgError = {
      message: 'new row violates row-level security policy for table "quotebooks"',
      details: null,
      hint: null,
      code: "42501",
    };
    const out = errorMessage(pgError);
    expect(out).toContain("row-level security");
    expect(out).toContain("42501");
    expect(out).not.toBe("[object Object]");
  });

  it("joins message, details and hint when all are present", () => {
    const out = errorMessage({
      message: "insert failed",
      details: "Key (id) already exists.",
      hint: "Use upsert.",
      code: "23505",
    });
    expect(out).toBe("insert failed — Key (id) already exists. — Use upsert. [23505]");
  });

  it("handles Error instances and bare strings", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain string")).toBe("plain string");
  });

  it("never returns [object Object] for an opaque object", () => {
    expect(errorMessage({ weird: true })).toBe('{"weird":true}');
    expect(errorMessage({})).toBe("Something went wrong.");
  });

  it("falls back for null/undefined, and honours a custom fallback", () => {
    expect(errorMessage(null)).toBe("Something went wrong.");
    expect(errorMessage(undefined, "Couldn't save.")).toBe("Couldn't save.");
    expect(errorMessage(new Error(""), "Couldn't save.")).toBe("Couldn't save.");
  });

  it("survives a circular object", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => errorMessage(circular)).not.toThrow();
  });
});
