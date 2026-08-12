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

/**
 * `only` — the exclusive mode. The distinction that matters is against `and`:
 * both require the selection to be satisfied, but `and` tolerates extra people
 * in the quote and `only` does not.
 *
 * Fixture recap — q1: [Alice] · q2: [bob, alice] · q3: [Carol]
 */
describe("applyFeed — exclusive (only) mode", () => {
  it("speaker ONLY excludes quotes where anyone else speaks", () => {
    const out = applyFeed(feed, f({ speakers: ["Alice"], speakerMode: "only" }));
    // q2 has Alice too, but bob is in it — not exclusively Alice.
    expect(out.map((q) => q.id)).toEqual(["q1"]);
  });

  it("differs from AND, which allows other speakers alongside", () => {
    const and = applyFeed(feed, f({ speakers: ["Alice"], speakerMode: "and" }));
    expect(and.map((q) => q.id).sort()).toEqual(["q1", "q2"]);

    const only = applyFeed(feed, f({ speakers: ["Alice"], speakerMode: "only" }));
    expect(only.map((q) => q.id)).toEqual(["q1"]);
  });

  it("with several selected, matches the cast EXACTLY — not a subset", () => {
    const out = applyFeed(
      feed,
      f({ speakers: ["Alice", "bob"], speakerMode: "only" }),
    );
    // q2 is exactly Alice + bob. q1 is Alice ALONE — under exact match that is
    // a different cast, so it is excluded even though it adds nobody extra.
    // q3 (Carol) is unrelated.
    expect(out.map((q) => q.id)).toEqual(["q2"]);
  });

  it("excludes a solo quote when two speakers are selected", () => {
    // The distinguishing case for exact-vs-subset, stated on its own so a
    // future change to either semantic fails loudly here.
    const soloAlice = applyFeed(feed, f({ speakers: ["Alice"], speakerMode: "only" }));
    expect(soloAlice.map((q) => q.id)).toEqual(["q1"]);

    const pair = applyFeed(feed, f({ speakers: ["Alice", "bob"], speakerMode: "only" }));
    expect(pair.map((q) => q.id)).not.toContain("q1");
  });

  it("is case-insensitive like the other speaker modes", () => {
    const out = applyFeed(feed, f({ speakers: ["ALICE"], speakerMode: "only" }));
    expect(out.map((q) => q.id)).toEqual(["q1"]);
  });

  it("treats an unattributed line as an outsider", () => {
    // A quote that is half Alice, half nobody-knows cannot honestly be called
    // "only Alice", so it is excluded rather than silently certified.
    const partial = quote("q6", {
      lines: [line("Alice", "said something"), line("", "and then someone else did")],
    });
    const out = applyFeed([...feed, partial], f({ speakers: ["Alice"], speakerMode: "only" }));
    expect(out.map((q) => q.id)).toEqual(["q1"]);
  });

  it("never matches a quote with no lines at all", () => {
    // An empty cast is vacuously a subset of any selection — guard against it.
    const empty = quote("q7", { lines: [] });
    const out = applyFeed([...feed, empty], f({ speakers: ["Alice"], speakerMode: "only" }));
    expect(out.map((q) => q.id)).toEqual(["q1"]);
  });

  it("tag ONLY matches the tag set exactly", () => {
    const out = applyFeed(feed, f({ tags: ["science"], tagMode: "only" }));
    // q2 is tagged science AND banter, so it is not exclusively science.
    expect(out.map((q) => q.id)).toEqual(["q1"]);

    // Selecting both tags matches q2 (exactly those two) but no longer q1,
    // which carries only one of them.
    const both = applyFeed(feed, f({ tags: ["science", "banter"], tagMode: "only" }));
    expect(both.map((q) => q.id)).toEqual(["q2"]);
  });

  it("tag ONLY never matches an untagged quote", () => {
    const untagged = quote("q8", { lines: [line("Alice", "no tags here")], tags: [] });
    const out = applyFeed([...feed, untagged], f({ tags: ["science"], tagMode: "only" }));
    expect(out.map((q) => q.id)).toEqual(["q1"]);
  });

  it("composes with the other filters", () => {
    const out = applyFeed(
      feed,
      f({ speakers: ["Alice"], speakerMode: "only", tags: ["science"] }),
    );
    expect(out.map((q) => q.id)).toEqual(["q1"]);

    const none = applyFeed(
      feed,
      f({ speakers: ["Alice"], speakerMode: "only", tags: ["work"] }),
    );
    expect(none).toEqual([]);
  });
});

/**
 * Multi-select truth table.
 *
 * The three modes are only meaningfully different once more than one value is
 * selected, so this fixture enumerates every shape a quote's cast can take
 * relative to a two-name selection {Jake, Keya}: each alone, exactly both,
 * both-plus-an-outsider, one-plus-an-outsider, an unrelated cast, no cast at
 * all, and a half-labelled one.
 *
 *   cast                  | Any | All | Only
 *   ----------------------|-----|-----|-----
 *   Jake                  |  ✓  |     |
 *   Keya                  |  ✓  |     |
 *   Jake, Keya            |  ✓  |  ✓  |  ✓
 *   Keya, Jake (reversed) |  ✓  |  ✓  |  ✓
 *   Jake, Keya, Sam       |  ✓  |  ✓  |
 *   Jake, Sam             |  ✓  |     |
 *   Sam                   |     |     |
 *   (no lines)            |     |     |
 *   Jake, (unattributed)  |  ✓  |     |
 */
describe("applyFeed — multi-select across all three modes", () => {
  const cast: QuoteWithLines[] = [
    quote("m-jake", { lines: [line("Jake", "solo")] }),
    quote("m-keya", { lines: [line("Keya", "solo")] }),
    quote("m-pair", { lines: [line("Jake", "a"), line("Keya", "b")] }),
    quote("m-pair-rev", { lines: [line("Keya", "a"), line("Jake", "b")] }),
    quote("m-pair-plus", {
      lines: [line("Jake", "a"), line("Keya", "b"), line("Sam", "c")],
    }),
    quote("m-jake-sam", { lines: [line("Jake", "a"), line("Sam", "b")] }),
    quote("m-sam", { lines: [line("Sam", "solo")] }),
    quote("m-empty", { lines: [] }),
    quote("m-partial", { lines: [line("Jake", "a"), line("", "b")] }),
  ];

  const pick = (mode: FeedFilters["speakerMode"]) =>
    applyFeed(cast, f({ speakers: ["Jake", "Keya"], speakerMode: mode }))
      .map((q) => q.id)
      .sort();

  it("Any = at least one of the selected speaks", () => {
    expect(pick("or")).toEqual(
      [
        "m-jake",
        "m-jake-sam",
        "m-keya",
        "m-pair",
        "m-pair-plus",
        "m-pair-rev",
        "m-partial",
      ].sort(),
    );
  });

  it("All = every selected speaks, outsiders permitted", () => {
    // m-pair-plus qualifies: Sam is extra, but Jake and Keya are both there.
    // The solos do not: each is missing the other selected name.
    expect(pick("and")).toEqual(["m-pair", "m-pair-plus", "m-pair-rev"].sort());
  });

  it("Only = exactly the selected cast, no more and no less", () => {
    // Drops m-pair-plus (Sam is extra) and both solos (each is short a name).
    expect(pick("only")).toEqual(["m-pair", "m-pair-rev"].sort());
  });

  it("is insensitive to the order speakers appear in the quote", () => {
    for (const mode of ["or", "and", "only"] as const) {
      const ids = pick(mode);
      expect(ids.includes("m-pair")).toBe(ids.includes("m-pair-rev"));
    }
  });

  it("nests: Only ⊆ All ⊆ Any", () => {
    // A structural invariant, not a coincidence of this fixture. Exact-match
    // implies every selected value is present (satisfying All), and All on a
    // non-empty selection implies at least one is present (satisfying Any).
    const any = new Set(pick("or"));
    const all = new Set(pick("and"));
    const only = new Set(pick("only"));

    for (const id of only) expect(all.has(id)).toBe(true);
    for (const id of all) expect(any.has(id)).toBe(true);
    // And the nesting is strict here — each mode really does narrow.
    expect(only.size).toBeLessThan(all.size);
    expect(all.size).toBeLessThan(any.size);
  });

  it("never matches an outsider-only or empty quote in any mode", () => {
    for (const mode of ["or", "and", "only"] as const) {
      expect(pick(mode)).not.toContain("m-sam");
      expect(pick(mode)).not.toContain("m-empty");
    }
  });

  it("collapses to Any === All when a single name is selected", () => {
    const one = (mode: FeedFilters["speakerMode"]) =>
      applyFeed(cast, f({ speakers: ["Jake"], speakerMode: mode }))
        .map((q) => q.id)
        .sort();
    // With one selection "at least one of" and "every one of" are the same
    // question; Only is the one that still differs.
    expect(one("or")).toEqual(one("and"));
    expect(one("only")).toEqual(["m-jake"]);
  });

  it("applies the same three rules to tags", () => {
    const tagged: QuoteWithLines[] = [
      quote("t-farm", { lines: [line("Jake", "x")], tags: ["farm"] }),
      quote("t-banter", { lines: [line("Jake", "x")], tags: ["banter"] }),
      quote("t-both", { lines: [line("Jake", "x")], tags: ["farm", "banter"] }),
      quote("t-both-plus", {
        lines: [line("Jake", "x")],
        tags: ["farm", "banter", "work"],
      }),
      quote("t-none", { lines: [line("Jake", "x")], tags: [] }),
    ];
    const byTag = (mode: FeedFilters["tagMode"]) =>
      applyFeed(tagged, f({ tags: ["farm", "banter"], tagMode: mode }))
        .map((q) => q.id)
        .sort();

    expect(byTag("or")).toEqual(["t-banter", "t-both", "t-both-plus", "t-farm"].sort());
    expect(byTag("and")).toEqual(["t-both", "t-both-plus"].sort());
    expect(byTag("only")).toEqual(["t-both"]);
  });
});
