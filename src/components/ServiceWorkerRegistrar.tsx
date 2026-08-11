"use client";

/**
 * Registers the service worker that makes Quotebook installable (and so
 * share-target capable) and openable offline.
 *
 * Dev is deliberately skipped: a cached shell against Next's hot-reloading
 * dev server produces confusing staleness.
 */

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        // Not fatal — the app works fine without it, just not offline-cold.
        console.warn("[sw] registration failed", err);
      });
    };

    // Wait for load so registration never competes with first paint.
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
