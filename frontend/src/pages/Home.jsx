import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { raceChannelKind, isTeamOnlyChannel, channelDisplayName } from '../lib/channels'
import { isTeamTier } from '../lib/tier'
import { useAudio } from '../lib/audio'
import VideoPlayer from '../components/VideoPlayer'
import StoryReader from '../components/StoryReader'

const FEED_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'post', label: 'Posts' },
  { id: 'episode', label: 'Podcast' },
  { id: 'video', label: 'Videos' },
  { id: 'story', label: 'Stories' },
]

// Home is a ranked feed (TTL's vision, built 2026-10-31): an endless scroll
// that intermixes team forum posts — surfaced by engagement, not just
// recency — with podcast episodes, YouTube uploads, and TTL stories. The
// this-week racing card and your next race stay pinned above the river.
//
// Ranking v1: post score = 3 × reactions + 2 × replies + a recency boost
// that fades over two weeks. Content (episodes/videos/stories) runs newest
// first. The river interleaves two content cards per forum post. Posts come
// from public race discussions for everyone; team channels join the mix
// only for team-entitled viewers, and DMs never appear.

const FEED_BATCH = 8

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

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(iso) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(iso)
}

function postScore(p) {
  const ageH = (Date.now() - new Date(p.created_at)) / 3600e3
  const recency = Math.max(0, 1 - ageH / (24 * 14)) * 2
  return p.reactionCount * 3 + p.replyCount * 2 + recency
}

function buildFeed(content, posts, activity = []) {
  const ranked = [...posts].sort((a, b) => b.score - a.score)
  const out = []
  // Popular discussions lead the river (Zack, 2026-10-31): when the top
  // discussion has real engagement, it opens the feed instead of waiting
  // behind two content cards.
  const top = ranked[0]
  if (top && (top.data.reactionCount + top.data.replyCount) >= 3) out.push(ranked.shift())
  let ci = 0
  let pi = 0
  while (ci < content.length || pi < ranked.length) {
    for (let n = 0; n < 2 && ci < content.length; n++) out.push(content[ci++])
    if (pi < ranked.length) out.push(ranked[pi++])
  }
  applyMixRules(out)
  // Team activity cards (race buzz, just-added races) weave in at fixed
  // early slots so the river feels inhabited even before chat takes off
  // (Zack, 2026-11-01 — "make the feed feel alive").
  const slots = [3, 10, 18]
  activity.slice(0, 3).forEach((item, i) => {
    out.splice(Math.min(slots[i], out.length), 0, item)
  })
  return out
}

// The mix rules (Zack, 2026-11-01): chronology stays the spine, with two
// adjustments so the river breathes —
//  1. Story guarantee: TTL's own editorial voice shouldn't drown under a
//     weekly podcast cadence; the newest story (<45 days old) earns a
//     first-screen seat if chronology buried it deeper than slot 4.
//  2. Diversity: never 3+ cards of the same content kind in a row when a
//     different kind is available within the next few cards to swap in.
function applyMixRules(out) {
  const storyIdx = out.findIndex(i => i.kind === 'story')
  if (storyIdx > 4) {
    const story = out[storyIdx]
    if ((Date.now() - (story.at || 0)) / 864e5 <= 45) {
      out.splice(storyIdx, 1)
      out.splice(4, 0, story)
    }
  }
  const isContent = k => k === 'episode' || k === 'video' || k === 'story'
  let runKind = null
  let runLen = 0
  for (let i = 0; i < out.length; i++) {
    const k = out[i].kind
    if (!isContent(k)) { runKind = null; runLen = 0; continue }
    if (k === runKind) runLen++
    else { runKind = k; runLen = 1 }
    if (runLen >= 3) {
      for (let j = i + 1; j <= Math.min(i + 4, out.length - 1); j++) {
        if (isContent(out[j].kind) && out[j].kind !== runKind) {
          const [swap] = out.splice(j, 1)
          out.splice(i, 0, swap)
          runKind = swap.kind
          runLen = 1
          break
        }
      }
    }
  }
}

// ─── Location-aware serving (Zack, 2026-10-31) ──────────────────────────
// "Say I'm traveling in Arizona, the relevant chats could show in my
// feed, unique for me." Two signals, both computed on-device from the
// member's own position (nothing is stored server-side):
//  1. Race proximity — a discussion/logistics post whose race is within
//     ~320 km gets a strong boost and a "Near you" chip.
//  2. Region match — a regions-channel post whose channel name matches
//     the member's state, city, or regional nickname gets a smaller one.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLa = (lat2 - lat1) * Math.PI / 180
  const dLo = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const REGION_WORDS = {
  Arizona: ['arizona', 'phoenix', 'southwest', 'desert'],
  Oregon: ['oregon', 'portland', 'pnw', 'pacific northwest'],
  Washington: ['washington', 'seattle', 'pnw', 'pacific northwest'],
  California: ['california', 'socal', 'norcal', 'bay area', 'san diego', 'los angeles'],
  Nevada: ['nevada', 'las vegas', 'southwest'],
  Utah: ['utah', 'southwest'],
  Colorado: ['colorado', 'denver', 'mountain'],
  Texas: ['texas', 'austin', 'houston', 'dallas'],
  Florida: ['florida', 'southeast'],
  Georgia: ['georgia', 'atlanta', 'southeast'],
  'North Carolina': ['carolina', 'southeast'],
  'South Carolina': ['carolina', 'southeast'],
  'New York': ['new york', 'northeast', 'new england'],
  Massachusetts: ['massachusetts', 'boston', 'new england', 'northeast'],
  Illinois: ['illinois', 'chicago', 'midwest'],
  Minnesota: ['minnesota', 'midwest'],
  Wisconsin: ['wisconsin', 'midwest'],
  Hawaii: ['hawaii'],
  Idaho: ['idaho', 'pnw', 'pacific northwest'],
  Montana: ['montana', 'mountain'],
}

function geoBoost(post, geo) {
  if (!geo) return null
  const ch = post.data.channel
  const race = ch?.race
  if (race && race.latitude != null && race.longitude != null) {
    const km = haversineKm(geo.lat, geo.lon, race.latitude, race.longitude)
    if (km <= 320) return { boost: 9, label: `Near ${race.city || race.location || 'you'}` }
  }
  if (ch?.category === 'regions' && geo.state) {
    const name = (ch.name || '').toLowerCase()
    const words = [geo.state, geo.city, ...(REGION_WORDS[geo.state] || [])]
      .filter(Boolean).map(w => String(w).toLowerCase())
    if (words.some(w => name.includes(w))) return { boost: 6, label: 'Near you' }
  }
  return null
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
            background: 'rgba(var(--brand-rgb),0.12)', color: 'var(--brand)',
            border: '1px solid rgba(var(--brand-rgb),0.25)',
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
            textTransform: 'uppercase', color: 'var(--brand)',
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
          borderLeft: '2px solid rgba(var(--brand-rgb),0.2)',
          fontSize: '13px', color: '#aaa', lineHeight: 1.8,
        }}>
          {names.join(', ')}
        </div>
      )}
    </div>
  )
}

const F = {
  card: {
    background: '#161616', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px', padding: '1.1rem 1.25rem', marginBottom: '1rem',
    width: '100%', textAlign: 'left', display: 'block',
  },
  chip: (color) => ({
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10px', fontWeight: 700,
    letterSpacing: '1.5px', textTransform: 'uppercase', color,
    border: `1px solid ${color}44`, background: `${color}14`,
    borderRadius: '3px', padding: '2px 7px', whiteSpace: 'nowrap',
  }),
  cardTitle: { fontSize: '16px', fontWeight: 600, color: '#fff', lineHeight: 1.35 },
  meta: { fontSize: '12px', color: '#777', marginTop: '4px' },
  summary: {
    fontSize: '13.5px', color: '#aaa', lineHeight: 1.55, marginTop: '8px',
    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
}

function Avatar({ profile, size = 36 }) {
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  const initials = (profile?.full_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: profile?.avatar_color || 'var(--brand)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Barlow Condensed, sans-serif', fontSize: size * 0.38, fontWeight: 700, color: '#000',
    }}>{initials}</div>
  )
}

// Team activity for the river (Zack, 2026-11-01): real member pulses
// from data that already exists — teammates gathering on near-term
// races, and races newly added to the calendar. Counts only, never
// names, so the cards are safe for every tier. race_entries.created_at
// is not confirmed in the live schema, so the timestamped select falls
// back to a plain one; "entered this week" appears only when the
// timestamps are really there.
async function loadActivityItems(supabase) {
  const today = new Date().toISOString().split('T')[0]
  const in60 = new Date(Date.now() + 60 * 864e5).toISOString().split('T')[0]
  const { data: races } = await supabase.from('races')
    .select('id, name, type, race_date, city, country, created_at')
    .gte('race_date', today).order('race_date').limit(120)
  if (!races?.length) return []
  const items = []
  const near = races.filter(r => r.race_date <= in60)
  if (near.length) {
    const ids = near.map(r => r.id)
    let entries = []
    const withTs = await supabase.from('race_entries').select('race_id, athlete_id, created_at').in('race_id', ids)
    if (!withTs.error) entries = withTs.data || []
    else {
      const plain = await supabase.from('race_entries').select('race_id, athlete_id').in('race_id', ids)
      entries = plain.data || []
    }
    const byRace = new Map()
    for (const e of entries) {
      const g = byRace.get(e.race_id) || { athletes: new Set(), recent: 0 }
      g.athletes.add(e.athlete_id)
      if (e.created_at && Date.now() - new Date(e.created_at).getTime() < 7 * 864e5) g.recent++
      byRace.set(e.race_id, g)
    }
    const buzz = near
      .map(r => ({ race: r, count: byRace.get(r.id)?.athletes.size || 0, recent: byRace.get(r.id)?.recent || 0 }))
      .filter(b => b.count >= 2)
      .sort((a, b) => a.race.race_date.localeCompare(b.race.race_date))
      .slice(0, 2)
    for (const b of buzz) {
      items.push({ kind: 'activity', key: `activity-buzz-${b.race.id}`, at: Date.now(), data: { activityType: 'buzz', ...b } })
    }
  }
  const fresh = races
    .filter(r => r.created_at && Date.now() - new Date(r.created_at).getTime() < 14 * 864e5)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
  if (fresh) {
    items.push({ kind: 'activity', key: `activity-new-${fresh.id}`, at: Date.now(), data: { activityType: 'newrace', race: fresh } })
  }
  return items
}

async function loadFeedPosts(team, userId) {
  const { data: chans } = await supabase.from('channels').select('id, name, type, category, audience, race_id')
  if (!chans) return []
  const byId = {}
  const allowed = []
  for (const ch of chans) {
    if (ch.type === 'dm') continue
    const isDiscussion = raceChannelKind(ch) === 'discussion'
    if (isDiscussion || (team && isTeamOnlyChannel(ch))) {
      allowed.push(ch.id)
      byId[ch.id] = { ...ch, feedKind: isDiscussion ? 'discussion' : 'team' }
    }
  }
  if (!allowed.length) return []

  // Race embeds (DESIGN-SPEC §2.2): a post in a race channel carries its
  // race with it, so the card can show the race and link through to it.
  const raceIds = [...new Set(allowed.map(id => byId[id].race_id).filter(Boolean))]
  if (raceIds.length) {
    const { data: raceRows } = await supabase.from('races')
      .select('id, name, race_date, location, city, latitude, longitude').in('id', raceIds)
    const raceById = Object.fromEntries((raceRows || []).map(r => [r.id, r]))
    for (const id of allowed) {
      if (byId[id].race_id) byId[id].race = raceById[byId[id].race_id] || null
    }
  }

  let msgs = []
  let cursor = null
  for (let page = 0; page < 3; page++) {
    let q = supabase.from('messages')
      .select('id, content, image_url, created_at, athlete_id, channel_id, profiles(full_name, avatar_color, avatar_url)')
      .in('channel_id', allowed)
      .order('created_at', { ascending: false })
      .limit(40)
    if (cursor) q = q.lt('created_at', cursor)
    const { data } = await q
    if (!data?.length) break
    msgs = msgs.concat(data)
    cursor = data[data.length - 1].created_at
    if (data.length < 40) break
  }
  msgs = msgs.filter(m => (m.content && m.content.trim().length > 1) || m.image_url)
  if (!msgs.length) return []

  const ids = msgs.map(m => m.id)
  const [{ data: reactions }, { data: replies }] = await Promise.all([
    supabase.from('message_reactions').select('message_id, emoji, athlete_id').in('message_id', ids),
    supabase.from('messages').select('reply_to').in('reply_to', ids),
  ])
  const rCount = {}
  const emojiCounts = {}
  const myHearts = new Set()
  for (const r of reactions || []) {
    rCount[r.message_id] = (rCount[r.message_id] || 0) + 1
    if (r.emoji) {
      emojiCounts[r.message_id] = emojiCounts[r.message_id] || {}
      emojiCounts[r.message_id][r.emoji] = (emojiCounts[r.message_id][r.emoji] || 0) + 1
    }
    if (r.emoji === '❤️' && r.athlete_id === userId) myHearts.add(r.message_id)
  }
  const repCount = {}
  for (const r of replies || []) repCount[r.reply_to] = (repCount[r.reply_to] || 0) + 1

  return msgs.map(m => {
    const emojis = emojiCounts[m.id] || {}
    const topEmoji = Object.entries(emojis).sort((a, b) => b[1] - a[1])[0]?.[0] || '❤️'
    const data = {
      ...m,
      channel: byId[m.channel_id],
      reactionCount: rCount[m.id] || 0,
      topEmoji,
      myHeart: myHearts.has(m.id),
      replyCount: repCount[m.id] || 0,
    }
    return { kind: 'post', key: `post-${m.id}`, at: new Date(m.created_at).getTime(), data, score: postScore(data) }
  })
}

export default function Home({ session, profile }) {
  const [weekRaces, setWeekRaces] = useState([])
  const [nextRace, setNextRace] = useState(null)
  const [myProfile, setMyProfile] = useState(null)
  const [feed, setFeed] = useState([])
  const [hero, setHero] = useState(null)
  // Location-aware serving: raw feed inputs are kept so the river can be
  // re-ranked when the member's position resolves (or is enabled).
  const [feedSource, setFeedSource] = useState(null)
  const [geo, setGeo] = useState(null)
  const [geoPrompt, setGeoPrompt] = useState(false)
  const [nearCount, setNearCount] = useState(0)
  const [filter, setFilter] = useState('all')
  const [archiveMeta, setArchiveMeta] = useState(null)
  const [playingVideo, setPlayingVideo] = useState(null)
  const [readingStory, setReadingStory] = useState(null)
  const filterBarRef = useRef(null)
  const barHiddenRef = useRef(false)
  const lastScrollByTarget = useRef(new Map())
  const [visibleCount, setVisibleCount] = useState(FEED_BATCH)
  const [loading, setLoading] = useState(true)
  const sentinelRef = useRef(null)
  const navigate = useNavigate()
  const audio = useAudio()
  const team = isTeamTier(profile)

  // Reload when the tier flips (profile arrives after mount, or the demo
  // switch is flipped) so team channels join/leave the post mix correctly.
  useEffect(() => { loadAll() }, [team])

  // Filter bar behaviour: hide on scroll down, reappear on scroll up
  // (always visible near the top). Performance rules learned from the
  // first version's jank: NEVER animate layout (the old margin collapse
  // pumped the whole feed), NEVER setState from a scroll handler (every
  // flip re-rendered the feed mid-scroll), no backdrop blur. The bar is
  // a zero-flow-height overlay; the handler writes transform/opacity
  // straight to its DOM node, rAF-throttled — compositor-only motion.
  useEffect(() => {
    let raf = 0
    function apply(hidden) {
      if (barHiddenRef.current === hidden) return
      barHiddenRef.current = hidden
      const el = filterBarRef.current
      if (!el) return
      el.style.transform = hidden ? 'translateY(-130%)' : 'translateY(0)'
      el.style.opacity = hidden ? '0' : '1'
    }
    function onScroll(e) {
      const t = e.target
      const y = t === document
        ? (document.scrollingElement?.scrollTop ?? window.scrollY)
        : t?.scrollTop
      if (typeof y !== 'number') return
      const last = lastScrollByTarget.current.get(t) ?? 0
      lastScrollByTarget.current.set(t, y)
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (y < 60) apply(false)
        else if (y > last + 6) apply(true)
        else if (y < last - 6) apply(false)
      })
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        setVisibleCount(c => Math.min(c + FEED_BATCH, feed.length))
      }
    }, { rootMargin: '600px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [feed.length, filter])

  async function ensureProfile() {
    const userId = session.user.id
    const { data: existing } = await supabase.from('profiles').select('id').eq('id', userId).single()
    if (!existing) {
      const email = session.user.email
      const fullName = session.user.user_metadata?.full_name || email.split('@')[0]
      await supabase.from('profiles').insert({ id: userId, full_name: fullName, email, role: 'athlete' })
    }
  }

  async function loadAll() {
    const { start, end } = getWeekRange()
    const userId = session.user.id
    const todayStr = new Date().toISOString().split('T')[0]
    const [racesRes, profileRes] = await Promise.all([
      supabase
        .from('races')
        .select('*, race_entries(athlete_id, profiles(full_name, id))')
        .gte('race_date', start)
        .lte('race_date', end)
        .order('race_date'),
      supabase.from('profiles').select('*').eq('id', userId).single(),
      ensureProfile(),
    ])
    if (racesRes.data) setWeekRaces(racesRes.data.filter(r => r.race_entries?.length > 0))
    if (profileRes.data) setMyProfile(profileRes.data)

    try {
      const { data: myEntries } = await supabase.from('race_entries').select('race_id').eq('athlete_id', userId)
      const ids = (myEntries || []).map(e => e.race_id)
      if (ids.length > 0) {
        const { data: mine } = await supabase.from('races').select('*')
          .in('id', ids).gte('race_date', todayStr).order('race_date').limit(1)
        if (mine?.length) setNextRace(mine[0])
      }
    } catch { /* pinned card only */ }

    // The river: content feeds + ranked forum posts, best-effort per source.
    let content = []
    try {
      const res = await fetch('/api/content/feeds')
      const data = await res.json()
      const toItem = (kind, d) => ({
        kind, key: `${kind}-${d.id || d.link || d.title}`,
        at: d.published ? new Date(d.published).getTime() || 0 : 0, data: d,
      })
      content = [
        ...(data.episodes || []).map(d => toItem('episode', d)),
        ...(data.videos || []).map(d => toItem('video', d)),
        ...(data.stories || []).map(d => toItem('story', d)),
      ].sort((a, b) => b.at - a.at)
      setArchiveMeta({
        episodesTotal: data.episodesTotal ?? (data.episodes || []).length,
        videosTotal: (data.videos || []).length,
        storiesTotal: data.storiesTotal ?? (data.stories || []).length,
      })
    } catch { /* feed still runs on posts alone */ }

    let posts = []
    try { posts = await loadFeedPosts(team, userId) } catch { /* feed still runs on content alone */ }

    let activity = []
    try { activity = await loadActivityItems(supabase) } catch { /* dressing only */ }

    // Hero slot (DESIGN-SPEC §5): the newest story/video with artwork
    // headlines the river and is pulled out of the interleave.
    const heroItem = content.find(c => (c.kind === 'story' || c.kind === 'video') && c.data.image) || null
    setHero(heroItem)
    setFeedSource({ content, posts, activity })
    setLoading(false)
  }

  // Re-rank the river whenever the inputs or the member's position change:
  // geo-boosted posts rise by score, exactly like engagement does.
  useEffect(() => {
    if (!feedSource) return
    let near = 0
    const boosted = feedSource.posts.map(p => {
      const hit = geoBoost(p, geo)
      if (!hit) return p
      near++
      return { ...p, score: p.score + hit.boost, data: { ...p.data, nearLabel: hit.label } }
    })
    setNearCount(near)
    setFeed(buildFeed(feedSource.content, boosted, feedSource.activity || []).filter(i => !hero || i.key !== hero.key))
  }, [feedSource, geo, hero])

  // Location: if permission is already granted, resolve silently; if it
  // has never been asked, offer the opt-in row (never a surprise prompt);
  // if denied, stay quiet. Position stays on-device — the reverse
  // geocode only labels it.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!('geolocation' in navigator)) return
      try {
        const perm = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null)
        if (cancelled) return
        if (perm?.state === 'granted') requestGeo()
        else if (!perm || perm.state === 'prompt') setGeoPrompt(true)
      } catch { if (!cancelled) setGeoPrompt(true) }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function requestGeo() {
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords
      let city = null
      let state = null
      try {
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`)
        const j = await r.json()
        city = j.city || j.locality || null
        state = j.principalSubdivision || null
      } catch { /* coordinates alone still power race proximity */ }
      setGeo({ lat: latitude, lon: longitude, city, state })
      setGeoPrompt(false)
    }, () => setGeoPrompt(false), { timeout: 8000, maximumAge: 3600e3 })
  }

  // Live reaction from the feed (DESIGN-SPEC §5): a real write to
  // message_reactions, optimistically reflected on the card.
  async function toggleHeart(item) {
    const m = item.data
    const next = !m.myHeart
    setFeed(prev => prev.map(i => i.key === item.key
      ? { ...i, data: { ...i.data, myHeart: next, reactionCount: Math.max(0, i.data.reactionCount + (next ? 1 : -1)) } }
      : i))
    if (next) {
      await supabase.from('message_reactions').insert({ message_id: m.id, athlete_id: session.user.id, emoji: '❤️' })
    } else {
      await supabase.from('message_reactions').delete()
        .eq('message_id', m.id).eq('athlete_id', session.user.id).eq('emoji', '❤️')
    }
  }

  const totalRacers = [...new Set(weekRaces.flatMap(r => r.race_entries.map(e => e.athlete_id)))].length
  const pillBtn = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    fontFamily: 'Barlow, sans-serif', fontSize: '13px', fontWeight: 600,
    color: active ? 'var(--accent)' : '#aaa',
    background: active ? 'rgba(var(--accent-rgb),0.12)' : 'rgba(255,255,255,0.05)',
    border: `1px solid ${active ? 'rgba(var(--accent-rgb),0.4)' : 'rgba(255,255,255,0.09)'}`,
    borderRadius: '999px', padding: '6px 13px', cursor: 'pointer',
  })

  function renderPost(item) {
    const m = item.data
    const ch = m.channel
    const race = ch?.race
    return (
      <div key={item.key} onClick={() => navigate(`/messages?channel=${m.channel_id}`)} style={{ ...F.card, cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <Avatar profile={m.profiles} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{m.profiles?.full_name || 'Teammate'}</div>
            <div style={{ fontSize: '12px', color: '#777' }}>{timeAgo(m.created_at)}</div>
          </div>
          {ch && (
            <span style={F.chip(ch.feedKind === 'discussion' ? 'var(--brand)' : 'var(--highlight)')}>
              {channelDisplayName(ch)}
            </span>
          )}
          {m.nearLabel && <span style={F.chip('var(--accent)')}>📍 Near you</span>}
          {(m.reactionCount + m.replyCount) >= 5 && <span style={F.chip('var(--highlight)')}>🔥 Popular</span>}
        </div>
        {m.content && (
          <div style={{ ...F.summary, WebkitLineClamp: 5, marginTop: 0, fontSize: '14.5px', color: '#ddd' }}>
            {m.content}
          </div>
        )}
        {m.image_url && (
          <img src={m.image_url} alt="" loading="lazy" style={{ width: '100%', borderRadius: '10px', marginTop: m.content ? '10px' : 0, display: 'block' }} />
        )}
        {race && (
          <button
            onClick={e => { e.stopPropagation(); navigate('/races') }}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left',
              marginTop: '12px', padding: '10px 12px', cursor: 'pointer',
              background: 'rgba(var(--brand-rgb),0.07)', border: '1px solid rgba(var(--brand-rgb),0.25)',
              borderRadius: '10px',
            }}
          >
            <span style={{ fontSize: '18px' }}>🏁</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 600, color: '#fff' }}>{race.name}</span>
              <span style={{ display: 'block', fontSize: '12px', color: '#999' }}>{fmtDate(race.race_date)} · {race.location}</span>
            </span>
            <span style={{ color: 'var(--brand)', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase' }}>View race →</span>
          </button>
        )}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' }}>
          <button
            style={pillBtn(m.myHeart)}
            onClick={e => { e.stopPropagation(); toggleHeart(item) }}
            aria-label={m.myHeart ? 'Remove your reaction' : 'React with a heart'}
          >
            {m.topEmoji} {m.reactionCount}
          </button>
          <span style={pillBtn(false)}>
            💬 {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--brand)', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '1px', textTransform: 'uppercase', fontSize: '11px' }}>
            {ch?.feedKind === 'discussion' ? 'Race discussion' : 'Team channel'}
          </span>
        </div>
      </div>
    )
  }

  function renderEpisode(item) {
    const ep = item.data
    const isCurrent = audio.current?.audio === ep.audio
    return (
      <div key={item.key} style={F.card}>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
          {ep.image
            ? <img src={ep.image} alt="" loading="lazy" style={{ width: '64px', height: '64px', borderRadius: '10px', objectFit: 'cover', flexShrink: 0 }} />
            : <div style={{ width: '64px', height: '64px', borderRadius: '10px', background: 'rgba(var(--brand-rgb),0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: 0 }}>🎧</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '5px' }}>
              <span style={F.chip('var(--brand)')}>Podcast</span>
              <span style={{ fontSize: '12px', color: '#777' }}>{timeAgo(ep.published)}{ep.duration ? ` · ${ep.duration}` : ''}</span>
            </div>
            <div style={F.cardTitle}>{ep.title}</div>
            {ep.summary && <div style={F.summary}>{ep.summary}</div>}
          </div>
          <button
            onClick={() => audio.playEpisode(ep)} aria-label={isCurrent && audio.playing ? 'Pause' : 'Play'}
            style={{
              width: '46px', height: '46px', borderRadius: '50%', flexShrink: 0, alignSelf: 'center',
              background: 'var(--brand)', border: 'none',
              color: '#06282a', fontSize: '16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 18px rgba(var(--brand-rgb),0.35)',
            }}
          >
            {isCurrent && audio.playing ? '❚❚' : '▶'}
          </button>
        </div>
      </div>
    )
  }

  function renderVideo(item) {
    const v = item.data
    return (
      <button key={item.key} onClick={() => setPlayingVideo(v)} style={{ ...F.card, cursor: 'pointer', padding: 0, overflow: 'hidden' }}>
        {v.image && (
          <div style={{ position: 'relative' }}>
            <img src={v.image} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              width: '52px', height: '52px', borderRadius: '50%',
              background: 'rgba(0,0,0,0.62)', color: '#fff', fontSize: '18px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>▶</div>
          </div>
        )}
        <div style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '5px' }}>
            <span style={F.chip('var(--accent)')}>YouTube</span>
            <span style={{ fontSize: '12px', color: '#777' }}>{v.age || fmtDate(v.published)}{v.views ? ` · ${v.views}` : ''}</span>
          </div>
          <div style={F.cardTitle}>{v.title}</div>
        </div>
      </button>
    )
  }

  function renderStory(item) {
    const st = item.data
    return (
      <button key={item.key} onClick={() => setReadingStory(st)} style={{ ...F.card, cursor: 'pointer', padding: 0, overflow: 'hidden' }}>
        {st.image && <img src={st.image} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '16/8', objectFit: 'cover', display: 'block' }} />}
        <div style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '5px' }}>
            <span style={F.chip('var(--highlight)')}>Story</span>
            <span style={{ fontSize: '12px', color: '#777' }}>{timeAgo(st.published)}</span>
          </div>
          <div style={F.cardTitle}>{st.title}</div>
          {st.summary && <div style={F.summary}>{st.summary}</div>}
        </div>
      </button>
    )
  }

  // Hero card: full-bleed artwork, gradient scrim, headline type.
  function renderHero(item) {
    const d = item.data
    const isVideo = item.kind === 'video'
    return (
      <button
        onClick={() => { if (isVideo) setPlayingVideo(d); else setReadingStory(d) }}
        style={{
          position: 'relative', width: '100%', textAlign: 'left', cursor: 'pointer',
          borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)',
          padding: 0, marginBottom: '1rem', display: 'block', background: '#161616',
        }}
      >
        <img src={d.image} alt="" style={{ width: '100%', aspectRatio: '16/9.5', objectFit: 'cover', display: 'block' }} />
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,0) 34%, rgba(5,8,10,0.88) 82%)',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          padding: '1.1rem 1.25rem',
        }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '7px' }}>
            <span style={F.chip(isVideo ? 'var(--accent)' : 'var(--highlight)')}>{isVideo ? '▶ YouTube' : 'Top story'}</span>
            <span style={{ fontSize: '12px', color: '#cfd4da' }}>{isVideo ? (d.age || '') : fmtDate(d.published)}</span>
          </div>
          <div style={{
            fontFamily: 'Barlow Condensed, sans-serif', fontSize: '27px', fontWeight: 800,
            letterSpacing: '0.5px', lineHeight: 1.12, color: '#fff',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {d.title}
          </div>
        </div>
      </button>
    )
  }

  // Team activity cards: slim, warm, one line of life from the roster —
  // "N TTLers racing X" or a race that just landed on the calendar.
  function renderActivity(item) {
    const d = item.data
    const race = d.race
    const where = [race.city, race.country].filter(Boolean).join(', ')
    const isBuzz = d.activityType === 'buzz'
    return (
      <button key={item.key} onClick={() => navigate('/races')} style={{ ...F.card, cursor: 'pointer', display: 'flex', gap: '13px', alignItems: 'center' }}>
        <div style={{
          width: '44px', height: '44px', borderRadius: '50%', flexShrink: 0,
          background: isBuzz ? 'rgba(var(--brand-rgb),0.16)' : 'rgba(var(--highlight-rgb),0.16)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '19px',
        }}>{isBuzz ? '🏁' : '🗓️'}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '3px' }}>
            <span style={F.chip(isBuzz ? 'var(--brand)' : 'var(--highlight)')}>{isBuzz ? 'Team activity' : 'Just added'}</span>
            {isBuzz && d.recent > 0 && <span style={{ fontSize: '12px', color: 'var(--brand)' }}>{d.recent} entered this week</span>}
          </div>
          <div style={F.cardTitle}>{race.name}</div>
          <div style={F.meta}>
            {isBuzz ? `${d.count} TTLers racing · ` : ''}{fmtDate(race.race_date)}{where ? ` · ${where}` : ''}
          </div>
        </div>
      </button>
    )
  }

  function renderItem(item) {
    if (item.kind === 'post') return renderPost(item)
    if (item.kind === 'episode') return renderEpisode(item)
    if (item.kind === 'video') return renderVideo(item)
    if (item.kind === 'activity') return renderActivity(item)
    return renderStory(item)
  }

  if (loading) return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '2rem 1.25rem' }}>
      <style>{`@keyframes ttlPulse { 0%,100% { opacity: .45 } 50% { opacity: .9 } }`}</style>
      <div style={{ height: '54px', width: '55%', borderRadius: '10px', background: '#1b1b1b', animation: 'ttlPulse 1.3s ease-in-out infinite', marginBottom: '1.5rem' }} />
      {[0, 1, 2].map(i => (
        <div key={i} style={{ height: i === 0 ? '210px' : '120px', borderRadius: '16px', background: '#161616', border: '1px solid rgba(255,255,255,0.05)', animation: `ttlPulse 1.3s ease-in-out ${i * 0.15}s infinite`, marginBottom: '1rem' }} />
      ))}
    </div>
  )

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '0.6rem 1.25rem 2rem' }}>
      {/* Pinned: this week's racing */}
      {weekRaces.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(var(--brand-rgb),0.06) 0%, rgba(var(--accent-rgb),0.06) 100%)',
          border: '1px solid rgba(var(--brand-rgb),0.2)',
          borderRadius: '12px', padding: '1.4rem 1.5rem',
          marginBottom: '1rem', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
            background: 'linear-gradient(90deg, var(--brand), var(--accent), var(--highlight), var(--accent))',
          }} />
          <div style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontSize: '12px', letterSpacing: '3px',
            textTransform: 'uppercase', color: 'var(--brand)', marginBottom: '8px',
          }}>
            This week
          </div>
          <div style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontSize: '24px', fontWeight: 800,
            letterSpacing: '1px', color: '#fff',
            lineHeight: 1.2, marginBottom: '12px',
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
      )}

      {/* Pinned: your next race */}
      {nextRace && (() => {
        const days = Math.ceil((new Date(nextRace.race_date + 'T12:00:00') - new Date()) / 86400000)
        return (
          <button onClick={() => navigate('/races')} style={{
            display: 'flex', alignItems: 'center', gap: '16px', width: '100%', textAlign: 'left',
            background: '#161616', border: '1px solid rgba(var(--accent-rgb),0.3)', borderRadius: '10px',
            padding: '1.1rem 1.4rem', marginBottom: '1rem', cursor: 'pointer',
          }}>
            <div style={{ fontSize: '26px', flexShrink: 0 }}>🏁</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '3px' }}>
                Your next race{days >= 0 ? ` — ${days === 0 ? 'today!' : `in ${days} day${days === 1 ? '' : 's'}`}` : ''}
              </div>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '18px', fontWeight: 700, letterSpacing: '1px', color: '#fff' }}>{nextRace.name}</div>
              <div style={{ fontSize: '13px', color: '#aaa' }}>{getDayName(nextRace.race_date)} · {nextRace.location}</div>
            </div>
            <div style={{ color: '#555', fontSize: '20px', flexShrink: 0 }}>→</div>
          </button>
        )
      })()}

      {/* The "Your feed" heading is gone (Zack, 2026-10-31: the page IS
          the Feed now — the label was redundant). This slot carries only
          live context: a location line when geo serving found something
          near the member, or the one-time location opt-in. */}
      {geo && nearCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0.85rem 0 0.2rem', fontSize: '13px', color: '#bbb' }}>
          <span>📍</span>
          <span>Near <b style={{ color: '#fff' }}>{geo.city ? `${geo.city}${geo.state ? `, ${geo.state}` : ''}` : 'you'}</b> — local races &amp; chats floated to the top of your feed</span>
        </div>
      )}
      {!geo && geoPrompt && (
        <button onClick={requestGeo} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', margin: '0.85rem 0 0.2rem', padding: '10px 14px', background: 'rgba(var(--accent-rgb),0.07)', border: '1px solid rgba(var(--accent-rgb),0.25)', borderRadius: '12px', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ fontSize: '15px' }}>📍</span>
          <span style={{ flex: 1, fontSize: '13px', color: '#ccc' }}>Traveling? Float races &amp; chats near you to the top</span>
          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11.5px', fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--accent)' }}>Enable location</span>
        </button>
      )}

      {/* Filter chips — one lens across every source. A sticky overlay:
          fixed height with an equal negative bottom margin, so it takes
          zero flow space (the spacer below holds its at-rest slot) and
          hiding it is pure transform — the feed never reflows. The
          scroll handler drives it via ref, never via React state. */}
      <div ref={filterBarRef} style={{
        position: 'sticky', top: 0, zIndex: 50,
        height: '52px', margin: '0 -1.25rem -52px',
        padding: '0 1.25rem',
        display: 'flex', alignItems: 'center',
        background: 'rgba(13,13,13,0.97)',
        transform: 'translateY(0)', opacity: 1,
        transition: 'transform 0.25s ease, opacity 0.2s ease',
        willChange: 'transform',
      }}>
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {FEED_FILTERS.map(f => {
          const active = filter === f.id
          return (
            <button
              key={f.id}
              onClick={() => { setFilter(f.id); setVisibleCount(FEED_BATCH) }}
              style={{
                fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 600,
                letterSpacing: '1.5px', textTransform: 'uppercase', whiteSpace: 'nowrap',
                padding: '8px 16px', borderRadius: '999px', cursor: 'pointer',
                border: `1px solid ${active ? 'rgba(var(--brand-rgb),0.55)' : 'rgba(255,255,255,0.12)'}`,
                background: active ? 'rgba(var(--brand-rgb),0.14)' : '#161616',
                color: active ? 'var(--brand)' : '#888', transition: 'all 0.15s',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>
      </div>
      {/* Spacer: holds the filter bar's at-rest slot in the flow. */}
      <div style={{ height: '52px', marginBottom: '0.35rem' }} />

      {filter === 'all' && hero && renderHero(hero)}

      {(() => {
        const visibleFeed = filter === 'all'
          ? feed
          : filter === 'post'
            // The Posts lens is the popular-discussions view: pure
            // engagement order, no interleave.
            ? feed.filter(i => i.kind === 'post').sort((a, b) => b.score - a.score)
            : feed.filter(i => i.kind === filter)
        if (visibleFeed.length === 0) {
          return (
            <div style={{
              background: '#161616', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '12px', padding: '2.5rem', textAlign: 'center',
              fontSize: '14px', color: '#999',
            }}>
              {feed.length === 0
                ? 'Nothing here yet — posts from race discussions and new TTL content will land in this feed.'
                : 'Nothing in this slice right now — try another filter.'}
            </div>
          )
        }
        const archiveTarget = filter === 'episode'
          ? { hash: 'podcast', label: `Browse all ${archiveMeta?.episodesTotal ?? ''} episodes in the archive` }
          : filter === 'video'
            ? { hash: 'videos', label: `Browse all ${archiveMeta?.videosTotal ?? ''} videos in the archive` }
            : filter === 'story'
              ? { hash: 'stories', label: `Browse all ${archiveMeta?.storiesTotal ?? ''} stories in the archive` }
              : null
        return (
          <>
            {visibleFeed.slice(0, visibleCount).map(renderItem)}
            <div ref={sentinelRef} style={{ height: '1px' }} />
            {/* Archive entry: a slim link at the very end of a filtered
                list — depth is offered once the recent stuff runs out,
                never as a banner above the content. */}
            {archiveTarget && visibleCount >= visibleFeed.length && (
              <button
                onClick={() => navigate(`/content#${archiveTarget.hash}`)}
                style={{
                  display: 'block', width: '100%', textAlign: 'center',
                  background: 'none', border: 'none',
                  borderTop: '1px solid rgba(255,255,255,0.07)',
                  padding: '18px 0 2px', marginTop: '8px', cursor: 'pointer',
                  color: 'var(--brand)',
                  fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13.5px',
                  fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
                }}
              >
                {archiveTarget.label} →
              </button>
            )}
            <div style={{
              textAlign: 'center', padding: '1.5rem 0 0.5rem',
              fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px',
              letterSpacing: '2px', textTransform: 'uppercase', color: '#555',
            }}>
              {visibleCount < visibleFeed.length ? 'Loading more…' : "You're all caught up 🏁"}
            </div>
          </>
        )
      })()}
      <VideoPlayer video={playingVideo} onClose={() => setPlayingVideo(null)} />
      <StoryReader story={readingStory} onClose={() => setReadingStory(null)} />
    </div>
  )
}
