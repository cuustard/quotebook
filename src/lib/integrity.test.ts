import { describe, expect, it } from "vitest";
import {
  findQuoteIssues,
  hasIssues,
  isValidQuoteDate,
  isValidQuoteTime,
} from "@/lib/integrity";
import type { QuoteLine, QuoteWithLines } from "@/lib/types";

let n = 0;
function line(over: Partial<QuoteLine> = {}): QuoteLine {
  n += 1;
  return {
    id: `l${n}`,
    quote_id: "q",
    speaker: "Jake Evans",
    line_text: "What a waste",
    line_context: "",
    order_index: 0,
    updated_at: "",
    field_updated_at: {},
    ...over,
  };
}

function quote(over: Partial<QuoteWithLines> = {}): QuoteWithLines {
  return {
    id: "q",
    quotebook_id: "book",
    quote_date: "2021-03-16",
    quote_time: "13:48",
    quote_context: "",
    tags: [],
    created_by: null,
    created_at: "2021-03-16T13:48:00.000Z",
    updated_at: "",
    field_updated_at: {},
    version: 1,
    lines: [line()],
    ...over,
  };
}

describe("isValidQuoteDate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidQuoteDate("2021-03-16")).toBe(true);
    expect(isValidQuoteDate("2020-02-29")).toBe(true); // leap year
  });

  it("rejects impossible and malformed dates", () => {
    expect(isValidQuoteDate("2021-02-30")).toBe(false); // rolls over
    expect(isValidQuoteDate("2021-13-01")).toBe(false);
    expect(isValidQuoteDate("2021-2-3")).toBe(false);
    expect(isValidQuoteDate("16/03/2021")).toBe(false);
    expect(isValidQuoteDate("")).toBe(false);
  });
});

describe("isValidQuoteTime", () => {
  it("accepts 24h HH:mm", () => {
    expect(isValidQuoteTime("00:00")).toBe(true);
    expect(isValidQuoteTime("23:59")).toBe(true);
  });

  it("rejects out-of-range and loose formats", () => {
    expect(isValidQuoteTime("24:00")).toBe(false);
    expect(isValidQuoteTime("13:60")).toBe(false);
    expect(isValidQuoteTime("9:33")).toBe(false); // unpadded
    expect(isValidQuoteTime("")).toBe(false);
  });
});

describe("findQuoteIssues", () => {
  it("reports nothing for a complete quote", () => {
    expect(findQuoteIssues(quote())).toEqual([]);
    expect(hasIssues(quote())).toBe(false);
  });

  it("flags a line with no speaker", () => {
    const q = quote({ lines: [line({ speaker: "  " })] });
    expect(findQuoteIssues(q)).toContain("missing-speaker");
  });

  it("flags a line with no text", () => {
    const q = quote({ lines: [line({ line_text: "" })] });
    expect(findQuoteIssues(q)).toContain("empty-line");
  });

  it("flags a quote with no lines at all", () => {
    expect(findQuoteIssues(quote({ lines: [] }))).toEqual(["no-lines"]);
  });

  it("ignores deleted lines when judging completeness", () => {
    // A tombstoned line must not make an otherwise-fine quote look broken…
    const ok = quote({ lines: [line(), line({ speaker: "", deleted: true })] });
    expect(findQuoteIssues(ok)).toEqual([]);
    // …nor should it count as content when it's the only one left.
    const empty = quote({ lines: [line({ deleted: true })] });
    expect(findQuoteIssues(empty)).toEqual(["no-lines"]);
  });

  it("flags bad dates and times", () => {
    expect(findQuoteIssues(quote({ quote_date: "2021-02-30" }))).toContain("invalid-date");
    expect(findQuoteIssues(quote({ quote_time: "9:33" }))).toContain("invalid-time");
  });

  it("reports every distinct problem at once", () => {
    const q = quote({
      quote_date: "nope",
      quote_time: "nope",
      lines: [line({ speaker: "", line_text: "" })],
    });
    expect(findQuoteIssues(q).sort()).toEqual(
      ["empty-line", "invalid-date", "invalid-time", "missing-speaker"].sort(),
    );
  });

  it("does not treat optional fields as problems", () => {
    const q = quote({ tags: [], quote_context: "", lines: [line({ line_context: "" })] });
    expect(findQuoteIssues(q)).toEqual([]);
  });
});
