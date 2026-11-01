-- 0004 (DRAFT — not applied): server-side auto-moderation.
-- Design: ~/workspace/team-ttl/AUTO-MODERATION.md.
-- Moves the client-side rule engine (frontend/src/lib/moderation.js)
-- behind the database so direct API writes are moderated too, adds the
-- audit log, repeat-offender auto-mute, and the report path.
-- Apply only after the 0002/0003 review, against the live schema export.

-- 1) Verdict log. Content itself is NOT stored; a hash lets staff match
--    a report to an event without retaining blocked text.
create table if not exists public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  channel_id uuid references public.channels(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  athlete_id uuid references public.profiles(id) on delete set null,
  source text not null check (source in ('client_gate', 'db_trigger', 'report', 'admin')),
  action text not null check (action in ('warn', 'block', 'hide', 'mute', 'unhide', 'clear')),
  rule text not null,               -- e.g. 'severe_term', 'spam_links', 'flood_repeat', 'rate_burst', 'reports_threshold'
  content_hash text,                -- sha256 of normalized content
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);

-- 2) Message-level moderation state, set by the trigger on insert.
alter table public.messages
  add column if not exists moderation_status text not null default 'clean'
  check (moderation_status in ('clean', 'hidden', 'flagged'));

-- 3) Auto-mute state on profiles (repeat offenders: 3 blocks in 7 days
--    -> 24h mute, enforced by RLS below).
alter table public.profiles
  add column if not exists muted_until timestamptz;

-- 4) Trigger sketch (PLpgSQL): normalize content the same way the
--    client engine does (lowercase, strip accents), test the severe
--    list + spam fingerprints, and either reject the insert (block) or
--    stamp moderation_status = 'hidden' for render-level collapse.
--    The full term list lives in a moderation_terms table so staff can
--    tune it without a deploy.
create table if not exists public.moderation_terms (
  term text primary key,
  severity text not null default 'severe' check (severity in ('severe', 'spam_phrase'))
);

-- create or replace function public.moderate_message() returns trigger ...
-- create trigger messages_moderate before insert on public.messages
--   for each row execute function public.moderate_message();

-- 5) RLS intent:
--    - messages SELECT: exclude moderation_status = 'hidden' unless the
--      reader is staff or the author.
--    - messages INSERT: deny when profiles.muted_until > now().
--    - moderation_events: staff read/update (review queue); inserts by
--      trigger + authenticated report path only.
