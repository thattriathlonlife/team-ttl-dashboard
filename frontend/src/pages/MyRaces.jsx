import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const FULL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const S = {
  page: { maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' },
  heading: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '36px', fontWeight: 800,
    letterSpacing: '2px', textTransform: 'uppercase',
    color: '#fff', marginBottom: '4px',
  },
  sub: { fontSize: '14px', color: '#999', marginBottom: '2rem' },
  empty: {
    textAlign: 'center', padding: '4rem 2rem',
    background: '#161616', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
  },
  emptyIcon: { fontSize: '48px', marginBottom: '16px' },
  emptyTitle: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '20px', fontWeight: 700,
    letterSpacing: '2px', textTransform: 'uppercase',
    color: '#fff', marginBottom: '8px',
  },
  emptySub: { fontSize: '14px', color: '#999' },
  statsRow: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px', marginBottom: '2rem',
  },
  statCard: {
    background: '#161616', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px', padding: '1rem 1.25rem',
  },
  statLabel: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '11px', letterSpacing: '1.5px', textTransform: 'uppercase',
    color: '#999', marginBottom: '6px',
  },
  statValue: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '32px', fontWeight: 700, lineHeight: 1,
  },
  statSub: { fontSize: '12px', color: '#999', marginTop: '4px' },
  monthGroup: { marginBottom: '2rem' },
  monthLabel: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '13px', letterSpacing: '2px', textTransform: 'uppercase',
    color: '#999', marginBottom: '10px',
    paddingBottom: '8px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  raceCard: {
    background: '#161616',
    border: '1px solid rgba(255,255,255,0.08)',
    borderLeft: '3px solid #00C4B4',
    borderRadius: '8px',
    padding: '1rem 1.25rem',
    display: 'grid',
    gridTemplateColumns: '64px 1fr auto',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '8px',
    transition: 'border-color 0.15s',
  },
  dateBlock: { textAlign: 'center' },
  dateDay: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '28px', fontWeight: 700, lineHeight: 1, color: '#fff',
  },
  dateMonth: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '11px', letterSpacing: '1px',
    textTransform: 'uppercase', color: '#999',
  },
  raceName: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '17px', fontWeight: 600, color: '#fff', marginBottom: '2px',
  },
  raceLoc: { fontSize: '12px', color: '#999' },
  daysAway: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '13px', fontWeight: 600,
    textAlign: 'right',
  },
  badge: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
    padding: '2px 8px', borderRadius: '3px',
    textTransform: 'uppercase', display: 'inline-block',
    marginTop: '4px',
  },
  exportBtn: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '12px', letterSpacing: '1.5px', textTransform: 'uppercase',
    padding: '8px 16px', background: 'none',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '4px', color: '#ccc',
    cursor: 'pointer', transition: 'all 0.15s',
    marginBottom: '1.5rem',
  },
}

function getBadgeStyle(type) {
  if (type === 'IRONMAN') return { background: 'rgba(0,196,180,0.12)', color: '#00C4B4', border: '1px solid rgba(0,196,180,0.25)' }
  if (type === '70.3') return { background: 'rgba(255,61,139,0.12)', color: '#FF3D8B', border: '1px solid rgba(255,61,139,0.25)' }
  return { background: 'rgba(232,184,75,0.1)', color: '#E8B84B', border: '1px solid rgba(232,184,75,0.2)' }
}

function getBorderColor(type) {
  if (type === 'IRONMAN') return '#00C4B4'
  if (type === '70.3') return '#FF3D8B'
  return '#E8B84B'
}

function getDaysAway(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const race = new Date(dateStr + 'T00:00:00')
  const diff = Math.ceil((race - today) / 86400000)
  if (diff === 0) return { text: 'Today!', color: '#FF3D8B' }
  if (diff === 1) return { text: 'Tomorrow!', color: '#FF3D8B' }
  if (diff <= 7) return { text: `${diff} days`, color: '#E8B84B' }
  if (diff <= 30) return { text: `${diff} days`, color: '#FF5A1F' }
  return { text: `${diff} days`, color: '#999' }
}

function generateIcal(races) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Team TTL//Race Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  races.forEach(race => {
    const d = race.race_date.replace(/-/g, '')
    lines.push('BEGIN:VEVENT')
    lines.push(`DTSTART;VALUE=DATE:${d}`)
    lines.push(`DTEND;VALUE=DATE:${d}`)
    lines.push(`SUMMARY:${race.name}`)
    lines.push(`LOCATION:${race.location || ''}`)
    lines.push(`DESCRIPTION:${race.type} Triathlon`)
    lines.push(`UID:ttl-race-${race.id}@teamttl`)
    lines.push('END:VEVENT')
  })

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export default function MyRaces({ session }) {
  const [races, setRaces] = useState([])
  const [loading, setLoading] = useState(true)
  const userId = session.user.id

  useEffect(() => { loadMyRaces() }, [])

  async function loadMyRaces() {
    const { data } = await supabase
      .from('race_entries')
      .select('*, races(*)')
      .eq('athlete_id', userId)
      .order('races(race_date)')

    if (data) {
      const upcoming = data
        .map(e => e.races)
        .filter(Boolean)
        .filter(r => r.race_date >= new Date().toISOString().split('T')[0])
        .sort((a, b) => new Date(a.race_date) - new Date(b.race_date))
      setRaces(upcoming)
    }
    setLoading(false)
  }

  function handleExport() {
    const ical = generateIcal(races)
    const blob = new Blob([ical], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'team-ttl-my-races.ics'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Group by month
  const grouped = races.reduce((acc, race) => {
    const d = new Date(race.race_date + 'T12:00:00')
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (!acc[key]) acc[key] = { label: `${FULL_MONTHS[d.getMonth()]} ${d.getFullYear()}`, races: [] }
    acc[key].races.push(race)
    return acc
  }, {})

  const totalIronman = races.filter(r => r.type === 'IRONMAN').length
  const total703 = races.filter(r => r.type === '70.3').length
  const nextRace = races[0]
  const daysToNext = nextRace ? Math.ceil((new Date(nextRace.race_date) - new Date()) / 86400000) : null

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'Barlow Condensed', letterSpacing: 2, color: '#999', textTransform: 'uppercase' }}>
      Loading...
    </div>
  )

  return (
    <div style={S.page}>
      <div style={S.heading}>My Races</div>
      <div style={S.sub}>Your personal race schedule for the season.</div>

      {races.length === 0 ? (
        <div style={S.empty}>
          <div style={S.emptyIcon}>🏊</div>
          <div style={S.emptyTitle}>No races entered yet</div>
          <div style={S.emptySub}>Head to the Races tab and hit Enter on any race to add it here.</div>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div style={S.statsRow}>
            <div style={S.statCard}>
              <div style={S.statLabel}>Total Entered</div>
              <div style={{ ...S.statValue, color: '#00C4B4' }}>{races.length}</div>
              <div style={S.statSub}>upcoming races</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statLabel}>Next Race</div>
              <div style={{ ...S.statValue, color: '#FF3D8B', fontSize: '24px' }}>
                {daysToNext !== null ? `${daysToNext}d` : '—'}
              </div>
              <div style={S.statSub}>{nextRace?.name?.replace(/ironman\s+70\.3\s+/i, '').replace(/ironman\s+/i, '') || '—'}</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statLabel}>Breakdown</div>
              <div style={{ ...S.statValue, fontSize: '20px', color: '#E8B84B' }}>
                {totalIronman > 0 && <span style={{ color: '#00C4B4' }}>{totalIronman} Full</span>}
                {totalIronman > 0 && total703 > 0 && <span style={{ color: '#999' }}> · </span>}
                {total703 > 0 && <span style={{ color: '#FF3D8B' }}>{total703} 70.3</span>}
                {totalIronman === 0 && total703 === 0 && <span style={{ color: '#999' }}>—</span>}
              </div>
              <div style={S.statSub}>by type</div>
            </div>
          </div>

          {/* Export */}
          <button style={S.exportBtn} onClick={handleExport}>
            📅 Export to Calendar (.ics)
          </button>

          {/* Races grouped by month */}
          {Object.values(grouped).map(group => (
            <div key={group.label} style={S.monthGroup}>
              <div style={S.monthLabel}>{group.label}</div>
              {group.races.map(race => {
                const d = new Date(race.race_date + 'T12:00:00')
                const daysAway = getDaysAway(race.race_date)
                return (
                  <div key={race.id} style={{ ...S.raceCard, borderLeftColor: getBorderColor(race.type) }}>
                    <div style={S.dateBlock}>
                      <div style={S.dateDay}>{d.getDate()}</div>
                      <div style={S.dateMonth}>{MONTHS[d.getMonth()]}</div>
                    </div>
                    <div>
                      <div style={S.raceName}>{race.name}</div>
                      <div style={S.raceLoc}>{race.location}</div>
                      <span style={{ ...S.badge, ...getBadgeStyle(race.type) }}>{race.type}</span>
                    </div>
                    <div style={{ ...S.daysAway, color: daysAway.color }}>
                      {daysAway.text}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
