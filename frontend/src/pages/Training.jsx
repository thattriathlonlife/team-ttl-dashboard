import { useState, useEffect, useRef, Component } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const STRAVA_ORANGE = '#FC4C02'

const TYPE_CONFIG = {
  'Swim':     { emoji: '🏊', color: '#00C4B4', bg: 'rgba(0,196,180,0.12)' },
  'Bike':     { emoji: '🚴', color: '#FF5A1F', bg: 'rgba(255,90,31,0.12)' },
  'Run':      { emoji: '🏃', color: '#FF3D8B', bg: 'rgba(255,61,139,0.12)' },
  'Walk':     { emoji: '🚶', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  'Hike':     { emoji: '🥾', color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  'Strength': { emoji: '💪', color: '#E8B84B', bg: 'rgba(232,184,75,0.12)' },
  'Workout':  { emoji: '⚡', color: '#E8B84B', bg: 'rgba(232,184,75,0.12)' },
}

function getTypeConfig(type) {
  return TYPE_CONFIG[type] || { emoji: '🏅', color: '#aaa', bg: 'rgba(255,255,255,0.06)' }
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172800) return 'Yesterday'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function getWeekStart(date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  d.setHours(0, 0, 0, 0)
  return d
}

function calcScore(sessions, durationSeconds) {
  return Math.round(sessions * 10 + (durationSeconds / 3600) * 5)
}

// ── Error boundary ────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) return (
      <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ background: 'rgba(255,61,139,0.1)', border: '1px solid rgba(255,61,139,0.2)', borderRadius: '8px', padding: '1.5rem', color: '#FF3D8B' }}>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>Training page error</div>
          <div style={{ fontSize: '13px' }}>{this.state.error.message}</div>
        </div>
      </div>
    )
    return this.props.children
  }
}

// ── Avatar ────────────────────────────────────────────────────────
function Avatar({ name, color, url, size = 28 }) {
  const initials = (name || 'A').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  if (url) return <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  return <div style={{ width: size, height: size, borderRadius: '50%', background: color || '#00C4B4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontSize: Math.max(9, size * 0.36), fontWeight: 700, color: '#000', flexShrink: 0 }}>{initials}</div>
}

// ── Weekly summary ────────────────────────────────────────────────
function WeeklySummary({ activities }) {
  const weekStart = getWeekStart(new Date())
  const week = activities.filter(a => new Date(a.start_date) >= weekStart)
  const swims = week.filter(a => a.type === 'Swim')
  const bikes = week.filter(a => a.type === 'Bike')
  const runs  = week.filter(a => a.type === 'Run')
  const swimKm = swims.reduce((s, a) => s + (a.distance_m || 0), 0) / 1000
  const bikeKm = bikes.reduce((s, a) => s + (a.distance_m || 0), 0) / 1000
  const runKm  = runs.reduce((s, a)  => s + (a.distance_m || 0), 0) / 1000

  const cols = [
    { emoji: '🏅', label: 'Sessions', val: week.length,                         sub: 'this week',        color: '#fff' },
    { emoji: '🏊', label: 'Swim',     val: swimKm > 0 ? `${swimKm.toFixed(1)} km` : `${swims.length}`, sub: `${swims.length} session${swims.length !== 1 ? 's' : ''}`, color: '#00C4B4' },
    { emoji: '🚴', label: 'Bike',     val: bikeKm > 0 ? `${bikeKm.toFixed(0)} km` : `${bikes.length}`, sub: `${bikes.length} session${bikes.length !== 1 ? 's' : ''}`, color: '#FF5A1F' },
    { emoji: '🏃', label: 'Run',      val: runKm  > 0 ? `${runKm.toFixed(1)} km`  : `${runs.length}`,  sub: `${runs.length} session${runs.length !== 1 ? 's' : ''}`,  color: '#FF3D8B' },
  ]
  return (
    <div style={{ background: 'rgba(252,76,2,0.06)', border: '1px solid rgba(252,76,2,0.18)', borderTop: '2px solid #FC4C02', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '2.5px', textTransform: 'uppercase', color: STRAVA_ORANGE, marginBottom: '10px' }}>This Week — Team Training</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
        {cols.map(c => (
          <div key={c.label}>
            <div style={{ fontSize: '10px', color: '#555', marginBottom: '3px', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '1px', textTransform: 'uppercase' }}>{c.emoji} {c.label}</div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '20px', fontWeight: 700, color: (c.val === 0 || c.val === '0') ? '#333' : c.color, lineHeight: 1 }}>{c.val}</div>
            <div style={{ fontSize: '10px', color: '#444', marginTop: '2px' }}>{c.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Leaderboard ───────────────────────────────────────────────────
function WeeklyLeaderboard({ activities }) {
  const weekStart = getWeekStart(new Date())
  const week = activities.filter(a => new Date(a.start_date) >= weekStart)
  const map = {}
  week.forEach(a => {
    if (!map[a.athlete_id]) map[a.athlete_id] = { id: a.athlete_id, name: a.athlete_name, color: a.athlete_avatar_color, url: a.athlete_avatar_url, sessions: 0, dur: 0 }
    map[a.athlete_id].sessions++
    map[a.athlete_id].dur += a.duration_s || 0
  })
  const ranked = Object.values(map).map(a => ({ ...a, score: calcScore(a.sessions, a.dur) })).sort((a, b) => b.score - a.score)
  const MEDALS = ['🥇', '🥈', '🥉']

  return (
    <div style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', overflow: 'hidden', marginBottom: '10px' }}>
      <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', color: '#555' }}>This Week</div>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 700, color: '#fff' }}>Leaderboard</div>
      </div>
      {ranked.length === 0
        ? <div style={{ padding: '12px 14px', fontSize: '12px', color: '#444', fontStyle: 'italic' }}>No training logged yet this week</div>
        : ranked.map((a, i) => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 14px', borderBottom: i < ranked.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: i === 0 ? 'rgba(232,184,75,0.04)' : 'none' }}>
            <span style={{ fontSize: '14px', width: '18px', flexShrink: 0 }}>{MEDALS[i] || `${i + 1}`}</span>
            <Avatar name={a.name} color={a.color} url={a.url} size={24} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
              <div style={{ fontSize: '10px', color: '#555' }}>{a.sessions} session{a.sessions !== 1 ? 's' : ''}</div>
            </div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 700, color: i === 0 ? '#E8B84B' : '#666', flexShrink: 0 }}>{a.score}</div>
          </div>
        ))
      }
      <div style={{ padding: '4px 14px 7px', fontSize: '10px', color: '#333', fontFamily: 'Barlow Condensed, sans-serif' }}>Sessions × 10 + hours × 5</div>
    </div>
  )
}

// ── Streaks ───────────────────────────────────────────────────────
function TrainingStreaks({ activities }) {
  const athleteWeeks = {}
  activities.forEach(a => {
    if (!athleteWeeks[a.athlete_id]) athleteWeeks[a.athlete_id] = { id: a.athlete_id, name: a.athlete_name, color: a.athlete_avatar_color, url: a.athlete_avatar_url, weeks: new Set() }
    athleteWeeks[a.athlete_id].weeks.add(getWeekStart(new Date(a.start_date)).getTime())
  })

  const thisWeek = getWeekStart(new Date()).getTime()
  const lastWeek = thisWeek - 7 * 86400000

  const streaks = Object.values(athleteWeeks).map(athlete => {
    const sorted = [...athlete.weeks].sort((a, b) => b - a)
    if (!sorted.includes(thisWeek) && !sorted.includes(lastWeek)) return { ...athlete, streak: 0 }
    let streak = 0
    let expected = sorted.includes(thisWeek) ? thisWeek : lastWeek
    for (const w of sorted) {
      if (w === expected) { streak++; expected -= 7 * 86400000 } else break
    }
    return { ...athlete, streak }
  }).filter(a => a.streak > 0).sort((a, b) => b.streak - a.streak)

  return (
    <div style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', color: '#555' }}>Consistency</div>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 700, color: '#fff' }}>Weekly Streaks</div>
      </div>
      {streaks.length === 0
        ? <div style={{ padding: '12px 14px', fontSize: '12px', color: '#444', fontStyle: 'italic' }}>No active streaks yet</div>
        : streaks.map((a, i) => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 14px', borderBottom: i < streaks.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
            <Avatar name={a.name} color={a.color} url={a.url} size={24} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
              <div style={{ fontSize: '10px', color: '#555' }}>{a.streak} week{a.streak !== 1 ? 's' : ''} straight</div>
            </div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 700, color: '#FF5A1F', flexShrink: 0 }}>
              {'🔥'.repeat(Math.min(a.streak, 3))} {a.streak}
            </div>
          </div>
        ))
      }
    </div>
  )
}

// ── Peak week ─────────────────────────────────────────────────────
function PeakWeekBanner({ activities, athleteId }) {
  const mine = activities.filter(a => a.athlete_id === athleteId)
  const weeks = {}
  mine.forEach(a => {
    const ws = getWeekStart(new Date(a.start_date)).getTime()
    if (!weeks[ws]) weeks[ws] = { sessions: 0, dur: 0, dist: 0 }
    weeks[ws].sessions++; weeks[ws].dur += a.duration_s || 0; weeks[ws].dist += a.distance_m || 0
  })
  const entries = Object.entries(weeks)
  if (entries.length < 3) return null
  const thisWeekTs = getWeekStart(new Date()).getTime()
  const scored = entries.map(([ts, w]) => ({ ts: +ts, score: calcScore(w.sessions, w.dur), ...w }))
  const peak = scored.reduce((b, w) => w.score > b.score ? w : b, scored[0])
  if (peak.ts !== thisWeekTs) return null
  return (
    <div style={{ background: 'rgba(232,184,75,0.08)', border: '1px solid rgba(232,184,75,0.25)', borderRadius: '8px', padding: '10px 14px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span style={{ fontSize: '20px', flexShrink: 0 }}>🏆</span>
      <div>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 700, color: '#E8B84B' }}>Biggest week of the last 90 days!</div>
        <div style={{ fontSize: '11px', color: '#aaa' }}>{peak.sessions} sessions · {(peak.dur / 3600).toFixed(1)}h · {(peak.dist / 1000).toFixed(0)} km</div>
      </div>
    </div>
  )
}

// ── Monthly summary ───────────────────────────────────────────────
function MonthlySummary({ activities }) {
  const now = new Date()
  if (now.getDate() > 7) return null
  const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1
  const lastYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const acts = activities.filter(a => { const d = new Date(a.start_date); return d.getMonth() === lastMonth && d.getFullYear() === lastYear })
  if (!acts.length) return null
  const swimKm = acts.filter(a => a.type === 'Swim').reduce((s, a) => s + (a.distance_m || 0), 0) / 1000
  const bikeKm = acts.filter(a => a.type === 'Bike').reduce((s, a) => s + (a.distance_m || 0), 0) / 1000
  const runKm  = acts.filter(a => a.type === 'Run').reduce((s, a)  => s + (a.distance_m || 0), 0) / 1000
  const hours  = acts.reduce((s, a) => s + (a.duration_s || 0), 0) / 3600
  const athletes = new Set(acts.map(a => a.athlete_id)).size
  return (
    <div style={{ background: 'rgba(255,61,139,0.06)', border: '1px solid rgba(255,61,139,0.18)', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: '#FF3D8B', marginBottom: '6px' }}>🗓 {MONTHS[lastMonth]} Team Recap</div>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>{acts.length} sessions · {athletes} athlete{athletes !== 1 ? 's' : ''} 🤘</div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {swimKm > 0 && <div><div style={{ fontSize: '10px', color: '#555' }}>🏊 Swim</div><div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '18px', fontWeight: 700, color: '#00C4B4' }}>{swimKm.toFixed(1)} km</div></div>}
        {bikeKm > 0 && <div><div style={{ fontSize: '10px', color: '#555' }}>🚴 Bike</div><div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '18px', fontWeight: 700, color: '#FF5A1F' }}>{bikeKm.toFixed(0)} km</div></div>}
        {runKm  > 0 && <div><div style={{ fontSize: '10px', color: '#555' }}>🏃 Run</div><div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '18px', fontWeight: 700, color: '#FF3D8B' }}>{runKm.toFixed(1)} km</div></div>}
        <div><div style={{ fontSize: '10px', color: '#555' }}>⏱ Total</div><div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '18px', fontWeight: 700, color: '#E8B84B' }}>{hours.toFixed(0)}h</div></div>
      </div>
    </div>
  )
}

// ── Activity card ─────────────────────────────────────────────────
function ActivityCard({ activity, upcomingRaces }) {
  const cfg = getTypeConfig(activity.type)
  // Find this athlete's next race
  const myRaces = upcomingRaces.filter(r => r.athlete_id === activity.athlete_id)
  const nextRace = myRaces[0]
  const daysOut = nextRace ? Math.ceil((new Date(nextRace.race_date) - new Date()) / 86400000) : null

  return (
    <a href={activity.strava_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'block', marginBottom: '8px' }}>
      <div style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px', transition: 'border-color 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(252,76,2,0.3)'}
        onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
      >
        {/* Row 1: athlete + time + view */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <Avatar name={activity.athlete_name} color={activity.athlete_avatar_color} url={activity.athlete_avatar_url} size={22} />
          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', color: '#888', flex: 1 }}>{activity.athlete_name}</span>
          {/* Inline race countdown */}
          {nextRace && daysOut !== null && daysOut <= 30 && (
            <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', color: '#00C4B4', background: 'rgba(0,196,180,0.1)', border: '1px solid rgba(0,196,180,0.2)', borderRadius: '4px', padding: '1px 6px', flexShrink: 0 }}>
              🏁 {daysOut}d to {nextRace.name.replace(/ironman\s+70\.3\s+/i, '').replace(/ironman\s+/i, '')}
            </span>
          )}
          <span style={{ fontSize: '10px', color: '#555', flexShrink: 0, marginLeft: '4px' }}>{timeAgo(activity.start_date)}</span>
        </div>

        {/* Row 2: type icon + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>{cfg.emoji}</div>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{activity.name}</div>
          <span style={{ fontSize: '10px', color: STRAVA_ORANGE, flexShrink: 0 }}>View →</span>
        </div>

        {/* Row 3: stats */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {activity.distance  && <span style={{ fontSize: '12px', color: cfg.color, fontWeight: 600, fontFamily: 'Barlow Condensed, sans-serif' }}>{activity.distance}</span>}
          {activity.duration  && <span style={{ fontSize: '12px', color: '#888' }}>{activity.duration}</span>}
          {activity.elevation && <span style={{ fontSize: '12px', color: '#555' }}>↑ {activity.elevation}</span>}
          {activity.average_heartrate && <span style={{ fontSize: '12px', color: '#555' }}>♥ {activity.average_heartrate} bpm</span>}
          {activity.kudos > 0 && <span style={{ fontSize: '12px', color: '#555' }}>👍 {activity.kudos}</span>}
        </div>
      </div>
    </a>
  )
}

// ── Connect banner ────────────────────────────────────────────────
function ConnectBanner({ userId }) {
  const origin = (typeof window !== 'undefined') ? window.location.origin : ''
  const url = `https://www.strava.com/oauth/authorize?client_id=${import.meta.env.VITE_STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(origin + '/api/strava/callback')}&response_type=code&approval_prompt=auto&scope=activity:read&state=${userId}`
  return (
    <div style={{ background: 'rgba(252,76,2,0.07)', border: '1px solid rgba(252,76,2,0.2)', borderRadius: '10px', padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
      <div>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '2px' }}>Connect your Strava</div>
        <div style={{ fontSize: '13px', color: '#999' }}>Share your training and appear on the leaderboard.</div>
      </div>
      <a href={url} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: STRAVA_ORANGE, color: '#fff', textDecoration: 'none', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', padding: '9px 18px', borderRadius: '6px', flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
        Connect Strava
      </a>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────
function TrainingPage({ session, profile }) {
  const [feedActivities, setFeedActivities]   = useState([])  // 14 days — loads first
  const [allActivities, setAllActivities]     = useState([])  // 90 days — loads second
  const [upcomingRaces, setUpcomingRaces]     = useState([])
  const [connectedCount, setConnectedCount]   = useState(0)
  const [loading, setLoading]                 = useState(true)
  const [error, setError]                     = useState(null)
  const [disconnecting, setDisconnecting]     = useState(false)
  const [searchParams]                        = useSearchParams()

  const userId     = session?.user?.id
  const isConnected = !!profile?.strava_athlete_id

  useEffect(() => {
    loadFeed()
    loadRaces()
  }, [])

  async function loadFeed() {
    try {
      // Phase 1: fast 14-day fetch — shows feed immediately
      const r14 = await fetch('/api/strava/activities?days=14')
      if (!r14.ok) throw new Error('Failed to load activities')
      const d14 = await r14.json()
      setFeedActivities(d14.activities || [])
      setAllActivities(d14.activities || [])   // seed social features with 14d data
      setConnectedCount(d14.connectedCount || 0)
      setLoading(false)

      // Phase 2: background 90-day fetch — updates social features silently
      const r90 = await fetch('/api/strava/activities?days=90')
      if (r90.ok) {
        const d90 = await r90.json()
        setAllActivities(d90.activities || [])
      }
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  async function loadRaces() {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('race_entries')
      .select('athlete_id, races(id, name, race_date, type)')
      .gte('races.race_date', today)
    if (data) setUpcomingRaces(
      data.filter(e => e.races).map(e => ({ athlete_id: e.athlete_id, ...e.races }))
        .sort((a, b) => new Date(a.race_date) - new Date(b.race_date))
    )
  }

  async function disconnect() {
    if (!confirm('Disconnect Strava?')) return
    setDisconnecting(true)
    await fetch('/api/strava/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) })
    if (typeof window !== 'undefined') window.location.reload()
  }

  // Group feed by day for display
  const grouped = feedActivities.reduce((acc, act) => {
    const key = new Date(act.start_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    if (!acc[key]) acc[key] = []
    acc[key].push(act)
    return acc
  }, {})

  const firstDayKey = Object.keys(grouped)[0]
  const firstDayAthletes = firstDayKey ? [...new Set(grouped[firstDayKey].map(a => a.athlete_id))] : []

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1.5rem 1rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '32px', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff', marginBottom: '2px' }}>Training</div>
          <div style={{ fontSize: '13px', color: '#999' }}>
            {connectedCount > 0 ? `${connectedCount} teammate${connectedCount !== 1 ? 's' : ''} connected via Strava` : 'Connect Strava to share your training'}
          </div>
        </div>
        {isConnected && (
          <button onClick={disconnect} disabled={disconnecting} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', padding: '7px 12px', background: 'none', border: '1px solid rgba(252,76,2,0.3)', borderRadius: '4px', color: STRAVA_ORANGE, cursor: 'pointer', flexShrink: 0 }}>
            {disconnecting ? 'Disconnecting...' : 'Disconnect Strava'}
          </button>
        )}
      </div>

      {!isConnected && <ConnectBanner userId={userId} />}

      {searchParams.get('connected') === 'true' && (
        <div style={{ background: 'rgba(0,196,180,0.1)', border: '1px solid rgba(0,196,180,0.25)', borderRadius: '8px', padding: '10px 14px', color: '#00C4B4', fontSize: '13px', marginBottom: '1.25rem' }}>
          ✓ Strava connected! Your activities will now appear in the team feed.
        </div>
      )}

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'Barlow Condensed', letterSpacing: 2, color: '#555', textTransform: 'uppercase', fontSize: '13px' }}>Loading...</div>
      ) : error ? (
        <div style={{ background: 'rgba(255,61,139,0.1)', border: '1px solid rgba(255,61,139,0.2)', borderRadius: '8px', padding: '1rem', color: '#FF3D8B', fontSize: '13px' }}>
          {error}
        </div>
      ) : (
        <>
          <MonthlySummary activities={allActivities} />
          <WeeklySummary activities={feedActivities} />

          {/* Two-col on desktop, single-col on mobile via CSS */}
          <style>{`
            @media (min-width: 768px) {
              .training-grid { display: grid; grid-template-columns: 1fr 260px; gap: 1.25rem; align-items: start; }
              .training-sidebar { position: sticky; top: 68px; }
            }
            @media (max-width: 767px) {
              .training-grid { display: flex; flex-direction: column; gap: 0; }
              .training-sidebar { order: -1; margin-bottom: 1rem; }
            }
          `}</style>

          <div className="training-grid">
            {/* Feed */}
            <div style={{ minWidth: 0 }}>
              {feedActivities.length === 0 ? (
                <div style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '3rem 2rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏊🚴🏃</div>
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '18px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff', marginBottom: '6px' }}>No activities yet</div>
                  <div style={{ fontSize: '13px', color: '#999' }}>{connectedCount === 0 ? 'Connect your Strava above to get started.' : 'No activities in the last 14 days. Get training! 💪'}</div>
                </div>
              ) : (
                Object.entries(grouped).map(([day, acts], dayIdx) => (
                  <div key={day} style={{ marginBottom: '1.25rem' }}>
                    <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: '#444', marginBottom: '8px', paddingBottom: '5px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{day}</div>
                    {/* Peak week banner — only on first day */}
                    {dayIdx === 0 && firstDayAthletes.map(id => (
                      <PeakWeekBanner key={id} activities={allActivities} athleteId={id} />
                    ))}
                    {acts.map(act => <ActivityCard key={act.id} activity={act} upcomingRaces={upcomingRaces} />)}
                  </div>
                ))
              )}
            </div>

            {/* Sidebar */}
            <div className="training-sidebar">
              <WeeklyLeaderboard activities={allActivities} />
              <TrainingStreaks activities={allActivities} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function Training(props) {
  return <ErrorBoundary><TrainingPage {...props} /></ErrorBoundary>
}
