-- =====================================================================
-- Quotebook — Supabase / PostgreSQL schema
-- =====================================================================
-- Run this in the Supabase SQL editor (or `supabase db push`) to provision
-- the remote sync backend. The local Dexie tables in `src/db/dexie.ts`
-- mirror these definitions field-for-field.
--
-- Sync model: the client is the source of truth for conflict resolution.
-- Postgres acts as a durable shared store; the client performs field-level
-- Last-Write-Wins merges using the `field_updated_at` jsonb map (epoch-ms,
-- fractional for sub-millisecond tie-breaks).
-- =====================================================================

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- quotebooks
-- ---------------------------------------------------------------------
create table if not exists public.quotebooks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  is_private  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Field-level LWW metadata. Maps column name -> fractional epoch ms.
  field_updated_at jsonb not null default '{}'::jsonb,
  -- Soft delete so deletions propagate as a normal LWW field.
  deleted     boolean not null default false
);

-- ---------------------------------------------------------------------
-- quotebook_members (flat permissions: every member can read/write/edit)
-- ---------------------------------------------------------------------
create table if not exists public.quotebook_members (
  id           uuid primary key default gen_random_uuid(),
  quotebook_id uuid not null references public.quotebooks (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  unique (quotebook_id, user_id)
);

-- ---------------------------------------------------------------------
-- quotes
-- ---------------------------------------------------------------------
create table if not exists public.quotes (
  id             uuid primary key default gen_random_uuid(),
  quotebook_id   uuid not null references public.quotebooks (id) on delete cascade,
  primary_quotee text not null default '',
  quote_date     date not null default current_date,
  quote_time     time not null default current_time,
  quote_context  text not null default '',
  tags           text[] not null default '{}',
  created_by      uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1,
  field_updated_at jsonb not null default '{}'::jsonb,
  -- Soft delete so deletions propagate as a normal LWW field.
  deleted        boolean not null default false
);
create index if not exists quotes_quotebook_id_idx on public.quotes (quotebook_id);

-- ---------------------------------------------------------------------
-- quote_lines (multi-line dialogue support)
-- ---------------------------------------------------------------------
create table if not exists public.quote_lines (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references public.quotes (id) on delete cascade,
  speaker       text not null default '',
  line_text     text not null default '',
  line_context  text not null default '',
  order_index   integer not null default 0,
  updated_at    timestamptz not null default now(),
  field_updated_at jsonb not null default '{}'::jsonb,
  deleted       boolean not null default false
);
create index if not exists quote_lines_quote_id_idx on public.quote_lines (quote_id);

-- ---------------------------------------------------------------------
-- invite_codes (temporary, expiring collaboration tokens)
-- ---------------------------------------------------------------------
create table if not exists public.invite_codes (
  id           uuid primary key default gen_random_uuid(),
  quotebook_id uuid not null references public.quotebooks (id) on delete cascade,
  code         text not null unique,
  created_by   uuid references auth.users (id) on delete set null,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);
create index if not exists invite_codes_code_idx on public.invite_codes (code);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.quotebooks        enable row level security;
alter table public.quotebook_members enable row level security;
alter table public.quotes            enable row level security;
alter table public.quote_lines       enable row level security;
alter table public.invite_codes      enable row level security;

-- Helper: is the current user a member (or owner) of a quotebook?
create or replace function public.is_member(qb uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.quotebooks b
    where b.id = qb and b.owner_id = auth.uid()
  ) or exists (
    select 1 from public.quotebook_members m
    where m.quotebook_id = qb and m.user_id = auth.uid()
  );
$$;

-- quotebooks --------------------------------------------------------
create policy "quotebooks: members read" on public.quotebooks
  for select using (public.is_member(id));
create policy "quotebooks: owner insert" on public.quotebooks
  for insert with check (owner_id = auth.uid());
create policy "quotebooks: members update" on public.quotebooks
  for update using (public.is_member(id));
create policy "quotebooks: owner delete" on public.quotebooks
  for delete using (owner_id = auth.uid());

-- quotebook_members -------------------------------------------------
create policy "members: visible to members" on public.quotebook_members
  for select using (public.is_member(quotebook_id));
-- A user may add themselves to a book (after redeeming an invite client-side).
create policy "members: self join" on public.quotebook_members
  for insert with check (user_id = auth.uid());
create policy "members: self leave" on public.quotebook_members
  for delete using (user_id = auth.uid());

-- quotes ------------------------------------------------------------
create policy "quotes: members read" on public.quotes
  for select using (public.is_member(quotebook_id));
create policy "quotes: members insert" on public.quotes
  for insert with check (public.is_member(quotebook_id));
create policy "quotes: members update" on public.quotes
  for update using (public.is_member(quotebook_id));
create policy "quotes: members delete" on public.quotes
  for delete using (public.is_member(quotebook_id));

-- quote_lines -------------------------------------------------------
create policy "lines: members read" on public.quote_lines
  for select using (public.is_member((select quotebook_id from public.quotes q where q.id = quote_id)));
create policy "lines: members insert" on public.quote_lines
  for insert with check (public.is_member((select quotebook_id from public.quotes q where q.id = quote_id)));
create policy "lines: members update" on public.quote_lines
  for update using (public.is_member((select quotebook_id from public.quotes q where q.id = quote_id)));
create policy "lines: members delete" on public.quote_lines
  for delete using (public.is_member((select quotebook_id from public.quotes q where q.id = quote_id)));

-- invite_codes ------------------------------------------------------
-- Members can manage invites for their books; anyone signed-in can look up a
-- code to redeem it (needed for the join flow).
create policy "invites: members manage" on public.invite_codes
  for all using (public.is_member(quotebook_id)) with check (public.is_member(quotebook_id));
create policy "invites: authenticated lookup" on public.invite_codes
  for select using (auth.role() = 'authenticated');

-- =====================================================================
-- Realtime: enable change broadcasting for collaborative sync.
-- (Soft-lock "User X is editing…" uses ephemeral broadcast channels and
--  does not require table replication.)
-- =====================================================================
alter publication supabase_realtime add table public.quotes;
alter publication supabase_realtime add table public.quote_lines;
alter publication supabase_realtime add table public.quotebooks;
