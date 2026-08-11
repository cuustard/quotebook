import { describe, expect, it } from "vitest";
import {
  decodeFeedFilters,
  encodeFeedFilters,
  feedHref,
  monthBounds,
} from "@/lib/feedUrl";
import { DEFAULT_FILTERS, type FeedFilters } from "@/lib/types";

const decode = (qs: string) => decodeFeedFilters(new URLSearchParams(qs));
const f = (over: Partial<FeedFilters> = {}): FeedFilters => ({ ...DEFAULT_FILTERS, ...over });

describe("encodeFeedFilters", () => {
  it("emits nothing for an unfiltered feed", () => {
    expect(encodeFeedFilters(DEFAULT_FILTERS)).toBe("");
  });

  it("omits values that match the defaults", () => {
    // speakerMode "or" and tagMode "and" are the defaults, so neither appears.
    const qs = encodeFeedFilters(f({ speakers: ["Jake Evans"] }));
    expect(qs).toContain("sp=Jake+Evans");
    expect(qs).not.toContain("spm=");
    expect(qs).not.toContain("tgm=");
    expect(qs).not.toContain("sk=");
  });

  it("repeats list params instead of delimiting them", () => {
    const qs = encodeFeedFilters(f({ speakers: ["Jake Evans", "Keya Patel"] }));
    expect(qs.match(/(^|&)sp=/g)).toHaveLength(2);
  });
});

describe("round-trip", () => {
  it("survives every dimension at once", () => {
    const original = f({
      query: "milk a cow",
      speakers: ["Jake Evans", "Keya Patel"],
      speakerMode: "and",
      tags: ["farm", "banter"],
      tagMode: "or",
      since: "2021-07-01",
      before: "2021-07-31",
      hours: [20, 21],
      weekdays: [4],
      onlyIncomplete: true,
      sortKey: "created_at",
      sortDir: "asc",
    });
    expect(decode(encodeFeedFilters(original))).toEqual(original);
  });

  // The reason list params are repeated rather than comma-joined.
  it("preserves names containing delimiters and unicode", () => {
    const original = f({ speakers: ["Smith, John", "11 yr old girl in movie", "Ioana Ciosu"] });
    expect(decode(encodeFeedFilters(original)).speakers).toEqual(original.speakers);
  });

  it("preserves an ampersand in a search query", () => {
    const original = f({ query: "a & b = c?" });
    expect(decode(encodeFeedFilters(original)).query).toBe("a & b = c?");
  });
});

describe("decodeFeedFilters", () => {
  it("returns the defaults for an empty query string", () => {
    expect(decode("")).toEqual(DEFAULT_FILTERS);
  });

  it("ignores unknown params", () => {
    expect(decode("utm_source=twitter&nonsense=1")).toEqual(DEFAULT_FILTERS);
  });

  it("falls back rather than throwing on malformed values", () => {
    const out = decode("from=18/03/2021&to=nope&hr=99&hr=abc&wd=7&sk=bogus&sd=sideways");
    expect(out.since).toBeNull();
    expect(out.before).toBeNull();
    expect(out.hours).toEqual([]); // 99 out of range, "abc" not a number
    expect(out.weekdays).toEqual([]); // 7 is out of range for Mon..Sun
    expect(out.sortKey).toBe(DEFAULT_FILTERS.sortKey);
    expect(out.sortDir).toBe(DEFAULT_FILTERS.sortDir);
  });

  it("de-duplicates and sorts numeric lists, and drops blank strings", () => {
    expect(decode("hr=20&hr=20&hr=9").hours).toEqual([9, 20]);
    expect(decode("sp=Jake&sp=Jake&sp=+&sp=Keya").speakers).toEqual(["Jake", "Keya"]);
  });

  it("accepts boundary values", () => {
    expect(decode("hr=0&hr=23").hours).toEqual([0, 23]);
    expect(decode("wd=0&wd=6").weekdays).toEqual([0, 6]);
  });
});

describe("feedHref", () => {
  it("links to the bare feed when nothing is overridden", () => {
    expect(feedHref("book-1", {})).toBe("/quotebook/book-1");
  });

  it("applies exactly one dimension, ignoring any prior state", () => {
    expect(feedHref("book-1", { speakers: ["Keya Patel"] })).toBe(
      "/quotebook/book-1?sp=Keya+Patel",
    );
  });
});

describe("monthBounds", () => {
  it("covers the whole month inclusively", () => {
    expect(monthBounds("2021-07")).toEqual({ since: "2021-07-01", before: "2021-07-31" });
    expect(monthBounds("2021-06")).toEqual({ since: "2021-06-01", before: "2021-06-30" });
  });

  it("handles February in both common and leap years", () => {
    expect(monthBounds("2021-02").before).toBe("2021-02-28");
    expect(monthBounds("2020-02").before).toBe("2020-02-29");
  });

  it("handles December without rolling the year", () => {
    expect(monthBounds("2021-12")).toEqual({ since: "2021-12-01", before: "2021-12-31" });
  });
});
