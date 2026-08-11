import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeTags } from "@/lib/tags";
import { tick } from "@/lib/id";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tick", () => {
  it("is strictly increasing within a frozen millisecond (including counter overflow)", () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000_000);
    let prev = tick();
    for (let i = 0; i < 2500; i++) {
      const t = tick();
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it("stays monotonic when the wall clock steps backwards", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(10_000_000);
    const a = tick();
    now.mockReturnValue(9_000_000); // clock stepped back a full second
    const b = tick();
    expect(b).toBeGreaterThan(a);
  });
});

describe("normalizeTags", () => {
  it("lowercases, trims, dedupes and drops empties", () => {
    expect(normalizeTags([" Foo ", "foo", "BAR", "", "  ", "baz"])).toEqual([
      "foo",
      "bar",
      "baz",
    ]);
  });
});
