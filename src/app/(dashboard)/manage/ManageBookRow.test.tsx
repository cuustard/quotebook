// @vitest-environment jsdom

/**
 * ManageBookRow — the rename box's prop→state sync.
 *
 * This pins the refactor that replaced `useEffect(() => setName(book.name))`
 * with React's "adjust state during render when a prop changes" pattern
 * (react-hooks/set-state-in-effect). The interesting cases are the two that a
 * naive `useState(book.name)` gets wrong: a rename arriving from outside must
 * be adopted, but the user's in-progress typing must not be clobbered by an
 * unrelated re-render.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/invites", () => ({
  listInvites: vi.fn(async () => []),
  generateInvite: vi.fn(),
  revokeInvite: vi.fn(),
}));
vi.mock("@/lib/repo", () => ({
  renameQuotebook: vi.fn(async () => {}),
  deleteQuotebook: vi.fn(async () => {}),
}));

const { ManageBookRow } = await import("@/app/(dashboard)/manage/page");
const { renameQuotebook } = await import("@/lib/repo");

type Book = Parameters<typeof ManageBookRow>[0]["book"];

const book = (name: string): Book =>
  ({
    id: "book-1",
    owner_id: "user-1",
    name,
    is_private: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    field_updated_at: {},
    deleted: false,
  }) as Book;

function renderRow(name: string) {
  const utils = render(<ManageBookRow book={book(name)} canAdmin ownedByMe />);
  // The row is collapsed by default; the rename box lives inside.
  fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  return utils;
}

const renameInput = () =>
  document.querySelector("input.qb-input") as HTMLInputElement;

afterEach(cleanup);

describe("ManageBookRow rename box", () => {
  it("seeds from the book name", () => {
    renderRow("Road Trip");
    expect(renameInput().value).toBe("Road Trip");
  });

  it("adopts a rename that arrives from another device", () => {
    const { rerender } = renderRow("Road Trip");
    expect(renameInput().value).toBe("Road Trip");

    // A sync pull renames the book underneath the open row.
    rerender(<ManageBookRow book={book("Road Trip 2024")} canAdmin ownedByMe />);
    expect(renameInput().value).toBe("Road Trip 2024");
  });

  it("keeps what the user is typing across an unrelated re-render", () => {
    const { rerender } = renderRow("Road Trip");
    fireEvent.change(renameInput(), { target: { value: "Road Trip Vol " } });

    // Same book name — nothing external changed, so the draft must survive.
    rerender(<ManageBookRow book={book("Road Trip")} canAdmin ownedByMe />);
    expect(renameInput().value).toBe("Road Trip Vol ");
  });

  it("disables Rename until the name actually differs", () => {
    renderRow("Road Trip");
    const btn = () => screen.getByRole("button", { name: "Rename" });
    expect(btn()).toHaveProperty("disabled", true);

    fireEvent.change(renameInput(), { target: { value: "Road Trip 2" } });
    expect(btn()).toHaveProperty("disabled", false);

    fireEvent.change(renameInput(), { target: { value: "   " } });
    expect(btn()).toHaveProperty("disabled", true); // blank is not a rename
  });

  it("commits a rename through the repo", () => {
    renderRow("Road Trip");
    fireEvent.change(renameInput(), { target: { value: "Road Trip 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(renameQuotebook).toHaveBeenCalledWith("book-1", "Road Trip 2");
  });
});
