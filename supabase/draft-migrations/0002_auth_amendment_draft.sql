-- Team TTL — auth amendment additions (DRAFT, Phase 0, 2026-10-31)
-- DO NOT RUN against production. Companion to 0001_reconstructed_schema.sql.
-- Implements the identity model from AUTH-AMENDMENT.md: stable internal
-- profile id, linkable external identities (Shopify first), public handle
-- separate from credentials, and a server-side team entitlement record.
--
-- APPLY ORDER: after 0001; before 0003 (its RLS helper reads
-- profiles.team_entitled from this file) and before 0004.
-- RECONCILED 2026-11-01 against 0001 + CLAUDE.md — see README.md in this
-- folder for the fix list and open questions. Changes in this pass are
-- marked [reconciled 2026-11-01].

-- Public handle: unique, used for mentions/DMs/display. NOT a credential;
-- sign-in stays email / linked identity. (Backfill from full_name slug, then enforce unique.)
-- [reconciled 2026-11-01] NOTE: the ADD COLUMN below already enforces
-- UNIQUE from the moment it runs, and no backfill is written in this file.
-- Backfill (slug from full_name, de-duplicated) must therefore run in the
-- same maintenance window, BEFORE any code reads handle as non-null.
-- NULL handles are allowed (unique permits multiple NULLs) until then.
alter table profiles add column if not exists handle text unique;

-- Team entitlement: authentication (who you are) is separate from
-- authorization (whether you are Team TTL). This is the record RLS checks.
alter table profiles add column if not exists team_entitled boolean default false;
alter table profiles add column if not exists entitled_via text; -- 'shopify_tag' | 'roster' | 'manual'
alter table profiles add column if not exists shopify_customer_id text unique;

-- [reconciled 2026-11-01] Backfill + NOT NULL for team_entitled.
-- As originally drafted this was default false with no backfill: every
-- existing profile — all invite-only team members by construction (see
-- 0001 invites + 0006's identical reasoning for member_class) — would have
-- read as NOT entitled, and 0003's RLS helper would have locked the whole
-- existing team out (admins excepted). Backfill first, then enforce.
update profiles set team_entitled = true, entitled_via = coalesce(entitled_via, 'roster')
  where team_entitled is distinct from true;
alter table profiles alter column team_entitled set default false;
alter table profiles alter column team_entitled set not null;

-- [reconciled 2026-11-01] entitled_via was free text with the value list
-- only in a comment; 0001/0004/0006 use CHECKs for enums like this. Add one.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_entitled_via_check'
  ) then
    alter table profiles
      add constraint profiles_entitled_via_check
      check (entitled_via is null or entitled_via in ('shopify_tag', 'roster', 'manual'));
  end if;
end $$;

-- [reconciled 2026-11-01] shopify_customer_id vs linked_identities:
-- this column duplicates linked_identities(provider='shopify',
-- provider_subject). Intended reading until Zack decides otherwise:
-- linked_identities is the source of truth for the link; this column is a
-- denormalised lookup cache on profiles and must be written in the same
-- server-side transaction as the linked_identities insert. See README
-- open question Q1 — if no cache is wanted, drop this column instead.

-- Linked external identities (Shopify Customer Account API first).
create table if not exists linked_identities (
  id uuid default uuid_generate_v4() primary key,
  profile_id uuid references profiles(id) on delete cascade not null,
  provider text not null,               -- 'shopify' | 'google' | 'apple'
  provider_subject text not null,       -- OIDC `sub` / Shopify customer id (gid string)
  email_at_link text,
  linked_at timestamptz default now(),
  last_login_at timestamptz,
  unique(provider, provider_subject)
);

alter table linked_identities enable row level security;
-- Policies (draft intent): a user can read/delete their own linked identities;
-- inserts happen server-side after a verified OAuth callback only.
-- [reconciled 2026-11-01] WARNING: enabling RLS with NO policies in this
-- file is deny-all in Postgres — the "user can read their own" intent above
-- does not exist until real policies are written from the exported live
-- policy set. Do not apply this file in this state to a database the app
-- reads linked_identities from.
