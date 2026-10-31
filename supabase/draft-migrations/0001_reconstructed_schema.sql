-- Team TTL Dashboard — reconstructed live schema (DRAFT, Phase 0, 2026-10-31)
-- DO NOT RUN against production. See README.md in this folder for confidence levels.
-- Sources: repo schema.sql, CLAUDE.md, and the frontend/API code surface.

create extension if not exists "uuid-ossp";

-- ============ CONFIRMED (repo schema.sql) ============

create table profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text not null,
  email text not null unique,
  initials text generated always as (
    upper(substring(full_name from 1 for 1) || substring(full_name from position(' ' in full_name) + 1 for 1))
  ) stored,
  avatar_color text default 'color-a',
  avatar_url text,                                   -- EVIDENCED: ProfilePage update payload
  whatsapp_number text,
  role text default 'athlete' check (role in ('athlete','admin')),
  -- EVIDENCED (CLAUDE.md + api/strava/sync.js + profile field accesses):
  strava_access_token text,
  strava_refresh_token text,
  strava_token_expires_at timestamptz,
  strava_bootstrap_status text default 'pending',
  training_streak_current integer default 0,
  training_streak_longest integer default 0,
  training_streak_last_active date,
  total_swim_km numeric default 0,
  total_bike_km numeric default 0,
  total_run_km numeric default 0,
  total_pr_count integer default 0,
  total_kudos_received integer default 0,
  created_at timestamptz default now()
);

create table invites (
  id uuid default uuid_generate_v4() primary key,
  email text not null unique,
  invited_by uuid references profiles(id),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  used_at timestamptz,
  expires_at timestamptz default (now() + interval '7 days'),
  created_at timestamptz default now()
);

create table races (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  type text not null check (type in ('IRONMAN','70.3','Olympic','Sprint','XTERRA','Other')),
  race_date date not null,
  location text not null,
  city text,
  country text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  external_id text unique,
  source text default 'manual',
  registration_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table race_entries (
  id uuid default uuid_generate_v4() primary key,
  race_id uuid references races(id) on delete cascade not null,
  athlete_id uuid references profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(race_id, athlete_id)
);

create table notification_log (
  id uuid default uuid_generate_v4() primary key,
  race_id uuid references races(id) on delete cascade,
  channel text not null,
  message text not null,
  sent_at timestamptz default now(),
  status text default 'sent'
);

-- ============ Messaging (CONFIRMED shape via CLAUDE.md + Messaging.jsx) ============

create table channels (                                -- EVIDENCED
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  type text not null,                                  -- 'channel' | 'dm' | 'race' (code filters neq 'dm'; race channels join races(name))
  category text,                                       -- 'general' | 'training' | 'interest' | 'regions' | 'race'
  description text,
  race_id uuid references races(id) on delete cascade,
  created_by uuid references profiles(id),
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table channel_members (                         -- CONFIRMED (CLAUDE.md DM system)
  channel_id uuid references channels(id) on delete cascade not null,
  athlete_id uuid references profiles(id) on delete cascade not null,
  joined_at timestamptz default now(),
  primary key (channel_id, athlete_id)
);

create table messages (                                -- EVIDENCED (insert payload in Messaging.jsx)
  id uuid default uuid_generate_v4() primary key,
  channel_id uuid references channels(id) on delete cascade not null,
  athlete_id uuid references profiles(id) on delete cascade not null,
  content text,
  image_url text,
  reply_to uuid references messages(id) on delete set null,
  edited_at timestamptz,                               -- INFERRED from edit flow
  created_at timestamptz default now()
);

create table message_reactions (                       -- EVIDENCED
  id uuid default uuid_generate_v4() primary key,
  message_id uuid references messages(id) on delete cascade not null,
  athlete_id uuid references profiles(id) on delete cascade not null,
  emoji text not null,
  created_at timestamptz default now(),
  unique(message_id, athlete_id, emoji)
);

create table message_mentions (                        -- EVIDENCED
  id uuid default uuid_generate_v4() primary key,
  message_id uuid references messages(id) on delete cascade not null,
  channel_id uuid references channels(id) on delete cascade not null,
  mentioned_user_id uuid references profiles(id) on delete cascade not null,
  seen_at timestamptz,
  created_at timestamptz default now()
);

create table channel_reads (                           -- EVIDENCED (upsert on channel open)
  athlete_id uuid references profiles(id) on delete cascade not null,
  channel_id uuid references channels(id) on delete cascade not null,
  last_read_at timestamptz not null default now(),
  primary key (athlete_id, channel_id)
);

-- RPCs (signatures INFERRED from call sites; bodies live only in the live DB):
--   create_dm_channel(p_user_id uuid, p_other_user_id uuid) returns channels row / id
--   get_dm_peers(p_user_id uuid)
--   get_unread_counts(p_user_id uuid) returns (channel_id, unread_count)
--   get_unread_count(p_user_id uuid)  returns integer

-- ============ Training / Strava (CONFIRMED via CLAUDE.md gotchas) ============

create table strava_activities (                       -- EVIDENCED
  id uuid default uuid_generate_v4() primary key,
  athlete_id uuid references profiles(id) on delete cascade not null,
  strava_activity_id bigint unique,                    -- INFERRED (Strava's id space)
  name text,
  sport_type text,                                     -- raw Strava strings; normalise before comparing
  distance_m numeric,
  moving_time_s integer,
  start_date timestamptz,
  pr_celebrated boolean default false,                 -- CONFIRMED: never overwrite true back to false
  created_at timestamptz default now()
);

create table challenges (                              -- CONFIRMED columns via CLAUDE.md
  id uuid default uuid_generate_v4() primary key,
  name text,                                           -- INFERRED
  target_value numeric,                                -- CONFIRMED (ChallengeCard fallback)
  challenge_progress jsonb default '{}',               -- written by sync only, never the frontend
  challenge_completed_celebrated boolean default false,
  is_active boolean default true,                      -- multiple active challenges are intentional
  start_date date,
  end_date date,                                         -- INFERRED
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table badges (                                  -- EVIDENCED (ProfilePage select)
  key text primary key,
  name text not null,
  description text,
  icon text,
  tier text,
  sort_order integer default 0
);

create table profile_badges (                          -- EVIDENCED
  athlete_id uuid references profiles(id) on delete cascade not null,
  badge_key text references badges(key) not null,
  earned_at timestamptz default now(),
  primary key (athlete_id, badge_key)
);

-- ============ Gear Hub (CONFIRMED via CLAUDE.md Gear Hub section) ============

create table discounts (                               -- CONFIRMED fields
  id uuid default uuid_generate_v4() primary key,
  brand text not null,
  code text,
  amount text,
  description text,
  category text,
  color text,
  expiry date,
  single_use boolean default false,
  note text,
  active boolean default true,                         -- soft delete via active = false
  sort_order integer default 0,
  logo_url text
);

create table gear_categories (                         -- CONFIRMED (seeded, 10 TTL categories)
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table gear_picks (                              -- CONFIRMED fields
  id uuid default uuid_generate_v4() primary key,
  category_id uuid references gear_categories(id) on delete cascade,
  name text,                                           -- INFERRED label; verify
  good_for text[] default '{}',                        -- preset tags, enforced frontend-only
  added_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table gear_pick_votes (                         -- CONFIRMED: composite PK, toggle deletes, switch upserts
  pick_id uuid references gear_picks(id) on delete cascade not null,
  athlete_id uuid references profiles(id) on delete cascade not null,
  direction text check (direction in ('up','down')),
  primary key (pick_id, athlete_id)
);

create table gear_pick_reviews (                       -- CONFIRMED behaviour: author or admin can delete
  id uuid default uuid_generate_v4() primary key,
  pick_id uuid references gear_picks(id) on delete cascade not null,
  athlete_id uuid references profiles(id) on delete cascade,
  body text,                                           -- INFERRED column name; verify
  created_at timestamptz default now()
);

create table garage_listings (                         -- EVIDENCED (GearHub payload)
  id uuid default uuid_generate_v4() primary key,
  seller_id uuid references profiles(id) on delete cascade not null,
  title text not null,
  description text,
  price numeric,                                       -- null when is_trade
  condition text,
  category text,
  size text,                                           -- INFERRED from form; verify
  image_url text,                                      -- garage-images bucket, path {seller_id}/{timestamp}.{ext}
  status text default 'available',
  created_at timestamptz default now()
);

-- Indexes (from repo schema.sql)
create index idx_races_date on races(race_date);
create index idx_race_entries_athlete on race_entries(athlete_id);
create index idx_race_entries_race on race_entries(race_id);
create index idx_messages_channel on messages(channel_id, created_at);
create index idx_strava_activities_athlete on strava_activities(athlete_id, start_date);

-- RLS: enabled on all tables in the live system (repo schema.sql shows the pattern);
-- the live policy set is NOT recoverable from the repo and must be exported from the
-- live database before this reconstruction is used for a staging build.
