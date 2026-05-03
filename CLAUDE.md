# CLAUDE.md — AI Assistant Context for Team TTL Dashboard

This file gives Claude the critical context needed to work on this codebase without re-learning it from scratch each session. Read this before touching any file.

---

## Project Summary

Private invite-only team dashboard for ThatTriathlonLife athletes. React + Vite frontend, Supabase backend, Vercel hosting, GitHub Actions for scheduled jobs. See README.md for full architecture.

The owner is **Zack Godwin** — he is an admin athlete. Most testing and debugging is done against his account.

---

## Critical Architecture Decisions

### Strava Sync — Two Completely Separate Files

There are **two separate sync files** that must stay in sync with each other:

- `/api/strava/sync.js` — full pipeline: fetch activities, upsert, prune, compute totals, check badges, celebrate PRs, update challenge progress. Called by GitHub Actions hourly AND by the Refresh button.
- `/api/strava/refresh.js` — thin proxy only. POSTs to `/api/strava/sync` with `userId` and `CRON_SECRET`. Does NOT contain any Strava logic.

**Never add Strava/badge/challenge logic to `refresh.js`** — it all belongs in `sync.js`. The Refresh button on the Training page calls `/api/strava/refresh`, which proxies to sync with `singleUserId` set. `sync.js` filters to that one athlete when `req.body.userId` is present.

### Streak — Never Recompute from Stored Activities

The streak integer on `profiles.training_streak_current` is the source of truth. It is computed correctly during bootstrap from a full Strava history walk (which is then discarded). The stored `strava_activities` window is a display feed only — it is never long enough to recount a real streak.

**Incremental sync must only:**
1. Check if athlete has activity this week or last week
2. Compare against `profiles.training_streak_last_active`
3. Increment, preserve, or reset accordingly

**Never call `computeWeeklyStreak()` in incremental sync.** This was a bug that was fixed — don't re-introduce it.

### Activity Retention Window

Activities are stored back to the **1st of the previous month** (not a rolling 14-day window — that was the original design and has been changed). The `getRetentionCutoff()` function in `sync.js` computes this. The monthly recap on the Training page depends on this window being at least a full prior month.

### Multiple Active Challenges

Multiple challenges can be active simultaneously. `updateChallengeProgress()` fetches all active challenges and calls `updateSingleChallengeProgress()` for each. **Never use `.single()` when querying active challenges.**

### Challenge Progress — Target Value Fallback

When a challenge is first created, `challenge_progress` is `{}` (empty). `ChallengeCard.jsx` must fall back to `challenge.target_value` for the target km display — not `progress.target_km || 1`. The `|| 1` default caused a bug where new challenges showed 1km instead of the real target.

### Sport Type Normalisation

**`run` must be checked before `ride`/`virtual` in `normaliseSport()`.**

`VirtualRun` contains the string "virtual". If you check `includes('virtual')` before `includes('run')`, `VirtualRun` gets mapped to `ride` — which breaks Zwift run tracking for challenges and badges.

Correct order:
```js
if (s.includes('swim'))   return 'swim'
if (s.includes('run'))    return 'run'   // MUST be before virtual check
if (s.includes('ride') || s.includes('cycling') || s === 'virtualride') return 'ride'
```

This normalisation exists in two places: `sync.js` (server) and `Training.jsx` (client, `normaliseSportClient`). Keep them in sync.

### Shout-Outs Channel Lookup

`getTrainingChannelId()` in `sync.js` looks up the channel by **name = 'shout-outs'**, not by category or sort_order. Do not change this to a category-based lookup — there are other training channels and the wrong one will be targeted.

### Deployment

Must deploy from `cd frontend && vercel --prod`. Running `vercel --prod` from the repo root fails with exit code 127 (vite not found) because node_modules are inside `frontend/`.

---

## Database Gotchas

### `challenges` table
- `challenge_progress` (JSONB) — written by sync, read by frontend. Never written by frontend.
- `challenge_completed_celebrated` (boolean) — prevents repeat completion announcements. Must exist or the completion post logic will error.
- No unique constraint on `is_active` — multiple active challenges are intentional.

### `profiles` table key columns
- `training_streak_last_active` (date) — added after initial schema. May be NULL for athletes who existed before the column was added. Incremental sync handles NULL gracefully.
- `strava_bootstrap_status` — reset to `'pending'` to force a full re-bootstrap (re-walks Strava history, recomputes streak).

### `strava_activities` table
- `pr_celebrated` (boolean) — prevents duplicate PR shout-outs. Never overwrite `true` back to `false`.
- `sport_type` stores raw Strava strings (`VirtualRide`, `VirtualRun`, `TrailRun` etc.) — always normalise before comparing.

---

## Common Tasks

### Testing badges from scratch
```sql
DELETE FROM profile_badges WHERE athlete_id = (
  SELECT id FROM profiles WHERE full_name = 'Zack Godwin'
);
```
Then hit Refresh on the Training page.

### Resetting streak (re-bootstrap)
```sql
UPDATE profiles SET strava_bootstrap_status = 'pending' WHERE full_name = 'Zack Godwin';
```
Then hit Refresh. Bootstrap will re-walk full Strava history and recompute streak correctly.

### Clearing a channel's messages
```sql
DELETE FROM messages WHERE channel_id = (
  SELECT id FROM channels WHERE name = 'channel-name'
);
```

### Checking what sport types are stored
```sql
SELECT DISTINCT sport_type FROM strava_activities ORDER BY sport_type;
```

---

## File Ownership — What Lives Where

| Concern | File |
|---------|------|
| Strava fetch, badge check, PR celebration, challenge progress, streak | `sync.js` |
| Refresh button proxy | `refresh.js` |
| Challenge card UI + progress display | `ChallengeCard.jsx` |
| Challenge create/edit/end modal | `ChallengeAdminModal.jsx` |
| Training feed, weekly summary, challenge cards, badge strips | `Training.jsx` |
| Badge display on profile | `ProfilePage.jsx` |
| Welcome badge award | `CompleteProfile.jsx` |

---

## Known Bootstrap Behaviour

When an athlete first connects Strava, the bootstrap evaluates **all** badge conditions against their full history at once. Every badge they've ever qualified for fires simultaneously and posts to `#shout-outs`. This is expected and unavoidable — `alreadyEarned` prevents re-posting after the first run.

Future improvement: a "silent bootstrap" flag that awards badges without posting, to prevent the flood for new athletes.

---

## Style Guide

- **Component styles** — inline style objects named `S` at the top of each file. No CSS modules, no Tailwind.
- **Colours** — `#00C4B4` (teal/primary), `#FF3D8B` (pink), `#E8B84B` (amber/challenge), `#FF5A1F` (orange), `#161616` (card bg), `#1a1a1a` (modal bg)
- **Typography** — `Barlow Condensed` for headings/labels/buttons, `Barlow` for body text
- **Modal pattern** — match `AddRaceModal.jsx` / `InviteModal.jsx`: fixed overlay, `#1a1a1a` bg, coloured `borderTop`, Barlow Condensed title, cancel + submit buttons right-aligned
- **Admin pattern** — match `Discounts.jsx` admin modal for any new admin UI
- **No markdown in messages** — the messaging UI does not render markdown. Do not use `**bold**` in `postToTrainingChannel()` strings.
