/**
 * Vercel Serverless Function — /api/embed-data
 *
 * Public aggregate data for the website race-map embed (/embed): the
 * races TTLers are actually entered in, with start-line counts only.
 *
 * Privacy contract: this endpoint is anonymous and public, so it must
 * never return anything about an individual athlete — no names, no
 * athlete ids, no profile fields. The response carries race fields and
 * three counts per race (total / team / community entrants), computed
 * server-side. Athlete ids are read here only to classify an entry as
 * team vs community (the same rule the app uses: a profile counts as
 * team unless team_entitled === false) and are never serialised.
 *
 * Why the service key: `race_entries` is not readable with the
 * publishable (anon) key — RLS returns zero rows silently, which would
 * produce a confidently empty map. Reads here use the service role,
 * the same credential pattern as api/strava/sync.js, and every field
 * that leaves this function is an aggregate by construction.
 *
 * GET /api/embed-data -> {
 *   generated_at, totals: { races, start_lines },
 *   races: [{ id, name, race_date, location, city, country,
 *             latitude, longitude, entries, team_entries,
 *             community_entries }]
 * }
 * Only upcoming races (race_date >= today) with at least one entry and
 * known coordinates are returned — the embed is people-first, like the
 * in-app map: no entries, no pin.
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service role — bypasses RLS
)

const PAGE = 1000

// PostgREST caps a response at 1000 rows; walk pages so a big season
// can never silently truncate the counts.
async function fetchAll(buildQuery) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const today = new Date().toISOString().split('T')[0]

    const races = await fetchAll(() => supabase
      .from('races')
      .select('id, name, race_date, location, city, country, latitude, longitude')
      .gte('race_date', today)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .order('race_date', { ascending: true }))

    if (races.length === 0) {
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600')
      return res.status(200).json({
        generated_at: new Date().toISOString(),
        totals: { races: 0, start_lines: 0 },
        races: [],
      })
    }

    const raceIds = races.map(r => r.id)
    const [entries, profiles] = await Promise.all([
      fetchAll(() => supabase
        .from('race_entries')
        .select('race_id, athlete_id')
        .in('race_id', raceIds)),
      fetchAll(() => supabase
        .from('profiles')
        .select('id, team_entitled')),
    ])

    // Same classification as the in-app map (Dashboard.jsx): a profile
    // counts as team unless team_entitled === false.
    const teamIds = new Set(
      (profiles || []).filter(p => p.team_entitled !== false).map(p => p.id)
    )

    const counts = new Map()
    for (const e of entries || []) {
      const c = counts.get(e.race_id) || { total: 0, team: 0 }
      c.total += 1
      if (teamIds.has(e.athlete_id)) c.team += 1
      counts.set(e.race_id, c)
    }

    const out = []
    let startLines = 0
    for (const r of races) {
      const c = counts.get(r.id)
      if (!c || c.total < 1) continue  // people-first: no entries, no pin
      startLines += c.total
      out.push({
        id: r.id,
        name: r.name,
        race_date: r.race_date,
        location: r.location,
        city: r.city,
        country: r.country,
        latitude: r.latitude,
        longitude: r.longitude,
        entries: c.total,
        team_entries: c.team,
        community_entries: c.total - c.team,
      })
    }

    // Public aggregate data — cache at the edge like the content feeds.
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600')
    return res.status(200).json({
      generated_at: new Date().toISOString(),
      totals: { races: out.length, start_lines: startLines },
      races: out,
    })
  } catch (err) {
    // Loud failure, never a silently empty map.
    console.error('embed-data failed:', err)
    return res.status(502).json({ error: 'Embed data unavailable', detail: String(err?.message || err).slice(0, 200) })
  }
}
