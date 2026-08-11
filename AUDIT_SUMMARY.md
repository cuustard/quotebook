# Audit, Remediation & Performance Report

**Date:** 2026-08-11 · **Scope:** full codebase (~7,500 lines across `src/`, `supabase/`, `public/`)
**Baseline:** 107 tests passing, clean typecheck, clean lint
**Final:** 157 tests passing (was 107), clean typecheck, clean lint, production build succeeds
**Stack:** upgraded to Next 16.3 / React 19.2 / zustand 5 / dexie-react-hooks 4 — `npm audit`: 0 vulnerabilities

---

## Summary

The codebase was already in good shape — the schema had thought-through RLS, the merge engine
was well-factored, and comments explained the non-obvious decisions. Most of what follows is
therefore not "obvious bug" material but concurrency, resource-lifetime, and data-path issues
that only surface under load or overlapping calls.

Two findings are worth calling out above the rest:

1. **A silent sync data-loss bug** — rows sharing a timestamp at a pull-page boundary were
   permanently skipped and never pulled again. Fixed at both the schema and client level.
2. **A pre-existing performance bug in the feed's read path** — `getQuotesWithLines`, which
   `useLiveQuery` re-runs on *every* data change, used `anyOf()` over every quote id. Measured
   at 5.3 seconds for a 2,000-quote book. Now ~1.0s (5.1×), and 23× faster when the book is a
   slice of a larger store.

The dependency upgrade that this report originally deferred has since been completed — see
[Not actioned](#not-actioned-needs-your-decision), kept for the record.

---

## Phase 1 — Security & Logic Hardening

### 1. Race condition in `syncNow()` — HIGH
**`src/lib/sync.ts`**

The re-entrancy guard was checked, then the function `await`ed `supabase.auth.getSession()`,
and only *then* set the flag:

```
if (syncing) return;
await supabase.auth.getSession();   // ← yields
syncing = true;
```

Four independent callers can fire concurrently (the 15s interval, realtime nudges, the `online`
event, and the manual "Sync now" button). Two crossing that await window both passed the guard
and ran overlapping pull/push cycles — interleaved cursor writes and duplicate upserts.

**Fix:** claim the lock before the first await; the whole body now runs inside one `try/finally`
so every early return still releases it.
**Test:** `sync.test.ts › runs a single cycle when called concurrently` — verified to fail when
the flag is moved back after the await.

### 2. Realtime channel + interval leak — MEDIUM
**`src/store/useSyncStore.ts`**

`joinBook()` assigned `channelBookId` only *after* `await channel.subscribe()`, so its own
"already joined" guard was ineffective against concurrent calls (React Strict Mode double-mounts
the effect; a fast book switch does the same). Both calls proceeded: the first channel was
orphaned — never removed, still receiving — and its prune interval leaked permanently because
the second call overwrote the timer handle.

**Fix:** claim `channelBookId` synchronously, add a `joinGeneration` counter so a superseded join
tears down its own channel, clear any existing prune timer before installing a new one, and bump
the generation in `leaveBook()` so an in-flight join can't install itself after departure.

### 3. Edge function burned paid quota on requests that never reached a provider — MEDIUM
**`supabase/functions/parse-capture/index.ts`**

`quickadd_bump_usage` ran *before* the request body was parsed or validated. A malformed body
(422) or an unconfigured deployment (500) still consumed one of the user's 100 daily slots
despite no provider call and no cost incurred — a client-side bug could burn a whole day's
allowance without spending a cent of real money.

**Fix:** parse and validate first, resolve the provider, and bump usage immediately before the
one call that actually spends money. Also added a `try/catch` around `req.json()`, which
previously threw into the generic handler and returned a misleading 502 "will retry" for input
that would never parse.

### 4. Service worker persisted share-target text — MEDIUM (privacy)
**`public/sw.js`**

Navigations were cached keyed by full URL. The Web Share Target arrives as
`/quick?text=<whatever the user shared>`, so shared private notes were written into Cache Storage
and survived indefinitely — including across sign-out, which only clears IndexedDB. Directly at
odds with the app's stated privacy posture.

**Fix:** navigations are now cached under a path-only key (the query is never what makes a shell
distinct — the client router reads it at runtime). `VERSION` bumped to `v2`, which makes the
existing `activate` handler purge any v1 cache still holding shared text.
Also added an `ok`/redirect guard so an error page can no longer be cached as the offline shell
for a route.
**Verified in-browser:** sharing to `/quick?text=…` prefills the box and strips the query
from the URL.

### 5. Object URL revoked synchronously — LOW
**`src/lib/export.ts`** — `URL.revokeObjectURL(url)` fired immediately after `a.click()`, which
races the browser's own read of the blob and can cancel the download outright in Firefox/Safari.
Deferred by one event-loop turn.

### 6. Auth listener never unsubscribed — LOW
**`src/store/useAuthStore.ts`** — `onAuthStateChange` returns a subscription that was dropped on
the floor. A second `init()` would stack a second live listener, both driving `onUserChange`.
Now retained and replaced on re-init.

### Checked and found sound (no change made)

Verified rather than assumed — several looked suspicious and turned out to be correct:

- **RLS policies** — the upsert path genuinely does need `owner_id = auth.uid()` in both `USING`
  and `WITH CHECK`; ownership is pinned by a trigger. Invite codes are unreadable to non-members
  and redemption is a `SECURITY DEFINER` RPC with server-side expiry.
- **`stats.ts` pair keys** — the separator *looks* like a space in most editors and the doc
  comment warns that a space would corrupt names containing spaces. A hex dump confirmed it is
  a NUL byte (`\0`). Correct as written.
- **Secrets** — no secrets tracked in git; `.env.local` holds only publishable/public values;
  the provider key is correctly server-side only.
- **Prompt injection** — the parse prompt instructs the model to treat the note as data, and
  `parse.ts` independently enforces a verbatim-coverage gate, so a hallucinated attribution
  cannot enter the record on the model's say-so.
- **`id.ts` invite codes** — uses rejection sampling over a CSPRNG and refuses to fall back to
  `Math.random()`. Correct.

---

## Phase 2 — Performance

### 7. Sync cursor stranded rows at page boundaries — HIGH (silent data loss)
**`supabase/schema.sql`, `src/lib/sync.ts`**

Two compounding problems:

- `touch_updated_at()` used `now()`, which is `transaction_timestamp()` and is **stable for a
  whole statement**. The sync engine pushes its entire outbox in one `upsert`, so a bulk push
  (e.g. importing 1,500 quotes) stamped *every row with an identical `updated_at`*.
- A peer's pull fetches 1,000 rows ordered by `updated_at`, then advances its cursor to the max
  and filters `> cursor` next round. When rows share the boundary timestamp, **the remainder is
  skipped forever.**

**Fix (root cause):** both timestamp triggers now use `clock_timestamp()`, which re-reads the
clock per row and keeps rows distinct even inside a bulk statement.

**Fix (client, defence in depth):** on a *full* page the cursor now rewinds to the newest
timestamp strictly below the max, so any group split by the page limit is re-fetched next round
(merging is idempotent, so re-applying costs nothing — losing rows is unrecoverable). If an
entire full page shares one timestamp there is nothing to rewind to; that case now logs a
specific diagnostic instead of silently dropping rows. Applied to both `pullTable` and
`pullMembers`.

**Test:** `sync.test.ts › does not lose rows whose timestamp straddles the page boundary` —
verified to fail against the previous cursor logic.

### 8. Feed read path — `anyOf()` over every quote id — HIGH (pre-existing)
**`src/lib/repo.ts` › `getQuotesWithLines`**

The single hottest query in the app: every quotebook page load, re-run by `useLiveQuery` on every
data change. It used `.where("quote_id").anyOf(quoteIds)`, which performs one index seek per key.

Measured (fake-indexeddb, 2 lines per quote):

| Scenario | Before | After | |
|---|---|---|---|
| Feed, 500 quotes | 307ms | 68ms | **4.5×** |
| Feed, 2,000 quotes | 5,314ms | 1,051ms | **5.1×** |
| Feed, 200 quotes in a 2,000-quote store | 611ms | 26ms | **23.1×** |

**Fix:** one linear scan of `quote_lines` filtered through a `Set`, replacing N index seeks.

> **Note on my own first attempt:** I initially "optimized" `buildBackup` by rewriting its N+1
> into `anyOf()` — the intuitive batching fix. Benchmarking showed that made it **30× slower**
> (167ms → 5,056ms). The measurement is what caught it; the final implementation uses scans
> throughout. Comments now warn against the `anyOf` rewrite so it isn't reintroduced.

### 9. N+1 in `buildBackup` — MEDIUM
**`src/lib/export.ts`** — one query per book plus **one query per quote** for its lines.
Now three table scans plus in-memory grouping.
**Measured: 168ms → 23ms for 2,000 quotes (7.2×).**

### 10. Per-row IndexedDB round trips in the pull path — MEDIUM
**`src/lib/sync.ts`** — `pullTable` did a `get` and a `put` per row: ~2,000 sequential round
trips for a full page, each paying its own transaction cost. Now one `bulkGet` + one `bulkPut`
per page. `pullMembers` likewise (`bulkPut` instead of a put per row).
Measured ~1.3× on fake-indexeddb; the real-browser gain is larger, as each `get`/`put` there is a
separate IndexedDB transaction.

### 11. Non-atomic, unbatched cascade deletes — MEDIUM
**`src/lib/repo.ts`**

- `deleteQuotebook` ran outside any transaction with a sequential put per quote *and* a nested
  per-quote line query. Beyond being slow, an interruption could leave the book tombstoned with
  its quotes still live. Now a single transaction with batched `bulkPut`s.
- `deleteQuote` and `updateQuote` held their transactions open across a sequential put per line;
  both now collect writes and flush once.

### 12. Per-row network inserts — MEDIUM
**`src/lib/sync.ts`** — `pushMembers` issued one HTTP request per membership row, serially. Now a
single `upsert` with `ignoreDuplicates`, which also replaces the previous
insert-and-tolerate-`23505` dance.

### On the "sub-100ms for all core actions and API routes" target

Stated plainly: **this target does not map onto this application**, and I did not manufacture
numbers to claim it.

- There are **no API routes** — no Server Actions, no route handlers, no server-side data
  fetching. The build output is static; every page is a client component over IndexedDB.
- **Core actions were already local and fast.** Create/edit/delete write to Dexie and return;
  they never await the network. They are well under 100ms and were before this audit.
- **The one network path — `parse-capture` — is provider-bound** (an LLM call, seconds by
  nature). It is deliberately asynchronous: captures save instantly and resolve in the
  background, which is the correct design for that latency, not something to optimize to 100ms.

The work that mattered for latency was the read/merge paths above, where the measured wins are
real and attributable.

---

## Phase 3 — Testing

**107 → 136 tests (+29), all passing.** Three new files, covering code that had **zero** coverage
and that this audit restructured.

| File | Tests | Covers |
|---|---|---|
| `src/lib/repo.test.ts` | 12 | Line diffing on edit (reorder preserves identity, removals tombstone, additions), cascade deletes, length caps, tag normalization, LWW clock advancement, `pickPrivateBook` determinism |
| `src/lib/sync.test.ts` | 11 | Batched merge against a stubbed Supabase, page-boundary rewind, pagination, cursor advancement, dirty-flag handling, payload shape, concurrency guard |
| `src/lib/export.test.ts` | 6 | Book/quote/line grouping with interleaved ids, ordering, tombstone exclusion, scoping, backup envelope |

### Tests were verified to actually fail

Coverage that doesn't catch regressions is worse than none, so each critical new test was
mutation-checked — the fix was deliberately reverted and the test confirmed to fail:

| Mutation | Test that caught it |
|---|---|
| Export grouping → wrong lines per quote | `nests each line under its own quote…` |
| `deleteQuotebook` cascade removed | `cascades soft-deletes to every quote and line` |
| Cursor advances to max instead of rewinding | `does not lose rows whose timestamp straddles…` |
| `syncing` flag set after the await | `runs a single cycle when called concurrently` |

All four failed as expected, then passed again once restored.

### End-to-end verification in a running browser

Beyond the suite, the changed write paths were exercised against a real dev server with
IndexedDB inspected directly:

- Boot → private quotebook created, **no console errors, no server errors**
- `createQuote` → two-line quote stored in the correct order
- `updateQuote` → reordered lines kept **the same row ids** (`2e4a8457`, `559c0e62`) with
  `order_index` swapped, no tombstones, `version` bumped 1→2 — exactly the intended diff
- `deleteQuote` → quote and both lines tombstoned and flagged `_dirty: 1` so tombstones sync
- Quick Add + share target → text prefilled, query string stripped from the URL

---

## React Compiler lint — RESOLVED

`eslint-config-next@16` enables React Compiler-aware hooks rules, which flagged five call
sites that predated the upgrade. **All five are now fixed and both rules are back at
`error`** — `npm run lint` reports zero warnings.

The fixes were made *after* adding rendering tests (below), and each behavioural one was
pinned by a test written against the old code first, so the refactors are provably
behaviour-preserving rather than merely lint-clean.

| Location | Was | Now |
|---|---|---|
| `MultiSelectDropdown.tsx` | `setQuery("")` in the open effect | reset in the open/close handler — opening is an event |
| `QuoteModal.tsx` | `setError(null)` in the open effect | cleared in `handleClose`, which every close path routes through |
| `manage/page.tsx` (sync) | `useEffect(() => setName(book.name))` | React's documented "adjust state during render when a prop changes" |
| `manage/page.tsx` (purity) | `Date.now()` during render | timestamp captured when the invite list lands |
| `quick/page.tsx` | `setText(...)` in the share-target effect | **kept**, with a targeted `eslint-disable` |

The last one is a deliberate, documented exception rather than a fix. That route is
statically prerendered (`○ Static`), so the usual remedy — a lazy `useState` initializer —
would read `window` where it does not exist and make the hydrated markup disagree with the
prerendered HTML. Reading location after mount is the hydration-safe approach, and the
effect must call `history.replaceState` regardless.

## Rendering tests (new)

The suite previously had **zero** React coverage — all 136 tests were logic and Dexie in a
`node` environment. That gap is why the Next 16 / React 19 upgrade had to be validated by
hand in a browser. Added jsdom + `@testing-library/react`, with `node` kept as the default
environment so the existing suites stay fast; component tests opt in per-file with a
`// @vitest-environment jsdom` docblock.

| File | Tests | Covers |
|---|---|---|
| `MultiSelectDropdown.test.tsx` | 9 | open/close, filtering, **query reset on reopen**, selection, Escape/outside-click, trigger summary |
| `QuoteModal.test.tsx` | 7 | save validation, line add/remove, blank-line dropping, save failure surfaced, **no stale error across opens** |
| `manage/ManageBookRow.test.tsx` | 5 | **rename box adopts an external rename**, does not clobber in-progress typing, rename gating |

The bolded cases are the ones guarding the refactors above; each was mutation-tested by
reverting its fix and confirming the test fails.

## Not actioned (needs your decision)

**RESOLVED — upgraded to Next 16.3.0 / React 19.2 on `chore/next-16-upgrade`; `npm audit` now reports 0 vulnerabilities.** The original finding and reasoning are kept below for the record.

The only available fix is `next@16.3.0` — a **major upgrade from 14.2.35**. I did not perform it,
for three reasons:

1. It directly conflicts with the "never break existing features" directive. Next 14 → 16 is a
   migration (async request APIs, changed caching semantics, React 19), not a patch.
2. This test suite covers library logic, not rendering — it **could not validate** such an
   upgrade, so I'd be shipping an unverifiable change.
3. **The exposed surface is absent from this app.** I verified rather than assumed:

| Advisory targets | Present here? |
|---|---|
| Server Actions (SSRF, unbounded payload) | No — zero `"use server"` |
| Custom server SSRF | No — plain `next start` |
| `rewrites` destination SSRF | No — none configured |
| Server Function endpoint disclosure | No — no route handlers |
| Response-body cache confusion | No server-side data fetching |
| postcss `sourceMappingURL` | Build-time only, over the project's own CSS |

`14.2.35` is already the newest 14.x, so no patch-level fix exists. My recommendation is to plan
the Next 16 upgrade as its own piece of work with the app exercised end-to-end, rather than
folding it into this pass. Happy to take that on separately.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/sync.ts` | Race condition; batched pull merge; page-boundary rewind; batched member push |
| `src/lib/repo.ts` | Feed read path (`anyOf` → scan); transactional/batched cascade deletes; batched line writes |
| `src/lib/export.ts` | N+1 → batched scans; deferred object-URL revoke |
| `src/store/useSyncStore.ts` | Realtime channel + prune-timer leak |
| `src/store/useAuthStore.ts` | Auth subscription retained/replaced |
| `supabase/schema.sql` | `now()` → `clock_timestamp()` in both timestamp triggers |
| `supabase/functions/parse-capture/index.ts` | Validate before charging quota; JSON parse guard |
| `public/sw.js` | Path-only shell cache key; cache-version purge; response guards |
| `src/lib/repo.test.ts`, `sync.test.ts`, `export.test.ts` | New — 29 tests |

### Deployment note

`supabase/schema.sql` changed. The file is idempotent, so re-running it applies the
`clock_timestamp()` triggers in place. **Until it is applied, the boundary-stranding fix is only
half-active** — the client-side rewind handles split groups, but a bulk push under the old
`now()` trigger can still produce a full page of identical timestamps, which the client can only
report, not recover from.
