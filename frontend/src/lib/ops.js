// Team Ops — pure logic for the staff surface (run 70).
// Ranking, regional density, and the merge on-ramp's CSV matching.
// Kept dependency-free so test/ops.test.mjs can exercise it directly.

export function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function racePlace(race) {
  return race.location || [race.city, race.state, race.country].filter(Boolean).join(', ')
}

// Upcoming races ranked by team headcount (count desc, then date, then name).
export function rankRaces(races, entries, todayISO) {
  const byRace = new Map()
  for (const e of entries) {
    const arr = byRace.get(e.race_id) ?? []
    arr.push(e.athlete_id)
    byRace.set(e.race_id, arr)
  }
  return races
    .filter(r => r.race_date >= todayISO)
    .map(race => ({ race, count: (byRace.get(race.id) ?? []).length, athleteIds: byRace.get(race.id) ?? [] }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count || a.race.race_date.localeCompare(b.race.race_date) || a.race.name.localeCompare(b.race.name))
}

// Team entries per region (state, else country) across upcoming races.
export function densityByRegion(races, entries, todayISO) {
  const raceById = new Map(races.map(r => [r.id, r]))
  const counts = new Map()
  for (const e of entries) {
    const race = raceById.get(e.race_id)
    if (!race || race.race_date < todayISO) continue
    const region = race.state || race.country || 'Unknown'
    counts.set(region, (counts.get(region) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region))
}

export function recentSignups(entries, limit = 10) {
  return [...entries]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit)
}

// Minimal CSV: handles quoted cells and commas inside quotes.
export function parseCsv(text) {
  const rows = []
  let row = [], cell = '', inQuotes = false
  const src = String(text ?? '').replace(/\r\n/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else cell += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  row.push(cell)
  rows.push(row)
  return rows.filter(r => r.some(c => String(c).trim() !== ''))
}

const ATHLETE_HEADERS = ['email', 'athlete_email', 'athlete', 'name', 'full_name', 'member']
const RACE_HEADERS = ['race', 'race_name', 'event']
const DATE_HEADERS = ['date', 'race_date', 'when']

// Import rows: { athlete, race, date } — header row optional; without one,
// columns are read as athlete, race, date.
export function parseImportCsv(text) {
  const table = parseCsv(text)
  if (table.length === 0) return { rows: [], errors: ['Nothing to import — the pasted text is empty.'] }
  const head = table[0].map(c => normName(c).replace(/\s+/g, '_'))
  const hasHeader = head.some(h => ATHLETE_HEADERS.includes(h) || RACE_HEADERS.includes(h))
  let ai = 0, ri = 1, di = 2
  if (hasHeader) {
    ai = head.findIndex(h => ATHLETE_HEADERS.includes(h))
    ri = head.findIndex(h => RACE_HEADERS.includes(h))
    di = head.findIndex(h => DATE_HEADERS.includes(h))
    if (ai < 0 || ri < 0) return { rows: [], errors: ['Could not find the athlete and race columns in the header row.'] }
  }
  const body = hasHeader ? table.slice(1) : table
  const rows = []
  const errors = []
  body.forEach((cells, i) => {
    const athlete = String(cells[ai] ?? '').trim()
    const race = String(cells[ri] ?? '').trim()
    const date = di >= 0 ? String(cells[di] ?? '').trim() : ''
    if (!athlete && !race) return
    if (!athlete || !race) { errors.push(`Line ${i + (hasHeader ? 2 : 1)}: needs both an athlete and a race.`); return }
    rows.push({ athlete, race, date })
  })
  return { rows, errors }
}

function toISODate(s) {
  if (!s) return ''
  const t = String(s).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

// Resolve parsed rows against live profiles / races / entries.
// Statuses: ready | duplicate | athlete_not_found | race_not_found |
//           ambiguous_athlete | ambiguous_race
export function matchImport(rows, profiles, races, entries) {
  const existing = new Set(entries.map(e => `${e.race_id}:${e.athlete_id}`))
  const byEmail = new Map()
  const byName = new Map()
  for (const p of profiles) {
    if (p.email) byEmail.set(String(p.email).toLowerCase(), p)
    const k = normName(p.full_name)
    if (k) byName.set(k, [...(byName.get(k) ?? []), p])
  }
  const raceByName = new Map()
  for (const r of races) {
    const k = normName(r.name)
    raceByName.set(k, [...(raceByName.get(k) ?? []), r])
  }
  return rows.map(row => {
    const out = { ...row, athleteId: null, raceId: null, status: '', detail: '' }
    // Athlete
    let athlete = null
    if (row.athlete.includes('@')) {
      athlete = byEmail.get(row.athlete.toLowerCase()) ?? null
      if (!athlete) { out.status = 'athlete_not_found'; out.detail = `No member with email ${row.athlete}`; return out }
    } else {
      const hits = byName.get(normName(row.athlete)) ?? []
      if (hits.length === 0) { out.status = 'athlete_not_found'; out.detail = `No member named "${row.athlete}"`; return out }
      if (hits.length > 1) { out.status = 'ambiguous_athlete'; out.detail = `${hits.length} members named "${row.athlete}"`; return out }
      athlete = hits[0]
    }
    out.athleteId = athlete.id
    // Race
    let hits = raceByName.get(normName(row.race)) ?? []
    const iso = toISODate(row.date)
    if (iso && hits.length > 1) hits = hits.filter(r => r.race_date === iso)
    if (hits.length === 0) { out.status = 'race_not_found'; out.detail = `No race matching "${row.race}"${iso ? ` on ${iso}` : ''}`; return out }
    if (hits.length > 1) { out.status = 'ambiguous_race'; out.detail = `${hits.length} races named "${row.race}" — add a date`; return out }
    out.raceId = hits[0].id
    if (existing.has(`${out.raceId}:${out.athleteId}`)) {
      out.status = 'duplicate'
      out.detail = 'Already on the start list'
      return out
    }
    out.status = 'ready'
    out.detail = `${athlete.full_name} → ${hits[0].name}`
    return out
  })
}
