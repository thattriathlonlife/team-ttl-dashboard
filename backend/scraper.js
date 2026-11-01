/**
 * TriTeam Race Scraper + WhatsApp Notifier
 * Node.js service — runs on a cron schedule (daily scrape, daily notification check)
 *
 * Install: npm install
 * Run:     node scraper.js
 * Cron:    0 6 * * * node /path/to/scraper.js   (runs at 6am daily)
 */

import 'dotenv/config';
import * as cheerio from 'cheerio';
import { appendFileSync } from 'fs';

// --- Config ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TRIATHLON_API_KEY = process.env.TRIATHLON_API_KEY;
const TRIATHLON_API_BASE = 'https://api.triathlon.org/v1';

// ---------------------------------------------------------------
// SUPABASE REST HELPER — replaces the JS client entirely.
// Uses the PostgREST API directly via fetch (native in Node 20).
// This avoids the WebSocket initialisation that @supabase/supabase-js
// performs at client creation time, which fails on Node < 22.
// ---------------------------------------------------------------
async function supabaseRequest(path, method = 'GET', body = null, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : null,
  });

  // DELETE and some POSTs return no body
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    return { data: null, error: { message: text || res.statusText } };
  }
  return { data, error: null };
}

// ---------------------------------------------------------------
// FEATURE FLAG — set to true once Meta Business account is ready
// ---------------------------------------------------------------
const NOTIFICATIONS_ENABLED = false;

// ---------------------------------------------------------------
// TRIATHLON.ORG API — fetch events by date range
// Covers IRONMAN, 70.3, Olympic, Sprint, and all other tri events
// API docs: https://developers.triathlon.org
// ---------------------------------------------------------------
async function fetchTriathlonEvents() {
  console.log('[Scraper] Fetching events from triathlon.org API...');

  if (!TRIATHLON_API_KEY) {
    throw new Error('[Scraper] TRIATHLON_API_KEY not set — cannot fetch events');
  }

  const currentYear = new Date().getFullYear();
  const startDate = `${currentYear}-01-01`;
  const endDate = `${currentYear + 1}-12-31`;

  // Paginated fetch (audit F3, 2026-11-01): the API returns total /
  // last_page metadata and the old single per_page=500 request silently
  // truncated the window — ascending order meant the cap ate the
  // furthest-future events first. Walk every page; fail loudly on HTTP
  // errors instead of returning an empty list (audit F2).
  const races = [];
  let page = 1;
  let lastPage = 1;
  let apiTotal = null;
  let eventsSeen = 0;

  do {
    const url = `${TRIATHLON_API_BASE}/events?start_date=${startDate}&end_date=${endDate}&per_page=500&order=asc&page=${page}`;
    console.log(`[Scraper] Requesting page ${page}: ${url}`);

    const response = await fetch(url, {
      headers: {
        'apikey': TRIATHLON_API_KEY,
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[Scraper] API error ${response.status}: ${text.slice(0, 300)}`);
    }

    const json = await response.json();
    if (page === 1) {
      apiTotal = json.total ?? null;
      lastPage = json.last_page ?? 1;
      console.log(`[Scraper] API window total: ${apiTotal} events across ${lastPage} page(s)`);
    }
    const events = json.data || [];
    eventsSeen += events.length;
    if (page === 1 && events.length > 0) {
      console.log('[Scraper] Sample event fields:', JSON.stringify(events[0], null, 2).substring(0, 500));
    }

    for (const event of events) {
      const name = event.event_title || '';
      const nameUpper = name.toUpperCase();

      // Classify type based on name
      let type;
      if (name.includes('70.3')) {
        type = '70.3';
      } else if (nameUpper.includes('IRONMAN')) {
        type = 'IRONMAN';
      } else if (nameUpper.includes('OLYMPIC')) {
        type = 'Olympic';
      } else if (nameUpper.includes('SPRINT')) {
        type = 'Sprint';
      } else if (nameUpper.includes('XTERRA')) {
        type = 'XTERRA';
      } else if (
        nameUpper.includes('TRIATHLON') ||
        nameUpper.includes('TRISTAR') ||
        nameUpper.includes('TRI ') ||
        nameUpper.includes('DUATHLON') ||
        nameUpper.includes('AQUATHLON')
      ) {
        type = 'Other';
      } else {
        continue; // skip unrelated events
      }

      const race_date = event.event_date ? event.event_date.split('T')[0] : null;
      if (!race_date) continue;

      // triathlon.org field names — venue is the city/location name
      const venue = event.event_venue || '';
      const country = event.event_country || event.event_country_name || '';
      const location = [venue, country].filter(Boolean).join(', ') || 'TBD';

      // Coordinates come back as event_latitude / event_longitude
      const lat = event.event_latitude ?? event.event_lat ?? null;
      const lng = event.event_longitude ?? event.event_lng ?? null;

      races.push({
        name,
        type,
        race_date,
        location,
        city: venue || null,
        country: country || null,
        latitude: lat ? parseFloat(lat) : null,
        longitude: lng ? parseFloat(lng) : null,
        external_id: `triorg_${event.event_id}`,
        source: 'triathlon_api',
        registration_url: event.event_website || event.event_listing || null,
      });
    }

    page++;
  } while (page <= lastPage);

  console.log(`[Scraper] API returned ${eventsSeen} total events (advertised total: ${apiTotal})`);
  console.log(`[Scraper] Filtered to ${races.length} triathlon events`);
  return races;
}

// ---------------------------------------------------------------
// PTO RACE CALENDAR SCRAPER — stats.protriathletes.org/pro-race-calendar
// Server-rendered HTML, covers all IRONMAN & 70.3 events worldwide
// ---------------------------------------------------------------
async function scrapeIronmanRaces() {
  console.log('[PTO] Fetching race calendar from stats.protriathletes.org...');

  const response = await fetch('https://stats.protriathletes.org/pro-race-calendar', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html',
    }
  });

  if (!response.ok) {
    // Fail loudly (audit F2, 2026-11-01): a dead source must turn the
    // run red, not silently contribute zero races.
    throw new Error(`[PTO] Failed to fetch calendar: HTTP ${response.status}`);
  }

  const html = await response.text();
  console.log(`[PTO] HTML length: ${html.length} chars`);

  const $ = cheerio.load(html);
  const races = [];

  // The page has race links like: <a href="/race/im-703-peru/2026/results">Ironman 70.3 Peru</a>
  // followed by plain text blocks with Country:, Location:, Distance:
  // We find all race links then walk up to grab the surrounding text block
  $('a[href*="/race/"]').each((_, el) => {
    try {
      const name = $(el).text().trim();
      if (!name || name.length < 3) return;

      // Only process IRONMAN branded races
      if (!/ironman/i.test(name)) return;

      // Get full text of nearest containing block
      // Walk up until we find a block with Country: in it
      let container = $(el).parent();
      let attempts = 0;
      while (attempts < 8 && !container.text().includes('Country:')) {
        container = container.parent();
        attempts++;
      }
      const blockText = container.text();

      // Extract date — "26 April 2026" or "TBA November 2026"
      const dateMatch = blockText.match(/(\d{1,2}\s+[A-Z][a-z]+\s+20\d{2})/);
      if (!dateMatch) {
        console.log(`[PTO] No date for: ${name}`);
        return;
      }
      const race_date = parseDateStr(dateMatch[1]);
      if (!race_date) return;

      // Extract Country and Location — stop before next field label
      const countryMatch = blockText.match(/Country:\s*([^:\n\r]+?)(?=\s*(?:Location:|Division:|Distance:|$))/);
      const locationMatch = blockText.match(/Location:\s*([^:\n\r]+?)(?=\s*(?:Country:|Division:|Distance:|$))/);
      const distanceMatch = blockText.match(/Distance:\s*([^:\n\r]+?)(?=\s*(?:Country:|Location:|Division:|$))/);

      const country = countryMatch ? countryMatch[1].trim() : '';
      const locationCity = locationMatch ? locationMatch[1].trim() : '';
      const distanceStr = distanceMatch ? distanceMatch[1].trim() : '';
      const location = [locationCity, country].filter(Boolean).join(', ') || 'TBD';

      // Classify type
      let type;
      if (name.includes('70.3') || distanceStr.toLowerCase().includes('half')) {
        type = '70.3';
      } else {
        type = 'IRONMAN';
      }

      const slug = $(el).attr('href')?.split('/race/')[1]?.split('/')[0] || '';
      const external_id = `pto_${slug || name.toLowerCase().replace(/\s+/g, '-')}_${race_date}`;

      races.push({
        name,
        type,
        race_date,
        location,
        country: country || null,
        external_id,
        source: 'pto_scrape',
        registration_url: slug
          ? `https://www.ironman.com/races/${
              slug
                .replace(/^ironman-703-/, 'im703-')
                .replace(/^im-703-/, 'im703-')
                .replace(/^ironman-/, 'im-')
            }`
          : `https://www.ironman.com/races`,
      });

      console.log(`[PTO] ${name} | ${race_date} | ${location}`);
    } catch (err) {
      console.error('[PTO] Error parsing entry:', err.message);
    }
  });

  // Deduplicate by external_id
  const seen = new Set();
  const unique = races.filter(r => {
    if (seen.has(r.external_id)) return false;
    seen.add(r.external_id);
    return true;
  });

  console.log(`[PTO] Found ${unique.length} IRONMAN/70.3 races`);
  return unique;
}

function parseDateStr(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------
// GEOCODER — OpenStreetMap Nominatim (free, no API key required)
// Adds lat/lon and city to a race based on its location string
// ---------------------------------------------------------------

function extractCityFromName(raceName) {
  const stripped = raceName
    .replace(/^ironman\s+70\.3\s+/i, '')
    .replace(/^ironman\s+/i, '')
    .trim();
  if (stripped && stripped.split(' ').length <= 3 && !/championship|world|series/i.test(stripped)) {
    return stripped;
  }
  return null;
}

function extractCityFromLocation(location) {
  if (!location || location === 'TBD') return null;
  const parts = location.split(',').map(p => p.trim());
  if (parts.length < 2) return null;
  return parts[0] || null;
}

// Curated coordinate overrides (audit F5, 2026-11-01): races whose
// name-derived "city" is actually a state/region, pinned to their real
// venues. These venues do not move; if one ever does, update the row
// here and the DB cache picks it up on the next run.
const GEOCODE_OVERRIDES = {
  'Ironman Florida': { city: 'Panama City Beach', latitude: 30.1766, longitude: -85.8055 },
  'Ironman Western Australia': { city: 'Busselton', latitude: -33.6525, longitude: 115.3459 },
};

// Cap on live Nominatim lookups per run. The DB cache absorbs repeat
// races, so a healthy run geocodes only genuinely new ones; the cap
// keeps a first run (or a source flood) polite to a free service.
const GEOCODE_MAX_NEW_PER_RUN = 150;
let geocodeLookupsThisRun = 0;

// Coordinates already in the DB, keyed by external_id. The old flow
// re-geocoded the entire PTO list from scratch every day because
// scraped races arrive coord-less; now the DB is the cache.
async function fetchCoordCache() {
  const { data, error } = await supabaseRequest(
    '/races?select=external_id,city,latitude,longitude&latitude=not.is.null&limit=2000'
  );
  const cache = new Map();
  if (!error && Array.isArray(data)) {
    for (const r of data) {
      if (r.external_id && r.latitude && r.longitude) cache.set(r.external_id, r);
    }
  } else if (error) {
    console.error('[Geocode] Coord cache read failed (continuing without):', error.message);
  }
  console.log(`[Geocode] DB coordinate cache: ${cache.size} races`);
  return cache;
}

async function geocodeRaces(races, coordCache = new Map()) {
  console.log(`[Geocode] Geocoding ${races.length} races...`);
  const results = [];

  for (const race of races) {
    const override = GEOCODE_OVERRIDES[race.name];
    if (override) {
      results.push({ ...race, city: override.city, latitude: override.latitude, longitude: override.longitude });
      continue;
    }

    if (race.latitude && race.longitude) {
      results.push(race);
      continue;
    }

    const cached = coordCache.get(race.external_id);
    if (cached) {
      results.push({ ...race, city: race.city || cached.city, latitude: parseFloat(cached.latitude), longitude: parseFloat(cached.longitude) });
      continue;
    }

    if (geocodeLookupsThisRun >= GEOCODE_MAX_NEW_PER_RUN) {
      results.push(race);
      continue;
    }

    const cityFromName = extractCityFromName(race.name);
    const cityFromLocation = extractCityFromLocation(race.location);
    const bestCity = cityFromName || cityFromLocation || null;

    const geocodeQuery = bestCity && race.country
      ? `${bestCity}, ${race.country}`
      : race.location;

    try {
      geocodeLookupsThisRun++;
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(geocodeQuery)}&format=json&limit=3&addressdetails=1`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'TriTeamDashboard/1.0 (team race tracker)',
          'Accept': 'application/json',
        }
      });

      if (!res.ok) { results.push(race); continue; }

      const data = await res.json();

      if (data.length > 0) {
        const ranked = data.sort((a, b) => {
          const aHasCity = !!(a.address?.city || a.address?.town || a.address?.village);
          const bHasCity = !!(b.address?.city || b.address?.town || b.address?.village);
          return (bHasCity ? 1 : 0) - (aHasCity ? 1 : 0);
        });
        const place = ranked[0];
        const addr = place.address || {};
        const placeType = place.type || '';

        const geocodedCity = addr.city || addr.town || addr.village ||
          addr.municipality || addr.city_district || null;

        // City-level results or nothing (audit F5): the old code
        // accepted region results whenever the place type was not on a
        // blocklist — 'administrative' was missing from it, which is
        // how state centroids (Florida, Western Australia) became pins.
        const invalidTypes = ['bay', 'sea', 'ocean', 'river', 'lake', 'region',
          'state', 'country', 'continent', 'county', 'district', 'administrative'];
        const isInvalidType = invalidTypes.includes(placeType);

        if (!geocodedCity || isInvalidType) {
          console.log(`[Geocode] "${race.name}" → type "${placeType}", no city-level result — skipping coords`);
          results.push({ ...race, city: bestCity ?? race.city ?? null, latitude: null, longitude: null });
        } else {
          results.push({
            ...race,
            city: geocodedCity,
            latitude: parseFloat(place.lat),
            longitude: parseFloat(place.lon),
          });
          console.log(`[Geocode] ${race.name} → ${geocodedCity} (${place.lat}, ${place.lon})`);
        }
      } else {
        console.log(`[Geocode] No result for: ${geocodeQuery} — skipping coords`);
        results.push({ ...race, city: bestCity, latitude: null, longitude: null });
      }

      // Nominatim rate limit: max 1 request/second
      await new Promise(r => setTimeout(r, 1100));

    } catch (err) {
      console.error(`[Geocode] Error for ${race.name}:`, err.message);
      results.push(race);
    }
  }

  console.log(`[Geocode] Done — ${results.filter(r => r.latitude).length}/${races.length} races geocoded (${geocodeLookupsThisRun} live lookups)`);
  return results;
}

// ---------------------------------------------------------------
// UPSERT RACES — insert new, update existing (by external_id)
// ---------------------------------------------------------------
async function upsertRaces(races) {
  if (races.length === 0) {
    console.log('[DB] No races to upsert');
    return;
  }

  const batchSize = 100;
  let totalUpserted = 0;

  for (let i = 0; i < races.length; i += batchSize) {
    const batch = races.slice(i, i + batchSize);
    const { data, error } = await supabaseRequest(
      '/races?on_conflict=external_id',
      'POST',
      batch,
      { 'Prefer': 'resolution=merge-duplicates,return=representation' }
    );

    if (error) {
      console.error(`[DB] Upsert error (batch ${Math.floor(i / batchSize) + 1}):`, error.message);
    } else {
      totalUpserted += data?.length ?? 0;
    }
  }

  console.log(`[DB] Upserted ${totalUpserted} races total`);
}

// ---------------------------------------------------------------
// NOTIFICATION — Check for races this weekend & notify WhatsApp
// Disabled until Meta Business account is approved.
// ---------------------------------------------------------------
async function checkAndNotify() {
  if (!NOTIFICATIONS_ENABLED) {
    console.log('[Notify] Notifications disabled — skipping (set NOTIFICATIONS_ENABLED = true to activate)');
    return;
  }

  console.log('[Notify] Checking for race-weekend notifications...');

  const today = new Date();
  const dayOfWeek = today.getDay();

  if (dayOfWeek !== 4 && dayOfWeek !== 5) {
    console.log('[Notify] Not a Thursday/Friday — skipping notification check');
    return;
  }

  const saturday = new Date(today);
  saturday.setDate(today.getDate() + (6 - dayOfWeek));
  const sunday = new Date(saturday);
  sunday.setDate(saturday.getDate() + 1);

  const satStr = saturday.toISOString().split('T')[0];
  const sunStr = sunday.toISOString().split('T')[0];

  const { data: races, error } = await supabaseRequest(
    `/races?select=id,name,type,race_date,location,race_entries(athlete_id,profiles(full_name,whatsapp_number))&race_date=in.(${satStr},${sunStr})`
  );

  if (error) { console.error('[Notify] DB error:', error.message); return; }
  if (!races || races.length === 0) { console.log('[Notify] No races this weekend'); return; }

  for (const race of races) {
    const entries = race.race_entries || [];
    if (entries.length === 0) continue;

    const names = entries.map(e => e.profiles?.full_name).filter(Boolean).join(', ');
    const emoji = race.type === 'IRONMAN' ? '🏊🚴🏃' : race.type === '70.3' ? '⚡' : '🏅';
    const message =
      `${emoji} *Race Weekend Alert!*\n\n` +
      `*${race.name}* (${race.type})\n` +
      `📍 ${race.location}\n` +
      `📅 ${race.race_date}\n\n` +
      `Team members racing: *${names}*\n\n` +
      `Go team! 💪`;

    await sendWhatsAppMessage(message, race.id);
  }
}

// Dormant until NOTIFICATIONS_ENABLED = true
async function sendWhatsAppMessage(message, raceId) {
  const WA_API_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`;
  const WA_TOKEN = process.env.WHATSAPP_TOKEN;
  const WA_CHANNEL_ID = process.env.WHATSAPP_CHANNEL_ID;

  try {
    const response = await fetch(WA_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: WA_CHANNEL_ID,
        type: 'text',
        text: { body: message },
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(JSON.stringify(err));
    }

    await supabaseRequest('/notification_log', 'POST', {
      race_id: raceId, channel: 'whatsapp', message, status: 'sent',
    });

    console.log('[Notify] WhatsApp message sent for race:', raceId);
  } catch (err) {
    console.error('[Notify] WhatsApp send failed:', err.message);
    await supabaseRequest('/notification_log', 'POST', {
      race_id: raceId, channel: 'whatsapp', message, status: 'failed',
    });
  }
}

// ---------------------------------------------------------------
// CLEANUP — delete race threads older than 14 days post-race
// ---------------------------------------------------------------
async function cleanupOldRaceChannels() {
  console.log('[Cleanup] Checking for expired race channels...');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffDate = cutoff.toISOString().split('T')[0];

  const { data: allRaceChannels, error: fetchError } = await supabaseRequest(
    '/channels?select=id,name,races(name,race_date)&type=eq.race&race_id=not.is.null'
  );

  if (fetchError) {
    console.error('[Cleanup] Failed to fetch race channels:', fetchError.message);
    return;
  }

  const toDelete = (allRaceChannels || []).filter(ch => {
    const raceDate = ch.races?.race_date;
    return raceDate && raceDate < cutoffDate;
  });

  if (toDelete.length === 0) {
    console.log('[Cleanup] No expired race channels found.');
    return;
  }

  console.log(`[Cleanup] Found ${toDelete.length} expired race channel(s) to delete:`);
  toDelete.forEach(ch => console.log(`  - #${ch.name} (race: ${ch.races?.race_date})`));

  const ids = toDelete.map(ch => ch.id).join(',');
  const { error: deleteError } = await supabaseRequest(
    `/channels?id=in.(${ids})`,
    'DELETE'
  );

  if (deleteError) {
    console.error('[Cleanup] Failed to delete channels:', deleteError.message);
  } else {
    console.log(`[Cleanup] Successfully deleted ${toDelete.length} expired race channel(s).`);
  }
}

// ---------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------
async function main() {
  console.log('=== TriTeam Scraper/Notifier ===', new Date().toISOString());

  try {
    // 1. Fetch from triathlon.org API (Olympic, Sprint, WTS events)
    const triEventsRaw = await fetchTriathlonEvents();

    // 2. Scrape PTO calendar for IRONMAN & 70.3 races
    const ironmanRaces = await scrapeIronmanRaces();

    // Sanity thresholds (audit F2, 2026-11-01): zero from BOTH sources
    // means the run learned nothing — fail loudly instead of letting a
    // green check hide a dead pipeline. A thin branded haul only warns:
    // the PTO source is known-degraded (audit F1) and its replacement is
    // Phase C, but the warning keeps the rot visible on every run.
    if (triEventsRaw.length === 0 && ironmanRaces.length === 0) {
      throw new Error('[Main] Both sources returned zero races — treating as a failed run');
    }
    const todayStr = new Date().toISOString().split('T')[0];
    const brandedUpcoming = [...triEventsRaw, ...ironmanRaces]
      .filter(r => (r.type === 'IRONMAN' || r.type === '70.3') && r.race_date >= todayStr).length;
    console.log(`[Main] Branded (IRONMAN/70.3) upcoming races in this fetch: ${brandedUpcoming}`);
    if (brandedUpcoming < 15) {
      console.log(`::warning::Only ${brandedUpcoming} upcoming IRONMAN/70.3 races in this fetch (a healthy calendar has 40+) — branded coverage is likely broken upstream`);
    }

    // 3. Geocode both sources against the DB coordinate cache
    // (audit F5 — API races were never geocoded at all before).
    const coordCache = await fetchCoordCache();
    const triEvents = await geocodeRaces(triEventsRaw, coordCache);
    const geocodedIronman = await geocodeRaces(ironmanRaces, coordCache);

    // 4. Merge and upsert
    const all = [...triEvents, ...geocodedIronman];
    console.log(`[Main] Total combined races: ${all.length}`);
    await upsertRaces(all);

    // Run summary — the health record F2 asked for. One block in the
    // log and, under GitHub Actions, in the step summary.
    const byType = {};
    for (const r of all) byType[r.type] = (byType[r.type] || 0) + 1;
    const summary = [
      '## Scraper run summary',
      `- triathlon_api parsed: ${triEvents.length}`,
      `- pto_scrape parsed: ${geocodedIronman.length}`,
      `- by type: ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      `- branded upcoming in fetch: ${brandedUpcoming}`,
      `- geocoded: ${all.filter(r => r.latitude).length}/${all.length} (live lookups this run: ${geocodeLookupsThisRun})`,
    ].join('\n');
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) {
      try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n'); } catch { /* log copy stands */ }
    }

    // 5. Check for weekend notifications (currently disabled — see NOTIFICATIONS_ENABLED flag)
    await checkAndNotify();

    // 6. Clean up race chat threads older than 14 days post-race
    await cleanupOldRaceChannels();

    console.log('=== Done ===');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
