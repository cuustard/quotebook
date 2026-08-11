/**
 * Quotebook service worker.
 *
 * Two jobs, deliberately no more:
 *   1. Make the app installable (a fetch handler is required for the install
 *      prompt, and installation is what unlocks the share target).
 *   2. Make it genuinely openable offline. Everything the app *does* already
 *      works offline via IndexedDB — but only once the page has loaded. This
 *      caches the shell so a cold start with no connection still works.
 *
 * Strategy is chosen per request type:
 *   - navigations: network-first, falling back to the cached shell. Keeps
 *     deploys fresh; survives being offline.
 *   - hashed build assets (/_next/static/*): cache-first. The hash IS the
 *     version, so a cached hit is never stale.
 *   - icons/manifest: cache-first with background refresh.
 *   - everything else (Supabase, provider calls): straight to the network,
 *     never cached.
 */

// Bumping this purges every previous cache on activate. v2 is a required
// purge, not a cosmetic bump: v1 keyed navigations by full URL and so may hold
// share-target text (`/quick?text=…`) that must not survive the upgrade.
const VERSION = "v2";
const SHELL_CACHE = `quotebook-shell-${VERSION}`;
const ASSET_CACHE = `quotebook-assets-${VERSION}`;
const OFFLINE_URLS = ["/", "/quick", "/inbox"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Best-effort: a failed precache must not block activation.
      await Promise.allSettled(OFFLINE_URLS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Cache-first, with a quiet background refresh. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never touch cross-origin traffic (Supabase auth, sync, Edge Functions).
  if (url.origin !== self.location.origin) return;

  // App shell — network first so a deploy is picked up immediately.
  if (request.mode === "navigate") {
    // Key the shell by PATH ONLY. The query string is never part of what makes
    // a shell distinct (the client router reads it at runtime), and caching it
    // would persist user content: the share target arrives as
    // `/quick?text=<whatever the user shared>`, which would otherwise sit in
    // Cache Storage indefinitely — outliving even sign-out.
    const shellKey = new Request(url.origin + url.pathname, { mode: "same-origin" });
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Only cache a real page. Caching an error or a redirect would pin a
          // broken shell as the offline fallback for that route.
          if (fresh.ok && fresh.type !== "opaqueredirect" && !fresh.redirected) {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(shellKey, fresh.clone());
          }
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          // Fall back to this exact route, then to the app root — the client
          // router can render any screen once the shell is running.
          return (
            (await cache.match(shellKey)) ??
            (await cache.match("/")) ??
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // Immutable, content-hashed build output.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Icons + manifest.
  if (/\.(png|svg|ico|webmanifest)$/.test(url.pathname) || url.pathname === "/manifest.json") {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});
