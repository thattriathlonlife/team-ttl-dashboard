import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import RaceList from '../components/RaceList'
import CalendarView from '../components/CalendarView'
import AddRaceModal from '../components/AddRaceModal'
import RaceMap from '../components/RaceMap'
import { pageCacheGet, pageCacheSet } from '../lib/pageCache'

const S = {
  page: { maxWidth: '1100px', margin: '0 auto', padding: '1.5rem' },
  tabBar: { display: 'flex', gap: '0', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  tab: { padding: '12px 20px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '14px', letterSpacing: '2px', textTransform: 'uppercase', color: '#888', background: 'none', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', transition: 'all 0.15s', marginBottom: '-1px' },
  tabActive: { color: 'var(--brand)', borderBottomColor: 'var(--brand)' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '1.5rem' },
  statCard: { background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '1rem 1.25rem' },
  statLabel: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#999', marginBottom: '6px' },
  statValue: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '32px', fontWeight: 700, lineHeight: 1 },
  statSub: { fontSize: '12px', color: '#999', marginTop: '4px' },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' },
  sectionTitle: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', letterSpacing: '2px', textTransform: 'uppercase', color: '#555' },
  sectionTitleSpan: { color: '#fff' },
  btnGhost: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '1.5px', textTransform: 'uppercase', padding: '8px 16px', background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#ccc', cursor: 'pointer', transition: 'all 0.15s' },
  filters: { display: 'flex', gap: '6px', flexWrap: 'nowrap', overflowX: 'auto', marginBottom: '1rem', alignItems: 'center', scrollbarWidth: 'none', paddingBottom: '2px' },
  filterBtn: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12.5px', fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase', padding: '7px 15px', background: '#161616', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '999px', color: '#8f8f8f', cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0 },
  filterBtnActive: { border: '1px solid rgba(var(--brand-rgb),0.5)', color: 'var(--brand)', background: 'rgba(var(--brand-rgb),0.08)' },
  filterDivider: { width: '1px', background: 'rgba(255,255,255,0.08)', height: '20px', margin: '0 4px' },
  filterLabel: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#333', marginRight: '2px' },
  searchWrap: { position: 'relative', marginBottom: '10px' },
  searchIcon: { position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#555', fontSize: '15px', pointerEvents: 'none' },
  searchInput: { width: '100%', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', padding: '10px 36px', fontSize: '14px', fontFamily: 'Barlow, sans-serif', outline: 'none', transition: 'border-color 0.15s' },
  searchClear: { position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#555', fontSize: '16px', cursor: 'pointer', padding: '2px 4px', lineHeight: 1 },
  searchResults: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '1px', color: '#555', marginBottom: '8px' },
  // My Races toggle
  viewToggle: { display: 'flex', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '2px', marginBottom: '1rem', width: 'fit-content' },
  viewBtn: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', padding: '6px 16px', background: 'none', border: 'none', borderRadius: '4px', cursor: 'pointer', transition: 'all 0.15s', color: '#555' },
  viewBtnActive: { background: 'var(--brand)', color: '#000', fontWeight: 600 },
}

const FILTER_CHIPS = [{ value: 'all', label: 'All' }, { value: 'ironman', label: 'IRONMAN' }, { value: '703', label: '70.3' }, { value: 'full', label: 'Full' }, { value: 'worldtri', label: 'World Tri' }, { value: 'mine', label: "I'm racing" }]
// The IRONMAN org group spans both branded sources: the curated seed
// (ironman_calendar, Phase C) and the retired PTO scrape's rows, which
// still carry history. Matching the chip to 'pto_scrape' alone hid all
// 159 seed races — the map read 'no location data' on the default view.
const ORG_SOURCES = { ironman: ['ironman_calendar', 'pto_scrape'] }

export default function Dashboard({ session }) {
  // Stale-while-revalidate (see lib/pageCache): instant render from the
  // last visit's data while loadAll refreshes in the background.
  const cachedDash = pageCacheGet('dash')
  const [view, setView] = useState('list') // 'list' | 'calendar'
  const [races, setRaces] = useState(() => cachedDash?.races || [])
  const [myEntries, setMyEntries] = useState(() => cachedDash?.myEntries || [])
  const [allEntries, setAllEntries] = useState(() => cachedDash?.allEntries || [])
  const [profiles, setProfiles] = useState(() => cachedDash?.profiles || [])
  const [profile, setProfile] = useState(() => cachedDash?.profile || null)
  const [loading, setLoading] = useState(() => !cachedDash)
  const [showAddRace, setShowAddRace] = useState(false)
  // One filter lens for the whole page (Zack, 2026-11-01: the org row,
  // type row, All/Mine toggle and map-mode toggle were four control rows
  // of chrome). Values: all | ironman | 703 | full | worldtri | mine.
  const [filter, setFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const userId = session.user.id

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    if (!loading) pageCacheSet('dash', { races, myEntries, allEntries, profiles, profile })
  }, [loading, races, myEntries, allEntries, profiles, profile])

  async function ensureProfile() {
    const { data: existing } = await supabase.from('profiles').select('id').eq('id', userId).single()
    if (!existing) {
      const email = session.user.email
      const fullName = session.user.user_metadata?.full_name || email.split('@')[0]
      await supabase.from('profiles').insert({ id: userId, full_name: fullName, email, role: 'athlete' })
    }
  }

  async function loadAll() {
    await ensureProfile()
    const [racesRes, entriesRes, profilesRes, myProfileRes] = await Promise.all([
      supabase.from('races').select('*').gte('race_date', new Date().toISOString().split('T')[0]).order('race_date'),
      supabase.from('race_entries').select('*, profiles(full_name, id)'),
      supabase.from('profiles').select('*'),
      supabase.from('profiles').select('*').eq('id', userId).single(),
    ])
    if (racesRes.data) setRaces(racesRes.data)
    if (entriesRes.data) {
      setAllEntries(entriesRes.data)
      setMyEntries(entriesRes.data.filter(e => e.athlete_id === userId).map(e => e.race_id))
    }
    if (profilesRes.data) setProfiles(profilesRes.data)
    if (myProfileRes.data) setProfile(myProfileRes.data)
    setLoading(false)
  }

  async function toggleEntry(raceId) {
    if (myEntries.includes(raceId)) {
      await supabase.from('race_entries').delete().eq('race_id', raceId).eq('athlete_id', userId)
      setMyEntries(prev => prev.filter(id => id !== raceId))
      setAllEntries(prev => prev.filter(e => !(e.race_id === raceId && e.athlete_id === userId)))
    } else {
      const { data } = await supabase.from('race_entries').insert({ race_id: raceId, athlete_id: userId }).select('*, profiles(full_name, id)').single()
      setMyEntries(prev => [...prev, raceId])
      if (data) setAllEntries(prev => [...prev, data])
    }
  }

  async function addRace(race) {
    const { data, error } = await supabase.from('races').insert(race).select().single()
    if (!error && data) setRaces(prev => [...prev, data].sort((a, b) => new Date(a.race_date) - new Date(b.race_date)))
    setShowAddRace(false)
  }

  const filteredRaces = races.filter(r => {
    let lens = true
    if (filter === 'ironman') lens = ORG_SOURCES.ironman.includes(r.source)
    else if (filter === 'worldtri') lens = r.source === 'triathlon_api'
    else if (filter === '703') lens = r.type === '70.3'
    else if (filter === 'full') lens = r.type === 'IRONMAN'
    else if (filter === 'mine') lens = myEntries.includes(r.id)
    const q = searchQuery.toLowerCase().trim()
    const searchMatch = !q || r.name?.toLowerCase().includes(q) || r.location?.toLowerCase().includes(q) || r.city?.toLowerCase().includes(q) || r.country?.toLowerCase().includes(q) || r.type?.toLowerCase().includes(q)
    return lens && searchMatch
  })

  // The map is the team's footprint, not the calendar (Zack, 2026-11-01):
  // only races with at least one person entered earn a pin, and pins are
  // classified team vs community by who's entered. The list below keeps
  // the full calendar; the map never follows the list's filter.
  const enteredRaceIds = new Set(allEntries.map(e => e.race_id))
  const mapRaces = races.filter(r => enteredRaceIds.has(r.id) && r.latitude && r.longitude)
  const teamIds = profiles.filter(p => p.team_entitled !== false).map(p => p.id)

  const myRaceCount = myEntries.length
  const nextRace = races.find(r => myEntries.includes(r.id))
  const daysToNext = nextRace ? Math.ceil((new Date(nextRace.race_date) - new Date()) / 86400000) : null

  // Concept A metrics (approved 2026-10-31): the strip answers horizon,
  // exposure, participation — computed over ALL upcoming races, never the
  // filtered subset (a KPI that moves when you type is a result count).
  const upcomingIds = new Set(races.map(r => r.id))
  const scopedEntries = allEntries.filter(e => upcomingIds.has(e.race_id))
  const startLines = scopedEntries.length
  const ttlersRacing = new Set(scopedEntries.map(e => e.athlete_id)).size
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0]
  const next90Count = races.filter(r => r.race_date <= in90).length
  const weekAgo = Date.now() - 7 * 86400000
  const entriesThisWeek = scopedEntries.filter(e => e.created_at && new Date(e.created_at).getTime() >= weekAgo).length
  const hasEntryTimestamps = scopedEntries.some(e => e.created_at)
  const nextRaceCrew = nextRace ? allEntries.filter(e => e.race_id === nextRace.id).length : 0

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'Barlow Condensed', letterSpacing: 2, color: '#555', textTransform: 'uppercase' }}>Loading...</div>

  return (
    <div style={S.page}>
      {/* Map — the team's footprint, not the calendar (Zack, 2026-11-01):
          only races with people entered earn pins; the full calendar
          lives in the list below. One map for everyone — names in the
          tapped card are shaped by membership, not a mode toggle. */}
      <div style={{ marginBottom: '1.1rem' }}>
        <div style={{ position: 'relative' }}>
          <RaceMap races={mapRaces} allEntries={allEntries} myEntries={myEntries} profile={profile} session={session} onToggle={toggleEntry} teamIds={teamIds} />
          {mapRaces.length > 0 && (
            <div style={{ position: 'absolute', left: '10px', bottom: '10px', background: 'rgba(5,12,18,0.82)', border: '1px solid rgba(255,255,255,0.12)', color: '#dfe', fontSize: '11px', padding: '5px 9px', borderRadius: '999px', pointerEvents: 'none', zIndex: 5 }}>
              {mapRaces.length} race{mapRaces.length !== 1 ? 's' : ''} with TTLers in them
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '11.5px', color: '#9aa', margin: '8px 2px 0' }}>
          <span><span style={{ color: 'var(--brand)' }}>●</span> Team racing</span>
          <span><span style={{ color: '#b9cdd6' }}>○</span> Community racing</span>
          <span><span style={{ color: 'var(--highlight)' }}>⚑</span> TTL activation</span>
          <span><span style={{ color: 'var(--highlight)' }}>★</span> You're in</span>
        </div>
      </div>

      {/* Hero: your next race countdown (Concept A) */}
      {nextRace && (
        <button
          onClick={() => { setView('list'); setFilter('mine') }}
          style={{
            display: 'flex', gap: '14px', alignItems: 'center', width: '100%', textAlign: 'left',
            borderRadius: '16px', padding: '14px 16px', marginBottom: '10px', cursor: 'pointer',
            background: 'linear-gradient(120deg, rgba(var(--brand-rgb),0.13), rgba(var(--accent-rgb),0.07))',
            border: '1px solid rgba(var(--brand-rgb),0.4)',
          }}
        >
          <div style={{ textAlign: 'center', minWidth: '64px' }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '40px', fontWeight: 800, color: '#fff', lineHeight: 0.95 }}>
              {daysToNext === 0 ? 'GO' : daysToNext}
            </div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10.5px', letterSpacing: '2px', color: 'var(--brand)', fontWeight: 700, marginTop: '3px' }}>
              {daysToNext === 0 ? "IT'S RACE DAY" : daysToNext === 1 ? 'DAY TO GO' : 'DAYS TO GO'}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--brand)', fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700 }}>Your next race</div>
            <div style={{ fontWeight: 700, fontSize: '16.5px', color: '#fff', marginTop: '2px' }}>{nextRace.name}</div>
            <div style={{ fontSize: '12.5px', color: '#aaa', marginTop: '1px' }}>
              {nextRace.location}{nextRaceCrew > 0 ? ` · ${nextRaceCrew} teammate${nextRaceCrew !== 1 ? 's' : ''} racing` : ''}
            </div>
          </div>
          <span style={{ color: 'var(--brand)', fontSize: '20px' }}>›</span>
        </button>
      )}

      {/* The Concept A metric strip, folded into one line (Zack,
          2026-11-01: three boxes was more chrome than information). */}
      <div style={{ fontSize: '12px', color: '#999', marginBottom: '1.25rem' }}>
        <b style={{ color: '#ddd' }}>{races.length}</b> upcoming races · <b style={{ color: '#ddd' }}>{startLines}</b> start lines · <b style={{ color: '#ddd' }}>{ttlersRacing}</b> TTLers racing
        {hasEntryTimestamps && entriesThisWeek > 0 && <span style={{ color: '#3ecf8e' }}> · ▲ {entriesThisWeek} this week</span>}
        <span> · {next90Count} in the next 90 days</span>
      </div>

      <div style={S.sectionHead}>
        <div style={S.sectionTitle}>Upcoming <span style={S.sectionTitleSpan}>Races</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '12.5px', color: '#777' }}>
            <button onClick={() => setView('list')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12.5px', padding: 0, color: view === 'list' ? 'var(--brand)' : '#777', fontWeight: view === 'list' ? 700 : 400 }}>List</button>
            {' · '}
            <button onClick={() => setView('calendar')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12.5px', padding: 0, color: view === 'calendar' ? 'var(--brand)' : '#777', fontWeight: view === 'calendar' ? 700 : 400 }}>Calendar</button>
          </span>
          <button style={S.btnGhost} onClick={() => setShowAddRace(true)}>+ Add Race</button>
        </div>
      </div>

      {/* One filter row: org, type and the I'm-racing lens in a single
          chip set (Zack, 2026-11-01). */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', scrollbarWidth: 'none', marginBottom: '1rem', paddingBottom: '2px' }}>
        {FILTER_CHIPS.map(c => (
          <button key={c.value} style={{ ...S.filterBtn, ...(filter === c.value ? S.filterBtnActive : {}) }} onClick={() => setFilter(c.value)}>
            {c.value === 'mine' && myRaceCount > 0 ? `I'm racing (${myRaceCount})` : c.label}
          </button>
        ))}
      </div>

      {view === 'list' && (
        <>
          {/* Search */}
          <div style={S.searchWrap}>
            <span style={S.searchIcon}>🔍</span>
            <input style={S.searchInput} type="text" placeholder="Search by name, location or type..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            {searchQuery && <button style={S.searchClear} onClick={() => setSearchQuery('')}>×</button>}
          </div>
          {searchQuery && <div style={S.searchResults}>{filteredRaces.length} result{filteredRaces.length !== 1 ? 's' : ''} for "{searchQuery}"</div>}

          {filter === 'mine' && myRaceCount === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', background: '#161616', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>🏊</div>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '16px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff', marginBottom: '8px' }}>No races entered yet</div>
              <div style={{ fontSize: '13px', color: '#999' }}>Tap All above, then hit Enter on any race to add it here.</div>
            </div>
          ) : (
            <RaceList races={filteredRaces} myEntries={myEntries} allEntries={allEntries} profiles={profiles} profile={profile} onToggle={toggleEntry} session={session} />
          )}
        </>
      )}

      {view === 'calendar' && <CalendarView races={filteredRaces} myEntries={myEntries} />}

      {showAddRace && <AddRaceModal onAdd={addRace} onClose={() => setShowAddRace(false)} />}
    </div>
  )
}
