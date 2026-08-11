import { describe, expect, it } from "vitest";
import { validateParsedQuote, verbatimCoverage } from "@/lib/parse";

const SOURCE = "Jake said hes going to milk a cow at 8pm";

/** A well-formed parse of SOURCE; override fields per test. */
function parsed(over: Record<string, unknown> = {}) {
  return {
    quote_date: "2026-08-07",
    quote_time: "20:00",
    quote_context: "",
    tags: [],
    lines: [
      { speaker: "Jake", line_text: "he's going to milk a cow", line_context: "" },
    ],
    confidence: "high",
    notes: null,
    ...over,
  };
}

describe("verbatimCoverage", () => {
  it("is 1 for text lifted straight from the source", () => {
    expect(verbatimCoverage("going to milk a cow", SOURCE)).toBe(1);
  });

  it("ignores apostrophe repair, so typo fixes still count as verbatim", () => {
    expect(verbatimCoverage("he's going to milk a cow", SOURCE)).toBe(1);
  });

  it("drops as invented words appear", () => {
    expect(verbatimCoverage("he is planning to purchase a tractor", SOURCE)).toBeLessThan(0.5);
  });

  it("is 0 for empty text", () => {
    expect(verbatimCoverage("", SOURCE)).toBe(0);
  });
});

describe("validateParsedQuote", () => {
  it("accepts a faithful parse and maps it to QuoteInput", () => {
    const r = validateParsedQuote(parsed(), SOURCE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.quote_date).toBe("2026-08-07");
    expect(r.input.quote_time).toBe("20:00");
    expect(r.input.lines[0].speaker).toBe("Jake");
    expect(r.confidence).toBe("high");
  });

  // The security-critical case: the model must not put words in someone's
  // mouth that the user never typed.
  it("REJECTS a fabricated quote", () => {
    const r = validateParsedQuote(
      parsed({
        lines: [
          {
            speaker: "Jake",
            line_text: "I have always wanted to own a dairy farm",
            line_context: "",
          },
        ],
      }),
      SOURCE,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/didn't match/i);
  });

  it("downgrades to low confidence on partial drift", () => {
    const r = validateParsedQuote(
      parsed({
        lines: [
          // ~60% of tokens are from the source; the rest is embellishment.
          { speaker: "Jake", line_text: "going to milk a cow tomorrow morning early", line_context: "" },
        ],
      }),
      SOURCE,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confidence).toBe("low");
  });

  it("downgrades when no speaker was identified", () => {
    const r = validateParsedQuote(
      parsed({
        lines: [{ speaker: "", line_text: "going to milk a cow", line_context: "" }],
      }),
      SOURCE,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confidence).toBe("low");
  });

  it("exempts very short lines from the coverage gate", () => {
    const r = validateParsedQuote(
      parsed({ lines: [{ speaker: "Jake", line_text: "Nope.", line_context: "" }] }),
      "Jake just said Nope.",
    );
    expect(r.ok).toBe(true);
  });

  it("rejects malformed dates and times", () => {
    expect(validateParsedQuote(parsed({ quote_date: "07/08/2026" }), SOURCE).ok).toBe(false);
    expect(validateParsedQuote(parsed({ quote_date: "2026-13-45" }), SOURCE).ok).toBe(false);
    expect(validateParsedQuote(parsed({ quote_time: "8pm" }), SOURCE).ok).toBe(false);
    expect(validateParsedQuote(parsed({ quote_time: "25:00" }), SOURCE).ok).toBe(false);
  });

  it("rejects responses with no usable lines", () => {
    expect(validateParsedQuote(parsed({ lines: [] }), SOURCE).ok).toBe(false);
    expect(
      validateParsedQuote(
        parsed({ lines: [{ speaker: "Jake", line_text: "   ", line_context: "" }] }),
        SOURCE,
      ).ok,
    ).toBe(false);
  });

  it("rejects non-object payloads", () => {
    expect(validateParsedQuote(null, SOURCE).ok).toBe(false);
    expect(validateParsedQuote("nope", SOURCE).ok).toBe(false);
    expect(validateParsedQuote([], SOURCE).ok).toBe(false);
  });

  // quote_context is the model's own description of the situation, not a
  // quotation, so it is exempt from the verbatim gate — only clamped.
  it("carries quote_context through without holding it to the verbatim rule", () => {
    const r = validateParsedQuote(
      parsed({ quote_context: "walking home in the dark" }),
      SOURCE,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.quote_context).toBe("walking home in the dark");
  });

  it("defaults quote_context to empty and clamps an overlong one", () => {
    const missing = validateParsedQuote(parsed({ quote_context: undefined }), SOURCE);
    expect(missing.ok && missing.input.quote_context).toBe("");
    const long = validateParsedQuote(parsed({ quote_context: "x".repeat(2000) }), SOURCE);
    expect(long.ok && long.input.quote_context.length).toBe(500);
  });

  it("normalizes tags and clamps overlong fields", () => {
    const r = validateParsedQuote(
      parsed({
        tags: [" Farm ", "farm", "FARM", ""],
        lines: [
          {
            speaker: "Jake",
            line_text: "milk a cow ".repeat(200),
            line_context: "x".repeat(5000),
          },
        ],
      }),
      SOURCE,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.tags).toEqual(["farm"]);
    expect(r.input.lines[0].line_text.length).toBeLessThanOrEqual(500);
    expect(r.input.lines[0].line_context.length).toBeLessThanOrEqual(1000);
  });
});
