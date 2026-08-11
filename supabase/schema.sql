-- =====================================================================
-- Quotebook — Supabase / PostgreSQL schema
-- =====================================================================
-- Run this in the Supabase SQL editor (or `supabase db push`) to provision
-- the remote sync backend. The local Dexie tables in `src/db/dexie.ts`
-- mirror these definitions field-for-field.
--
-- The file is IDEMPOTENT: tables use IF NOT EXISTS and every policy,
-- trigger and function is dropped/recreated, so re-running it on an
-- existing project upgrades it in place.
--
-- Sync model: the client performs field-level Last-Write-Wins merges using
-- the `field_updated_at` jsonb map (fractional epoch-ms ticks). Postgres is
-- the durable shared store and assigns `updated_at` itself (triggers below)
-- so the incremental pull cursor never trusts client wall clocks.
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
  quote_date     date not null default current_date,
  quote_time     time not null default current_time,
  -- The situation the whole exchange happened in ("walking in the dark").
  -- Distinct from quote_lines.line_context, which annotates one utterance.
  quote_context  text not null default '',
  tags           text[] not null default '{}',
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1,
  field_updated_at jsonb not null default '{}'::jsonb,
  -- Soft delete so deletions propagate as a normal LWW field.
  deleted        boolean not null default false
);
create index if not exists quotes_quotebook_id_idx on public.quotes (quotebook_id);

-- `primary_quotee` was folded into quote_lines.speaker (the client migrates
-- local copies in the Dexie v2 upgrade). No-op on fresh projects.
alter table public.quotes drop column if exists primary_quotee;
-- Ensure quote_context exists on projects provisioned while it was absent.
alter table public.quotes add column if not exists quote_context text not null default '';

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

-- Mirror the client-side field caps (MAX_LINE_TEXT / MAX_CONTEXT in
-- src/lib/types.ts) so a modified client can't sync unbounded text to peers.
alter table public.quote_lines drop constraint if exists quote_lines_line_text_len;
alter table public.quote_lines add constraint quote_lines_line_text_len
  check (char_length(line_text) <= 500);
alter table public.quote_lines drop constraint if exists quote_lines_line_context_len;
alter table public.quote_lines add constraint quote_lines_line_context_len
  check (char_length(line_context) <= 1000);

alter table public.quotes drop constraint if exists quotes_quote_context_len;
alter table public.quotes add constraint quotes_quote_context_len
  check (char_length(quote_context) <= 500);

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
-- Server-assigned timestamps
-- =====================================================================
-- The incremental pull cursor filters on `updated_at`, so it must be set by
-- the server — a client with a fast clock would otherwise push rows "from
-- the future" and make other clients' cursors skip peers' writes forever.
-- (`field_updated_at` stays client-set; it is only compared between clients.)
-- clock_timestamp(), NOT now(): now() is transaction_timestamp() and is stable
-- for a whole statement, so a bulk push (the sync engine upserts its entire
-- outbox in ONE statement) would stamp every row with the SAME updated_at. A
-- peer whose pull page filled up with such rows could not advance its cursor
-- past them without skipping the rest — the leftovers were stranded and never
-- pulled again. clock_timestamp() re-reads the clock per row, so the cursor
-- always has a distinct value to advance to.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists quotebooks_touch_updated_at on public.quotebooks;
create trigger quotebooks_touch_updated_at
  before insert or update on public.quotebooks
  for each row execute function public.touch_updated_at();

drop trigger if exists quotes_touch_updated_at on public.quotes;
create trigger quotes_touch_updated_at
  before insert or update on public.quotes
  for each row execute function public.touch_updated_at();

drop trigger if exists quote_lines_touch_updated_at on public.quote_lines;
create trigger quote_lines_touch_updated_at
  before insert or update on public.quote_lines
  for each row execute function public.touch_updated_at();

-- Same reasoning for the members pull cursor (filters on joined_at).
-- clock_timestamp() for the same reason as touch_updated_at above.
create or replace function public.touch_joined_at()
returns trigger
language plpgsql
as $$
begin
  new.joined_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists members_touch_joined_at on public.quotebook_members;
create trigger members_touch_joined_at
  before insert on public.quotebook_members
  for each row execute function public.touch_joined_at();

-- Pull-cursor indexes: every incremental pull filters + orders on these.
create index if not exists quotebooks_updated_at_idx  on public.quotebooks (updated_at);
create index if not exists quotes_updated_at_idx      on public.quotes (updated_at);
create index if not exists quote_lines_updated_at_idx on public.quote_lines (updated_at);
create index if not exists members_joined_at_idx      on public.quotebook_members (joined_at);

-- =====================================================================
-- Column protection
-- =====================================================================
-- RLS UPDATE policies let any member update a quotebook row, but ownership
-- must never move and only the owner may change privacy — enforced here
-- because WITH CHECK cannot compare against the pre-update row.
create or replace function public.protect_quotebook_columns()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'quotebooks.owner_id is immutable';
  end if;
  if new.is_private is distinct from old.is_private
     and auth.uid() is distinct from old.owner_id then
    raise exception 'Only the owner may change a quotebook''s privacy';
  end if;
  return new;
end;
$$;

drop trigger if exists quotebooks_protect_columns on public.quotebooks;
create trigger quotebooks_protect_columns
  before update on public.quotebooks
  for each row execute function public.protect_quotebook_columns();

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
stable
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
-- `is_member(id)` answers "does a row with this id exist that I own or belong
-- to?" — which is false for a row being INSERTED, because it isn't there yet.
-- The sync engine pushes with upsert (INSERT ... ON CONFLICT DO UPDATE), and
-- that path makes Postgres consult the SELECT and UPDATE policies too, not
-- just INSERT. So every quotebooks policy also accepts `owner_id = auth.uid()`,
-- which is checkable on the proposed row without it existing first. Removing
-- those clauses breaks the very first sync with a misleading 42501.
drop policy if exists "quotebooks: members read" on public.quotebooks;
create policy "quotebooks: members read" on public.quotebooks
  for select using (owner_id = auth.uid() or public.is_member(id));

drop policy if exists "quotebooks: owner insert" on public.quotebooks;
create policy "quotebooks: owner insert" on public.quotebooks
  for insert with check (owner_id = auth.uid());

-- Same reasoning as the SELECT policy above: both USING and WITH CHECK must
-- accept ownership directly, or the upsert path fails on first insert.
-- protect_quotebook_columns still pins owner_id on UPDATE, so a member of
-- someone else's book cannot use this to seize ownership.
drop policy if exists "quotebooks: members update" on public.quotebooks;
create policy "quotebooks: members update" on public.quotebooks
  for update
  using (owner_id = auth.uid() or public.is_member(id))
  with check (owner_id = auth.uid() or public.is_member(id));

drop policy if exists "quotebooks: owner delete" on public.quotebooks;
create policy "quotebooks: owner delete" on public.quotebooks
  for delete using (owner_id = auth.uid());

-- quotebook_members -------------------------------------------------
drop policy if exists "members: visible to members" on public.quotebook_members;
create policy "members: visible to members" on public.quotebook_members
  for select using (public.is_member(quotebook_id));

-- Direct inserts are only for owners registering their own membership
-- (guest → account claim). Joining someone else's book goes through the
-- redeem_invite() RPC below, which validates the invite server-side.
drop policy if exists "members: self join" on public.quotebook_members;
drop policy if exists "members: owner self insert" on public.quotebook_members;
create policy "members: owner self insert" on public.quotebook_members
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.quotebooks b
      where b.id = quotebook_id and b.owner_id = auth.uid()
    )
  );

drop policy if exists "members: self leave" on public.quotebook_members;
create policy "members: self leave" on public.quotebook_members
  for delete using (user_id = auth.uid());

-- quotes ------------------------------------------------------------
drop policy if exists "quotes: members read" on public.quotes;
create policy "quotes: members read" on public.quotes
  for select using (public.is_member(quotebook_id));

drop policy if exists "quotes: members insert" on public.quotes;
create policy "quotes: members insert" on public.quotes
  for insert with check (public.is_member(quotebook_id));

drop policy if exists "quotes: members update" on public.quotes;
create policy "quotes: members update" on public.quotes
  for update using (public.is_member(quotebook_id)) with check (public.is_member(quotebook_id));

drop policy if exists "quotes: members delete" on public.quotes;
create policy "quotes: members delete" on public.quotes
  for delete using (public.is_member(quotebook_id));

-- quote_lines -------------------------------------------------------
drop policy if exists "lines: members read" on public.quote_lines;
create policy "lines: members read" on public.quote_lines
  for select using (public.is_member((select quotebook_id from public.quotes q where q.id = quote_id)));

drop policy if exists "lines: members insert" on public.quote_lines;
create policy "lines: members insert" on public.quote_lines
  for insert with check (public.is_member((select quotebook_id from public.quotes q where q.id = quote_id)));

drop policy if exists "lines: members update" on public.quote_lines;
create policy "lines: members update" on public.quote_lines
  for update using (public.is_member((select quotebook_id from public.quotes q where q.id = quote_id)))
  with check (public.is_member((select quotebook_id from public.quotes q where q.id = quote_id)));

drop policy if exists "lines: members delete" on public.quote_lines;
create policy "lines: members delete" on public.quote_lines
  for delete using (public.is_member((select quotebook_id from public.quotes q where q.id = quote_id)));

-- invite_codes ------------------------------------------------------
-- Only members can see or manage a book's invites. Codes are never readable
-- by non-members: redemption happens through the SECURITY DEFINER RPC, so no
-- table-wide SELECT policy is needed (a former "authenticated lookup" policy
-- exposed every code to every signed-in user — dropped).
drop policy if exists "invites: authenticated lookup" on public.invite_codes;
drop policy if exists "invites: members manage" on public.invite_codes;
create policy "invites: members manage" on public.invite_codes
  for all using (public.is_member(quotebook_id)) with check (public.is_member(quotebook_id));

-- =====================================================================
-- Invite redemption (server-side validation)
-- =====================================================================
-- SECURITY DEFINER so it can look up the code and insert the membership
-- row without a permissive RLS policy. This is the ONLY path by which a
-- non-owner becomes a member, and it enforces expiry server-side.
create or replace function public.redeem_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invite_codes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to join a quotebook.';
  end if;

  select * into v_invite
  from public.invite_codes
  where code = upper(trim(p_code));

  if not found then
    raise exception 'Invite code not found.';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'This invite code has expired.';
  end if;

  insert into public.quotebook_members (quotebook_id, user_id)
  values (v_invite.quotebook_id, auth.uid())
  on conflict (quotebook_id, user_id) do nothing;

  return v_invite.quotebook_id;
end;
$$;

revoke all on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;

-- =====================================================================
-- Quick Add parsing quota
-- =====================================================================
-- The parse-capture Edge Function bills per call, so each user gets a daily
-- cap. Only the service role (the function) touches this table: RLS is
-- enabled with no policies, and the RPC is revoked from every client role.
create table if not exists public.quickadd_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null default current_date,
  count   integer not null default 0,
  primary key (user_id, day)
);
alter table public.quickadd_usage enable row level security;

create or replace function public.quickadd_bump_usage(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.quickadd_usage (user_id, day, count)
  values (p_user, current_date, 1)
  on conflict (user_id, day) do update
    set count = public.quickadd_usage.count + 1
  returning count into v_count;
  return v_count;
end;
$$;

revoke all on function public.quickadd_bump_usage(uuid) from public, anon, authenticated;

-- =====================================================================
-- Realtime
-- =====================================================================
-- 1. postgres_changes replication nudges collaborators to pull promptly.
--    (Guarded per-user by the RLS policies above.)
do $$
begin
  alter publication supabase_realtime add table public.quotes;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.quote_lines;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.quotebooks;
exception when duplicate_object then null;
end $$;

-- 2. Soft-lock presence uses PRIVATE broadcast channels ("presence:<bookId>").
--    These policies on realtime.messages restrict both subscribing and
--    broadcasting to members of that book, so outsiders can neither harvest
--    editing beacons nor spoof locks.
drop policy if exists "presence: members read" on realtime.messages;
create policy "presence: members read" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'presence:%'
    and public.is_member((split_part(realtime.topic(), ':', 2))::uuid)
  );

drop policy if exists "presence: members write" on realtime.messages;
create policy "presence: members write" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'presence:%'
    and public.is_member((split_part(realtime.topic(), ':', 2))::uuid)
  );
