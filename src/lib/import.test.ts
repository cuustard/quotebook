import { describe, expect, it } from "vitest";
import { toQuoteInput } from "@/lib/import";

/** Shape produced by scripts/export-quoteguessgame.mjs. */
function entry(over: Record<string, unknown> = {}) {
  return {
    source_id: 85,
    quote_date: "2021-03-18",
    quote_time: "09:33",
    quote_context: "",
    tags: [],
    lines: [
      { speaker: "Keya Patel", line_text: "What colour do you want", line_context: "", order_index: 0 },
      { speaker: "Ioana Ciosu", line_text: "That one", line_context: "Points to the green one", order_index: 1 },
    ],
    ...over,
  };
}

describe("toQuoteInput", () => {
  it("converts a migrated conversation faithfully", () => {
    const r = toQuoteInput(entry(), 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.quote_date).toBe("2021-03-18");
    expect(r.input.quote_time).toBe("09:33");
    expect(r.input.lines).toHaveLength(2);
    expect(r.input.lines[1].speaker).toBe("Ioana Ciosu");
    // action_text became this line's context, not the quote's.
    expect(r.input.lines[1].line_context).toBe("Points to the green one");
    expect(r.input.quote_context).toBe("");
  });

  // The whole point of restoring quote_context: a situation describing the
  // exchange must not get folded into any single line's annotation.
  it("keeps whole-quote context separate from line context", () => {
    const r = toQuoteInput(
      entry({
        quote_context: "Talking about how no one gets eaten in Lord Of The Flies",
        lines: [
          { speaker: "Fern Harris", line_text: "Wait so they don't eat him", line_context: "", order_index: 0 },
          { speaker: "Jake Evans", line_text: "What a waste", line_context: "", order_index: 1 },
        ],
      }),
      0,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.quote_context).toMatch(/Lord Of The Flies/);
    expect(r.input.lines.every((l) => l.line_context === "")).toBe(true);
  });

  it("keeps both levels when a quote has each", () => {
    const r = toQuoteInput(
      entry({ quote_context: "In the car park" }),
      0,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.quote_context).toBe("In the car park");
    expect(r.input.lines[1].line_context).toBe("Points to the green one");
  });

  it("orders lines by order_index regardless of array order", () => {
    const r = toQuoteInput(
      entry({
        lines: [
          { speaker: "B", line_text: "second", line_context: "", order_index: 1 },
          { speaker: "A", line_text: "first", line_context: "", order_index: 0 },
        ],
      }),
      0,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.lines.map((l) => l.line_text)).toEqual(["first", "second"]);
  });

  it("allows an empty speaker (source rows with no speaker_id)", () => {
    const r = toQuoteInput(
      entry({ lines: [{ speaker: "", line_text: "said by nobody", line_context: "", order_index: 0 }] }),
      0,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.lines[0].speaker).toBe("");
  });

  it("rejects malformed rows without throwing", () => {
    expect(toQuoteInput(null, 0).ok).toBe(false);
    expect(toQuoteInput(entry({ quote_date: "18/03/2021" }), 0).ok).toBe(false);
    expect(toQuoteInput(entry({ quote_time: "9:33" }), 0).ok).toBe(false);
    expect(toQuoteInput(entry({ lines: [] }), 0).ok).toBe(false);
  });

  it("names the offending row so a bad entry is findable", () => {
    const r = toQuoteInput(entry({ quote_date: "nope" }), 41);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("quote #42");
  });
});
