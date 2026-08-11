import { describe, expect, it } from "vitest";
import { clockMax, mergeRecord } from "@/lib/merge";
import type { SyncMeta } from "@/lib/types";

type Row = SyncMeta & { id: string; name: string; color: string };

const FIELDS = ["name", "color"] as const;

function row(partial: Partial<Row>): Row {
  return {
    id: "r1",
    name: "a",
    color: "red",
    updated_at: "2026-01-01T00:00:00.000Z",
    field_updated_at: {},
    ...partial,
  };
}

describe("mergeRecord", () => {
  it("adopts remote wholesale when there is no local row", () => {
    const remote = row({ name: "remote", field_updated_at: { name: 100 } });
    const { merged, changedLocally, localIsNewer } = mergeRecord(
      undefined,
      remote,
      FIELDS,
    );
    expect(merged).toBe(remote);
    expect(changedLocally).toBe(true);
    expect(localIsNewer).toBe(false);
  });

  it("lets concurrent edits to different fields both survive", () => {
    const local = row({
      name: "local-name",
      color: "red",
      field_updated_at: { name: 200, color: 100 },
    });
    const remote = row({
      name: "old-name",
      color: "blue",
      field_updated_at: { name: 100, color: 300 },
    });
    const { merged, changedLocally, localIsNewer } = mergeRecord(
      local,
      remote,
      FIELDS,
    );
    expect(merged.name).toBe("local-name"); // local won its field
    expect(merged.color).toBe("blue"); // remote won its field
    expect(merged.field_updated_at).toEqual({ name: 200, color: 300 });
    expect(changedLocally).toBe(true); // color changed locally
    expect(localIsNewer).toBe(true); // name must be pushed back
  });

  it("resolves same-field conflicts by the higher tick", () => {
    const local = row({ name: "older", field_updated_at: { name: 100 } });
    const remote = row({ name: "newer", field_updated_at: { name: 100.001 } });
    const { merged } = mergeRecord(local, remote, FIELDS);
    expect(merged.name).toBe("newer");
  });

  it("treats identical ticks as the same write (keeps local, pushes nothing)", () => {
    const local = row({ name: "same", field_updated_at: { name: 100 } });
    const remote = row({ name: "same", field_updated_at: { name: 100 } });
    const { changedLocally, localIsNewer } = mergeRecord(local, remote, FIELDS);
    expect(changedLocally).toBe(false);
    expect(localIsNewer).toBe(false);
  });

  it("never resets updated_at to the 1970 epoch on an empty clock", () => {
    const local = row({ updated_at: "2026-05-05T12:00:00.000Z" });
    const remote = row({ updated_at: "2026-05-06T12:00:00.000Z" });
    const { merged } = mergeRecord(local, remote, FIELDS);
    expect(merged.updated_at).toBe("2026-05-05T12:00:00.000Z"); // untouched
    expect(merged.updated_at.startsWith("1970")).toBe(false);
  });

  it("derives updated_at from the merged clock's newest tick", () => {
    const t = Date.UTC(2026, 0, 2, 3, 4, 5);
    const local = row({ field_updated_at: { name: t } });
    const remote = row({
      name: "x",
      field_updated_at: { name: t, color: t + 5000 },
    });
    const { merged } = mergeRecord(local, remote, FIELDS);
    expect(merged.updated_at).toBe(new Date(t + 5000).toISOString());
  });
});

describe("clockMax", () => {
  it("returns the highest tick", () => {
    expect(clockMax(row({ field_updated_at: { a: 1, b: 9, c: 3 } }))).toBe(9);
  });
  it("returns 0 for an empty or missing clock", () => {
    expect(clockMax(row({}))).toBe(0);
    expect(clockMax({ updated_at: "", field_updated_at: undefined as never })).toBe(0);
  });
});
