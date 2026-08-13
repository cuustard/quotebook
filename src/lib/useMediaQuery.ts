"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query from React.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: matchMedia IS an
 * external store, and this is the API that keeps a component from rendering
 * one frame with a stale answer. The server snapshot is `false`, so anything
 * gated on this renders its desktop form during SSR and corrects on hydration
 * — which is the safe direction, since the desktop layout is the one that must
 * not regress.
 *
 * Presentation that can be expressed in CSS should stay in CSS; this exists
 * for the cases where the DIFFERENCE IS STRUCTURAL — the filter panel is
 * inline on desktop and a portalled sheet on mobile, which is not one element
 * with two sets of classes.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * True below Tailwind's `lg` (1024px) — the same breakpoint the sidebar and
 * bottom bar switch on, kept in one place so the JS and CSS halves of the
 * adaptive shell can never disagree about where "mobile" ends.
 */
export function useIsCompact(): boolean {
  return useMediaQuery("(max-width: 1023.98px)");
}
