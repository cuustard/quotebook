import { describe, expect, it } from "vitest";
import { computeStats, pairKey, spanYears, weekdayIndex } from "@/lib/stats";
import type { QuoteLine, QuoteWithLines } from "@/lib/types";

let n = 0;
function line(speaker: string, text = "some words here", over: Partial<QuoteLine> = {}): QuoteLine {
  n += 1;
  return {
    id: `l${n}`,
    quote_id: "q",
    speaker,
    line_text: text,
    line_context: "",
    order_index: 0,
    updated_at: "",
    field_updated_at: {},
    ...over,
  };
}

function quote(id: string, date: string, time: string, lines: QuoteLine[]): QuoteWithLines {
  return {
    id,
    quotebook_id: "book",
    quote_date: date,
    quote_time: time,
    quote_context: "",
    tags: [],
    created_by: null,
    created_at: `${date}T${time}:00.000Z`,
    updated_at: "",
    field_updated_at: {},
    version: 1,
    lines,
  };
}

describe("weekdayIndex", () => {
  it("is Monday-first", () => {
    expect(weekdayIndex(2021, 3, 15)).toBe(0); // a Monday
    expect(weekdayIndex(2021, 3, 19)).toBe(4); // Friday
    expect(weekdayIndex(2021, 3, 21)).toBe(6); // Sunday
  });
});

describe("computeStats", () => {
  const feed = [
    quote("q1", "2021-03-19", "20:10", [line("Jake"), line("Keya")]),
    quote("q2", "2021-03-19", "21:00", [line("Jake")]),
    quote("q3", "2021-05-02", "13:00", [line("Keya"), line("Tom")]),
  ];

  it("counts the headline totals", () => {
    const s = computeStats(feed);
    expect(s.quotes).toBe(3);
    expect(s.lines).toBe(5);
    expect(s.speakerCount).toBe(3);
    expect(s.multiLine).toBe(2);
    expect(s.words).toBe(15); // 5 lines x "some words here"
  });

  it("buckets by hour and Monday-first weekday", () => {
    const s = computeStats(feed);
    expect(s.byHour[20]).toBe(1);
    expect(s.byHour[21]).toBe(1);
    expect(s.byHour[13]).toBe(1);
    expect(s.byWeekday[4]).toBe(2); // two on a Friday
    expect(s.byWeekday[6]).toBe(1); // one on a Sunday
  });

  it("zero-fills the months between first and last", () => {
    const s = computeStats(feed);
    expect(s.byMonth.map((b) => b.key)).toEqual(["2021-03", "2021-04", "2021-05"]);
    expect(s.byMonth.map((b) => b.count)).toEqual([2, 0, 1]);
    expect(s.byMonth[0].label).toBe("Mar 2021");
  });

  it("ranks speakers by distinct quotes, not by line count", () => {
    // Jake speaks twice in one quote — that's still one quote for him.
    const s = computeStats([quote("x", "2021-01-01", "10:00", [line("Jake"), line("Jake")])]);
    expect(s.bySpeaker).toEqual([{ name: "Jake", quotes: 1, lines: 2 }]);
  });

  it("pairs speakers who share a quote, and never pairs someone with themselves", () => {
    const s = computeStats(feed);
    expect(s.pairs).toEqual([
      { a: "Jake", b: "Keya", count: 1 },
      { a: "Keya", b: "Tom", count: 1 },
    ]);
    const solo = computeStats([quote("x", "2021-01-01", "10:00", [line("Jake"), line("Jake")])]);
    expect(solo.pairs).toEqual([]);
  });

  // Regression: names contain spaces, so a space-separated pair key made
  // `split()` tear "Jake Evans" into "Jake" — and the whole matrix rendered
  // empty. Single-word fixtures hid this completely.
  it("round-trips pairs whose names contain spaces", () => {
    const s = computeStats([
      quote("m1", "2021-03-19", "20:10", [line("Jake Evans"), line("Keya Patel")]),
      quote("m2", "2021-03-20", "20:10", [line("Jake Evans"), line("Keya Patel")]),
      quote("m3", "2021-03-21", "20:10", [line("Keya Patel"), line("Thomas Wilderspin")]),
    ]);
    expect(s.pairs).toEqual([
      { a: "Jake Evans", b: "Keya Patel", count: 2 },
      { a: "Keya Patel", b: "Thomas Wilderspin", count: 1 },
    ]);
    // And the key the chart builds must find the count the stats stored.
    const counts = new Map(s.pairs.map((p) => [pairKey(p.a, p.b), p.count]));
    expect(counts.get(pairKey("Keya Patel", "Jake Evans"))).toBe(2); // order-independent
    expect(counts.get(pairKey("Jake Evans", "Keya Patel"))).toBe(2);
  });

  it("tracks each speaker's first and last appearance", () => {
    const s = computeStats(feed);
    expect(s.spans).toEqual([
      { name: "Jake", first: "2021-03-19", last: "2021-03-19" },
      { name: "Keya", first: "2021-03-19", last: "2021-05-02" },
      { name: "Tom", first: "2021-05-02", last: "2021-05-02" },
    ]);
  });

  it("finds the busiest day and the longest quote", () => {
    const s = computeStats(feed);
    expect(s.busiestDay).toEqual({ date: "2021-03-19", count: 2 });
    expect(s.longest?.words).toBe(6); // the two-line quote
  });

  it("ignores deleted lines", () => {
    const s = computeStats([
      quote("x", "2021-01-01", "10:00", [line("Jake"), line("Ghost", "gone", { deleted: true })]),
    ]);
    expect(s.lines).toBe(1);
    expect(s.speakerCount).toBe(1);
    expect(s.multiLine).toBe(0);
  });

  it("survives malformed dates and an empty feed", () => {
    const bad = computeStats([quote("x", "not-a-date", "99:99", [line("Jake")])]);
    expect(bad.quotes).toBe(1);
    expect(bad.byMonth).toEqual([]);
    expect(bad.first).toBeNull();
    expect(bad.byHour.every((n) => n === 0)).toBe(true);

    const empty = computeStats([]);
    expect(empty.quotes).toBe(0);
    expect(empty.byMonth).toEqual([]);
    expect(empty.busiestDay).toBeNull();
  });
});

describe("spanYears", () => {
  it("measures the archive span", () => {
    expect(spanYears("2012-05-20", "2025-03-20")).toBeCloseTo(12.8, 1);
    expect(spanYears("2021-01-01", "2021-01-01")).toBe(0);
  });
});
