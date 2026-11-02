import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  brandedExternalId, triathlonExternalId, normalizeRaceName,
  extractCityFromName, extractCityFromLocation,
  GEOCODE_CITY_ALIASES, sameCity, applyDedupeGuard,
} from './scraper-pure.js'

// Scraper pure helpers (extracted from scraper.js, 2026-11-01). These
// pin the calendar's identity rules: a silent change here forks race
// rows and splits entries, which is exactly what Phase B was built to
// prevent.

// ── Identity mapping ──
test('identity: branded seed races key as im_<slug>_<year>', () => {
  assert.equal(brandedExternalId('la-quinta', '2026-12-06'), 'im_la-quinta_2026')
  assert.equal(brandedExternalId('texas', '2027-04-24'), 'im_texas_2027')
})
test('identity: World Triathlon events key as triorg_<event id>', () => {
  assert.equal(triathlonExternalId(186432), 'triorg_186432')
  assert.equal(triathlonExternalId('186432'), 'triorg_186432')
})

// ── Name normalization ──
test('normalizeRaceName: case, punctuation and spacing collapse', () => {
  assert.equal(normalizeRaceName('IRONMAN 70.3 La Quinta!'), 'ironman 70 3 la quinta')
  assert.equal(normalizeRaceName('  Ironman   Texas  '), 'ironman texas')
  assert.equal(normalizeRaceName(null), '')
  assert.equal(normalizeRaceName(undefined), '')
})

// ── Dedupe guard ──
test('dedupe: an incoming race adopts the existing identity on name+date match', () => {
  const existing = [{ name: 'Ironman 70.3 La Quinta', race_date: '2026-12-06', external_id: 'pto_la-quinta_2026' }]
  const incoming = [{ name: 'IRONMAN 70.3 LA QUINTA', race_date: '2026-12-06', external_id: 'im_la-quinta_2026' }]
  applyDedupeGuard(incoming, existing)
  assert.equal(incoming[0].external_id, 'pto_la-quinta_2026')
})
test('dedupe: same identity is left alone', () => {
  const existing = [{ name: 'Ironman Texas', race_date: '2027-04-24', external_id: 'im_texas_2027' }]
  const incoming = [{ name: 'Ironman Texas', race_date: '2027-04-24', external_id: 'im_texas_2027' }]
  applyDedupeGuard(incoming, existing)
  assert.equal(incoming[0].external_id, 'im_texas_2027')
})
test('dedupe: a different date does not adopt (editions are distinct)', () => {
  const existing = [{ name: 'Ironman Texas', race_date: '2026-04-25', external_id: 'im_texas_2026' }]
  const incoming = [{ name: 'Ironman Texas', race_date: '2027-04-24', external_id: 'im_texas_2027' }]
  applyDedupeGuard(incoming, existing)
  assert.equal(incoming[0].external_id, 'im_texas_2027')
})
test('dedupe: within one batch, a later twin adopts the first identity', () => {
  const batch = [
    { name: 'Ironman Florida', race_date: '2026-11-07', external_id: 'im_florida_2026' },
    { name: 'IRONMAN Florida', race_date: '2026-11-07', external_id: 'triorg_999' },
  ]
  applyDedupeGuard(batch, [])
  assert.equal(batch[1].external_id, 'im_florida_2026')
})

// ── City matching ──
test('sameCity: accents and punctuation are ignored', () => {
  assert.equal(sameCity('São Paulo', 'Sao Paulo'), true)
  assert.equal(sameCity('Poreč', 'Porec'), true)
})
test('sameCity: containment counts (Galveston ~ Galveston Island)', () => {
  assert.equal(sameCity('Galveston', 'Galveston Island'), true)
  assert.equal(sameCity('Kona', 'Kailua-Kona'), true)
})
test('sameCity: different cities and empty values fail', () => {
  assert.equal(sameCity('Austin', 'Houston'), false)
  assert.equal(sameCity(null, 'Austin'), false)
  assert.equal(sameCity('Austin', ''), false)
})
test('aliases: Port Elizabeth resolves through Gqeberha, not sameCity alone', () => {
  assert.equal(sameCity('Port Elizabeth', 'Gqeberha'), false) // why the alias exists
  assert.ok((GEOCODE_CITY_ALIASES['Port Elizabeth'] || []).some(a => sameCity('Gqeberha', a)))
})

// ── City extraction ──
test('extractCityFromName: strips the IRONMAN prefix', () => {
  assert.equal(extractCityFromName('Ironman 70.3 Oceanside'), 'Oceanside')
  assert.equal(extractCityFromName('Ironman Texas'), 'Texas')
  assert.equal(extractCityFromName('Ironman 70.3 Indian Wells'), 'Indian Wells')
})
test('extractCityFromName: championships and long names yield null', () => {
  assert.equal(extractCityFromName('Ironman World Championship'), null)
  assert.equal(extractCityFromName('Ironman 70.3 World Championship'), null)
  assert.equal(extractCityFromName('Ironman 70.3 Puerto Rico Presented By Someone'), null)
})
test('extractCityFromLocation: takes the first comma segment', () => {
  assert.equal(extractCityFromLocation('Oceanside, California, USA'), 'Oceanside')
  assert.equal(extractCityFromLocation('TBD'), null)
  assert.equal(extractCityFromLocation('Singlepart'), null)
  assert.equal(extractCityFromLocation(null), null)
})
