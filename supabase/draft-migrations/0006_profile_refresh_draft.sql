-- 0006_profile_refresh_draft.sql — DRAFT, not applied.
-- Profile refresh (spec: ~/workspace/team-ttl/PROFILE-REFRESH-SPEC.md).
-- Flair direction DECIDED by Zack 2026-11-01: name chips (option C).
--
-- What this adds:
--   profiles.member_class      — the stored membership class the chips
--                                read: community | team | racing_division
--                                | pro. Staff-assigned, never self-picked.
--                                Admin stays the existing profiles.role.
--   profiles.bio               — short member-written bio (<= 160 chars
--                                enforced in the app).
--   profiles.home_city         — powers roster "who's near you" + the ops
--                                population-density view.
--   profiles.achievement_line  — favorite achievement, member's own words.
--   profiles.pinned_badge_key  — one earned badge showcased on the
--                                profile header (must reference badges).
--   race_entries.finished      — finishes, not just entries (achievements
--   race_entries.finish_note     spec §3: finisher badge family).
--
-- Apply order: run this whole file once in the Supabase SQL editor.
-- After it lands, the app change that adds member_class / team_entitled
-- to the author joins can ship (the joins must NOT name these columns
-- before this runs — PostgREST fails the whole query on a bad column).

alter table profiles
  add column if not exists member_class text not null default 'community'
    check (member_class in ('community', 'team', 'racing_division', 'pro')),
  add column if not exists bio text,
  add column if not exists home_city text,
  add column if not exists achievement_line text,
  add column if not exists pinned_badge_key text references badges(key);

-- Existing profile holders are team members by construction (invite-only
-- roster); new community signups default to 'community' above.
update profiles set member_class = 'team' where member_class = 'community';

alter table race_entries
  add column if not exists finished boolean not null default false,
  add column if not exists finish_note text;

-- Badge catalog seed (achievements spec §3.1: one source of truth).
-- Keys + names mirror BADGE_LABELS in frontend/api/strava/sync.js.
-- Descriptions are placeholders in TTL's voice — review before applying.
insert into badges (key, name, icon, tier, description, sort_order) values
  ('welcome_team',   'Welcome to Team',  '👋', 'standard', 'Completed your profile and joined the team.', 1),
  ('race_first',     'Race Debut',       '🎽', 'standard', 'Entered your first race.', 2),
  ('race_5',         'Race Regular',     '📅', 'silver',   'Entered 5 races.', 3),
  ('race_10',        'Race Addict',      '🗓️', 'gold',     'Entered 10 races.', 4),
  ('streak_4',       'On A Roll',        '🔥', 'standard', 'Trained 4 weeks in a row.', 5),
  ('streak_8',       'Locked In',        '🔒', 'silver',   'Trained 8 weeks in a row.', 6),
  ('streak_12',      'Unbreakable',      '💪', 'silver',   'Trained 12 weeks in a row.', 7),
  ('streak_20',      'Unstoppable',      '🚀', 'gold',     'Trained 20 weeks in a row.', 8),
  ('streak_52',      'Year of Graft',    '🏆', 'elite',    'Trained 52 weeks in a row.', 9),
  ('pr_first',       'Personal Best',    '🏅', 'standard', 'Set your first PR.', 10),
  ('pr_10',          'PR Machine',       '⚡', 'silver',   'Set 10 PRs.', 11),
  ('pr_50',          'Record Breaker',   '💥', 'gold',     'Set 50 PRs.', 12),
  ('pr_100',         'Relentless',       '🎯', 'elite',    'Set 100 PRs.', 13),
  ('kudos_100',      'TTL Nash',         '👏', 'silver',   'Received 100 kudos.', 14),
  ('kudos_500',      'TTL Legend',       '⭐', 'gold',     'Received 500 kudos.', 15),
  ('run_1000',       '1,000km Runner',   '👟', 'silver',   'Ran 1,000 km all-time.', 16),
  ('run_5000',       'Ultra Runner',     '🏃', 'gold',     'Ran 5,000 km all-time.', 17),
  ('bike_10000',     '10,000km Rider',   '🚴', 'silver',   'Rode 10,000 km all-time.', 18),
  ('bike_25000',     'Velominati',       '🚵', 'gold',     'Rode 25,000 km all-time.', 19),
  ('century',        'The Century',      '💯', 'silver',   'Rode 160 km+ in one ride.', 20),
  ('marathon_legs',  'Marathon Legs',    '🦵', 'silver',   'Ran a marathon in one run.', 21),
  ('iron_swim',      'Iron Swimmer',     '🌊', 'silver',   'Swam 3.8 km in one swim.', 22),
  ('suffer_200',     'Pain Cave',        '😤', 'gold',     'Suffer score 200+ in one session.', 23),
  ('brick',          'Brick House',      '🧱', 'standard', 'Bike + run on the same day.', 24),
  ('triple_threat',  'Triple Threat',    '🔱', 'silver',   'Swim, bike and run on the same day.', 25),
  ('shred_till_bed', 'Shred Til'' Bed',  '🛏️', 'standard', 'Trained late into the night.', 26),
  ('half_iron_week', '70.3 Ready',       '🔶', 'silver',   'A 70.3-distance week of training.', 27),
  ('full_iron_week', 'Iron Ready',       '🔴', 'gold',     'A full-distance week of training.', 28)
on conflict (key) do nothing;
