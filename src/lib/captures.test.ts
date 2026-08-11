import { describe, expect, it } from "vitest";
import {
  canTransition,
  isRetryDue,
  resolutionBlocked,
  retryDelayMs,
} from "@/lib/captures";

describe("retryDelayMs", () => {
  it("backs off exponentially from 5s", () => {
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(2)).toBe(10_000);
    expect(retryDelayMs(3)).toBe(20_000);
    expect(retryDelayMs(4)).toBe(40_000);
  });

  it("caps at 5 minutes", () => {
    expect(retryDelayMs(10)).toBe(300_000);
    expect(retryDelayMs(100)).toBe(300_000);
  });

  it("treats 0 attempts like the first retry", () => {
    expect(retryDelayMs(0)).toBe(5_000);
  });
});

describe("isRetryDue", () => {
  const at = "2026-08-07T10:00:00.000Z";
  const atMs = new Date(at).getTime();

  it("is always due before the first attempt", () => {
    expect(isRetryDue({ attempts: 0, attempted_at: null }, atMs)).toBe(true);
  });

  it("waits out the backoff window after a failure", () => {
    const c = { attempts: 2, attempted_at: at }; // window = 10s
    expect(isRetryDue(c, atMs + 9_999)).toBe(false);
    expect(isRetryDue(c, atMs + 10_000)).toBe(true);
  });
});

describe("canTransition", () => {
  it("allows the AI path: pending → parsing → parsed → done", () => {
    expect(canTransition("pending", "parsing")).toBe(true);
    expect(canTransition("parsing", "parsed")).toBe(true);
    expect(canTransition("parsed", "done")).toBe(true);
  });

  it("allows manual conversion and failure rescue", () => {
    expect(canTransition("pending", "done")).toBe(true);
    expect(canTransition("parsing", "failed")).toBe(true);
    expect(canTransition("failed", "done")).toBe(true);
    expect(canTransition("failed", "pending")).toBe(true); // manual retry
    expect(canTransition("parsing", "pending")).toBe(true); // retry later
  });

  it("rejects everything out of done, and skipping states", () => {
    expect(canTransition("done", "pending")).toBe(false);
    expect(canTransition("done", "parsed")).toBe(false);
    expect(canTransition("pending", "parsed")).toBe(false); // must go via parsing
    expect(canTransition("parsed", "failed")).toBe(false);
  });
});

describe("resolutionBlocked", () => {
  const ok = { online: true, signedIn: true, configured: true };

  it("passes when everything is available", () => {
    expect(resolutionBlocked(ok)).toBeNull();
  });

  it("blocks offline, guest, and unconfigured — in that priority order", () => {
    expect(resolutionBlocked({ ...ok, online: false })).toBe("offline");
    expect(resolutionBlocked({ ...ok, signedIn: false })).toBe(
      "sign in to use AI parsing",
    );
    expect(resolutionBlocked({ ...ok, configured: false })).toBe(
      "backend not configured",
    );
  });
});
