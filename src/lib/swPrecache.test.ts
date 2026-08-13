/**
 * Service worker precache — asset extraction.
 *
 * `public/sw.js` is a classic worker script, not a module, so it cannot be
 * imported. Rather than restate its regex here (which would test a copy and
 * pass happily while the shipped worker broke), this reads the real file and
 * evaluates the one pure function out of it.
 *
 * What it guards: install-time precaching only works if the worker can find
 * the `/_next/` bundles a route's HTML references. Miss them and the shell
 * still caches, the app still "installs", and it is only offline — the one
 * moment it matters — that the page loads and then fails to boot.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SW_SOURCE = readFileSync(
  path.resolve(__dirname, "../../public/sw.js"),
  "utf8",
);

/** Lift `extractBuildAssets` out of the shipped worker and make it callable. */
function loadExtractor(): (html: string) => string[] {
  const match = SW_SOURCE.match(
    /function extractBuildAssets\(html\) \{[\s\S]*?\n\}/,
  );
  if (!match) {
    throw new Error("extractBuildAssets not found in public/sw.js");
  }
  return new Function(`${match[0]}; return extractBuildAssets;`)() as (
    html: string,
  ) => string[];
}

const extractBuildAssets = loadExtractor();

describe("extractBuildAssets", () => {
  it("finds scripts and stylesheets a Next document references", () => {
    const html = `<!DOCTYPE html><html><head>
      <link rel="stylesheet" href="/_next/static/chunks/abc123.css"/>
      <link rel="preload" as="script" href="/_next/static/chunks/main-app-def.js"/>
      </head><body>
      <script src="/_next/static/chunks/webpack-999.js" async=""></script>
      </body></html>`;

    expect(extractBuildAssets(html).sort()).toEqual([
      "/_next/static/chunks/abc123.css",
      "/_next/static/chunks/main-app-def.js",
      "/_next/static/chunks/webpack-999.js",
    ]);
  });

  it("de-duplicates an asset referenced more than once", () => {
    // Next commonly both preloads and then loads the same chunk.
    const html = `
      <link rel="preload" as="script" href="/_next/static/chunks/x.js"/>
      <script src="/_next/static/chunks/x.js"></script>`;
    expect(extractBuildAssets(html)).toEqual(["/_next/static/chunks/x.js"]);
  });

  it("ignores anything that is not build output", () => {
    // Precaching app routes, icons or third-party origins here would be wrong:
    // routes are precached separately as shells, and cross-origin requests are
    // deliberately never touched by the worker.
    const html = `
      <link rel="manifest" href="/manifest.json"/>
      <link rel="icon" href="/icon-192.png"/>
      <a href="/settings">Settings</a>
      <script src="https://example.com/analytics.js"></script>
      <script src="/_next/static/chunks/real.js"></script>`;
    expect(extractBuildAssets(html)).toEqual(["/_next/static/chunks/real.js"]);
  });

  it("unescapes HTML entities so the URL matches what the browser requests", () => {
    // Attribute values arrive escaped; leaving &amp; in place would request a
    // URL that does not exist and silently cache nothing.
    const html = `<script src="/_next/static/chunks/x.js?a=1&amp;b=2"></script>`;
    expect(extractBuildAssets(html)).toEqual(["/_next/static/chunks/x.js?a=1&b=2"]);
  });

  it("returns nothing for markup with no build output", () => {
    expect(extractBuildAssets("<html><body>offline</body></html>")).toEqual([]);
  });
});

describe("service worker contract", () => {
  it("precaches every static route the app can cold-start into", () => {
    // Dynamic routes are intentionally excluded — they are per-book and
    // unbounded, and the navigation fallback covers them.
    const routes = SW_SOURCE.match(/const PRECACHE_ROUTES = \[([\s\S]*?)\]/)?.[1];
    expect(routes).toBeTruthy();
    for (const route of [
      "/",
      "/quick",
      "/inbox",
      "/manage",
      "/settings",
      "/login",
      "/signup",
      "/reset-password",
    ]) {
      expect(routes).toContain(`"${route}"`);
    }
  });

  it("serves an app-owned fallback rather than the browser error screen", () => {
    // The whole point of the offline shell is that the user never sees
    // Chrome's dinosaur; `Response.error()` would surface exactly that.
    expect(SW_SOURCE).toContain("OFFLINE_FALLBACK_HTML");
    expect(SW_SOURCE).not.toContain("Response.error()");
  });

  it("keys cached shells by path only, never by full URL", () => {
    // The share target arrives as /quick?text=<user content>; caching by full
    // URL would persist that text in Cache Storage past sign-out.
    expect(SW_SOURCE).toContain("function shellKey(pathname)");
    expect(SW_SOURCE).toContain("self.location.origin + pathname");
  });
});
