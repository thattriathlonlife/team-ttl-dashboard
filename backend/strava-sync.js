/**
 * strava-sync.js — TTL Team Dashboard
 *
 * Runs every hour via GitHub Actions.
 *
 * For each connected athlete:
 *   - If bootstrap_status = 'pending'  → historical walk-back to compute initial streak
 *   - If bootstrap_status = 'complete' → incremental sync (last 2 days, keeps feed fresh)
 *
 * Stores:
 *   - strava_activities  : 14-day rolling window (feed display)
 *   - profiles           : streak columns only (current, longest, last_active)
 *
 * Never stores full history. Streak is computed once at bootstrap then
 * maintained incrementally on every subsequent sync.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const STRAVA_BASE = 'https://www.strava.com/api/v3';
const FEED_DAYS   = 14;   // rolling window kept in strava_activities
const BUFFER_DAYS = 2;    // incremental sync looks back 2 days to survive a missed run

// ── Strava token refresh ───────────────────────────────────────────────────

async function refreshStravaToken(profile) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: profile.strava_refresh_token,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed for ${profile.id}: ${res.status}`);

  const data = await res.json();

  await supabase.from('profiles').update({
    strava_access_token:    data.access_token,
    strava_refresh_token:   data.refresh_token,
    strava_token_expires_at: data.expires_at,
  }).eq('id', profile.id);

  return data.access_token;
}

async function getValidToken(profile) {
  const nowSecs = Math.floor(Date.now() / 1000);
  // Refresh if token expires within 5 minutes
  if (profile.strava_token_expires_at - nowSecs < 300) {
    return await refreshStravaToken(profile);
  }
  return profile.strava_access_token;
}

// ── Strava API helpers ────────────────────────────────────────────────────

async function fetchActivities(token, { after, before, page = 1, perPage = 200 } = {}) {
  const params = new URLSearchParams({ per_page: perPage, page });
  if (after)  params.set('after',  after);
  if (before) params.set('before', before);

  const res = await fetch(`${STRAVA_BASE}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) throw new Error(`Strava API error: ${res.status}`);

  return res.json();
}

// ── Streak helpers ────────────────────────────────────────────────────────

/**
 * Given a sorted (desc) list of activity dates (YYYY-MM-DD strings),
 * walk back from today counting consecutive active days.
 * A "day" counts if the athlete had at least one activity.
 */
function computeStreakFromDates(activityDates) {
  if (!activityDates.length) return 0;

  const unique = [...new Set(activityDates)].sort().reverse(); // most recent first
  const today  = toDateStr(new Date());
  const yesterday = toDateStr(new Date(Date.now() - 86400_000));

  // Streak must include today or yesterday to be active
  if (unique[0] !== today && unique[0] !== yesterday) return 0;

  let streak = 0;
  let cursor = unique[0] === today ? new Date() : new Date(Date.now() - 86400_000);

  for (const dateStr of unique) {
    const expected = toDateStr(cursor);
    if (dateStr === expected) {
      streak++;
      cursor = new Date(cursor.getTime() - 86400_000);
    } else if (dateStr < expected) {
      // Gap found — streak ends
      break;
    }
    // dateStr > expected shouldn't happen given sort, but skip if so
  }

  return streak;
}

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Incrementally update streak given the current profile state
 * and whether there was activity today or yesterday.
 */
function incrementalStreakUpdate(profile, recentActivityDates) {
  const today     = toDateStr(new Date());
  const yesterday = toDateStr(new Date(Date.now() - 86400_000));

  const hasToday     = recentActivityDates.includes(today);
  const hasYesterday = recentActivityDates.includes(yesterday);

  const lastActive = profile.training_streak_last_active; // 'YYYY-MM-DD' or null
  let current  = profile.training_streak_current  ?? 0;
  let longest  = profile.training_streak_longest  ?? 0;

  if (hasToday) {
    if (lastActive === today) {
      // Already counted — no change needed
      return null;
    } else if (lastActive === yesterday || current === 0) {
      current += 1;
    } else {
      // Gap between lastActive and today — streak broken
      current = 1;
    }
    longest = Math.max(current, longest);
    return { training_streak_current: current, training_streak_longest: longest, training_streak_last_active: today };
  }

  if (hasYesterday) {
    if (lastActive === yesterday) return null; // already counted
    if (lastActive === toDateStr(new Date(Date.now() - 2 * 86400_000)) || current === 0) {
      current += 1;
    } else {
      current = 1;
    }
    longest = Math.max(current, longest);
    return { training_streak_current: current, training_streak_longest: longest, training_streak_last_active: yesterday };
  }

  // No activity today or yesterday — streak broken if it was active
  if (lastActive && lastActive < yesterday) {
    return { training_streak_current: 0 };
  }

  return null; // nothing to update
}

// ── Activity upsert ───────────────────────────────────────────────────────

function mapActivity(raw, athleteId) {
  return {
    id:                    raw.id,
    athlete_id:            athleteId,
    name:                  raw.name,
    sport_type:            raw.sport_type ?? raw.type,
    start_date:            raw.start_date,
    start_date_local:      raw.start_date_local,
    distance:              raw.distance,
    moving_time:           raw.moving_time,
    elapsed_time:          raw.elapsed_time,
    total_elevation_gain:  raw.total_elevation_gain,
    average_heartrate:     raw.average_heartrate ?? null,
    max_heartrate:         raw.max_heartrate ?? null,
    map_summary_polyline:  raw.map?.summary_polyline ?? null,
  };
}

async function upsertActivities(activities, athleteId) {
  if (!activities.length) return;
  const rows = activities.map(a => mapActivity(a, athleteId));
  const { error } = await supabase
    .from('strava_activities')
    .upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}

async function pruneOldActivities(athleteId) {
  const cutoff = new Date(Date.now() - FEED_DAYS * 86400_000).toISOString();
  await supabase
    .from('strava_activities')
    .delete()
    .eq('athlete_id', athleteId)
    .lt('start_date', cutoff);
}

// ── Bootstrap: historical walk-back ──────────────────────────────────────

/**
 * Fetches activities in reverse chronological order until a gap is found.
 * Only stores the last FEED_DAYS worth in strava_activities (feed display).
 * Activities older than FEED_DAYS are fetched, used to compute the streak,
 * then discarded — never inserted into the database.
 * Walk-back has no page cap: terminates naturally when a gap is confirmed
 * or when Strava returns an empty page (beginning of athlete's history).
 */
async function bootstrapAthlete(profile, token) {
  console.log(`  → Bootstrapping ${profile.full_name}...`);

  await supabase
    .from('profiles')
    .update({ strava_bootstrap_status: 'in_progress' })
    .eq('id', profile.id);

  const feedCutoff  = Math.floor((Date.now() - FEED_DAYS * 86400_000) / 1000);
  const allDates    = [];   // all activity dates for streak computation
  const feedActivities = []; // only last FEED_DAYS for storage

  let page = 1;
  let gapFound = false;
  let oldestActiveDate = null;

  while (!gapFound) {
    let activities;
    try {
      activities = await fetchActivities(token, { page, perPage: 200 });
    } catch (err) {
      if (err.message === 'RATE_LIMITED') {
        console.warn(`  ⚠ Rate limited during bootstrap for ${profile.full_name} — will retry next run`);
        await supabase.from('profiles')
          .update({ strava_bootstrap_status: 'pending' })
          .eq('id', profile.id);
        return;
      }
      throw err;
    }

    if (!activities.length) break; // no more history

    for (const activity of activities) {
      const dateStr = activity.start_date_local.split('T')[0];
      allDates.push(dateStr);

      const activityTs = new Date(activity.start_date).getTime() / 1000;
      if (activityTs >= feedCutoff) {
        feedActivities.push(activity);
      }

      oldestActiveDate = dateStr;
    }

    // Check if we've found a gap — walk back day by day from the oldest date
    // to detect a break. We stop fetching once a gap is confirmed.
    const streak = computeStreakFromDates(allDates);

    // If the oldest fetched date is further back than our computed streak
    // would require, we've confirmed the gap — no need to fetch more pages.
    const streakStartDate = new Date(Date.now() - streak * 86400_000);
    const oldestFetched   = new Date(oldestActiveDate);
    if (oldestFetched <= streakStartDate) {
      gapFound = true;
    }

    page++;
  }

  const streakCurrent = computeStreakFromDates(allDates);
  const lastActive    = allDates.sort().reverse()[0] ?? null;

  // Store only feed window activities
  if (feedActivities.length) {
    await upsertActivities(feedActivities, profile.id);
  }

  await supabase.from('profiles').update({
    strava_bootstrap_status:    'complete',
    training_streak_current:    streakCurrent,
    training_streak_longest:    streakCurrent, // first run — current is longest we know of
    training_streak_last_active: lastActive,
    strava_last_synced_at:      new Date().toISOString(),
  }).eq('id', profile.id);

  console.log(`  ✓ Bootstrap complete: streak = ${streakCurrent} days, feed activities = ${feedActivities.length}`);
}

// ── Incremental sync ──────────────────────────────────────────────────────

async function incrementalSync(profile, token) {
  console.log(`  → Incremental sync for ${profile.full_name}...`);

  // Fetch last BUFFER_DAYS to survive a missed hourly run
  const after = Math.floor((Date.now() - BUFFER_DAYS * 86400_000) / 1000);
  const activities = await fetchActivities(token, { after });

  if (activities.length) {
    await upsertActivities(activities, profile.id);
  }

  // Prune feed to FEED_DAYS rolling window
  await pruneOldActivities(profile.id);

  // Compute streak update from recent activity dates
  const recentDates = activities.map(a => a.start_date_local.split('T')[0]);
  const streakUpdate = incrementalStreakUpdate(profile, recentDates);

  const profileUpdate = { strava_last_synced_at: new Date().toISOString() };
  if (streakUpdate) Object.assign(profileUpdate, streakUpdate);

  await supabase.from('profiles').update(profileUpdate).eq('id', profile.id);

  console.log(`  ✓ Synced ${activities.length} recent activities${streakUpdate ? `, streak → ${streakUpdate.training_streak_current ?? profile.training_streak_current}` : ''}`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚴 Strava sync — ${new Date().toISOString()}`);

  // Fetch all athletes with Strava connected
  const { data: athletes, error } = await supabase
    .from('profiles')
    .select(`
      id, full_name,
      strava_access_token, strava_refresh_token, strava_token_expires_at,
      strava_bootstrap_status,
      training_streak_current, training_streak_longest, training_streak_last_active
    `)
    .not('strava_access_token', 'is', null);

  if (error) throw error;
  if (!athletes?.length) {
    console.log('No athletes with Strava connected.');
    return;
  }

  console.log(`Found ${athletes.length} connected athlete(s)\n`);

  for (const profile of athletes) {
    try {
      console.log(`Processing: ${profile.full_name} (bootstrap: ${profile.strava_bootstrap_status})`);
      const token = await getValidToken(profile);

      if (profile.strava_bootstrap_status !== 'complete') {
        await bootstrapAthlete(profile, token);
      } else {
        await incrementalSync(profile, token);
      }
    } catch (err) {
      console.error(`  ✗ Error syncing ${profile.full_name}:`, err.message);
      // Continue with next athlete — don't let one failure kill the whole run
    }
  }

  console.log('\n✅ Sync complete');
}

main().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
