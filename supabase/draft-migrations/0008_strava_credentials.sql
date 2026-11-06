-- 0008_strava_credentials.sql — Strava token lockdown.
-- APPROVED by Zack 2026-11-06 ("Yes, lock down the Strava tokens") and
-- applied the same day via the Supabase Management API in two parts:
-- part 1 (this file's CREATE + copy) before the code switch, part 2
-- (the DROP at the bottom) only after the switched code was verified
-- running against the new table in production.
--
-- Why: profiles is readable by every signed-in account ("Read all
-- profiles" RLS, auth.role() = 'authenticated'), and the Strava OAuth
-- tokens lived on the profile row — any member could read every other
-- member's access + refresh tokens through the API. Refresh tokens are
-- the finding that cannot be un-rung, so the tokens move to a table no
-- app role can read at all. Found in the 2026-11-06 live schema
-- reconciliation (~/workspace/team-ttl/SCHEMA-RECONCILIATION-2026-11-06.md).
--
-- What stays on profiles (not sensitive, read by the client):
-- strava_athlete_id, strava_bootstrap_status, strava_last_synced_at.
--
-- Code that moved with this (frontend/api/strava/): sync.js (athlete
-- selection + refresh write-back), activities.js, callback.js (upsert),
-- disconnect.js (row delete). All are service-role serverless paths.

-- PART 1 — create + copy (applied 2026-11-06, verified 1 row copied,
-- matching the 1 profile then holding a refresh token).
create table if not exists public.strava_credentials (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  strava_athlete_id bigint,
  access_token text,
  refresh_token text,
  expires_at bigint,
  updated_at timestamptz not null default now()
);

-- RLS on with NO policies: anon and authenticated roles can neither
-- read nor write; the service role bypasses RLS and is the only reader.
alter table public.strava_credentials enable row level security;

insert into public.strava_credentials (athlete_id, strava_athlete_id, access_token, refresh_token, expires_at)
select id, strava_athlete_id, strava_access_token, strava_refresh_token, strava_token_expires_at
from public.profiles
where strava_access_token is not null or strava_refresh_token is not null
on conflict (athlete_id) do nothing;

-- PART 2 — drop the token columns from profiles (applied 2026-11-06
-- after the production refresh-endpoint verification passed against
-- the new table; see the Team TTL progress log, run 58).
alter table public.profiles
  drop column if exists strava_access_token,
  drop column if exists strava_refresh_token,
  drop column if exists strava_token_expires_at;
