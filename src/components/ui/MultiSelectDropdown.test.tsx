// @vitest-environment jsdom

/**
 * MultiSelectDropdown behaviour.
 *
 * Written to pin the search-reset-on-open behaviour BEFORE moving it out of an
 * effect (react-hooks/set-state-in-effect), so the refactor is provably
 * behaviour-preserving rather than merely lint-clean.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";

afterEach(cleanup);

/** More options than the default searchThreshold (8), so the box renders. */
const MANY = ["Ana", "Ben", "Cara", "Dan", "Eve", "Finn", "Gus", "Hana", "Ivy"];

let root: HTMLElement;

function setup(props: Partial<React.ComponentProps<typeof MultiSelectDropdown>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <MultiSelectDropdown
      options={MANY}
      selected={[]}
      onChange={onChange}
      noun="speaker"
      {...props}
    />,
  );
  root = utils.container;
  return { onChange, ...utils };
}

// The trigger is always the first button in the tree; matching it by its label
// is brittle because the label IS the selection summary under test.
const trigger = () => root.querySelector("button") as HTMLButtonElement;
const search = () => screen.getByPlaceholderText("Search speakers…");
/** The expanded list — always the trigger's next sibling. Selected structurally
 *  rather than by class so a restyle doesn't break it. Scoping matters: with
 *  one thing selected the trigger's label is that same name, so an unscoped
 *  query matches two buttons. */
const panel = () => trigger().nextElementSibling as HTMLElement;
const option = (name: string) => within(panel()).getByRole("button", { name });
const noOption = (name: string) => within(panel()).queryByRole("button", { name });

describe("MultiSelectDropdown", () => {
  it("is closed until the trigger is clicked", () => {
    setup();
    expect(screen.queryByPlaceholderText("Search speakers…")).toBeNull();
    fireEvent.click(trigger());
    expect(search()).toBeTruthy();
  });

  it("filters options by the search query", () => {
    setup();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "an" } });

    // Ana, Dan, Hana contain "an"; Ben does not.
    expect(option("Ana")).toBeTruthy();
    expect(option("Dan")).toBeTruthy();
    expect(noOption("Ben")).toBeNull();
  });

  it("shows an empty state when nothing matches", () => {
    setup();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "zzzz" } });
    expect(screen.getByText("No matches.")).toBeTruthy();
  });

  it("RESETS the search query when reopened", () => {
    // The behaviour under refactor: a stale query must not survive a close/open
    // cycle, or the list silently opens pre-filtered.
    setup();
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "zzzz" } });
    expect(screen.getByText("No matches.")).toBeTruthy();

    fireEvent.click(trigger()); // close
    fireEvent.click(trigger()); // reopen

    expect((search() as HTMLInputElement).value).toBe("");
    expect(option("Ben")).toBeTruthy();
  });

  it("adds and removes values through onChange", () => {
    const { onChange } = setup({ selected: ["Ana"] });
    fireEvent.click(trigger());

    fireEvent.click(option("Ben"));
    expect(onChange).toHaveBeenCalledWith(["Ana", "Ben"]);

    fireEvent.click(option("Ana"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("clears every selection via Clear", () => {
    const { onChange } = setup({ selected: ["Ana", "Ben"] });
    fireEvent.click(trigger());
    fireEvent.click(option("Clear"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("stays open until the trigger is toggled", () => {
    // The list occupies layout rather than floating over it, so dismissing it
    // on an outside click or Escape would collapse the panel and shift
    // everything under the pointer. Only the trigger closes it.
    setup();
    fireEvent.click(trigger());
    expect(search()).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(search()).toBeTruthy();

    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(search()).toBeTruthy();

    // Selecting an option also leaves it open, so several can be picked.
    fireEvent.click(option("Ben"));
    expect(search()).toBeTruthy();

    fireEvent.click(trigger());
    expect(screen.queryByPlaceholderText("Search speakers…")).toBeNull();
  });

  it("hides the search box when there are few options", () => {
    setup({ options: ["Ana", "Ben"] });
    fireEvent.click(trigger());
    expect(screen.queryByPlaceholderText("Search speakers…")).toBeNull();
    expect(option("Ana")).toBeTruthy();
  });

  it("summarises the selection on the trigger", () => {
    const { unmount } = setup();
    expect(trigger().textContent).toContain("Any speaker");
    unmount();

    const two = setup({ selected: ["Ana", "Ben"], prefix: "#" });
    expect(trigger().textContent).toContain("#Ana, #Ben");
    two.unmount();

    setup({ selected: ["Ana", "Ben", "Cara"] });
    expect(trigger().textContent).toContain("3 speakers selected");
  });
});
