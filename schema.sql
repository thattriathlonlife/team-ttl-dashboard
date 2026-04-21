-- TriTeam Dashboard — Supabase Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- PROFILES (linked to Supabase Auth)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text not null,
  email text not null unique,
  initials text generated always as (
    upper(substring(full_name from 1 for 1) || substring(full_name from position(' ' in full_name) + 1 for 1))
  ) stored,
  avatar_color text default 'color-a',
  whatsapp_number text,
  role text default 'athlete' check (role in ('athlete','admin')),
  created_at timestamptz default now()
);

-- INVITES (admin-controlled, invite-only access)
create table invites (
  id uuid default uuid_generate_v4() primary key,
  email text not null unique,
  invited_by uuid references profiles(id),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  used_at timestamptz,
  expires_at timestamptz default (now() + interval '7 days'),
  created_at timestamptz default now()
);

-- RACES (scraped + manually added)
create table races (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  type text not null check (type in ('IRONMAN','70.3','Other')),
  race_date date not null,
  location text not null,
  city text,
  country text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  external_id text unique,   -- ID from IRONMAN/Triathlon source
  source text default 'manual', -- 'scraped' | 'manual'
  registration_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RACE ENTRIES (which athlete is in which race)
create table race_entries (
  id uuid default uuid_generate_v4() primary key,
  race_id uuid references races(id) on delete cascade not null,
  athlete_id uuid references profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(race_id, athlete_id)
);

-- NOTIFICATIONS LOG
create table notification_log (
  id uuid default uuid_generate_v4() primary key,
  race_id uuid references races(id) on delete cascade,
  channel text not null, -- 'whatsapp'
  message text not null,
  sent_at timestamptz default now(),
  status text default 'sent'
);

-- INDEXES
create index idx_races_date on races(race_date);
create index idx_race_entries_athlete on race_entries(athlete_id);
create index idx_race_entries_race on race_entries(race_id);

-- ROW LEVEL SECURITY
alter table profiles enable row level security;
alter table races enable row level security;
alter table race_entries enable row level security;
alter table invites enable row level security;

-- Profiles: users can read all, only update their own
create policy "Read all profiles" on profiles for select using (auth.role() = 'authenticated');
create policy "Update own profile" on profiles for update using (auth.uid() = id);

-- Races: all authenticated users can read and insert
create policy "Read all races" on races for select using (auth.role() = 'authenticated');
create policy "Insert races" on races for insert with check (auth.role() = 'authenticated');
create policy "Update races" on races for update using (auth.role() = 'authenticated');

-- Race entries: all authenticated users read; users manage their own
create policy "Read all entries" on race_entries for select using (auth.role() = 'authenticated');
create policy "Manage own entries" on race_entries for all using (auth.uid() = athlete_id);

-- Invites: only admins can create; anyone can read their own token
create policy "Admin creates invites" on invites for insert
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "Read own invite" on invites for select using (email = (select email from profiles where id = auth.uid()));

-- Trigger: create profile on auth.users insert
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'New Member'), new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Seed: Insert first admin (run after creating your Supabase Auth account)
-- UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
