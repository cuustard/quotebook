// @vitest-environment jsdom

/**
 * Swipe triage gesture.
 *
 * The contract worth guarding is not "a swipe works" but everything it must
 * NOT do: never fire for a mouse, never eat a tap, never hijack a vertical
 * scroll, and never delete on a short brush. Each of those failures is
 * invisible on desktop and destructive on touch.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SwipeableRow } from "@/components/SwipeableRow";

afterEach(cleanup);

/** Past the 110px commit distance in the hook. */
const COMMIT = 140;

function setup() {
  const onSwipeRight = vi.fn();
  const onSwipeLeft = vi.fn();
  const onClick = vi.fn();
  const utils = render(
    <SwipeableRow
      onSwipeRight={onSwipeRight}
      onSwipeLeft={onSwipeLeft}
      rightLabel="Confirm"
      leftLabel="Delete"
    >
      <button onClick={onClick}>Delete</button>
    </SwipeableRow>,
  );
  const row = utils.container.querySelector(".touch-pan-y") as HTMLElement;
  return { onSwipeRight, onSwipeLeft, onClick, row, ...utils };
}

/** Drive a gesture. `pointerType` is the whole point of these tests. */
function gesture(
  el: HTMLElement,
  { dx, dy = 0, pointerType = "touch" }: { dx: number; dy?: number; pointerType?: string },
) {
  const opts = { pointerType, pointerId: 1 };
  fireEvent.pointerDown(el, { ...opts, clientX: 200, clientY: 300 });
  // Two moves: the first crosses the slop and decides the axis, the second
  // travels — which is how a real drag arrives.
  fireEvent.pointerMove(el, { ...opts, clientX: 200 + dx / 2, clientY: 300 + dy / 2 });
  fireEvent.pointerMove(el, { ...opts, clientX: 200 + dx, clientY: 300 + dy });
  fireEvent.pointerUp(el, { ...opts, clientX: 200 + dx, clientY: 300 + dy });
}

describe("swipe triage", () => {
  it("commits the right action on a full right swipe", () => {
    const { row, onSwipeRight, onSwipeLeft } = setup();
    gesture(row, { dx: COMMIT });
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it("commits the left action on a full left swipe", () => {
    const { row, onSwipeRight, onSwipeLeft } = setup();
    gesture(row, { dx: -COMMIT });
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("ignores a swipe that stops short of the commit distance", () => {
    // Swipe-left deletes, so a brush past the row must never be destructive.
    const { row, onSwipeLeft, onSwipeRight } = setup();
    gesture(row, { dx: -60 });
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("NEVER fires for a mouse, however far it is dragged", () => {
    // This is what makes the feature additive: desktop cannot reach it.
    const { row, onSwipeLeft, onSwipeRight } = setup();
    gesture(row, { dx: -400, pointerType: "mouse" });
    gesture(row, { dx: 400, pointerType: "mouse" });
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("yields to a vertical drag so the list still scrolls", () => {
    const { row, onSwipeRight } = setup();
    gesture(row, { dx: COMMIT, dy: 400 }); // mostly vertical
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("leaves taps alone", () => {
    const { row, onClick, onSwipeLeft, onSwipeRight } = setup();
    fireEvent.pointerDown(row, { pointerType: "touch", pointerId: 1, clientX: 200, clientY: 300 });
    fireEvent.pointerUp(row, { pointerType: "touch", pointerId: 1, clientX: 200, clientY: 300 });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it("swallows the click synthesised at the end of a swipe", () => {
    // Releasing a swipe on top of a button must not also press that button.
    const { row, onClick, onSwipeLeft } = setup();
    gesture(row, { dx: -COMMIT });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("only swallows one click, so the next tap works", () => {
    const { row, onClick } = setup();
    gesture(row, { dx: -COMMIT });
    fireEvent.click(screen.getByRole("button", { name: "Delete" })); // swallowed
    fireEvent.click(screen.getByRole("button", { name: "Delete" })); // must land
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps vertical scrolling with the browser", () => {
    const { row } = setup();
    // `touch-action: pan-y` is what lets the page scroll while we take the
    // horizontal axis; without it the gesture and the scroller fight.
    expect(row.className).toContain("touch-pan-y");
  });
});
