-- 0007_analytics_events_draft.sql — DRAFT, not applied.
-- Analytics event store for the reporting suite's event taxonomy
-- (spec: ~/workspace/team-ttl/ANALYTICS-REPORTING-SUITE.md).
--
-- What this adds:
--   analytics_events — one row per tracked event from the app's
--                      client tracker (frontend/src/lib/track.js),
--                      written through the collector endpoint
--                      (frontend/api/events.js). Columns:
--                        event      — taxonomy name, e.g. 'race_viewed'
--                        user_id    — the acting member, when signed in
--                                     (internal funnel math keys events
--                                     to accounts; sponsor outputs are
--                                     aggregates only, per the suite's
--                                     governance rules)
--                        session_id — per-browser-session id from the
--                                     tracker (sessionStorage)
--                        properties — allowlisted ids/enums only
--                                     (race_id, deal_id, category,
--                                     kind/item_id, surface). The
--                                     collector strips anything else;
--                                     never message text or free text.
--                        created_at — server timestamp.
--
-- RLS is INSERT-ONLY by design: anon and authenticated may insert
-- (the collector writes with the publishable key), and there are
-- deliberately NO select/update/delete policies, so the table is
-- unreadable through the API — reads happen via the service role
-- (report generation) only. Event-name/property validation lives in
-- the collector, not in a CHECK constraint, so the taxonomy can grow
-- without a migration per event.
--
-- Apply order: independent of 0002–0006; run this whole file once in
-- the Supabase SQL editor whenever convenient. Until it lands, the
-- collector answers 202 and drops events quietly — the app is
-- unaffected either way, capture simply starts the day this runs.

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  event text not null,
  user_id uuid,
  session_id text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_event_created_idx
  on public.analytics_events (event, created_at);

alter table public.analytics_events enable row level security;

drop policy if exists analytics_events_insert on public.analytics_events;
create policy analytics_events_insert on public.analytics_events
  for insert to anon, authenticated
  with check (true);

-- No select / update / delete policies on purpose (see header):
-- with RLS enabled and no policy for a command, that command is
-- denied for anon and authenticated; the service role bypasses RLS.
