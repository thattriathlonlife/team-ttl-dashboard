/**
 * TriTeam Race Scraper + WhatsApp Notifier
 * Node.js service — runs on a cron schedule (daily scrape, daily notification check)
 *
 * Install: npm install
 * Run:     node scraper.js
 * Cron:    0 6 * * * node /path/to/scraper.js   (runs at 6am daily)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

// --- Config ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ---------------------------------------------------------------
// FEATURE FLAG — set to true once Meta Business account is ready
// ---------------------------------------------------------------
const NOTIFICATIONS_ENABLED = false;

// Meta WhatsApp Cloud API config (unused until NOTIFICATIONS_ENABLED = true)
// const WA_API_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`;
// const WA_TOKEN = process.env.WHATSAPP_TOKEN;
// const WA_CHANNEL_ID = process.env.WHATSAPP_CHANNEL_ID;

// ---------------------------------------------------------------
// SCRAPER — Fetches races from Ironman.com
// ---------------------------------------------------------------
async function scrapeIronmanRaces() {
  console.log('[Scraper] Fetching IRONMAN races...');

  // IRONMAN provides a public JSON feed for their race calendar
  const response = await fetch(
    'https://www.ironman.com/api/races?year=2025&pageSize=200',
    { headers: { 'User-Agent': 'TriTeam Dashboard Scraper/1.0' } }
  );

  if (!response.ok) {
    console.error('[Scraper] Failed to fetch IRONMAN API:', response.status);
    return [];
  }

  const data = await response.json();
  const races = [];

  for (const item of data.races || []) {
    const type = item.eventType?.includes('70.3') ? '70.3' : 'IRONMAN';
    races.push({
      name: item.name,
      type,
      race_date: item.date?.split('T')[0],
      location: `${item.city}, ${item.country}`,
      city: item.city,
      country: item.country,
      latitude: item.lat ? parseFloat(item.lat) : null,
      longitude: item.lng ? parseFloat(item.lng) : null,
      external_id: `ironman_${item.id}`,
      source: 'scraped',
      registration_url: item.registrationUrl || null,
    });
  }

  console.log(`[Scraper] Found ${races.length} races`);
  return races;
}

// Fallback: scrape triathlon.org if IRONMAN API is unavailable
async function scrapeTriathlonOrg() {
  console.log('[Scraper] Falling back to triathlon.org...');
  const response = await fetch('https://www.triathlon.org/events', {
    headers: { 'User-Agent': 'TriTeam Dashboard Scraper/1.0' }
  });
  const html = await response.text();
  const $ = cheerio.load(html);
  const races = [];

  $('.event-item').each((i, el) => {
    const name = $(el).find('.event-name').text().trim();
    const dateStr = $(el).find('.event-date').text().trim();
    const location = $(el).find('.event-location').text().trim();
    if (name && dateStr) {
      const isFullIronman = name.toUpperCase().includes('IRONMAN') && !name.includes('70.3');
      races.push({
        name,
        type: name.includes('70.3') ? '70.3' : isFullIronman ? 'IRONMAN' : 'Other',
        race_date: parseDateStr(dateStr),
        location,
        source: 'scraped',
        external_id: `triorg_${i}_${name.replace(/\s+/g, '_').toLowerCase()}`,
      });
    }
  });

  return races.filter(r => r.type !== 'Other');
}

function parseDateStr(str) {
  const d = new Date(str);
  return isNaN(d) ? null : d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------
// UPSERT RACES — insert new, skip existing (by external_id)
// ---------------------------------------------------------------
async function upsertRaces(races) {
  const valid = races.filter(r => r.race_date && r.name);
  const { data, error } = await supabase
    .from('races')
    .upsert(valid, { onConflict: 'external_id', ignoreDuplicates: true })
    .select();

  if (error) console.error('[DB] Upsert error:', error.message);
  else console.log(`[DB] Upserted ${data?.length ?? 0} races`);
}

// ---------------------------------------------------------------
// NOTIFICATION — Check for races this weekend & notify WhatsApp
// Disabled until Meta Business account is approved.
// To re-enable: set NOTIFICATIONS_ENABLED = true at the top of this file,
// then uncomment the WA_API_URL / WA_TOKEN / WA_CHANNEL_ID lines above.
// ---------------------------------------------------------------
async function checkAndNotify() {
  if (!NOTIFICATIONS_ENABLED) {
    console.log('[Notify] Notifications disabled — skipping (set NOTIFICATIONS_ENABLED = true to activate)');
    return;
  }
  console.log('[Notify] Checking for race-weekend notifications...');

  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat

  // Only send on Thursday or Friday before the weekend
  if (dayOfWeek !== 4 && dayOfWeek !== 5) {
    console.log('[Notify] Not a Thursday/Friday — skipping notification check');
    return;
  }

  // Find races happening this Saturday or Sunday
  const saturday = new Date(today);
  saturday.setDate(today.getDate() + (6 - dayOfWeek));
  const sunday = new Date(saturday);
  sunday.setDate(saturday.getDate() + 1);

  const satStr = saturday.toISOString().split('T')[0];
  const sunStr = sunday.toISOString().split('T')[0];

  const { data: races, error } = await supabase
    .from('races')
    .select(`
      id, name, type, race_date, location,
      race_entries(
        athlete_id,
        profiles(full_name, whatsapp_number)
      )
    `)
    .in('race_date', [satStr, sunStr]);

  if (error) { console.error('[Notify] DB error:', error.message); return; }
  if (!races || races.length === 0) { console.log('[Notify] No races this weekend'); return; }

  for (const race of races) {
    const entries = race.race_entries || [];
    if (entries.length === 0) continue;

    const names = entries.map(e => e.profiles?.full_name).filter(Boolean).join(', ');
    const emoji = race.type === 'IRONMAN' ? '🏊🚴🏃' : '⚡';
    const message = `${emoji} *Race Weekend Alert!*\n\n` +
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
  // Uncomment the WA_* config lines at the top of this file before using this.
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

    await supabase.from('notification_log').insert({
      race_id: raceId,
      channel: 'whatsapp',
      message,
      status: 'sent',
    });

    console.log('[Notify] WhatsApp message sent for race:', raceId);
  } catch (err) {
    console.error('[Notify] WhatsApp send failed:', err.message);
    await supabase.from('notification_log').insert({
      race_id: raceId,
      channel: 'whatsapp',
      message,
      status: 'failed',
    });
  }
}

// ---------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------
async function main() {
  console.log('=== TriTeam Scraper/Notifier ===', new Date().toISOString());

  try {
    // 1. Scrape races
    let races = await scrapeIronmanRaces();
    if (races.length === 0) races = await scrapeTriathlonOrg();
    await upsertRaces(races);

    // 2. Check for weekend notifications (currently disabled — see NOTIFICATIONS_ENABLED flag)
    await checkAndNotify();

    console.log('=== Done ===');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
