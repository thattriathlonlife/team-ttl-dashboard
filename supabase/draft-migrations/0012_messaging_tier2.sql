-- 0012 (APPLIED 2026-11-06 via the Supabase Management API): messaging
-- Tier 2 (M5) — polls, group DMs, member channels with approval,
-- moderation tools (the usable core of draft 0004), forward,
-- @channel support data, report/block.
--
-- Deliberately NOT in this migration (from draft 0004): the DB-side
-- moderation trigger + moderation_terms engine. The client gate
-- (lib/moderation.js) already blocks severe content at send time;
-- 0012 adds the human side — reports, an admin queue, hide/mute
-- actions and the audit log. The trigger remains future work.
--
-- Pending-channel gating: channels.status='pending' hides a member
-- channel's MESSAGES from everyone but its creator and admins until
-- approval. The gate is added to channel_visible_to AND wrapped
-- around the 0009 message SELECT/INSERT policy bodies (their CASE
-- logic is preserved verbatim inside).

begin;

-- 1. channels: display name (group DMs, member channels) + status ────
alter table public.channels add column if not exists display_name text;
alter table public.channels add column if not exists status text not null default 'active';
alter table public.channels drop constraint if exists channels_status_check;
alter table public.channels add constraint channels_status_check check (status in ('active', 'pending'));

-- 2. channel_visible_to: pending channels visible to creator/admin ──
create or replace function public.channel_visible_to(cid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select uid is not null and exists (
    select 1 from channels c
    where c.id = cid
    and (
      c.status <> 'pending'
      or c.created_by = uid
      or exists (select 1 from profiles p where p.id = uid and p.role = 'admin')
    )
    and (
      case
        when c.type = 'dm' then exists (
          select 1 from channel_members cm
          where cm.channel_id = c.id and cm.athlete_id = uid
        )
        when c.type = 'race' and c.name like '%-discussion' then true
        else exists (
          select 1 from profiles p
          where p.id = uid
            and (p.member_class in ('team', 'racing_division', 'pro')
                 or p.role = 'admin')
        )
      end
    )
  )
$$;

-- 3. messages: forwarded marker + moderation state (0004 §2) ────────
alter table public.messages add column if not exists is_forwarded boolean not null default false;
alter table public.messages add column if not exists moderation_status text not null default 'clean';
alter table public.messages drop constraint if exists messages_moderation_status_check;
alter table public.messages add constraint messages_moderation_status_check
  check (moderation_status in ('clean', 'hidden', 'flagged'));

-- 4. profiles: auto/manual mute state (0004 §3) ──────────────────────
alter table public.profiles add column if not exists muted_until timestamptz;

-- 5. Mute enforcement: a BEFORE INSERT trigger (a policy cannot do
--    this — permissive INSERT policies OR together, and 0009's single
--    policy must stay the only insert gate). ────────────────────────
create or replace function public.enforce_not_muted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from profiles
    where id = new.athlete_id and muted_until is not null and muted_until > now()
  ) then
    raise exception 'muted' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists messages_enforce_not_muted on public.messages;
create trigger messages_enforce_not_muted
  before insert on public.messages
  for each row execute function public.enforce_not_muted();

-- 6. Policies: member channel proposals, admin updates, moderation ──
drop policy if exists "Members propose channels" on public.channels;
create policy "Members propose channels"
on public.channels for insert to authenticated
with check (created_by = auth.uid() and status = 'pending' and type <> 'dm');

drop policy if exists "Admins update channels" on public.channels;
create policy "Admins update channels"
on public.channels for update to authenticated
using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "Admins moderate messages" on public.messages;
create policy "Admins moderate messages"
on public.messages for update to authenticated
using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "Admins update profiles" on public.profiles;
create policy "Admins update profiles"
on public.profiles for update to authenticated
using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 7. The 0009 message policies gain the pending-channel gate. These
--    two statements were generated from the LIVE policy text (the
--    gate clause inserted at the channel-id anchor; bodies otherwise
--    byte-identical to 0009's) — hand-balancing these expressions is
--    how the first apply attempt broke. ─────────────────────────────
drop policy if exists "Insert own messages in visible channels" on public.messages;
create policy "Insert own messages in visible channels"
on public.messages for insert to authenticated
with check ((auth.uid() = athlete_id) AND (EXISTS ( SELECT 1
   FROM channels c
  WHERE ((c.id = messages.channel_id) AND (c.status <> 'pending'::text OR c.created_by = auth.uid() OR (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'::text))) AND CASE
            WHEN (c.type = 'dm'::text) THEN (EXISTS ( SELECT 1
               FROM channel_members cm
              WHERE ((cm.channel_id = c.id) AND (cm.athlete_id = auth.uid()))))
            WHEN ((c.type = 'race'::text) AND (c.name ~~ '%-discussion'::text)) THEN true
            ELSE (EXISTS ( SELECT 1
               FROM profiles p
              WHERE ((p.id = auth.uid()) AND ((p.member_class = ANY (ARRAY['team'::text, 'racing_division'::text, 'pro'::text])) OR (p.role = 'admin'::text)))))
        END AND ((c.is_readonly = false) OR (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))))))));

drop policy if exists "Read messages in visible channels" on public.messages;
create policy "Read messages in visible channels"
on public.messages for select to authenticated
using (EXISTS ( SELECT 1
   FROM channels c
  WHERE ((c.id = messages.channel_id) AND (c.status <> 'pending'::text OR c.created_by = auth.uid() OR (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'::text))) AND CASE
            WHEN (c.type = 'dm'::text) THEN (EXISTS ( SELECT 1
               FROM channel_members cm
              WHERE ((cm.channel_id = c.id) AND (cm.athlete_id = auth.uid()))))
            WHEN ((c.type = 'race'::text) AND (c.name ~~ '%-discussion'::text)) THEN true
            ELSE (EXISTS ( SELECT 1
               FROM profiles p
              WHERE ((p.id = auth.uid()) AND ((p.member_class = ANY (ARRAY['team'::text, 'racing_division'::text, 'pro'::text])) OR (p.role = 'admin'::text)))))
        END)));

-- 8. Polls ────────────────────────────────────────────────────────────
create table if not exists public.polls (
  id uuid primary key default uuid_generate_v4(),
  message_id uuid not null unique references public.messages(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  question text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.poll_options (
  id uuid primary key default uuid_generate_v4(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null,
  sort int not null default 0
);
create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, athlete_id)
);
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists "Read polls in visible channels" on public.polls;
create policy "Read polls in visible channels"
on public.polls for select to authenticated
using (public.channel_visible_to(channel_id, auth.uid()));
drop policy if exists "Create own polls" on public.polls;
create policy "Create own polls"
on public.polls for insert to authenticated
with check (athlete_id = auth.uid() and public.channel_visible_to(channel_id, auth.uid()));

drop policy if exists "Read poll options in visible channels" on public.poll_options;
create policy "Read poll options in visible channels"
on public.poll_options for select to authenticated
using (exists (select 1 from public.polls p where p.id = poll_id and public.channel_visible_to(p.channel_id, auth.uid())));
drop policy if exists "Create options for own polls" on public.poll_options;
create policy "Create options for own polls"
on public.poll_options for insert to authenticated
with check (exists (select 1 from public.polls p where p.id = poll_id and p.athlete_id = auth.uid()));

drop policy if exists "Read poll votes in visible channels" on public.poll_votes;
create policy "Read poll votes in visible channels"
on public.poll_votes for select to authenticated
using (exists (select 1 from public.polls p where p.id = poll_id and public.channel_visible_to(p.channel_id, auth.uid())));
drop policy if exists "Cast own poll vote" on public.poll_votes;
create policy "Cast own poll vote"
on public.poll_votes for insert to authenticated
with check (athlete_id = auth.uid() and exists (select 1 from public.polls p where p.id = poll_id and public.channel_visible_to(p.channel_id, auth.uid())));
drop policy if exists "Change own poll vote" on public.poll_votes;
create policy "Change own poll vote"
on public.poll_votes for update to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid() and exists (select 1 from public.polls p where p.id = poll_id and public.channel_visible_to(p.channel_id, auth.uid())));
drop policy if exists "Retract own poll vote" on public.poll_votes;
create policy "Retract own poll vote"
on public.poll_votes for delete to authenticated
using (athlete_id = auth.uid());

grant select, insert, update, delete on public.polls, public.poll_options, public.poll_votes to authenticated;
grant all on public.polls, public.poll_options, public.poll_votes to service_role;

do $$ begin
  alter publication supabase_realtime add table public.poll_votes;
exception when duplicate_object then null; end $$;

-- 9. Reports (the admin review queue's input) ────────────────────────
create table if not exists public.message_reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete set null,
  reason text,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz
);
alter table public.message_reports enable row level security;
drop policy if exists "Report messages" on public.message_reports;
create policy "Report messages"
on public.message_reports for insert to authenticated
with check (reporter_id = auth.uid());
drop policy if exists "Admins read reports" on public.message_reports;
create policy "Admins read reports"
on public.message_reports for select to authenticated
using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
drop policy if exists "Admins resolve reports" on public.message_reports;
create policy "Admins resolve reports"
on public.message_reports for update to authenticated
using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
grant select, insert, update on public.message_reports to authenticated;
grant all on public.message_reports to service_role;

-- 10. Blocks (DM-level, mirroring WhatsApp: group messages unaffected)
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
alter table public.user_blocks enable row level security;
drop policy if exists "Manage own blocks" on public.user_blocks;
create policy "Manage own blocks"
on public.user_blocks for all to authenticated
using (blocker_id = auth.uid())
with check (blocker_id = auth.uid());
grant select, insert, update, delete on public.user_blocks to authenticated;
grant all on public.user_blocks to service_role;

-- 11. Moderation audit log (draft 0004 §1) ───────────────────────────
create table if not exists public.moderation_events (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  channel_id uuid references public.channels(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  athlete_id uuid references public.profiles(id) on delete set null,
  source text not null check (source in ('client_gate', 'db_trigger', 'report', 'admin')),
  action text not null check (action in ('warn', 'block', 'hide', 'mute', 'unhide', 'clear')),
  rule text not null,
  content_hash text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);
alter table public.moderation_events enable row level security;
drop policy if exists "Admins manage moderation events" on public.moderation_events;
create policy "Admins manage moderation events"
on public.moderation_events for all to authenticated
using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
grant select, insert, update on public.moderation_events to authenticated;
grant all on public.moderation_events to service_role;

-- 12. Group DM creation (mirrors create_dm_channel's definer pattern)
create or replace function public.create_group_dm_channel(member_ids uuid[], display_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_channel uuid;
  v_members uuid[];
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  select array_agg(distinct m) into v_members
  from unnest(member_ids) as m
  where m <> v_caller;
  if v_members is null or coalesce(array_length(v_members, 1), 0) < 2 then
    raise exception 'A group DM needs at least two other members';
  end if;
  if array_length(v_members, 1) > 20 then
    raise exception 'Group DMs are capped at 20 other members';
  end if;
  insert into channels (name, type, category, is_readonly, sort_order, display_name, created_by, status)
  values ('dm-' || gen_random_uuid(), 'dm', 'dm', false, 0, nullif(trim(display_name), ''), v_caller, 'active')
  returning id into v_channel;
  insert into channel_members (channel_id, athlete_id)
  select v_channel, m from unnest(v_members || v_caller) as m;
  return v_channel;
end $$;
grant execute on function public.create_group_dm_channel(uuid[], text) to authenticated;

commit;
