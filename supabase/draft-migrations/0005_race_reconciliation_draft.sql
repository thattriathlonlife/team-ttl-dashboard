-- 0005 — Race reconciliation columns (scraper Phase B2)
-- Status: DRAFT — not applied. Prepared 2026-11-01 (see SCRAPER-AUDIT.md).
-- Apply manually in the Supabase SQL editor for project
-- imnykwagjlzitgktznlz when ready; the scraper-side stamping/retirement
-- code ships only AFTER this lands (an upsert naming a missing column
-- fails the whole batch).
--
-- Purpose: give the races table a memory. Today nothing records when a
-- row was last returned by its source, so a race that is cancelled or
-- rescheduled upstream leaves a wrong future row that looks identical
-- to a live one. With last_seen_at stamped on every upsert:
--   * upcoming rows unseen for 14 consecutive daily runs are retired
--     (is_active = false) — never deleted, so race_entries and channel
--     links stay intact and a returning race reactivates itself;
--   * the app already filters on race_date; once B2 ships it also
--     filters is_active = true.
--
-- RECONCILED 2026-11-01 against 0001 + CLAUDE.md — see README.md in this
-- folder. Changes in this pass are marked [reconciled 2026-11-01].
-- [reconciled 2026-11-01] Ordering wording corrected: the earlier draft
-- said both "must NOT land before this migration + one stamping run" and
-- "ordering is safe". Both halves, precisely: the is_active = true filter
-- is SAFE to land any time after this migration because DEFAULT true
-- keeps every pre-migration row visible; what must wait for stamping
-- runs is the RETIREMENT step (setting is_active = false from
-- last_seen_at) — retiring before last_seen_at has been stamped would
-- have no signal to retire on. Project ref in the header above
-- (imnykwagjlzitgktznlz) verified against RELAUNCH-AND-PROPOSAL.md /
-- SUPABASE-DESK-SESSION.md — it is the Team TTL project, not Fed State's.
-- Naming note: races.is_active (this file) and challenges.is_active
-- (0001, "is this challenge live") are unrelated flags on different
-- tables — queries must qualify the table, never assume one meaning.

alter table public.races
  add column if not exists last_seen_at timestamptz,
  add column if not exists is_active boolean not null default true;

create index if not exists races_active_date_idx
  on public.races (is_active, race_date);

comment on column public.races.last_seen_at is
  'Last scraper run that returned this race from its source. Stamped by the scraper upsert (Phase B2).';
comment on column public.races.is_active is
  'Retirement flag set by the scraper after 14 consecutive unseen runs. Rows are retired, never deleted, so entries survive.';
