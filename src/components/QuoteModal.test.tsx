// @vitest-environment jsdom

/**
 * QuoteModal behaviour.
 *
 * Focused on the save-validation rules and on error lifecycle across open/close
 * — the latter is what pins the refactor that moves `setError(null)` out of the
 * open effect (react-hooks/set-state-in-effect). A stale error surviving into
 * the next open would be a real, user-visible bug, so it is asserted directly.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Mock the repo so the modal is tested in isolation — importing it for real
// would pull in the sync engine and Supabase.
const createQuote = vi.fn(async () => "quote-1");
const updateQuote = vi.fn(async () => {});
vi.mock("@/lib/repo", () => ({
  createQuote: (...a: unknown[]) => createQuote(...(a as [])),
  updateQuote: (...a: unknown[]) => updateQuote(...(a as [])),
}));
vi.mock("@/lib/captures", () => ({ completeCapture: vi.fn(async () => {}) }));

const { QuoteModal } = await import("@/components/QuoteModal");
const { useUIStore } = await import("@/store/useUIStore");

const BOOK = "book-1";

const openCreate = () =>
  act(() => {
    useUIStore.getState().openCreateQuote(BOOK);
  });
const closeModal = () =>
  act(() => {
    useUIStore.getState().closeQuoteModal();
  });

const speaker = () => screen.getByPlaceholderText("Quotee") as HTMLInputElement;
const said = () => screen.getByPlaceholderText("What was said…") as HTMLTextAreaElement;
const saveBtn = () => screen.getByRole("button", { name: /Add quote|Saving…/ });

/** Fill the first line so the form becomes saveable. */
function fillValidLine() {
  fireEvent.change(speaker(), { target: { value: "Jake" } });
  fireEvent.change(said(), { target: { value: "milk a cow" } });
}

beforeEach(() => {
  createQuote.mockClear();
  updateQuote.mockClear();
  createQuote.mockImplementation(async () => "quote-1");
  closeModal();
});
afterEach(cleanup);

describe("QuoteModal", () => {
  it("renders nothing until the store opens it", () => {
    render(<QuoteModal />);
    expect(screen.queryByPlaceholderText("Quotee")).toBeNull();
    openCreate();
    expect(speaker()).toBeTruthy();
  });

  it("blocks saving until a line has both a speaker and text", async () => {
    render(<QuoteModal />);
    openCreate();
    expect(saveBtn()).toHaveProperty("disabled", true);

    fireEvent.change(said(), { target: { value: "milk a cow" } });
    expect(saveBtn()).toHaveProperty("disabled", true); // text but no speaker

    fireEvent.change(speaker(), { target: { value: "Jake" } });
    await waitFor(() => expect(saveBtn()).toHaveProperty("disabled", false));
  });

  it("saves through createQuote and closes", async () => {
    render(<QuoteModal />);
    openCreate();
    fillValidLine();
    fireEvent.click(saveBtn());

    await waitFor(() => expect(createQuote).toHaveBeenCalledTimes(1));
    const [bookId, input] = createQuote.mock.calls[0] as unknown as [
      string,
      { lines: Array<{ speaker: string; line_text: string }> },
    ];
    expect(bookId).toBe(BOOK);
    expect(input.lines).toHaveLength(1);
    expect(input.lines[0]).toMatchObject({ speaker: "Jake", line_text: "milk a cow" });

    await waitFor(() => expect(useUIStore.getState().quoteModal.open).toBe(false));
  });

  it("drops lines that have a speaker but nothing said", async () => {
    render(<QuoteModal />);
    openCreate();
    fillValidLine();
    fireEvent.click(screen.getByRole("button", { name: "+ Add line" }));

    // Second line: speaker only, no text.
    const speakers = screen.getAllByPlaceholderText("Quotee");
    fireEvent.change(speakers[1], { target: { value: "Keya" } });
    fireEvent.click(saveBtn());

    await waitFor(() => expect(createQuote).toHaveBeenCalledTimes(1));
    const [, input] = createQuote.mock.calls[0] as unknown as [
      string,
      { lines: unknown[] },
    ];
    expect(input.lines).toHaveLength(1); // the blank one never persists
  });

  it("surfaces a save failure instead of closing", async () => {
    createQuote.mockImplementation(async () => {
      throw new Error("disk on fire");
    });
    render(<QuoteModal />);
    openCreate();
    fillValidLine();
    fireEvent.click(saveBtn());

    await waitFor(() => expect(screen.getByText("disk on fire")).toBeTruthy());
    expect(useUIStore.getState().quoteModal.open).toBe(true); // stays open to retry
  });

  it("does NOT carry a stale error into the next open", async () => {
    // The behaviour under refactor. Reopening after a failure must present a
    // clean form, not last time's red text.
    createQuote.mockImplementation(async () => {
      throw new Error("disk on fire");
    });
    render(<QuoteModal />);
    openCreate();
    fillValidLine();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(screen.getByText("disk on fire")).toBeTruthy());

    // Close via the Cancel button, the way a user would.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(useUIStore.getState().quoteModal.open).toBe(false));

    openCreate();
    expect(screen.queryByText("disk on fire")).toBeNull();
  });

  it("adds and removes dialogue lines", () => {
    render(<QuoteModal />);
    openCreate();
    expect(screen.getAllByPlaceholderText("Quotee")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "+ Add line" }));
    expect(screen.getAllByPlaceholderText("Quotee")).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove line" })[0]);
    expect(screen.getAllByPlaceholderText("Quotee")).toHaveLength(1);
  });
});
