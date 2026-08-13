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
 * ─────────────────────────── Precache strategy ───────────────────────────
 * Caching a route's HTML is NOT enough to open it offline. The document is a
 * near-empty skeleton; everything the user sees comes from the `/_next/`
 * bundles it references. Precaching only documents (what this used to do) left
 * any route the browser had not already fetched broken offline — the shell
 * loaded and then failed to boot.
 *
 * So install fetches each route and ALSO pulls the build assets that route's
 * HTML references. The asset URLs are read out of the markup rather than from
 * a build manifest on purpose: they are content-hashed and change every build,
 * and scraping them at install time means the worker never carries a hardcoded
 * list that can silently drift out of date.
 *
 * Strategy is chosen per request type:
 *   - navigations: network-first, falling back to the cached shell. Keeps
 *     deploys fresh; survives being offline.
 *   - hashed build assets (/_next/static/*): cache-first. The hash IS the
 *     version, so a cached hit is never stale.
 *   - RSC payloads: network-first, cached on success, so client-side
 *     navigation between already-visited routes keeps working offline.
 *   - icons/manifest: cache-first.
 *   - everything else (Supabase, provider calls): straight to the network,
 *     never cached.
 */

// Bumping this purges every previous cache on activate. v3 rebuilds the shell
// cache so existing installs pick up the asset precache above; v2 was itself a
// required purge (v1 keyed navigations by full URL and so could hold
// share-target text, `/quick?text=…`, which must not survive an upgrade).
const VERSION = "v3";
const SHELL_CACHE = `quotebook-shell-${VERSION}`;
const ASSET_CACHE = `quotebook-assets-${VERSION}`;

/**
 * Every route that can be cold-started offline.
 *
 * Dynamic routes (`/quotebook/<id>`, and its `/stats`) are deliberately absent
 * — their shells are per-book and unbounded in number. They are covered by the
 * navigation fallback: the client router boots from the cached root shell and
 * then renders the book straight out of IndexedDB.
 */
const PRECACHE_ROUTES = [
  "/",
  "/quick",
  "/inbox",
  "/manage",
  "/settings",
  "/login",
  "/signup",
  "/reset-password",
];

/**
 * Last-resort navigation response. Only reached when even the root shell is
 * missing (i.e. the worker installed but every precache fetch failed), and it
 * exists so that case still renders something owned by the app rather than the
 * browser's network-error screen.
 */
const OFFLINE_FALLBACK_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quotebook — offline</title>
<style>
  html,body{height:100%;margin:0}
  body{display:grid;place-items:center;background:#1e1f22;color:#f2f3f5;
       font:400 15px/1.5 ui-sans-serif,system-ui,sans-serif;text-align:center;padding:2rem}
  p{color:#949ba4;max-width:28rem}
</style></head>
<body><div>
  <h1 style="font-size:1.25rem;margin:0 0 .5rem">You're offline</h1>
  <p>Quotebook hasn't finished caching itself yet. Reconnect once and it will
     open offline from then on — your quotes are stored on this device.</p>
</div></body></html>`;

/** Shell entries are keyed by PATH ONLY — see the navigation handler. */
function shellKey(pathname) {
  return new Request(self.location.origin + pathname, { mode: "same-origin" });
}

/**
 * Pull the `/_next/` URLs a document references. Covers `<script src>`,
 * `<link href>` (stylesheets and preloads) alike — anything same-origin under
 * `/_next/` is build output the route needs in order to boot.
 */
function extractBuildAssets(html) {
  const urls = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)) {
    // Ampersands are HTML-escaped in attributes; unescape so the request URL
    // matches what the browser would actually ask for.
    urls.add(match[1].replace(/&amp;/g, "&"));
  }
  return [...urls];
}

async function precacheRoute(shellCache, assetCache, pathname) {
  // `cache: "reload"` so installing after a deploy can't re-cache a stale HTTP
  // cache entry that still points at the previous build's chunks.
  const response = await fetch(pathname, { cache: "reload" });
  if (!response.ok) return;

  const forCache = response.clone();
  const html = await response.text();
  await shellCache.put(shellKey(pathname), forCache);

  const assets = extractBuildAssets(html);
  // Best-effort per asset: one 404 (say, a preload that no longer exists)
  // must not abandon the rest of the route's bundles.
  await Promise.allSettled(assets.map((asset) => assetCache.add(asset)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const [shellCache, assetCache] = await Promise.all([
        caches.open(SHELL_CACHE),
        caches.open(ASSET_CACHE),
      ]);
      // Best-effort: a failed precache must not block activation. A partially
      // cached app still beats no offline support at all.
      await Promise.allSettled(
        PRECACHE_ROUTES.map((route) => precacheRoute(shellCache, assetCache, route)),
      );
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

/**
 * Background Sync — drain the capture parse queue when connectivity returns.
 *
 * The worker cannot do the parse itself: it needs the user's Supabase session
 * to call the Edge Function, and that lives in the page. So the worker's job is
 * to WAKE a client and let it do the work. `sync` fires when the platform
 * decides the network is genuinely back, which is the part a page cannot do for
 * itself once it has been closed.
 *
 * If no client is open the queue is left alone rather than dropped — captures
 * are already durable in IndexedDB, and the next boot sweep will pick them up.
 * That is why this is an optimisation and never the only path: Background Sync
 * is Chromium-only, so Safari and Firefox rely entirely on the boot/interval
 * sweeps in src/lib/captures.ts.
 */
const PARSE_QUEUE_TAG = "quotebook-parse-queue";

self.addEventListener("sync", (event) => {
  if (event.tag !== PARSE_QUEUE_TAG) return;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        client.postMessage({ type: "quotebook:drain-parse-queue" });
      }
    })(),
  );
});

/** Cache-first — for content-hashed output, where a hit is never stale. */
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
    const key = shellKey(url.pathname);
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Only cache a real page. Caching an error or a redirect would pin a
          // broken shell as the offline fallback for that route.
          if (fresh.ok && fresh.type !== "opaqueredirect" && !fresh.redirected) {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(key, fresh.clone());
          }
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          // This exact route, then the app root — the client router can render
          // any screen (including a dynamic /quotebook/<id>) once the shell is
          // running, since the data comes from IndexedDB. The inline fallback
          // is the floor: never surface the browser's error screen.
          return (
            (await cache.match(key)) ??
            (await cache.match(shellKey("/"))) ??
            new Response(OFFLINE_FALLBACK_HTML, {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            })
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

  // React Server Component payloads, which the client router fetches when
  // navigating between routes. Network-first so a deploy wins, cached so the
  // same navigation still works on a later offline visit.
  if (url.searchParams.has("_rsc")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        // Key by path + the RSC marker only: the rest of the query can carry
        // user content (again, the share target), which must not be cached.
        const rscKey = new Request(`${url.origin}${url.pathname}?_rsc=1`, {
          mode: "same-origin",
        });
        try {
          const fresh = await fetch(request);
          if (fresh.ok) await cache.put(rscKey, fresh.clone());
          return fresh;
        } catch {
          const hit = await cache.match(rscKey);
          if (hit) return hit;
          throw new Error("offline and no cached RSC payload");
        }
      })(),
    );
    return;
  }

  // Icons + manifest.
  if (/\.(png|svg|ico|webmanifest)$/.test(url.pathname) || url.pathname === "/manifest.json") {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});
