import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function getWeekRange() {
  const today = new Date()
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  }
}

function getDayName(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function RaceRow({ race }) {
  const [expanded, setExpanded] = useState(false)
  const names = race.race_entries.map(e => e.profiles?.full_name).filter(Boolean)
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>{race.name}</span>
          <span style={{ color: '#999' }}> — {getDayName(race.race_date)}</span>
          <span style={{
            marginLeft: '8px',
            fontFamily: 'Barlow Condensed, sans-serif',
            fontSize: '11px', letterSpacing: '1px',
            background: 'rgba(0, 181, 185,0.12)', color: '#00B5B9',
            border: '1px solid rgba(0, 181, 185,0.25)',
            borderRadius: '3px', padding: '1px 7px',
            verticalAlign: 'middle', whiteSpace: 'nowrap',
          }}>
            {names.length} {names.length === 1 ? 'athlete' : 'athletes'}
          </span>
        </div>
        <button
          onClick={() => setExpanded(prev => !prev)}
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontSize: '11px', letterSpacing: '1px',
            textTransform: 'uppercase', color: '#00B5B9',
            background: 'none', border: 'none', cursor: 'pointer',
            whiteSpace: 'nowrap', padding: 0, flexShrink: 0,
          }}
        >
          {expanded ? 'Hide' : 'Show all'}
        </button>
      </div>
      {expanded && (
        <div style={{
          marginTop: '6px', paddingLeft: '12px',
          borderLeft: '2px solid rgba(0, 181, 185,0.2)',
          fontSize: '13px', color: '#aaa', lineHeight: 1.8,
        }}>
          {names.join(', ')}
        </div>
      )}
    </div>
  )
}

export default function Home({ session }) {
  const [weekRaces, setWeekRaces] = useState([])
  const [upcomingRaces, setUpcomingRaces] = useState([])
  const [nextRace, setNextRace] = useState(null)
  const [latestContent, setLatestContent] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => { loadWeek() }, [])

  async function ensureProfile() {
    const userId = session.user.id
    const { data: existing } = await supabase.from('profiles').select('id').eq('id', userId).single()
    if (!existing) {
      const email = session.user.email
      const fullName = session.user.user_metadata?.full_name || email.split('@')[0]
      await supabase.from('profiles').insert({ id: userId, full_name: fullName, email, role: 'athlete' })
    }
  }

  async function loadWeek() {
    const { start, end } = getWeekRange()
    const userId = session.user.id
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const horizon = new Date(today)
    horizon.setDate(today.getDate() + 90)
    const horizonStr = horizon.toISOString().split('T')[0]
    const [racesRes, upcomingRes, profileRes] = await Promise.all([
      supabase
        .from('races')
        .select('*, race_entries(athlete_id, profiles(full_name, id))')
        .gte('race_date', start)
        .lte('race_date', end)
        .order('race_date'),
      supabase
        .from('races')
        .select('*')
        .gte('race_date', todayStr)
        .lte('race_date', horizonStr)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .order('race_date'),
      supabase.from('profiles').select('*').eq('id', userId).single(),
      ensureProfile(),
    ])
    if (racesRes.data) setWeekRaces(racesRes.data.filter(r => r.race_entries?.length > 0))
    if (upcomingRes.data) setUpcomingRaces(upcomingRes.data)
    if (profileRes.data) setProfile(profileRes.data)

    // Feed additions (5-tab model): my next entered race + the latest
    // Watch content. Both are best-effort teasers — Home renders without them.
    try {
      const { data: myEntries } = await supabase.from('race_entries').select('race_id').eq('athlete_id', userId)
      const ids = (myEntries || []).map(e => e.race_id)
      if (ids.length > 0) {
        const { data: mine } = await supabase.from('races').select('*')
          .in('id', ids).gte('race_date', todayStr).order('race_date').limit(1)
        if (mine?.length) setNextRace(mine[0])
      }
    } catch { /* teaser only */ }
    try {
      const res = await fetch('/api/content/feeds')
      const data = await res.json()
      if (data && (data.episodes?.length || data.stories?.length)) {
        setLatestContent({ episode: data.episodes?.[0] || null, story: data.stories?.[0] || null })
      }
    } catch { /* teaser only */ }

    setLoading(false)
  }

  const firstName = profile?.full_name?.split(' ')[0] || 'Athlete'
  const totalRacers = [...new Set(weekRaces.flatMap(r => r.race_entries.map(e => e.athlete_id)))].length

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'Barlow Condensed', letterSpacing: 2, color: '#999', textTransform: 'uppercase' }}>
      Loading...
    </div>
  )

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

      {/* Greeting */}
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{
          fontFamily: 'Barlow Condensed, sans-serif',
          fontSize: '13px', letterSpacing: '3px',
          textTransform: 'uppercase', color: '#999', marginBottom: '8px',
        }}>
          {greeting()},
        </div>
        <h1 style={{
          fontFamily: 'Barlow Condensed, sans-serif',
          fontSize: '52px', fontWeight: 900,
          letterSpacing: '2px', lineHeight: 1, color: '#fff',
        }}>
          {firstName.toUpperCase()}
        </h1>
        <div style={{
          width: '60px', height: '3px', marginTop: '12px',
          background: 'linear-gradient(90deg, #00B5B9, #E87362)',
          borderRadius: '2px',
        }} />
      </div>

      {weekRaces.length === 0 ? (
        <div style={{
          background: '#161616', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '12px', padding: '3rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>🤙</div>
          <div style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontSize: '20px', fontWeight: 700,
            letterSpacing: '2px', textTransform: 'uppercase',
            color: '#fff', marginBottom: '8px',
          }}>
            No races this week
          </div>
          <div style={{ fontSize: '14px', color: '#999' }}>
            Train hard — race weekend is coming.
          </div>
        </div>
      ) : (
        <>
          {/* 1 — This Week summary */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(0, 181, 185,0.06) 0%, rgba(232, 115, 98,0.06) 100%)',
            border: '1px solid rgba(0, 181, 185,0.2)',
            borderRadius: '12px', padding: '1.75rem 2rem',
            marginBottom: '1.25rem', position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
              background: 'linear-gradient(90deg, #00B5B9, #E87362, #E8B84B, #E87362)',
            }} />
            <div style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontSize: '12px', letterSpacing: '3px',
              textTransform: 'uppercase', color: '#00B5B9', marginBottom: '10px',
            }}>
              This week
            </div>
            <div style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontSize: '28px', fontWeight: 800,
              letterSpacing: '1px', color: '#fff',
              lineHeight: 1.2, marginBottom: '16px',
            }}>
              {totalRacers === 1
                ? '1 teammate is racing this week 🏁'
                : `${totalRacers} teammates are racing this week 🏁`}
            </div>
            <div>
              {weekRaces.map(race => (
                <RaceRow key={race.id} race={race} />
              ))}
            </div>
          </div>

          {/* 2 — Good luck */}
          <div style={{
            background: '#161616', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '10px', padding: '1.25rem 1.75rem',
            display: 'flex', alignItems: 'center', gap: '16px',
            marginBottom: '1.25rem',
          }}>
            <div style={{ fontSize: '28px', flexShrink: 0 }}>🤘</div>
            <div>
              <div style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                fontSize: '18px', fontWeight: 700,
                letterSpacing: '1px', color: '#fff', marginBottom: '3px',
              }}>
                Good luck out there, Team TTL!
              </div>
              <div style={{ fontSize: '13px', color: '#aaa' }}>
                Have fun, race hard, and finish strong. The whole team is cheering you on!
              </div>
            </div>
          </div>

        </>
      )}

      {/* Feed cards (5-tab model): Home points at the dedicated pages
          instead of duplicating them — the full map and lists live in
          Races, the full player and stories live in Watch. */}
      {nextRace && (() => {
        const days = Math.ceil((new Date(nextRace.race_date + 'T12:00:00') - new Date()) / 86400000)
        return (
          <button onClick={() => navigate('/races')} style={{
            display: 'flex', alignItems: 'center', gap: '16px', width: '100%', textAlign: 'left',
            background: '#161616', border: '1px solid rgba(232, 115, 98,0.3)', borderRadius: '10px',
            padding: '1.25rem 1.75rem', marginTop: '1.25rem', cursor: 'pointer',
          }}>
            <div style={{ fontSize: '28px', flexShrink: 0 }}>🏁</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: '#E87362', marginBottom: '3px' }}>
                Your next race{days >= 0 ? ` — ${days === 0 ? 'today!' : `in ${days} day${days === 1 ? '' : 's'}`}` : ''}
              </div>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '18px', fontWeight: 700, letterSpacing: '1px', color: '#fff' }}>{nextRace.name}</div>
              <div style={{ fontSize: '13px', color: '#aaa' }}>{getDayName(nextRace.race_date)} · {nextRace.location}</div>
            </div>
            <div style={{ color: '#555', fontSize: '20px', flexShrink: 0 }}>→</div>
          </button>
        )
      })()}

      {latestContent && (
        <button onClick={() => navigate('/content')} style={{
          display: 'flex', alignItems: 'center', gap: '16px', width: '100%', textAlign: 'left',
          background: '#161616', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px',
          padding: '1.25rem 1.75rem', marginTop: '1.25rem', cursor: 'pointer',
        }}>
          <div style={{ fontSize: '28px', flexShrink: 0 }}>🎧</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: '#00B5B9', marginBottom: '3px' }}>
              Latest from TTL
            </div>
            {latestContent.episode && (
              <div style={{ fontSize: '14px', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Podcast: {latestContent.episode.title}
              </div>
            )}
            {latestContent.story && (
              <div style={{ fontSize: '13px', color: '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                Story: {latestContent.story.title}
              </div>
            )}
          </div>
          <div style={{ color: '#555', fontSize: '20px', flexShrink: 0 }}>→</div>
        </button>
      )}

      <button onClick={() => navigate('/races')} style={{
        display: 'flex', alignItems: 'center', gap: '16px', width: '100%', textAlign: 'left',
        background: '#161616', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px',
        padding: '1.25rem 1.75rem', marginTop: '1.25rem', cursor: 'pointer',
      }}>
        <div style={{ fontSize: '28px', flexShrink: 0 }}>🗺️</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '18px', fontWeight: 700, letterSpacing: '1px', color: '#fff', marginBottom: '3px' }}>
            Team race map
          </div>
          <div style={{ fontSize: '13px', color: '#aaa' }}>
            {upcomingRaces.length > 0
              ? `${upcomingRaces.length} upcoming race${upcomingRaces.length === 1 ? '' : 's'} with locations in the next 90 days`
              : 'See where the team is racing'}
          </div>
        </div>
        <div style={{ color: '#555', fontSize: '20px', flexShrink: 0 }}>→</div>
      </button>
    </div>
  )
}
