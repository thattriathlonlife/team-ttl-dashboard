// Pure helpers for the race scraper, extracted so they can be unit
// tested without importing the scraper's main() (Zack, 2026-11-01:
// "build out the remaining tests"). scraper.js imports these; the
// behavior is byte-identical to the inline originals.

// Stable external identity per source — the upsert key. One mapping,
// tested, so a rename here can never silently fork the calendar.
export function brandedExternalId(slug, raceDate) {
  return `im_${slug}_${String(raceDate).slice(0, 4)}`;
}

export function triathlonExternalId(eventId) {
  return `triorg_${eventId}`;
}

// Name normalization for the dedupe guard: case/punctuation-insensitive
// so "IRONMAN 70.3 La Quinta!" and "Ironman 70.3 La Quinta" share a key.
export function normalizeRaceName(x) {
  return (x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function extractCityFromName(raceName) {
  const stripped = raceName
    .replace(/^ironman\s+70\.3\s+/i, '')
    .replace(/^ironman\s+/i, '')
    .trim();
  if (stripped && stripped.split(' ').length <= 3 && !/championship|world|series/i.test(stripped)) {
    return stripped;
  }
  return null;
}

export function extractCityFromLocation(location) {
  if (!location || location === 'TBD') return null;
  const parts = location.split(',').map(p => p.trim());
  if (parts.length < 2) return null;
  return parts[0] || null;
}

// Cities Nominatim knows by a different name than the race listing
// (Port Elizabeth was renamed Gqeberha in 2021; the listing still uses
// the old name). Checked alongside sameCity at acceptance time.
export const GEOCODE_CITY_ALIASES = {
  'Port Elizabeth': ['Gqeberha'],
};


// Accent/punctuation-insensitive city comparison ("Poreč" ~ "Porec",
// "São Paulo" ~ "Sao Paulo"). Containment counts as a match so
// "Galveston" ~ "Galveston Island" passes.
export function sameCity(a, b) {
  if (!a || !b) return false;
  const norm = x => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const na = norm(a), nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Cross-source dedupe guard (audit F4/F9): if a race about to be
// upserted matches an existing DB row — or an earlier race in this same
// batch — on normalized name + date under a DIFFERENT external_id,
// adopt the existing identity so the upsert updates that row instead
// of forking a twin that splits the entries.
export function applyDedupeGuard(races, existingRows) {
  const byKey = new Map();
  for (const r of existingRows || []) {
    const k = `${normalizeRaceName(r.name)}|${r.race_date}`;
    if (!byKey.has(k)) byKey.set(k, r.external_id);
  }
  let adopted = 0;
  for (const race of races) {
    const k = `${normalizeRaceName(race.name)}|${race.race_date}`;
    const hit = byKey.get(k);
    if (hit && hit !== race.external_id) {
      console.log(`[Dedupe] "${race.name}" (${race.race_date}) adopts existing identity ${hit} instead of ${race.external_id}`);
      race.external_id = hit;
      adopted++;
    } else if (!hit) {
      byKey.set(k, race.external_id);
    }
  }
  if (adopted) console.log(`[Dedupe] ${adopted} adoption(s) — no duplicate rows created`);
  return races;
}
