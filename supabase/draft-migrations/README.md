# Draft schema reconstruction — Phase 0

**Status: DRAFT. Do not run against production.** Reconstructed 2026-10-31 from three evidence sources, in descending order of authority:

1. `schema.sql` in the repo root (documents only the original 5 tables)
2. `CLAUDE.md` architecture/gotcha notes (documents most later additions)
3. The frontend + API code surface (every `.from()`, select list, insert/update payload, filter column) — raw extraction saved at `~/workspace/team-ttl/phase-0/schema-evidence.txt`

Confidence tags per table in the SQL: **CONFIRMED** (source 1 or 2 states it), **EVIDENCED** (columns proven by code, types inferred), **INFERRED** (shape guessed from usage; verify before use).

## What only the live database can confirm

- Column types/nullability for EVIDENCED/INFERRED tables (types here are best inference from usage)
- RLS policies actually in force (the repo documents intent, not the live policy set)
- RPC bodies for `create_dm_channel`, `get_dm_peers`, `get_unread_count`, `get_unread_counts` (signatures inferred from call sites)
- Triggers, generated columns beyond `profiles.initials`, and any tables the current code no longer touches (e.g. `notification_log` may be legacy)
- Storage bucket policies (buckets known: `avatars`, `garage-images`, `logos`; the parity spec adds `message-media`)

## Later Phase 0 drafts

- `0002_auth_amendment_draft.sql` adds the identity/entitlement model.
- `0003_race_channel_split.sql` adds the explicit channel `audience` field and canonical race-channel types: `race_discussion` (public) and `race_logistics` (team-only). Legacy `type='race'` channels migrate to logistics because they originated inside the members-only prototype. Its RLS section is an acceptance target, not an executable policy replacement, until the live policy set has been exported.
- `0004_automoderation_draft.sql` adds server-side auto-moderation (verdict log, message moderation state, auto-mute, term list). Apply only after the 0002/0003 review.
- `0005_race_reconciliation_draft.sql` adds `races.last_seen_at` + `races.is_active` for scraper Phase B2 (stamping + 14-run retirement). Draft only; the scraper-side code ships only after this lands.
- `0006_profile_refresh_draft.sql` also exists (profile refresh: `member_class`, bio/home city/achievement/pinned badge, race finish flags, badge-catalog seed). It was **not** part of the 2026-11-01 reconciliation pass over 0002–0005 — see open question Q2 for its overlap with 0002.
- `0007_analytics_events_draft.sql` adds `analytics_events`, the reporting suite's event store (insert-only RLS; the app's tracker + `/api/events` collector already ship against it and drop events quietly until this lands). Independent of all other drafts; apply any time to start capture.
- `0008_strava_credentials.sql` — **APPLIED 2026-11-06** (Zack-approved token lockdown): moves Strava OAuth tokens off the member-readable `profiles` row into `strava_credentials` (RLS on, no policies — service-role only) and drops the three token columns from `profiles`. Applied in two parts around the code switch in `frontend/api/strava/`; see the file header and run 58 in the progress log.
- `0009_message_discount_rls.sql` — **APPLIED 2026-11-06** (Zack-approved hardening step 2): replaces the read-all SELECT policies on `messages` and `discounts` with visibility-shaped ones — DMs readable/postable by channel members only, public race discussions open to any signed-in account, team channels and logistics gated on `member_class` entitlement, discount codes entitled-only — and consolidates the two messages INSERT policies into one (the old pair's OR semantics let any account post as any athlete). Verified by a role-simulation matrix against live data before and after applying; see the file header and run 59 in the progress log. The rest of draft 0003 (audience column, canonical channel types) remains unapplied.

**Apply order (draft intent):** 0001 → 0002 → 0003 → 0004; 0005 is independent of 0002–0004 (races only) but must land before any Phase B2 scraper code; 0006 depends on 0001 (`badges`) and interacts with 0002 (see Q2).

## Inventory corrections vs the raw code scan

- `avatars` and `logos` appear as `.from('...')` in code but are **storage buckets**, not tables.
- The live system is: **19 tables** (5 original + 14 later) + `auth.users`, 4 RPCs, 3 storage buckets.

## Reconciliation pass — 2026-11-01 (drafts only, nothing applied)

Drafts 0002, 0003, 0004, and 0005 were reconciled against 0001 and the repo `CLAUDE.md`. All edits are in the draft files only, kept minimal, and marked `[reconciled 2026-11-01]` in place. One comment-only correction was also made in 0001 (item 1).

### What was fixed

1. **0001 — RPC signatures in the comment block contradicted CLAUDE.md and every call site.** `create_dm_channel` was drafted as `(p_user_id, p_other_user_id)` returning a channels row; the code and CLAUDE.md both say `(other_athlete_id uuid) → uuid` with the caller taken from `auth.uid()`. `get_dm_peers` was drafted as `(p_user_id uuid)`; the code calls it with `{ p_channel_ids }` and CLAUDE.md gives the full return table. Comment corrected in place; no schema changed.
2. **0002 — `team_entitled` would have locked out the existing team.** It was `default false` with no backfill and no NOT NULL, so every existing invite-only member would have read as not entitled under 0003's RLS helper (admins excepted). Added: a backfill setting existing profiles to entitled via `'roster'`, then `SET DEFAULT false` + `SET NOT NULL`. Same reasoning 0006 already applies to `member_class`.
3. **0002 — `entitled_via` was free text** with its value list (`shopify_tag | roster | manual`) only in a comment. Added a guarded CHECK constraint (`profiles_entitled_via_check`), matching the enum-by-CHECK pattern used in 0001/0004/0006.
4. **0002 — `handle` ordering hazard documented.** The `ADD COLUMN … UNIQUE` enforces uniqueness immediately, but the backfill the header comment describes is not in the file. Added an in-place note: backfill must run in the same maintenance window, before any code reads `handle` as non-null.
5. **0002 — RLS enabled on `linked_identities` with no policies is deny-all.** Added an explicit warning comment; the "user can read their own" line above it is intent only until real policies are written from the live export.
6. **0003 — DM channels were backfilled to `audience = 'team'`.** DMs fell through the audience CASE to `'team'`, misdescribing them: DM visibility is membership-based (`channel_members`), never entitlement-based. The CASE now returns NULL for `type = 'dm'` (the shape check and §2 SELECT rule already treat DMs separately, and the audience CHECK passes on NULL).
7. **0003 — a non-race channel could be made public by name alone.** The `%-discussion` suffix branch fired for any channel; the client encoding (`frontend/src/lib/channels.js`) only reads that suffix in race context. The public branch is now guarded to race context (`race_id` present, `category = 'race'`, or race type).
8. **0003 — prerequisite clarified.** Noted that 0001's reconstruction omits the live `channels` type/category CHECK constraints entirely (a known gap in 0001 — CLAUDE.md and the live client failures are authoritative), that this migration introduces no new category value, and that the header now declares the 0002 dependency and defines "Staff" as `profiles.role = 'admin'`.
9. **0004 — inconsistent UUID default.** `moderation_events.id` used `gen_random_uuid()`; every id in 0001 uses `uuid_generate_v4()` (uuid-ossp). Aligned to `uuid_generate_v4()` so the draft set depends on one UUID extension.
10. **0004 — new tables had RLS left off**, unlike 0001 (RLS on all tables) and 0002. Added `enable row level security` for `moderation_events` and `moderation_terms`, with the same deny-all-until-policies warning as 0002.
11. **0004 + 0003 — "staff" was undefined.** Neither draft defined it and 0001 has no staff role. Both files now state in their headers: staff := `profiles.role = 'admin'`.
12. **0005 — self-contradictory ordering note resolved.** The header said the `is_active = true` filter both "must NOT land before this migration + one stamping run" and "ordering is safe". Corrected in place: the filter is safe any time after the migration (DEFAULT true keeps pre-migration rows visible); the *retirement* step is what must wait for stamping. Also added: the header's project ref (`imnykwagjlzitgktznlz`) was verified as the Team TTL project, and a naming note that `races.is_active` and `challenges.is_active` (0001) are unrelated flags.

### Known non-issues (checked, deliberately left alone)

- **Schema qualification differs across drafts** — 0004/0005 qualify with `public.`, 0001/0002/0003/0006 do not. Same target schema under the default `search_path`; cosmetic only, left as-is to keep the diff minimal.
- **0005's project ref is correct** — `imnykwagjlzitgktznlz` matches `RELAUNCH-AND-PROPOSAL.md` and `SUPABASE-DESK-SESSION.md` (Team TTL's project, not Fed State's).
- **0006's badge seed matches 0001** — its `insert into badges (key, name, icon, tier, description, sort_order)` lines up exactly with 0001's `badges` table, and `pinned_badge_key` correctly references `badges(key)`.

### Open questions for Zack

- **Q1 — `profiles.shopify_customer_id` (0002): keep the cache or drop it?** 0002 stores the Shopify customer id both on `profiles` and in `linked_identities` (`provider='shopify'`). The draft now documents `linked_identities` as the source of truth and the column as a same-transaction lookup cache. If no read path actually needs the cache, dropping the column is cleaner. Decide before 0002 is applied.
- **Q2 — Two sources of truth for "team": DECIDED by Zack 2026-11-06 — `member_class` is the source of truth.** `profiles.member_class` (0006, applied 2026-11-02) decides entitlement: `team | racing_division | pro` are entitled, `community` is not; `role = 'admin'` remains an orthogonal overlay. The `team_entitled` / `entitled_via` columns were removed from the 0002 draft (2026-11-06), 0003's RLS helper reads `member_class`, and the client derives entitlement from the class (`frontend/src/lib/tier.js`: `profileEntitled` / `isEntitledClass`, shipped in run 57). The legacy `team_entitled` boolean is honoured only as a fallback for synthetic/demo rows that carry no class.
- **Q3 — 0006's backfill is not re-runnable: CLOSED by execution (2026-11-02).** The backfill ran exactly once when 0006 was applied via the Supabase Management session (all 7 then-existing profiles became `member_class = 'team'`, verified by read-back). Standing caution: never re-run that UPDATE standalone — after genuine Community signups exist it would silently promote them.
- **Q4 — Live export: RECEIVED and reconciled 2026-11-06.** Zack ran the export query and pasted the full result (columns, CHECKs, RLS state + policies, RPC bodies) into the Team TTL chat; reconciliation lives at `~/workspace/team-ttl/SCHEMA-RECONCILIATION-2026-11-06.md`. Confirmed: 0002/0003/0004 not applied; 0005/0006/0007 applied. Mechanism update: DDL no longer needs Zack to paste it — since 2026-11-02 the Supabase Management connection lets Friday apply a migration set directly once Zack approves that exact set (how 0005/0006 landed).
- **Q5 — `profiles.handle` backfill (0002): who writes it?** The slug + de-duplication backfill for existing members is described but not written in any draft. It needs an owner and a collision rule (two members with the same initials/name slug) before 0002 is applied.
