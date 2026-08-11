import { describe, expect, it } from "vitest";
import { applyFeed, collectSpeakers, collectTags } from "@/lib/search";
import { DEFAULT_FILTERS } from "@/lib/types";
import type { FeedFilters, QuoteLine, QuoteWithLines } from "@/lib/types";

let n = 0;
function line(speaker: string, text: string): QuoteLine {
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
  };
}

function quote(
  id: string,
  opts: {
    lines: QuoteLine[];
    tags?: string[];
    date?: string;
    time?: string;
    created?: string;
    context?: string;
  },
): QuoteWithLines {
  return {
    id,
    quotebook_id: "book",
    quote_date: opts.date ?? "2026-01-15",
    quote_time: opts.time ?? "12:00",
    quote_context: opts.context ?? "",
    tags: opts.tags ?? [],
    created_by: null,
    created_at: opts.created ?? "2026-01-15T12:00:00.000Z",
    updated_at: "",
    field_updated_at: {},
    version: 1,
    lines: opts.lines,
  };
}

const feed: QuoteWithLines[] = [
  quote("q1", {
    lines: [line("Alice", "The mitochondria is the powerhouse of the cell")],
    tags: ["science"],
    date: "2026-01-01",
  }),
  quote("q2", {
    lines: [line("bob", "I never said that"), line("alice", "You just did")],
    tags: ["banter", "science"],
    date: "2026-02-01",
  }),
  quote("q3", {
    lines: [line("Carol", "Ship it")],
    tags: ["work"],
    date: "2026-03-01",
  }),
];

const f = (patch: Partial<FeedFilters>): FeedFilters => ({
  ...DEFAULT_FILTERS,
  ...patch,
});

describe("collectSpeakers", () => {
  it("dedupes case-insensitively, keeping first-seen casing", () => {
    const speakers = collectSpeakers(feed);
    expect(speakers).toEqual(["Alice", "bob", "Carol"]);
  });
});

describe("collectTags", () => {
  it("returns sorted distinct tags", () => {
    expect(collectTags(feed)).toEqual(["banter", "science", "work"]);
  });
});

describe("applyFeed", () => {
  it("matches speakers case-insensitively", () => {
    const out = applyFeed(feed, f({ speakers: ["Alice"] }));
    expect(out.map((q) => q.id).sort()).toEqual(["q1", "q2"]);
  });

  it("speaker AND requires every selected speaker in the quote", () => {
    const out = applyFeed(
      feed,
      f({ speakers: ["Alice", "bob"], speakerMode: "and" }),
    );
    expect(out.map((q) => q.id)).toEqual(["q2"]);
  });

  it("tag AND vs OR", () => {
    const and = applyFeed(feed, f({ tags: ["science", "banter"], tagMode: "and" }));
    expect(and.map((q) => q.id)).toEqual(["q2"]);
    const or = applyFeed(feed, f({ tags: ["science", "work"], tagMode: "or" }));
    expect(or.map((q) => q.id).sort()).toEqual(["q1", "q2", "q3"]);
  });

  it("applies inclusive date bounds", () => {
    const out = applyFeed(feed, f({ since: "2026-02-01", before: "2026-02-28" }));
    expect(out.map((q) => q.id)).toEqual(["q2"]);
  });

  it("sorts by quote_date in both directions", () => {
    expect(applyFeed(feed, f({ sortDir: "desc" })).map((q) => q.id)).toEqual([
      "q3",
      "q2",
      "q1",
    ]);
    expect(applyFeed(feed, f({ sortDir: "asc" })).map((q) => q.id)).toEqual([
      "q1",
      "q2",
      "q3",
    ]);
  });

  // Self-contained fixtures: the shared `feed` leaves every quote at the
  // default 12:00, which can't exercise an hour filter.
  const timed: QuoteWithLines[] = [
    // 2021-03-19 is a Friday (Monday-first index 4).
    quote("evening", { lines: [line("Jake", "late one")], date: "2021-03-19", time: "20:10" }),
    // 2021-03-15 is a Monday (index 0).
    quote("lunch", { lines: [line("Keya", "midday")], date: "2021-03-15", time: "13:00" }),
    // Same Friday, different hour — separates hour from weekday.
    quote("friday-noon", { lines: [line("Tom", "also friday")], date: "2021-03-19", time: "13:00" }),
  ];

  it("filters by hour of day", () => {
    expect(applyFeed(timed, f({ hours: [20] })).map((q) => q.id)).toEqual(["evening"]);
    expect(applyFeed(timed, f({ hours: [13] })).map((q) => q.id).sort()).toEqual([
      "friday-noon", "lunch",
    ]);
    expect(applyFeed(timed, f({ hours: [20, 13] }))).toHaveLength(3);
  });

  it("filters by Monday-first weekday", () => {
    expect(applyFeed(timed, f({ weekdays: [4] })).map((q) => q.id).sort()).toEqual([
      "evening", "friday-noon",
    ]);
    expect(applyFeed(timed, f({ weekdays: [0] })).map((q) => q.id)).toEqual(["lunch"]);
  });

  it("intersects hour with weekday rather than unioning them", () => {
    // Friday AND 13:00 -> only the one quote that is both.
    expect(applyFeed(timed, f({ hours: [13], weekdays: [4] })).map((q) => q.id)).toEqual([
      "friday-noon",
    ]);
    // Monday AND 20:00 -> nothing, even though each matches something alone.
    expect(applyFeed(timed, f({ hours: [20], weekdays: [0] }))).toEqual([]);
  });

  it("onlyIncomplete narrows to quotes missing something mandatory", () => {
    const broken = quote("q4", {
      lines: [line("", "no speaker on this one")],
      date: "2026-04-01",
    });
    const withBroken = [...feed, broken];

    expect(applyFeed(withBroken, f({})).map((q) => q.id).sort()).toEqual([
      "q1", "q2", "q3", "q4",
    ]);
    expect(applyFeed(withBroken, f({ onlyIncomplete: true })).map((q) => q.id)).toEqual([
      "q4",
    ]);
  });

  it("combines onlyIncomplete with the other filters", () => {
    const broken = quote("q5", {
      lines: [line("", "orphan line")],
      tags: ["work"],
      date: "2026-04-02",
    });
    const out = applyFeed([...feed, broken], f({ onlyIncomplete: true, tags: ["work"] }));
    // q3 has the work tag but is complete; q5 is incomplete AND tagged work.
    expect(out.map((q) => q.id)).toEqual(["q5"]);
  });

  it("fuzzy search tolerates typos and still applies filters", () => {
    const out = applyFeed(feed, f({ query: "mitochondira" })); // typo
    expect(out.map((q) => q.id)).toEqual(["q1"]);
    const none = applyFeed(feed, f({ query: "mitochondira", tags: ["work"] }));
    expect(none).toEqual([]);
  });
});
