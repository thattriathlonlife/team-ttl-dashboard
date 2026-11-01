import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { channelDisplayName, channelAccessLabel, raceChannelKind, isTeamOnlyChannel } from '../lib/channels'
import { isTeamTier } from '../lib/tier'

// Global search (DESIGN-SPEC §2.6): one box across races, athletes,
// channels, and TTL content (podcast / videos / stories). Indexes are small
// (hundreds of rows), so this loads them once and filters locally — instant
// results, no search service. The current app's search icon is decorative;
// this one works.
const S = {
  wrap: { maxWidth: '680px', margin: '0 auto', padding: '1.5rem 1.25rem 3rem' },
  input: {
    width: '100%', background: '#161616', border: '1px solid rgba(var(--brand-rgb),0.35)',
    borderRadius: '999px', padding: '14px 20px', fontSize: '16px', color: '#fff',
    outline: 'none', fontFamily: 'Barlow, sans-serif',
  },
  h: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--brand)', margin: '1.75rem 0 0.6rem' },
  row: {
    display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
    background: '#161616', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px',
    padding: '12px 14px', marginBottom: '8px', cursor: 'pointer',
  },
  tag: {
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10.5px', fontWeight: 700,
    letterSpacing: '1.2px', textTransform: 'uppercase', padding: '3px 8px',
    borderRadius: '5px', flexShrink: 0, marginLeft: 'auto', whiteSpace: 'nowrap',
  },
  chip: {
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12.5px', fontWeight: 600,
    letterSpacing: '1.2px', textTransform: 'uppercase', padding: '7px 15px',
    borderRadius: '999px', border: '1px solid rgba(255,255,255,0.12)',
    background: '#161616', color: '#999', cursor: 'pointer',
  },
  title: { fontSize: '15px', fontWeight: 600, color: '#fff' },
  meta: { fontSize: '12px', color: '#888', marginTop: '2px' },
  icon: { fontSize: '20px', flexShrink: 0, width: '30px', textAlign: 'center' },
  empty: { color: '#777', fontSize: '14px', padding: '1rem 0' },
}

const RECENT_KEY = 'ttl-recent-searches'

export default function Search({ profile }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(null)
  const [recents, setRecents] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
  })
  const navigate = useNavigate()
  const team = isTeamTier(profile)

  function remember(term) {
    const t = term.trim()
    if (t.length < 2) return
    setRecents(prev => {
      const next = [t, ...prev.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, 6)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  useEffect(() => {
    ;(async () => {
      const [racesRes, profilesRes, channelsRes, entriesRes] = await Promise.all([
        supabase.from('races').select('id, name, race_date, location').order('race_date'),
        supabase.from('profiles').select('id, full_name, avatar_color'),
        supabase.from('channels').select('id, name, type, category, audience').neq('type', 'dm'),
        supabase.from('race_entries').select('race_id'),
      ])
      const entryCounts = {}
      for (const e of entriesRes.data || []) entryCounts[e.race_id] = (entryCounts[e.race_id] || 0) + 1
      let content = { episodes: [], videos: [], stories: [] }
      try {
        const r = await fetch('/api/content/feeds')
        if (r.ok) content = await r.json()
      } catch { /* content is additive */ }
      // Tier-shaped like the rest of the app: fans search public race
      // discussions; team channels are searchable only by the entitled.
      const visibleChannels = (channelsRes.data || []).filter(c =>
        raceChannelKind(c) === 'discussion' || (team && isTeamOnlyChannel(c)))
      setIndex({
        races: (racesRes.data || []).map(r => ({ ...r, entryCount: entryCounts[r.id] || 0 })),
        athletes: profilesRes.data || [],
        channels: visibleChannels,
        episodes: content.episodes || [],
        videos: content.videos || [],
        stories: content.stories || [],
      })
    })()
  }, [team])

  const q = query.trim().toLowerCase()
  const match = (s) => s && s.toLowerCase().includes(q)
  const results = (!index || q.length < 2) ? null : {
    races: index.races.filter(r => match(r.name) || match(r.location)).slice(0, 6),
    athletes: index.athletes.filter(a => match(a.full_name)).slice(0, 6),
    channels: index.channels.filter(c => match(channelDisplayName(c))).slice(0, 6),
    episodes: index.episodes.filter(e => match(e.title)).slice(0, 4),
    videos: index.videos.filter(v => match(v.title)).slice(0, 4),
    stories: index.stories.filter(s => match(s.title)).slice(0, 4),
  }
  const total = results
    ? Object.values(results).reduce((n, arr) => n + arr.length, 0)
    : 0

  return (
    <div style={S.wrap}>
      <input
        style={S.input}
        placeholder="Search races, athletes, channels, episodes…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        autoFocus
      />

      {!index && <div style={S.empty}>Loading the index…</div>}
      {index && q.length < 2 && (
        <>
          {recents.length > 0 && (
            <>
              <div style={S.h}>Recent</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {recents.map(r => (
                  <button key={r} style={S.chip} onClick={() => setQuery(r)}>{r}</button>
                ))}
              </div>
            </>
          )}
          <div style={S.empty}>Searches everything in the app: {index.races.length} races, {index.athletes.length} athletes, {index.channels.length} channels, and all TTL podcast episodes, videos, and stories.</div>
        </>
      )}
      {results && total === 0 && <div style={S.empty}>Nothing matches “{query}”.</div>}

      {results && results.races.length > 0 && (
        <>
          <div style={S.h}>Races</div>
          {results.races.map(r => (
            <button key={r.id} style={S.row} onClick={() => { remember(query); navigate('/races') }}>
              <span style={S.icon}>🏁</span>
              <span style={{ minWidth: 0 }}>
                <span style={S.title}>{r.name}</span>
                <span style={{ ...S.meta, display: 'block' }}>{r.race_date} · {r.location}</span>
              </span>
              {r.entryCount > 0 && (
                <span style={{ ...S.tag, background: 'rgba(var(--accent-rgb),0.13)', color: 'var(--accent)' }}>{r.entryCount} in</span>
              )}
            </button>
          ))}
        </>
      )}

      {results && results.athletes.length > 0 && (
        <>
          <div style={S.h}>Athletes</div>
          {results.athletes.map(a => (
            <button key={a.id} style={S.row} onClick={() => { remember(query); navigate('/team?tab=roster') }}>
              <span style={{ width: 32, height: 32, borderRadius: '50%', background: a.avatar_color || '#3d7a8c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#10131a', fontFamily: 'Barlow Condensed, sans-serif', flexShrink: 0 }}>
                {(a.full_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2)}
              </span>
              <span style={S.title}>{a.full_name}</span>
            </button>
          ))}
        </>
      )}

      {results && results.channels.length > 0 && (
        <>
          <div style={S.h}>Channels</div>
          {results.channels.map(c => {
            const access = channelAccessLabel(c)
            const kind = raceChannelKind(c)
            return (
              <button key={c.id} style={S.row} onClick={() => { remember(query); navigate(`/messages?channel=${c.id}`) }}>
                <span style={{ ...S.icon, color: 'var(--brand)', fontWeight: 800 }}>#</span>
                <span style={{ minWidth: 0 }}>
                  <span style={S.title}>{channelDisplayName(c)}</span>
                  {access && <span style={{ ...S.meta, display: 'block' }}>{access}</span>}
                </span>
                {kind === 'discussion'
                  ? <span style={{ ...S.tag, background: 'rgba(var(--highlight-rgb),0.13)', color: 'var(--highlight)' }}>Public</span>
                  : isTeamOnlyChannel(c)
                    ? <span style={{ ...S.tag, background: 'rgba(var(--brand-rgb),0.13)', color: 'var(--brand)' }}>Team</span>
                    : null}
              </button>
            )
          })}
        </>
      )}

      {results && results.episodes.length > 0 && (
        <>
          <div style={S.h}>Podcast</div>
          {results.episodes.map((e, i) => (
            <button key={i} style={S.row} onClick={() => { remember(query); navigate('/content#podcast') }}>
              <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--brand)', color: '#04282a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>▶</span>
              <span style={{ ...S.title, minWidth: 0 }}>{e.title}</span>
            </button>
          ))}
        </>
      )}

      {results && results.videos.length > 0 && (
        <>
          <div style={S.h}>Videos</div>
          {results.videos.map(v => (
            <button key={v.id} style={S.row} onClick={() => window.open(v.link, '_blank', 'noopener')}>
              <span style={S.icon}>▶️</span>
              <span style={S.title}>{v.title}</span>
            </button>
          ))}
        </>
      )}

      {results && results.stories.length > 0 && (
        <>
          <div style={S.h}>Stories</div>
          {results.stories.map((s, i) => (
            <button key={i} style={S.row} onClick={() => window.open(s.link, '_blank', 'noopener')}>
              <span style={S.icon}>📰</span>
              <span style={S.title}>{s.title}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
