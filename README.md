# Quotebook

A **local-first, privacy-respecting collaborative notebook** for capturing and
organizing quotes and dialogues — without recurring cloud costs. Everything is
instant and works offline; sync and collaboration are optional add-ons.

## Highlights

- **Local-first** — every read/write hits IndexedDB (via Dexie) so the UI is
  instant and fully offline-capable.
- **Anonymous onboarding** — start using the app immediately as a guest with one
  anchored Private Quotebook. Secure an account later and your local data
  migrates seamlessly.
- **Collaborative quotebooks** — invite others with 24h expiring codes; flat
  permissions (everyone can read/write/edit). Codes are validated **server-side**
  (a `SECURITY DEFINER` RPC) so membership can't be gained without one.
- **Field-level Last-Write-Wins sync** — concurrent edits to different fields
  both survive; same-field clashes resolve by a high-precision timestamp.
- **Soft-locks** — when someone opens an edit pane, collaborators see
  “User X is editing…” via Supabase realtime broadcast.
- **Rich quotes** — single-liners or multi-speaker dialogues, editable date/time,
  tags, and context at **two levels**: the situation the whole exchange happened
  in ("walking in the dark") and what one person did while saying a single line
  ("points to the green one").
- **Powerful feed** — fuzzy search, stacked filters (speakers, tags AND/OR, date
  windows) and sort axes (event date vs. added date, newest/oldest).
- **Quick Add** — one box, one keystroke. Captures save to IndexedDB instantly
  (offline included) and wait in an Inbox; optional AI parsing turns them into
  structured quotes, with a verbatim check so nothing is ever put in someone's
  mouth that you didn't type.
- **Installable PWA** — install it and Quotebook joins the system share sheet,
  so text shared from any app lands straight in Quick Add. Opens offline, too.
- **Data portability** — one-click clean JSON export, and import to match.

## Tech stack

| Concern              | Choice                                  |
| -------------------- | --------------------------------------- |
| Framework            | Next.js (App Router) + TypeScript       |
| Styling              | Tailwind CSS                            |
| Global UI state      | Zustand                                 |
| Local database       | Dexie.js (IndexedDB)                    |
| Remote sync + auth   | Supabase (PostgreSQL, email/password)   |
| Fuzzy search         | Fuse.js                                 |

## Getting started

```bash
npm install

# Optional: enable accounts + sync. Without this the app runs fully in guest mode.
cp .env.local.example .env.local   # then fill in your Supabase URL + anon key

npm run dev
```

Open http://localhost:3000.

### Enabling sync (optional)

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor. It creates
   all tables, Row Level Security policies, the `redeem_invite` RPC, and enables
   realtime (including private presence channels). The script is idempotent —
   re-run it after pulling updates to upgrade an existing project in place.
3. Put `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   (**Project Settings → API Keys**, starts with `sb_publishable_`) in
   `.env.local`. Older projects that still issue a legacy `anon` JWT can use
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` instead — the app accepts either, and
   prefers the publishable key when both are present. Never put an
   `sb_secret_` key in `.env.local`; it ships to the browser.
4. Restart `npm run dev`. The "Secure Account" CTA now works and changes sync.

> **Sign-out behavior:** signing out (or switching accounts) wipes the local
> IndexedDB mirror so quotes never linger on a shared browser. The app warns
> first if any changes haven't synced yet.

### Installing as an app (optional)

Quotebook ships a web app manifest and a service worker, so it can be installed
from the browser (Chrome/Edge: the install icon in the address bar; iOS Safari:
Share → Add to Home Screen). Installing buys three things:

- **Share target** — Quotebook appears in the system share sheet. Share text
  from any app and it opens Quick Add with the content prefilled, ready to save.
  *Android and desktop Chrome/Edge only — iOS does not implement Web Share
  Target, so on iPhone you get the home-screen shortcut but not the share sheet.*
- **App shortcuts** — long-press the icon to jump straight to Quick Add or Inbox.
- **Cold-start offline** — the service worker caches the app shell, so the app
  opens with no connection at all (everything it does was already offline-capable
  once loaded; this closes the gap of not being able to *open* it).

The service worker is registered in production builds only — `npm run dev`
deliberately skips it so hot reloading isn't fighting a cached shell.

Icons live in `public/` and are plain PNGs; regenerate them if you change the
accent colour in `tailwind.config.ts`.

### Enabling Quick Add AI parsing (optional)

Quick Add works without this — captures are saved instantly and converted from
the Inbox by hand. To have an LLM do the formatting:

1. Store your [Gemini API key](https://aistudio.google.com/apikey) as a
   **server** secret (never in `.env.local` — the browser must never see it):
   ```bash
   supabase secrets set GEMINI_API_KEY=...
   ```
   Defaults to `gemini-3.6-flash`. For the cheapest/fastest option set
   `PARSER_MODEL=gemini-3.5-flash-lite`. `ANTHROPIC_API_KEY` and
   `OPENAI_API_KEY` are also supported — the function auto-detects whichever
   is set, and `PARSER_PROVIDER` forces one. Per-user daily quota is
   `PARSER_DAILY_CAP` (default 100).
2. Deploy the function — **with** JWT verification, so only signed-in users
   can spend your quota:
   ```bash
   supabase functions deploy parse-capture
   ```
3. Set `NEXT_PUBLIC_QUICKADD_AI=true` in `.env.local` and restart.

**How a capture becomes a quote:** the capture saves to Dexie immediately, then
a background engine (offline-aware, with exponential backoff) sends the text to
the Edge Function, which returns JSON-schema-constrained output. The client then
re-validates everything itself — including a **verbatim check** that every
line's words actually appear in what you typed. Minor drift flags the quote for
review; fabrication rejects the parse outright and drops the capture back to
manual conversion. The quote is created immediately either way, and the Inbox
badge is the nudge to review it later.

**Privacy note:** the capture text is sent to your chosen provider for parsing
and nothing else — the function requests no server-side retention (Gemini is
called with `store: false`), and the API key never leaves the Edge Function.
Captures you never parse (guest mode, offline, or AI disabled) never leave the
device at all.

## Architecture

```
src/
├─ db/dexie.ts            Local IndexedDB tables (mirror Supabase schema)
├─ lib/
│  ├─ types.ts            Shared domain types + feed-filter value objects
│  ├─ id.ts               UUID + high-precision logical clock (LWW tie-breaks)
│  ├─ merge.ts            Pure field-level LWW merge core (unit-tested)
│  ├─ repo.ts             All mutations → Dexie (stamps LWW clocks + _dirty)
│  ├─ sync.ts             Background pull → merge (field-level LWW) → push
│  ├─ captures.ts         Quick Add inbox + offline-aware parse engine
│  ├─ parse.ts            Validates AI parses; enforces the verbatim rule
│  ├─ search.ts           Fuzzy search + stacked filters + sorting
│  ├─ tags.ts             Tag normalization
│  ├─ auth.ts             Guest → account data migration
│  ├─ invites.ts          Expiring invite codes (validated server-side)
│  ├─ export.ts           JSON backup
│  ├─ import.ts           Restore a backup / land a migration (resumable)
│  └─ supabase.ts         Optional Supabase client
├─ store/
│  ├─ useSyncStore.ts     Sync status + realtime soft-lock presence
│  ├─ useAuthStore.ts     Email/password auth + migration triggers
│  └─ useUIStore.ts       Modal / mobile-nav UI state
├─ components/            Sidebar, QuoteModal, QuoteCard, FeedControls, …
└─ app/
   ├─ (auth)/             login / signup / reset-password
   └─ (dashboard)/        dashboard, quick, inbox, quotebook/[id] feed,
                          manage, settings

supabase/
├─ schema.sql             Tables, RLS, triggers, RPCs (idempotent)
└─ functions/
   └─ parse-capture/      Edge Function: raw note → structured quote JSON

scripts/
└─ export-quoteguessgame.mjs   One-off QuoteGuessGame → Quotebook migration
```

### Importing from QuoteGuessGame

`scripts/export-quoteguessgame.mjs` reads a QuoteGuessGame Supabase project
**read-only** and writes a Quotebook import file. Nothing is written to either
database by the script — the file is then imported from **Settings → Data
portability**, which lands every quote through the normal `createQuote()` path.

```bash
node scripts/export-quoteguessgame.mjs --env ../QuoteGuessGame/.env.local
```

| QuoteGuessGame | → | Quotebook |
| --- | --- | --- |
| `conversations` | → | `quotes` |
| `.happened_at` | → | `quote_date` + `quote_time` (parsed as wall-clock, not an instant) |
| `.context` | → | `quote_context` — the situation for the whole exchange |
| `dialogue_lines` | → | `quote_lines` |
| `.line_order` | → | `order_index` (1-based → 0-based) |
| `.speaker_id` → `speakers.name` | → | `speaker` (null speaker → `""`) |
| `.action_text` | → | `line_context` — what that person did on that line |

Imports are **resumable**: each source id is recorded once landed, so re-running
an interrupted import skips what's already there rather than duplicating it.

### How sync works

The UI **only ever touches Dexie**. Mutations stamp each changed field with a
monotonic fractional-millisecond `tick()` and flag the record `_dirty`. The sync
engine, when online and signed in:

1. **Pulls** rows changed since a per-table cursor (RLS scopes them to the books
   you belong to). The cursor compares `updated_at`, which **Postgres assigns
   via trigger**, so client clock skew can never hide a peer's writes,
2. **Merges** them field-by-field — for each field the higher `field_updated_at`
   tick wins, so independent edits to different fields all survive,
3. **Pushes** every still-`_dirty` record (safe, because we merged first; the
   dirty flag is only cleared if the record wasn't edited again mid-flight).

Each pull/push step is isolated, so one failing table can't block the others'
outboxes.

Realtime `postgres_changes` events nudge an immediate sync so collaborators see
each other within a second or two. Tunable thresholds (`PUSH_DEBOUNCE_MS`,
`FULL_SYNC_INTERVAL_MS`, presence TTL) are documented inline in `src/lib/sync.ts`
and `src/store/useSyncStore.ts`.

## Scripts

```bash
npm run dev         # local dev server
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run test        # vitest (merge core, feed engine, clock helpers)
```
