-- 0009_message_discount_rls.sql — close the read-all holes on messages
-- and discounts (step 2 of the 2026-11-06 schema-reconciliation
-- hardening sequence; step 1 was 0008, the Strava token lockdown).
-- APPROVED by Zack 2026-11-06 ("proceed" on the step-2 proposal) and
-- applied the same day via the Supabase Management API, after a
-- role-simulation matrix verified the new policies against the live
-- data (see run 59 in the progress log).
--
-- What was wrong (verified from the 2026-11-06 live export):
--   * messages SELECT "Read all messages": auth.role()='authenticated'
--     — ANY signed-in account could read every message, including DMs.
--     DMs were private in the UI only.
--   * discounts SELECT "Read active discounts": any signed-in account
--     could read partner-deal codes, which the tier model reserves for
--     entitled team accounts.
--   * messages INSERT had TWO permissive policies whose OR semantics
--     quietly defeated the own-message check: "Admin posts to readonly
--     channels" passes for ANY insert into a non-readonly channel, with
--     no athlete check — so any signed-in account could post AS ANY
--     athlete into almost any channel (impersonation). This migration
--     consolidates INSERT into a single policy (see below).
--
-- Design (matches ACCESS-AND-UI-SPEC tier model + draft 0003 §2's
-- intended RLS shape, written against the exported live policies):
--   * Group channels carry NO membership rows in this app (verified:
--     channel_members exists only for DMs), so group-channel visibility
--     cannot be membership-based. It follows entitlement instead —
--     profiles.member_class, the source of truth since the 2026-11-06
--     Q2 decision: team / racing_division / pro, plus role='admin'.
--   * DM channels (type='dm'): members only, via channel_members.
--     Strictly — not even admins who are not members.
--   * Public race discussions (type='race', name '%-discussion', the
--     live encoding from lib/channels.js): readable and postable by
--     any signed-in account, per the product rule. Legacy race
--     channels without the suffix are logistics — entitled only,
--     never silently public (draft 0003's migration rule).
--   * discounts SELECT: entitled accounts only. Admins keep full
--     access through the existing "Admins manage discounts" policy.
--
-- Unchanged: messages UPDATE/DELETE (already own-only), channel_reads
-- and message_mentions (already own-scoped), channels SELECT (channel
-- metadata stays readable; names carry no content). The SECURITY
-- INVOKER unread-count functions (get_unread_count(s)) pick up the
-- new visibility automatically because RLS applies inside them.
-- Residual, deliberately out of scope: message_reactions SELECT is
-- still read-all — it exposes emoji + athlete + message id metadata,
-- never content.

-- ── messages SELECT ─────────────────────────────────────────────────
drop policy if exists "Read all messages" on public.messages;

create policy "Read messages in visible channels"
on public.messages for select to authenticated
using (
  exists (
    select 1 from public.channels c
    where c.id = messages.channel_id
    and (
      case
        when c.type = 'dm' then exists (
          select 1 from public.channel_members cm
          where cm.channel_id = c.id
            and cm.athlete_id = auth.uid()
        )
        when c.type = 'race' and c.name like '%-discussion' then true
        else exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and (p.member_class in ('team', 'racing_division', 'pro')
                 or p.role = 'admin')
        )
      end
    )
  )
);

-- ── messages INSERT (consolidated) ──────────────────────────────────
-- One policy: you post as yourself, only into a channel you can see,
-- and readonly channels stay admin-only (the intent of the policy
-- being replaced, which as written granted everyone).
drop policy if exists "Insert own messages" on public.messages;
drop policy if exists "Admin posts to readonly channels" on public.messages;

create policy "Insert own messages in visible channels"
on public.messages for insert to authenticated
with check (
  auth.uid() = athlete_id
  and exists (
    select 1 from public.channels c
    where c.id = messages.channel_id
    and (
      case
        when c.type = 'dm' then exists (
          select 1 from public.channel_members cm
          where cm.channel_id = c.id
            and cm.athlete_id = auth.uid()
        )
        when c.type = 'race' and c.name like '%-discussion' then true
        else exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and (p.member_class in ('team', 'racing_division', 'pro')
                 or p.role = 'admin')
        )
      end
    )
    and (
      c.is_readonly = false
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'admin'
      )
    )
  )
);

-- ── discounts SELECT ────────────────────────────────────────────────
drop policy if exists "Read active discounts" on public.discounts;

create policy "Read discounts (entitled)"
on public.discounts for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.member_class in ('team', 'racing_division', 'pro')
           or p.role = 'admin')
  )
);
