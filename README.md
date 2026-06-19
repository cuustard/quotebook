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
  permissions (everyone can read/write/edit).
- **Field-level Last-Write-Wins sync** — concurrent edits to different fields
  both survive; same-field clashes resolve by a high-precision timestamp.
- **Soft-locks** — when someone opens an edit pane, collaborators see
  “User X is editing…” via Supabase realtime broadcast.
- **Rich quotes** — single-liners or multi-speaker dialogues, per-line context
  footnotes, editable date/time, and tags.
- **Powerful feed** — fuzzy search, stacked filters (speakers, tags AND/OR, date
  windows) and sort axes (event date vs. added date, newest/oldest).
- **Data portability** — one-click clean JSON export.

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
   all tables, Row Level Security policies, and enables realtime.
3. Put `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
   `.env.local`.
4. Restart `npm run dev`. The "Secure Account" CTA now works and changes sync.

## Architecture

```
src/
├─ db/dexie.ts            Local IndexedDB tables (mirror Supabase schema)
├─ lib/
│  ├─ types.ts            Shared domain types + feed-filter value objects
│  ├─ id.ts               UUID + high-precision logical clock (LWW tie-breaks)
│  ├─ repo.ts             All mutations → Dexie (stamps LWW clocks + _dirty)
│  ├─ sync.ts             Background pull → merge (field-level LWW) → push
│  ├─ search.ts           Fuzzy search + stacked filters + sorting
│  ├─ auth.ts             Guest → account data migration
│  ├─ invites.ts          Expiring invite codes (online)
│  ├─ export.ts           JSON backup
│  └─ supabase.ts         Optional Supabase client
├─ store/
│  ├─ useSyncStore.ts     Sync status + realtime soft-lock presence
│  ├─ useAuthStore.ts     Email/password auth + migration triggers
│  └─ useUIStore.ts       Modal / mobile-nav UI state
├─ components/            Sidebar, QuoteModal, QuoteCard, FeedControls, …
└─ app/
   ├─ (auth)/             login / signup / reset-password
   └─ (dashboard)/        dashboard, quotebook/[id] feed, manage, settings
```

### How sync works

The UI **only ever touches Dexie**. Mutations stamp each changed field with a
monotonic fractional-millisecond `tick()` and flag the record `_dirty`. The sync
engine, when online and signed in:

1. **Pulls** rows changed since a per-table cursor (RLS scopes them to the books
   you belong to),
2. **Merges** them field-by-field — for each field the higher `field_updated_at`
   tick wins, so independent edits to different fields all survive,
3. **Pushes** every still-`_dirty` record (safe, because we merged first).

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
```
