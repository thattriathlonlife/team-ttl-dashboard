import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankRaces, densityByRegion, parseImportCsv, matchImport } from '../src/lib/ops.js'

const RACES = [
  { id: 'r-tx', name: 'Ironman Texas', race_date: '2027-04-24', state: 'Texas', country: 'USA' },
  { id: 'r-oc', name: 'Ironman 70.3 Oceanside', race_date: '2027-04-03', state: 'California', country: 'USA' },
  { id: 'r-old', name: 'Ironman Past', race_date: '2026-01-10', state: 'Texas', country: 'USA' },
  { id: 'r-none', name: 'Ironman Nobody', race_date: '2027-06-01', state: 'Ohio', country: 'USA' },
]
const ENTRIES = [
  { race_id: 'r-tx', athlete_id: 'a1', created_at: '2026-11-01T00:00:00Z' },
  { race_id: 'r-tx', athlete_id: 'a2', created_at: '2026-11-02T00:00:00Z' },
  { race_id: 'r-tx', athlete_id: 'a3', created_at: '2026-11-03T00:00:00Z' },
  { race_id: 'r-oc', athlete_id: 'a1', created_at: '2026-11-04T00:00:00Z' },
  { race_id: 'r-old', athlete_id: 'a1', created_at: '2026-01-01T00:00:00Z' },
]
const TODAY = '2026-11-13'

test('rankRaces: upcoming only, count desc, zero-count races excluded', () => {
  const ranked = rankRaces(RACES, ENTRIES, TODAY)
  assert.deepEqual(ranked.map(x => x.race.id), ['r-tx', 'r-oc'])
  assert.equal(ranked[0].count, 3)
})

test('densityByRegion: entries grouped by state, past races excluded', () => {
  const d = densityByRegion(RACES, ENTRIES, TODAY)
  assert.deepEqual(d, [{ region: 'Texas', count: 3 }, { region: 'California', count: 1 }])
})

test('parseImportCsv: header row + quoted comma in a name', () => {
  const { rows, errors } = parseImportCsv('email,race,date\n"a@x.com","Ironman Texas, The Woodlands",2027-04-24\n')
  assert.equal(errors.length, 0)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].race, 'Ironman Texas, The Woodlands')
})

test('parseImportCsv: no header falls back to athlete, race, date order', () => {
  const { rows } = parseImportCsv('Zack Godwin,Ironman Texas,2027-04-24')
  assert.deepEqual(rows, [{ athlete: 'Zack Godwin', race: 'Ironman Texas', date: '2027-04-24' }])
})

const PROFILES = [
  { id: 'a1', full_name: 'Zack Godwin', email: 'zack@x.com' },
  { id: 'a2', full_name: 'Eric Lagerstrom', email: 'eric@x.com' },
]

test('matchImport: ready, duplicate, and not-found statuses', () => {
  const matched = matchImport([
    { athlete: 'eric@x.com', race: 'Ironman 70.3 Oceanside', date: '2027-04-03' },
    { athlete: 'Zack Godwin', race: 'Ironman Texas', date: '' },
    { athlete: 'Ghost Person', race: 'Ironman Texas', date: '' },
    { athlete: 'Eric Lagerstrom', race: 'Ironman Atlantis', date: '' },
  ], PROFILES, RACES, ENTRIES)
  assert.equal(matched[0].status, 'ready')
  assert.equal(matched[0].raceId, 'r-oc')
  assert.equal(matched[1].status, 'duplicate') // a1 already entered for r-tx
  assert.equal(matched[2].status, 'athlete_not_found')
  assert.equal(matched[3].status, 'race_not_found')
})

test('matchImport: same-name races are disambiguated by date', () => {
  const two = [
    { id: 'r-a', name: 'Ironman 70.3 Somewhere', race_date: '2027-05-01' },
    { id: 'r-b', name: 'Ironman 70.3 Somewhere', race_date: '2027-09-01' },
  ]
  const noDate = matchImport([{ athlete: 'Eric Lagerstrom', race: 'Ironman 70.3 Somewhere', date: '' }], PROFILES, two, [])
  assert.equal(noDate[0].status, 'ambiguous_race')
  const withDate = matchImport([{ athlete: 'Eric Lagerstrom', race: 'Ironman 70.3 Somewhere', date: '2027-09-01' }], PROFILES, two, [])
  assert.equal(withDate[0].status, 'ready')
  assert.equal(withDate[0].raceId, 'r-b')
})
