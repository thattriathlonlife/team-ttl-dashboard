-- 0010_messaging_parity.sql — schema foundation for the WhatsApp-parity
-- messaging rebuild (M1). Approved as part of Zack's 2026-11-06
-- "Full rebuild + Web Push now" decision on the messaging audit
-- (~/workspace/team-ttl/MESSAGING-AUDIT-2026-11-06.md). Applied
-- 2026-11-06 via the Supabase Management API. PURELY ADDITIVE: no
-- existing column, policy, or row is changed or removed.
--
-- Contents:
--   1. channel_visible_to() — a SECURITY DEFINER helper mirroring
--      migration 0009's channel-visibility rule, for reuse by the
--      storage policies below (0009's own policies stay as applied).
--   2. channel_user_state — per-user mute / archive / pin.
--   3. message_stars — per-user starred messages.
--   4. messages: deleted_at (soft delete-for-everyone), media_path +
--      media_kind + audio_duration_s (private-bucket media, voice
--      notes), content_tsv generated column + GIN index (search).
--   5. message_reactions.channel_id (denormalized, backfilled) so
--      reaction changes can be realtime-subscribed per channel; the
--      table joins the supabase_realtime publication.
--   6. push_subscriptions — Web Push subscriptions (kind leaves room
--      for fcm/apns tokens if a native wrapper lands later).
--   7. private_config — service-role-only key/value for server
--      secrets the Vercel functions need (VAPID private key), the
--      strava_credentials pattern.
--   8. message-media storage bucket (PRIVATE) + policies: read and
--      upload only where the caller can see the channel (path is
--      <channel_id>/<athlete_id>/<file>), delete only your own files.

-- 1. Visibility helper (mirrors 0009) --------------------------------
create or replace function public.channel_visible_to(cid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null and exists (
    select 1 from channels c
    where c.id = cid
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

-- 2. channel_user_state ----------------------------------------------
create table if not exists public.channel_user_state (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  muted_until timestamptz,
  archived boolean not null default false,
  pinned boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, channel_id)
);
alter table public.channel_user_state enable row level security;
drop policy if exists "Manage own channel state" on public.channel_user_state;
create policy "Manage own channel state"
on public.channel_user_state for all to authenticated
using (auth.uid() = athlete_id)
with check (auth.uid() = athlete_id);
grant select, insert, update, delete on public.channel_user_state to authenticated;
grant all on public.channel_user_state to service_role;

-- 3. message_stars ----------------------------------------------------
create table if not exists public.message_stars (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (athlete_id, message_id)
);
alter table public.message_stars enable row level security;
drop policy if exists "Manage own stars" on public.message_stars;
create policy "Manage own stars"
on public.message_stars for all to authenticated
using (auth.uid() = athlete_id)
with check (auth.uid() = athlete_id);
grant select, insert, update, delete on public.message_stars to authenticated;
grant all on public.message_stars to service_role;

-- 4. messages additions ----------------------------------------------
alter table public.messages
  add column if not exists deleted_at timestamptz,
  add column if not exists media_path text,
  add column if not exists media_kind text,
  add column if not exists audio_duration_s integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_media_kind_check'
  ) then
    alter table public.messages
      add constraint messages_media_kind_check
      check (media_kind in ('image', 'audio', 'video'));
  end if;
end $$;

alter table public.messages
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists messages_content_tsv_idx
  on public.messages using gin (content_tsv);
create index if not exists messages_channel_created_idx
  on public.messages (channel_id, created_at desc);

-- 5. message_reactions: channel_id + realtime ------------------------
alter table public.message_reactions
  add column if not exists channel_id uuid references public.channels(id) on delete cascade;

update public.message_reactions r
set channel_id = m.channel_id
from public.messages m
where m.id = r.message_id and r.channel_id is null;

create index if not exists message_reactions_channel_idx
  on public.message_reactions (channel_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;

-- 6. push_subscriptions ------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'webpush'
    check (kind in ('webpush', 'fcm', 'apns')),
  endpoint text not null,
  p256dh text,
  auth text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (athlete_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "Manage own push subscriptions" on public.push_subscriptions;
create policy "Manage own push subscriptions"
on public.push_subscriptions for all to authenticated
using (auth.uid() = athlete_id)
with check (auth.uid() = athlete_id);
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- 7. private_config (service-role only) --------------------------------
create table if not exists public.private_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.private_config enable row level security;
-- No policies: only the service role (RLS bypass) can read or write.
grant all on public.private_config to service_role;

-- 8. message-media bucket (private) + storage policies ------------------
insert into storage.buckets (id, name, public)
values ('message-media', 'message-media', false)
on conflict (id) do nothing;

drop policy if exists "Read message media in visible channels" on storage.objects;
create policy "Read message media in visible channels"
on storage.objects for select to authenticated
using (
  bucket_id = 'message-media'
  and public.channel_visible_to(((storage.foldername(name))[1])::uuid, auth.uid())
);

drop policy if exists "Upload message media to visible channels" on storage.objects;
create policy "Upload message media to visible channels"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-media'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.channel_visible_to(((storage.foldername(name))[1])::uuid, auth.uid())
);

drop policy if exists "Delete own message media" on storage.objects;
create policy "Delete own message media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'message-media'
  and (storage.foldername(name))[2] = auth.uid()::text
);
