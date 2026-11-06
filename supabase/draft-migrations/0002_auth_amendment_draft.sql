-- Team TTL — auth amendment additions (DRAFT, Phase 0, 2026-10-31)
-- DO NOT RUN against production. Companion to 0001_reconstructed_schema.sql.
-- Implements the identity model from AUTH-AMENDMENT.md: stable internal
-- profile id, linkable external identities (Shopify first), and a public
-- handle separate from credentials. Team entitlement is NOT recorded
-- here — it lives in profiles.member_class (0006) per the Q2 decision
-- recorded below and in README.md.
--
-- APPLY ORDER: after 0001 and 0006; before 0003 (its RLS helper reads
-- profiles.member_class, which 0006 provides) and before 0004.
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

-- Team entitlement is NOT in this file. [decided 2026-11-06, README Q2]
-- Zack decided profiles.member_class (0006, live since 2026-11-02) is
-- the single source of truth for team entitlement: team /
-- racing_division / pro are entitled, community is not. The
-- team_entitled / entitled_via columns drafted here earlier (with
-- their backfill and CHECK) were removed so there is never a second
-- switch that can disagree with the class; 0003's RLS helper reads
-- member_class (+ role = 'admin'). Authentication (who you are) stays
-- separate from authorization (whether you are Team TTL) — the class
-- is simply where the authorization answer lives, assigned from the
-- Shopify tag / roster / manual source when an identity is linked.
alter table profiles add column if not exists shopify_customer_id text unique;

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
