/**
 * Take pointer capture, tolerating the cases where it cannot be taken.
 *
 * Capture is what lets a drag survive the pointer leaving the element it
 * started on — which happens immediately here, because the element moves with
 * the finger. But `setPointerCapture` THROWS `NotFoundError` if the pointer id
 * is no longer active, which can happen if the gesture was cancelled between
 * the browser dispatching the event and the handler running.
 *
 * Optional chaining does not help: it guards against the method being absent,
 * not against it throwing. An uncaught throw inside a pointermove handler
 * would abort the gesture mid-drag and leave the row stuck mid-swipe, so the
 * failure is swallowed — losing capture degrades the drag, it does not break
 * the app.
 */
export function capturePointer(e: React.PointerEvent): void {
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId);
  } catch {
    // Pointer already gone; the gesture ends on the next up/cancel anyway.
  }
}
