-- Team TTL — auth amendment additions (DRAFT, Phase 0, 2026-10-31)
-- DO NOT RUN against production. Companion to 0001_reconstructed_schema.sql.
-- Implements the identity model from AUTH-AMENDMENT.md: stable internal
-- profile id, linkable external identities (Shopify first), public handle
-- separate from credentials, and a server-side team entitlement record.

-- Public handle: unique, used for mentions/DMs/display. NOT a credential;
-- sign-in stays email / linked identity. (Backfill from full_name slug, then enforce unique.)
alter table profiles add column if not exists handle text unique;

-- Team entitlement: authentication (who you are) is separate from
-- authorization (whether you are Team TTL). This is the record RLS checks.
alter table profiles add column if not exists team_entitled boolean default false;
alter table profiles add column if not exists entitled_via text; -- 'shopify_tag' | 'roster' | 'manual'
alter table profiles add column if not exists shopify_customer_id text unique;

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
