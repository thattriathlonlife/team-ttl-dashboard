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

## Inventory corrections vs the raw code scan

- `avatars` and `logos` appear as `.from('...')` in code but are **storage buckets**, not tables.
- The live system is: **19 tables** (5 original + 14 later) + `auth.users`, 4 RPCs, 3 storage buckets.
