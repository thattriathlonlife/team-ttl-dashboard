-- Team TTL — public race discussions + team-only race logistics (DRAFT)
-- Phase 0, 2026-10-31. DO NOT RUN against production until the live RLS
-- policies and channel constraints have been exported and reviewed.
--
-- Product rule (ACCESS-AND-UI-SPEC.md):
--   * Every race may have one PUBLIC discussion. Any signed-in Community,
--     Team, or Staff account may read and post.
--   * Every race may have one TEAM-ONLY logistics channel for travel,
--     lodging, and meetups. Only entitled Team/Staff accounts may read/post.
--   * Legacy channels with type='race' were created inside the members-only
--     prototype. They therefore migrate to logistics, preserving history
--     without silently making old team conversations public.

-- 1. Canonical taxonomy -------------------------------------------------------

alter table channels
  add column if not exists audience text;

update channels
set audience = case
  when type = 'race_discussion' then 'public'
  when type in ('race', 'race_logistics') then 'team'
  else coalesce(audience, 'team')
end;

update channels
set type = case
  when race_id is not null and audience = 'public' then 'race_discussion'
  when race_id is not null and type = 'race' then 'race_logistics'
  else type
end
where race_id is not null;

alter table channels
  alter column audience set default 'team';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'channels_audience_check'
  ) then
    alter table channels
      add constraint channels_audience_check
      check (audience in ('public', 'team'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'channels_race_audience_shape_check'
  ) then
    alter table channels
      add constraint channels_race_audience_shape_check
      check (
        (type = 'race_discussion' and audience = 'public' and race_id is not null)
        or (type = 'race_logistics' and audience = 'team' and race_id is not null)
        or (type not in ('race_discussion', 'race_logistics'))
      );
  end if;
end $$;

-- Before enabling this index in production, inspect for duplicate legacy
-- race channels for the same race/audience and merge or archive them.
create unique index if not exists channels_one_race_channel_per_audience
  on channels (race_id, audience)
  where race_id is not null and type in ('race_discussion', 'race_logistics');

create index if not exists channels_race_audience_idx
  on channels (race_id, audience);

-- 2. Intended RLS shape -------------------------------------------------------
--
-- The live policy set is not in the repo, so the policies below are stated as
-- the acceptance target rather than blindly dropped/created here:
--
-- Helper (depends on the team_entitled column drafted in 0002):
--   public.is_team_entitled(user_id uuid) -> boolean
--   true when profiles.team_entitled is true or profiles.role = 'admin'.
--
-- channels SELECT:
--   - audience = 'public': any authenticated user.
--   - audience = 'team' and type <> 'dm': entitled Team/Staff users.
--   - type = 'dm': only rows joined through channel_members for auth.uid().
--
-- channels INSERT/UPDATE:
--   - Public race discussions and team logistics are created by authenticated
--     users only for an existing race; team logistics creation additionally
--     requires entitlement.
--   - created_by must equal auth.uid(); audience/type/race_id combinations
--     must satisfy the check constraint above.
--
-- messages SELECT/INSERT/UPDATE/DELETE and message_reactions,
-- message_mentions, channel_reads:
--   - The parent channel must be visible to the caller under the channels
--     rule above. A public channel grants read/post to authenticated users;
--     it does not grant access to the race's logistics channel.
--   - Message UPDATE/DELETE remains author-only except Staff moderation.
--
-- Public aggregate surfaces (race counts, map pins) must continue to read
-- race_entries only through the consent/display rules; making a discussion
-- public does NOT make entry rows or the named roster public.
