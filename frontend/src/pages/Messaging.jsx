import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isTeamTier } from '../lib/tier'
import { channelAccessLabel, channelDisplayName, isRaceChannel, isTeamOnlyChannel, raceChannelKind } from '../lib/channels'
import TeamLocked from '../components/TeamLocked'
import { moderateOutgoing, shouldHide } from '../lib/moderation'
import { pageCacheGet, pageCacheSet } from '../lib/pageCache'
import MemberChips from '../components/MemberChips'
import { openMember } from '../lib/memberView'
import { track } from '../lib/track'
import { readsMap, dmTickState, seenByProfiles } from '../lib/receipts'
import { getDraft, setDraft, clearDraft } from '../lib/drafts'
import { subscribeOnline, getOnline } from '../lib/presence'
import { outboxAdd, outboxRemove, outboxBump, outboxForChannel } from '../lib/outbox'
import { extractFirstUrl, formatDuration, mediaPathFor, audioExtForMime, pickAudioMime, compressImageFile, AUDIO_MIME_CANDIDATES, VOICE_NOTE_MAX_S } from '../lib/media'

const MENU_ROW_STYLE = { display: 'flex', width: '100%', padding: '13px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'Barlow, sans-serif', fontSize: '15px', color: '#eee' }

// Given a DM channel (with dm_members hydrated), return the other person's profile
function dmOtherProfile(channel, userId) {
  return channel.dm_members?.find(m => m.id !== userId) || null
}

const MEMBER_COLORS = ['var(--brand)','var(--accent)','var(--highlight)','var(--accent)','#a78bfa','#34d399','#f472b6','#60a5fa']
const QUICK_EMOJIS = ['👍','💪','🔥','🤘','🏁','❤️','🎉','😮']
const ALL_EMOJIS = ['😀','😂','🥹','😍','🤩','😎','🥳','🤔','😮','💪','🔥','❤️','👍','🎉','🏆','🤘','🏁','🏊','🚴','🏃','⚡','💯','🙌','👏']

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function Avatar({ profile, size = 32, idx = 0 }) {
  const name = profile?.full_name || 'Athlete'
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const color = profile?.avatar_color || MEMBER_COLORS[idx % MEMBER_COLORS.length]
  if (profile?.avatar_url) return <img src={profile.avatar_url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  return <div style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontSize: size * 0.38, fontWeight: 700, color: '#000', flexShrink: 0 }}>{initials}</div>
}

// Render message content with @mentions highlighted and URLs as
// links (M3 — links pair with the LinkPreview card under the bubble).
function MessageContent({ content, currentUserId, profiles }) {
  if (!content) return null
  const urlParts = content.split(/(https?:\/\/[^\s<>"')\]]+)/g)
  return (
    <span>
      {urlParts.map((part, i) => {
        if (/^https?:\/\//.test(part)) {
          const href = part.replace(/[.,!?;:]+$/, '')
          const trail = part.slice(href.length)
          return (
            <span key={i}>
              <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', textDecoration: 'underline', wordBreak: 'break-all' }}>{href}</a>
              {trail}
            </span>
          )
        }
        const parts = part.split(/(@\w[\w\s]*)/g)
        return (
          <span key={i}>
            {parts.map((sub, j) => {
              if (sub.startsWith('@')) {
                const name = sub.slice(1).trim()
                const mentioned = profiles?.find(p => p.full_name?.toLowerCase() === name.toLowerCase())
                const isMe = mentioned?.id === currentUserId
                return (
                  <span key={j} style={{
                    background: isMe ? 'rgba(var(--accent-rgb),0.2)' : 'rgba(var(--brand-rgb),0.15)',
                    color: isMe ? 'var(--accent)' : 'var(--brand)',
                    borderRadius: '3px', padding: '0 3px',
                    fontWeight: 600,
                  }}>{sub}</span>
                )
              }
              return <span key={j}>{sub}</span>
            })}
          </span>
        )
      })}
    </span>
  )
}

// ─── LinkPreview — Open Graph card for the first URL in a message ────
// Fetched via /api/unfurl (server-side; browsers hit CORS). Cached per
// URL for the session; renders nothing until a real card comes back.
const linkPreviewCache = new Map()
function LinkPreview({ text }) {
  const url = extractFirstUrl(text)
  const [data, setData] = useState(() => (url ? linkPreviewCache.get(url) : null) || null)
  useEffect(() => {
    if (!url) return
    if (linkPreviewCache.has(url)) { setData(linkPreviewCache.get(url)); return }
    let cancelled = false
    fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (cancelled) return
        const d = j && (j.title || j.image) ? j : null
        linkPreviewCache.set(url, d)
        setData(d)
      })
      .catch(() => { linkPreviewCache.set(url, null) })
    return () => { cancelled = true }
  }, [url])
  if (!url || !data) return null
  let host = ''
  try { host = new URL(data.url || url).hostname.replace(/^www\./, '') } catch { host = '' }
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', gap: '10px', marginTop: '6px', background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.09)', borderLeft: '3px solid var(--brand)', borderRadius: '8px', padding: '8px', textDecoration: 'none', maxWidth: '320px' }}>
      {data.image && <img src={data.image} alt="" style={{ width: '52px', height: '52px', borderRadius: '6px', objectFit: 'cover', flexShrink: 0 }} onError={e => { e.currentTarget.style.display = 'none' }} />}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#eee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.title || host}</span>
        {data.description && <span style={{ fontSize: '12px', color: '#999', lineHeight: 1.4, marginTop: '2px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{data.description}</span>}
        <span style={{ display: 'block', fontSize: '10.5px', color: '#666', marginTop: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{data.siteName || host}</span>
      </span>
    </a>
  )
}

// ─── VoiceNotePlayer — waveform-lite player for audio messages ───────
// Deterministic bar pattern (seeded by duration) with a progress fill;
// tap the bars to seek. The audio element stays mounted per bubble.
const VOICE_BARS = Array.from({ length: 30 }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7) * 0.7 + Math.sin(i * 0.6) * 0.3))
function VoiceNotePlayer({ src, durationS, own }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [dur, setDur] = useState(durationS || 0)

  function toggle() {
    const a = audioRef.current
    if (!a || !src) return
    if (playing) a.pause()
    else a.play().catch(() => {})
  }

  function seek(e) {
    const a = audioRef.current
    if (!a || !dur) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    a.currentTime = ratio * dur
    setProgress(ratio)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', minWidth: '210px', maxWidth: '280px' }}>
      <audio ref={audioRef} src={src || undefined} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        onTimeUpdate={() => { const a = audioRef.current; if (a && a.duration) setProgress(a.currentTime / a.duration) }}
        onLoadedMetadata={() => { const a = audioRef.current; if (a && a.duration && isFinite(a.duration)) setDur(a.duration) }} />
      <button onClick={toggle} disabled={!src} aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        style={{ width: '36px', height: '36px', borderRadius: '50%', border: 'none', flexShrink: 0, cursor: src ? 'pointer' : 'default', background: own ? '#03292b' : 'var(--brand)', color: own ? 'var(--brand)' : '#03292b', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: src ? 1 : 0.5 }}>
        {playing ? '⏸' : '▶'}
      </button>
      <div onClick={seek} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '2px', height: '30px', cursor: dur ? 'pointer' : 'default' }}>
        {VOICE_BARS.map((h, i) => (
          <div key={i} style={{ flex: 1, height: `${Math.round(h * 100)}%`, minHeight: '4px', borderRadius: '2px', background: (i / VOICE_BARS.length) <= progress ? 'var(--brand)' : 'rgba(255,255,255,0.28)' }} />
        ))}
      </div>
      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', fontFamily: 'Barlow Condensed, sans-serif', minWidth: '30px' }}>
        {src ? formatDuration(progress > 0 && dur ? progress * dur : dur) : '…'}
      </span>
    </div>
  )
}

export default function Messaging({ session, profile, onReadChannel }) {
  // Stale-while-revalidate (see lib/pageCache): the chat list renders
  // from the last visit instantly; loadChannels refreshes behind it.
  const cachedMsg = pageCacheGet('msg')
  const [channels, setChannels] = useState(() => cachedMsg?.channels || [])
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [unreadCounts, setUnreadCounts] = useState(() => cachedMsg?.unreadCounts || {})
  const [mentionCount, setMentionCount] = useState(() => cachedMsg?.mentionCount || 0)
  const [showSidebar, setShowSidebar] = useState(true)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 680)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showMentions, setShowMentions] = useState(false)
  const [sideFilter, setSideFilter] = useState('all') // sidebar category chips
  const [dmChannels, setDmChannels] = useState(() => cachedMsg?.dmChannels || [])
  const [showNewDm, setShowNewDm] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  // M2b — per-user channel state (pin/mute/archive), menus, starred
  // view, archived view, and search jump-to highlight.
  const [channelState, setChannelState] = useState(() => cachedMsg?.channelState || {})
  const [menuFor, setMenuFor] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [showStarred, setShowStarred] = useState(false)
  const [highlightFor, setHighlightFor] = useState(null)
  const [lockedChannel, setLockedChannel] = useState(null)
  const [loading, setLoading] = useState(() => !cachedMsg)
  const [searchParams] = useSearchParams()
  const userId = session.user.id
  const isAdmin = profile?.role === 'admin'
  const teamView = isTeamTier(profile)
  const selectedChannelRef = useRef(null)
  const onReadChannelRef = useRef(onReadChannel)
  useEffect(() => { onReadChannelRef.current = onReadChannel }, [onReadChannel])

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 680
      setIsMobile(mobile)
      if (!mobile) setShowSidebar(true)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => { loadChannels() }, [])

  useEffect(() => {
    const channelId = searchParams.get('channel')
    const dmId = searchParams.get('dm')
    const hl = searchParams.get('highlight')
    if ((channelId || dmId) && hl) {
      setHighlightFor({ channelId: channelId || dmId, messageId: hl })
    }
    if (channelId && channels.length > 0) {
      const ch = channels.find(c => c.id === channelId)
      if (ch) openChannel(ch, { keepHighlight: !!hl })
    }
    if (dmId && dmChannels.length > 0) {
      const dm = dmChannels.find(c => c.id === dmId)
      if (dm) openChannel(dm, { keepHighlight: !!hl })
    }
  }, [searchParams, channels, dmChannels])

  const [lastMessages, setLastMessages] = useState(() => cachedMsg?.lastMessages || {})

  // Online presence (M2a): DM rows show a green dot for peers who are
  // in the app right now.
  const [onlineIds, setOnlineIds] = useState(() => new Set(getOnline().keys()))
  useEffect(() => subscribeOnline(m => setOnlineIds(new Set(m.keys()))), [])

  async function loadChannels() {
    // 3 parallel queries instead of N+1
    const [channelsRes, readsRes, mentionsRes, msgsRes, dmMembersRes, stateRes] = await Promise.all([
      supabase.from('channels').select('*, races(name)').neq('type', 'dm').order('sort_order').order('name'),
      supabase.from('channel_reads').select('*').eq('athlete_id', userId),
      supabase.from('message_mentions').select('*', { count: 'exact', head: true }).eq('mentioned_user_id', userId).is('seen_at', null),
      // Fetch last message per channel in one query using a recent window
      supabase.from('messages').select('channel_id, content, image_url, media_kind, created_at, athlete_id, profiles(full_name)').order('created_at', { ascending: false }).limit(300),
      // Fetch this user's DM channel memberships + the other member's profile
      supabase.from('channel_members').select('channel_id, channels!inner(id, type, created_at), athlete:profiles!athlete_id(id, full_name, avatar_color, avatar_url)').eq('athlete_id', userId),
      supabase.from('channel_user_state').select('*').eq('athlete_id', userId),
    ])

    setMentionCount(mentionsRes.count || 0)
    if (stateRes.data) {
      const map = {}
      stateRes.data.forEach(r => { map[r.channel_id] = r })
      setChannelState(map)
    }

    // Build DM channels: for each DM the user belongs to, fetch the other member
    if (dmMembersRes.data) {
      const dmChannelIds = dmMembersRes.data.map(m => m.channel_id)
      if (dmChannelIds.length > 0) {
        // RLS restricts channel_members reads to own rows only, so use a
        // security definer RPC to fetch all members of these DM channels
        const uniqueChannelIds = [...new Set(dmChannelIds)]
        const { data: dmPeers } = await supabase
          .rpc('get_dm_peers', { p_channel_ids: uniqueChannelIds })
        const membersByChannel = {}
        ;(dmPeers || []).forEach(m => {
          if (!membersByChannel[m.channel_id]) membersByChannel[m.channel_id] = []
          membersByChannel[m.channel_id].push({ id: m.id, full_name: m.full_name, avatar_color: m.avatar_color, avatar_url: m.avatar_url })
        })
        const builtDms = uniqueChannelIds.map(chId => ({
          id: chId, type: 'dm',
          dm_members: (membersByChannel[chId] || []).filter(Boolean),
        }))
        setDmChannels(builtDms)
      }
    }

    if (channelsRes.data) {
      // Fix: ensure every race conversation gets the race category, including
      // the legacy type and the public/logistics split.
      const fixedChannels = channelsRes.data.map(ch =>
        isRaceChannel(ch) && ch.category !== 'race' ? { ...ch, category: 'race' } : ch
      )
      setChannels(fixedChannels)

      // Build last message map from batched results (first occurrence = most recent per channel)
      if (msgsRes.data) {
        const lastMsgs = {}
        for (const msg of msgsRes.data) {
          if (!lastMsgs[msg.channel_id]) lastMsgs[msg.channel_id] = msg
        }
        setLastMessages(lastMsgs)
      }
    }

    if (channelsRes.data && readsRes.data) {
      const readsMap = {}
      readsRes.data.forEach(r => { readsMap[r.channel_id] = r.last_read_at })
      // Use get_unread_count RPC for a single round-trip
      const { data: unreadData } = await supabase.rpc('get_unread_counts', { p_user_id: userId })
      if (unreadData) {
        const counts = {}
        unreadData.forEach(r => { counts[r.channel_id] = r.unread_count })
        setUnreadCounts(counts)
      } else {
        // Fallback: derive from reads map + message timestamps (approximate)
        const counts = {}
        if (msgsRes.data) {
          const msgsByChannel = {}
          msgsRes.data.forEach(m => {
            if (!msgsByChannel[m.channel_id]) msgsByChannel[m.channel_id] = []
            msgsByChannel[m.channel_id].push(m.created_at)
          })
          channelsRes.data.forEach(ch => {
            const lastRead = readsMap[ch.id]
            const msgs = msgsByChannel[ch.id] || []
            counts[ch.id] = lastRead ? msgs.filter(t => t > lastRead).length : msgs.length
          })
        }
        setUnreadCounts(counts)
      }
    }
    setLoading(false)
  }

  // Keep the return-visit cache current (realtime unread bumps included).
  useEffect(() => {
    if (!loading) pageCacheSet('msg', { channels, dmChannels, unreadCounts, mentionCount, lastMessages, channelState })
  }, [loading, channels, dmChannels, unreadCounts, mentionCount, lastMessages, channelState])

  // Realtime: increment sidebar unread badge instantly when a new message arrives
  // in any channel the user is not currently viewing
  useEffect(() => {
    const sub = supabase.channel('global-message-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const { channel_id, athlete_id, content, image_url, media_kind, created_at } = payload.new
          // Ignore own messages — sender already marked read in sendMessage
          if (athlete_id === userId) return
          // Update last message preview for sidebar regardless of which channel is open
          setLastMessages(prev => ({
            ...prev,
            [channel_id]: { content, image_url, media_kind, created_at }
          }))
          // Ignore if user currently has this channel open — they're reading it
          if (selectedChannelRef.current?.id === channel_id) return
          // Increment sidebar badge for this channel
          setUnreadCounts(prev => ({ ...prev, [channel_id]: (prev[channel_id] || 0) + 1 }))
          // Refresh nav badge immediately
          onReadChannelRef.current?.()
        })
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [userId])

  async function openChannel(channel, opts = {}) {
    if (!opts.keepHighlight) setHighlightFor(null)
    if (!teamView && isTeamOnlyChannel(channel)) {
      selectedChannelRef.current = null
      setSelectedChannel(null)
      setLockedChannel(channel)
      setShowMentions(false)
      setShowStarred(false)
      if (isMobile) setShowSidebar(false)
      return
    }
    setLockedChannel(null)
    selectedChannelRef.current = channel
    setSelectedChannel(channel)
    setShowMentions(false)
    setShowStarred(false)
    if (isMobile) setShowSidebar(false)
    await supabase.from('channel_reads').upsert(
      { channel_id: channel.id, athlete_id: userId, last_read_at: new Date(Date.now() + 1000).toISOString() },
      { onConflict: 'channel_id,athlete_id' }
    )
    setUnreadCounts(prev => ({ ...prev, [channel.id]: 0 }))
    onReadChannel?.()
  }

  // M2b — pin / mute / archive writes (channel_user_state, 0010).
  async function updateChannelState(ch, patch) {
    const current = channelState[ch.id] || {}
    const row = {
      athlete_id: userId, channel_id: ch.id,
      pinned: current.pinned || false,
      archived: current.archived || false,
      muted_until: current.muted_until || null,
      ...patch,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('channel_user_state').upsert(row, { onConflict: 'athlete_id,channel_id' })
    if (!error) setChannelState(prev => ({ ...prev, [ch.id]: row }))
    setMenuFor(null)
  }

  function openStarred() {
    setShowStarred(true)
    setShowMentions(false)
    setLockedChannel(null)
    setSelectedChannel(null)
    selectedChannelRef.current = null
    if (isMobile) setShowSidebar(false)
  }

  async function openMentions() {
    setShowMentions(true)
    setShowStarred(false)
    setLockedChannel(null)
    setSelectedChannel(null)
    if (isMobile) setShowSidebar(false)
    // Mark all mentions as seen
    await supabase.from('message_mentions').update({ seen_at: new Date().toISOString() }).eq('mentioned_user_id', userId).is('seen_at', null)
    setMentionCount(0)
  }

  const generalChannels = channels.filter(c => c.category === 'general')
  const trainingChannels = channels.filter(c => c.category === 'training')
  const interestChannels = channels.filter(c => c.category === 'interest')
  const regionChannels = channels.filter(c => c.category === 'regions')
  const publicRaceChannels = channels.filter(c => raceChannelKind(c) === 'discussion')
  const teamRaceChannels = channels.filter(c => raceChannelKind(c) === 'logistics')
  // Announcement channels (readonly 📢 or the announcements category) pin
  // as a gold card above the list — previously such channels weren't
  // rendered in any sidebar group at all.
  const announcementChannels = channels.filter(c => c.is_readonly || c.category === 'announcements')
  const pinnedAnnouncement = announcementChannels[0] || null
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0)
  const showGroup = (key) => sideFilter === 'all' || sideFilter === key

  // Clean three-way separation (Zack, 2026-10-31, after the mixed stream
  // put DMs under a "Groups you're in" header): GROUP CHATS = public race
  // discussions anyone can join; TEAM CHATS = members-only channels
  // (general/training/interest/regions + race logistics); DIRECT
  // MESSAGES = 1:1s in their own section so they're trivial to find.
  // Each section is recency-sorted internally; the chips narrow which
  // slices show. Announcements stay pinned above the sections.
  const isAnnouncementCh = (c) => c.is_readonly || c.category === 'announcements'
  const tsOf = (id) => { const t = lastMessages?.[id]?.created_at; return t ? new Date(t).getTime() : 0 }
  const sections = (() => {
    const allChans = channels.filter(c => !isAnnouncementCh(c) && !channelState[c.id]?.archived)
    const byKind = (k) => allChans.filter(c => raceChannelKind(c) === k)
    const byCats = (cats) => allChans.filter(c => cats.includes(c.category) && !raceChannelKind(c))
    const dmItems = teamView
      ? dmChannels.filter(ch => !channelState[ch.id]?.archived).map(ch => ({ kind: 'dm', ch }))
      : [{ kind: 'lockedDm', ch: { id: 'locked-dms', type: 'dm', name: 'Direct Messages' } }]
    let groups = []
    let team = []
    let dms = []
    if (sideFilter === 'all') {
      groups = byKind('discussion').map(ch => ({ kind: 'channel', ch }))
      team = allChans.filter(c => raceChannelKind(c) !== 'discussion').map(ch => ({ kind: 'channel', ch }))
      dms = dmItems
    } else if (sideFilter === 'races') {
      groups = byKind('discussion').map(ch => ({ kind: 'channel', ch }))
      team = byKind('logistics').map(ch => ({ kind: 'channel', ch }))
    } else if (sideFilter === 'regions') {
      team = byCats(['regions']).map(ch => ({ kind: 'channel', ch }))
    } else if (sideFilter === 'training') {
      team = byCats(['training']).map(ch => ({ kind: 'channel', ch }))
    } else if (sideFilter === 'dms') {
      dms = dmItems
    }
    const nameOf = (it) => it.kind === 'dm'
      ? (dmOtherProfile(it.ch, userId)?.full_name || 'DM')
      : (raceChannelKind(it.ch) ? channelDisplayName(it.ch) : prettyName(it.ch.name))
    const sortItems = (arr) => arr.sort((a, b) =>
      ((channelState[b.ch.id]?.pinned ? 1 : 0) - (channelState[a.ch.id]?.pinned ? 1 : 0)) ||
      (tsOf(b.ch.id) - tsOf(a.ch.id)) || nameOf(a).localeCompare(nameOf(b)))
    return [
      { id: 'groups', label: 'Group chats', items: sortItems(groups) },
      { id: 'team', label: 'Team chats', items: sortItems(team) },
      { id: 'dms', label: 'Direct messages', items: sortItems(dms) },
    ].filter(s => s.items.length > 0)
  })()

  const archivedItems = [
    ...channels.filter(c => channelState[c.id]?.archived).map(ch => ({ kind: 'channel', ch })),
    ...dmChannels.filter(c => channelState[c.id]?.archived).map(ch => ({ kind: 'dm', ch })),
  ]

  function renderChatItem(item) {
            const ch = item.ch
            const last = lastMessages?.[ch.id]
            const st = channelState[ch.id] || {}
            const muted = !!st.muted_until && new Date(st.muted_until) > new Date()
            const unread = unreadCounts[ch.id] || 0
            const isSelected = selectedChannel?.id === ch.id

            if (item.kind === 'lockedDm') {
              return (
                <ChatRow
                  key="locked-dms"
                  avatar={<div style={{ width: 52, height: 52, borderRadius: '50%', background: '#1b1b1b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>🔒</div>}
                  name="Direct Messages"
                  preview="Team members only"
                  dimmed
                  onClick={() => openChannel({ id: 'locked-dms', type: 'dm', name: 'Direct Messages' })}
                />
              )
            }

            if (item.kind === 'dm') {
              const other = dmOtherProfile(ch, userId)
              const senderPrefix = last ? (last.athlete_id === userId ? 'You: ' : '') : ''
              const draftText = getDraft(ch.id)
              return (
                <ChatRow
                  key={ch.id}
                  avatar={<Avatar profile={other} size={52} />}
                  name={other?.full_name || 'Direct message'}
                  preview={draftText.trim() ? `Draft: ${draftText}` : last ? `${senderPrefix}${last.content || '📷 Photo'}` : 'No messages yet'}
                  time={waListTime(last?.created_at)}
                  unread={unread}
                  selected={isSelected}
                  online={!!other && onlineIds.has(other.id)}
                  draft={!!draftText.trim()}
                  muted={muted}
                  pinned={!!st.pinned}
                  onMenu={() => setMenuFor(ch)}
                  onClick={() => openChannel(ch)}
                />
              )
            }

            const locked = !teamView && isTeamOnlyChannel(ch)
            const kind = raceChannelKind(ch)
            const draftText = locked ? '' : getDraft(ch.id)
            const sender = last ? (last.athlete_id === userId ? 'You' : last.profiles?.full_name?.split(' ')[0]) : null
            const badge = kind === 'discussion'
              ? <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '9.5px', fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', background: 'rgba(var(--highlight-rgb),0.13)', color: 'var(--highlight)', padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>Public</span>
              : kind === 'logistics'
                ? <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '9.5px', fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', background: 'rgba(var(--brand-rgb),0.13)', color: 'var(--brand)', padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>Team</span>
                : null
            return (
              <ChatRow
                key={ch.id}
                avatar={<ChannelDisc ch={ch} />}
                name={kind ? channelDisplayName(ch) : prettyName(ch.name)}
                preview={draftText.trim() ? `Draft: ${draftText}` : locked ? '🔒 Team only' : last ? `${sender ? `${sender}: ` : ''}${last.content || '📷 Photo'}` : 'No messages yet'}
                time={locked ? '' : waListTime(last?.created_at)}
                unread={locked ? 0 : unread}
                selected={isSelected}
                badge={badge}
                dimmed={locked}
                draft={!!draftText.trim()}
                muted={muted}
                pinned={!!st.pinned}
                onMenu={locked ? null : () => setMenuFor(ch)}
                onClick={() => openChannel(ch)}
              />
            )
          }

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'Barlow Condensed', letterSpacing: 2, color: '#999', textTransform: 'uppercase' }}>Loading...</div>

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 59px)', overflow: 'hidden' }}>

      {/* Sidebar */}
      {(showSidebar || !isMobile) && (
        <div style={{ width: isMobile ? '100%' : '280px', background: '#111', borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'relative' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {/* Category chips — one lens over the channel list */}
            <div style={{ display: 'flex', gap: '7px', overflowX: 'auto', padding: '12px 16px 4px', scrollbarWidth: 'none' }}>
              {[
                { id: 'all', label: 'All' },
                { id: 'races', label: 'Races' },
                { id: 'regions', label: 'Regions' },
                { id: 'training', label: 'Training' },
                { id: 'dms', label: 'DMs' },
              ].map(f => {
                const active = sideFilter === f.id
                return (
                  <button
                    key={f.id}
                    onClick={() => setSideFilter(f.id)}
                    style={{
                      fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12.5px', fontWeight: 600,
                      letterSpacing: '1.3px', textTransform: 'uppercase', whiteSpace: 'nowrap',
                      padding: '6px 14px', borderRadius: '999px', cursor: 'pointer',
                      border: `1px solid ${active ? 'rgba(var(--brand-rgb),0.55)' : 'rgba(255,255,255,0.12)'}`,
                      background: active ? 'rgba(var(--brand-rgb),0.14)' : '#161616',
                      color: active ? 'var(--brand)' : '#888',
                    }}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>

            {/* Announcements — pinned WhatsApp-style row (megaphone disc),
                exactly where it sits in the real WhatsApp Community. */}
            {pinnedAnnouncement && sideFilter === 'all' && !showArchived && (() => {
              const last = lastMessages?.[pinnedAnnouncement.id]
              const sender = last?.athlete_id === userId ? 'You' : last?.profiles?.full_name?.split(' ')[0]
              return (
                <ChatRow
                  avatar={<ChannelDisc ch={pinnedAnnouncement} />}
                  name="Announcements"
                  preview={last ? (sender ? `~${sender}: ${last.content || '📷 Photo'}` : (last.content || '📷 Photo')) : 'Tap for the latest announcement'}
                  time={waListTime(last?.created_at)}
                  unread={unreadCounts[pinnedAnnouncement.id] || 0}
                  selected={selectedChannel?.id === pinnedAnnouncement.id}
                  onClick={() => openChannel(pinnedAnnouncement)}
                />
              )
            })()}

            {/* Mentions row (All view only — sections carry the rest) */}
            {sideFilter === 'all' && !showArchived && <ChatRow
              avatar={<div style={{ width: 52, height: 52, borderRadius: '50%', background: '#232323', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0, color: '#999' }}>@</div>}
              name="Mentions"
              preview="Messages where you're tagged"
              unread={mentionCount}
              selected={showMentions}
              onClick={openMentions}
            />}

            {/* Starred + Archived rows (M2b, All view only) */}
            {sideFilter === 'all' && !showArchived && <ChatRow
              avatar={<div style={{ width: 52, height: 52, borderRadius: '50%', background: '#232323', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0, color: 'var(--highlight)' }}>★</div>}
              name="Starred messages"
              preview="Messages you've saved"
              selected={showStarred}
              onClick={openStarred}
            />}
            {sideFilter === 'all' && !showArchived && archivedItems.length > 0 && <ChatRow
              avatar={<div style={{ width: 52, height: 52, borderRadius: '50%', background: '#232323', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0, color: '#999' }}>🗄</div>}
              name="Archived"
              preview={`${archivedItems.length} chat${archivedItems.length > 1 ? 's' : ''}`}
              onClick={() => setShowArchived(true)}
            />}

            {/* Archived mode: the sidebar swaps to the archived list */}
            {showArchived && (
              <div>
                <button onClick={() => setShowArchived(false)} style={{ background: 'none', border: 'none', color: 'var(--brand)', fontSize: '14px', cursor: 'pointer', padding: '14px 16px 4px', fontFamily: 'Barlow, sans-serif' }}>← Back to chats</button>
                <div style={{ fontFamily: 'Barlow, sans-serif', fontSize: '16px', fontWeight: 600, color: '#8a8a8a', padding: '6px 16px 2px' }}>Archived</div>
                {archivedItems.map(renderChatItem)}
                {archivedItems.length === 0 && <div style={{ padding: '18px 16px', fontSize: '13.5px', color: '#555' }}>No archived chats.</div>}
              </div>
            )}

            {/* The three clean sections (Zack, 2026-10-31) */}
            {!showArchived && sections.map(section => (
              <div key={section.id}>
                <div style={{ fontFamily: 'Barlow, sans-serif', fontSize: '16px', fontWeight: 600, color: '#8a8a8a', padding: '16px 16px 2px' }}>
                  {section.label}
                </div>
                {section.items.map(renderChatItem)}
              </div>
            ))}
            {!showArchived && sections.length === 0 && (
              <div style={{ padding: '18px 16px', fontSize: '13.5px', color: '#555' }}>Nothing here yet.</div>
            )}

            {/* Bottom hint when no channel selected on mobile */}
            {isMobile && !selectedChannel && !showMentions && (
              <div style={{ padding: '2rem 20px', textAlign: 'center' }}>
                <div style={{ fontSize: '13px', color: '#444' }}>Tap a channel to open it</div>
              </div>
            )}
          </div>

          {/* Floating "+ New chat" pill — WhatsApp's "+ Add group" pattern
              (Zack, 2026-10-31: the add-chat action belongs on a floating
              button). The old compose FAB sat at bottom:18 inside the
              sidebar, where the app's floating nav covers it on mobile —
              this pill rides ABOVE the nav (bottom: 94 on mobile). With
              both actions available it opens a two-row menu; with one, it
              fires it directly. */}
          {(isAdmin || teamView) && (!isMobile || (!selectedChannel && !showMentions)) && (
            <>
              {showAddMenu && (
                <>
                  <div onClick={() => setShowAddMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
                  <div style={{
                    position: 'absolute', right: '16px', bottom: isMobile ? '152px' : '76px', zIndex: 61,
                    background: '#1d1d1d', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '14px',
                    boxShadow: '0 18px 44px rgba(0,0,0,0.55)', overflow: 'hidden', minWidth: '212px',
                  }}>
                    {isAdmin && (
                      <button onClick={() => { setShowAddMenu(false); setShowNewChannel(true) }} style={{ display: 'flex', alignItems: 'center', gap: '11px', width: '100%', padding: '13px 16px', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', textAlign: 'left' }}>
                        <span style={{ fontSize: '16px' }}>＋</span>
                        <span style={{ fontFamily: 'Barlow, sans-serif', fontSize: '14.5px', fontWeight: 600, color: '#fff' }}>New channel</span>
                      </button>
                    )}
                    {teamView && (
                      <button onClick={() => { setShowAddMenu(false); setShowNewDm(true) }} style={{ display: 'flex', alignItems: 'center', gap: '11px', width: '100%', padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                        <span style={{ fontSize: '15px' }}>✉️</span>
                        <span style={{ fontFamily: 'Barlow, sans-serif', fontSize: '14.5px', fontWeight: 600, color: '#fff' }}>New message</span>
                      </button>
                    )}
                  </div>
                </>
              )}
              <button
                onClick={() => {
                  if (isAdmin && teamView) setShowAddMenu(m => !m)
                  else if (isAdmin) setShowNewChannel(true)
                  else setShowNewDm(true)
                }}
                aria-label="Start a new chat"
                style={{
                  position: 'absolute', right: '16px', bottom: isMobile ? '94px' : '18px', zIndex: 60,
                  background: 'var(--brand)', color: '#03292b', border: 'none', borderRadius: '999px',
                  padding: '13px 22px', cursor: 'pointer',
                  fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 800, letterSpacing: '1.2px',
                  display: 'flex', alignItems: 'center', gap: '7px',
                  boxShadow: '0 12px 30px rgba(var(--brand-rgb),0.42)',
                }}
              >
                <span style={{ fontSize: '17px', lineHeight: 1 }}>+</span> NEW CHAT
              </button>
            </>
          )}
        </div>
      )}

      {/* Mentions view */}
      {(!showSidebar || !isMobile) && showMentions && (
        <MentionsView session={session} profile={profile} isMobile={isMobile} channels={channels} teamView={teamView} onBack={() => { setShowSidebar(true); setShowMentions(false) }} onOpenChannel={openChannel} />
      )}

      {/* Locked team surface */}
      {(!showSidebar || !isMobile) && lockedChannel && !showMentions && (
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          {isMobile && (
            <button aria-label="Back to channels" onClick={() => { setShowSidebar(true); setLockedChannel(null) }} style={{ background: 'none', border: 'none', color: '#999', fontSize: '20px', cursor: 'pointer', padding: '14px 16px 0' }}>←</button>
          )}
          <TeamLocked feature={lockedChannel.type === 'dm' ? 'Direct messages' : channelDisplayName(lockedChannel)} />
        </div>
      )}

      {/* Message thread */}
      {(!showSidebar || !isMobile) && selectedChannel && !showMentions && !showStarred && (
        <MessageThread
          key={selectedChannel.id}
          channel={selectedChannel}
          session={session}
          profile={profile}
          isMobile={isMobile}
          highlightId={highlightFor?.channelId === selectedChannel.id ? highlightFor.messageId : null}
          onBack={() => { setShowSidebar(true); selectedChannelRef.current = null; setSelectedChannel(null) }}
          onMarkRead={() => { setUnreadCounts(prev => ({ ...prev, [selectedChannel.id]: 0 })); onReadChannel?.() }}
          onMention={() => setMentionCount(prev => prev + 1)}
        />
      )}

      {/* Starred messages view (M2b) */}
      {(!showSidebar || !isMobile) && showStarred && (
        <StarredView
          session={session}
          channels={channels}
          dmChannels={dmChannels}
          isMobile={isMobile}
          onBack={() => { setShowSidebar(true); setShowStarred(false) }}
          onJump={(ch, messageId) => { setHighlightFor({ channelId: ch.id, messageId }); openChannel(ch, { keepHighlight: true }) }}
        />
      )}

      {/* Per-chat options sheet: pin / mute / archive (M2b) */}
      {menuFor && createPortal((
        <div onClick={() => setMenuFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 240, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '480px', padding: '10px 0 calc(10px + env(safe-area-inset-bottom, 0px))' }}>
            <div style={{ padding: '10px 20px 6px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#fff' }}>
              {menuFor.type === 'dm' ? (dmOtherProfile(menuFor, userId)?.full_name || 'Direct message') : (raceChannelKind(menuFor) ? channelDisplayName(menuFor) : prettyName(menuFor.name))}
            </div>
            {(() => {
              const st = channelState[menuFor.id] || {}
              const mutedNow = !!st.muted_until && new Date(st.muted_until) > new Date()
              return (
                <>
                  <button onClick={() => updateChannelState(menuFor, { pinned: !st.pinned })} style={MENU_ROW_STYLE}>{st.pinned ? '📌 Unpin chat' : '📌 Pin chat'}</button>
                  <button onClick={() => updateChannelState(menuFor, { muted_until: mutedNow ? null : new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString() })} style={MENU_ROW_STYLE}>{mutedNow ? '🔔 Unmute notifications' : '🔕 Mute notifications'}</button>
                  <button onClick={() => updateChannelState(menuFor, { archived: !st.archived })} style={MENU_ROW_STYLE}>{st.archived ? '📤 Unarchive chat' : '🗄 Archive chat'}</button>
                </>
              )
            })()}
            <button onClick={() => setMenuFor(null)} style={{ ...MENU_ROW_STYLE, color: '#999' }}>Cancel</button>
          </div>
        </div>
      ), document.body)}

      {/* Empty state */}
      {!isMobile && !selectedChannel && !showMentions && !lockedChannel && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '48px' }}>💬</div>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '16px', letterSpacing: '2px', textTransform: 'uppercase', color: '#555' }}>Select a channel to start chatting</div>
        </div>
      )}

      {showNewChannel && (
        <NewChannelModal session={session} onClose={() => setShowNewChannel(false)} onCreated={(ch) => { setChannels(prev => [...prev, ch]); setShowNewChannel(false); openChannel(ch) }} />
      )}
      {showNewDm && (
        <NewDmModal
          userId={userId}
          onClose={() => setShowNewDm(false)}
          onCreated={(dmChannel) => {
            setDmChannels(prev => {
              const exists = prev.find(c => c.id === dmChannel.id)
              return exists ? prev : [...prev, dmChannel]
            })
            setShowNewDm(false)
            openChannel(dmChannel)
          }}
        />
      )}
    </div>
  )
}

function channelInitial(ch) {
  // For race channels use the shortened race name, else the channel name.
  const name = isRaceChannel(ch)
    ? (ch.races?.name?.replace(/ironman\s+70\.3\s+/i, '').replace(/ironman\s+/i, '') || ch.name)
    : ch.name
  return name.trim()[0]?.toUpperCase() || '#'
}

const CATEGORY_COLORS = {
  general:  'var(--brand)',
  training: 'var(--highlight)',
  interest: '#a78bfa',
  regions:  '#60a5fa',
  race:     'var(--accent)',
}

function ChannelIcon({ ch, isSelected, size = 36 }) {
  if (ch.is_readonly) {
    return (
      <div style={{ width: size, height: size, borderRadius: '8px', background: isSelected ? 'rgba(var(--accent-rgb),0.25)' : 'rgba(var(--accent-rgb),0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: size * 0.5 }}>
        📢
      </div>
    )
  }
  const color = CATEGORY_COLORS[ch.category] || 'var(--brand)'
  const letter = channelInitial(ch)
  return (
    <div style={{
      width: size, height: size, borderRadius: '8px', flexShrink: 0,
      background: isSelected ? `${color}30` : `${color}18`,
      border: `1px solid ${isSelected ? color + '60' : color + '28'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800,
      fontSize: size * 0.44, color: isSelected ? color : `${color}cc`,
      transition: 'all 0.15s',
    }}>
      {letter}
    </div>
  )
}

// ─── WhatsApp-style list (Zack, 2026-10-31: "make messaging look like
// WhatsApp", reference = the Team TTL WhatsApp Community view) ───────────
// Flat, recency-sorted rows: big round avatar, human name, right-aligned
// timestamp (brand-coloured when unread), sender-prefixed preview, round
// unread badge, hairline divider under the text column only.
export function waListTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const startOf = (x) => { const t = new Date(x); t.setHours(0, 0, 0, 0); return t }
  const days = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (days <= 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'long' })
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
}

export function waClock(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function waDayLabel(dateStr) {
  const d = new Date(dateStr)
  const now = new Date()
  const startOf = (x) => { const t = new Date(x); t.setHours(0, 0, 0, 0); return t }
  const days = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// Channel names in the database are slugs (community-chat); WhatsApp shows
// human names (Community Chat). Only transform obvious slugs.
export function prettyName(name) {
  if (!name) return ''
  if (/\s/.test(name) && name !== name.toLowerCase()) return name
  if (!/\s/.test(name) && !name.includes('-') && name !== name.toLowerCase()) return name
  return name.split(/[-\s]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const CATEGORY_RGB = {
  general: 'var(--brand-rgb)',
  training: 'var(--highlight-rgb)',
  interest: '167,139,250',
  regions: '96,165,250',
  race: 'var(--accent-rgb)',
}

export function ChannelDisc({ ch, size = 52 }) {
  if (ch.is_readonly || ch.category === 'announcements') {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(37,211,102,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.46, flexShrink: 0 }}>📢</div>
    )
  }
  const rgb = CATEGORY_RGB[ch.category] || 'var(--brand-rgb)'
  const color = CATEGORY_COLORS[ch.category] || 'var(--brand)'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `rgba(${rgb},0.18)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800,
      fontSize: size * 0.42, color,
    }}>
      {channelInitial(ch)}
    </div>
  )
}

export function ChatRow({ avatar, name, preview, time, unread = 0, selected = false, onClick, badge = null, dimmed = false, online = false, draft = false, muted = false, pinned = false, onMenu = null }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', gap: '12px', width: '100%', padding: '10px 16px 0',
        background: selected ? 'rgba(255,255,255,0.05)' : 'none',
        border: 'none', cursor: 'pointer', textAlign: 'left', alignItems: 'flex-start',
      }}
    >
      <span style={{ position: 'relative', flexShrink: 0 }}>
        {avatar}
        {online && <span style={{ position: 'absolute', right: 0, bottom: 1, width: 12, height: 12, borderRadius: '50%', background: '#25d366', border: '2px solid #0b0b0b' }} />}
      </span>
      <div style={{ flex: 1, minWidth: 0, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '11px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: 'Barlow, sans-serif', fontSize: '16px', fontWeight: unread > 0 ? 700 : 600, color: dimmed ? '#777' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.25 }}>
            {pinned && <span style={{ marginRight: '5px', fontSize: '11px' }}>📌</span>}{name}
          </span>
          {badge}
          {time && (
            <span style={{ fontSize: '12px', color: unread > 0 ? 'var(--brand)' : '#777', flexShrink: 0, fontWeight: unread > 0 ? 600 : 400 }}>
              {time}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: '13.5px', color: draft ? 'var(--brand)' : dimmed ? '#555' : unread > 0 ? '#bbb' : '#8a8a8a', fontStyle: draft ? 'italic' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.35 }}>
            {preview || ' '}
          </span>
          {unread > 0 && (
            <span style={{ background: muted ? '#3d3d3d' : 'var(--brand)', color: muted ? '#999' : '#03292b', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', minWidth: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0 }}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
      </div>
      {onMenu && (
        <span role="button" aria-label="Chat options" onClick={(e) => { e.stopPropagation(); onMenu() }}
          style={{ alignSelf: 'center', color: '#777', fontSize: '18px', padding: '6px 2px', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>
          ⋯
        </span>
      )}
    </button>
  )
}

function ChannelGroup({ label, channels, selected, unread, lastMessages, onSelect, defaultOpen = true, locked = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const groupUnread = locked ? 0 : channels.reduce((sum, ch) => sum + (unread[ch.id] || 0), 0)

  return (
    <div>
      {/* Collapsible header */}
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '12px 20px 5px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: '#444', flex: 1 }}>{label}</span>
        {!open && groupUnread > 0 && (
          <span style={{ background: 'var(--brand)', color: '#000', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10px', fontWeight: 700, borderRadius: '8px', padding: '1px 6px' }}>{groupUnread}</span>
        )}
        <span style={{ fontSize: '10px', color: '#333', marginLeft: '4px' }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && channels.map((ch, idx) => {
        const isSelected = selected?.id === ch.id
        const unreadCount = locked ? 0 : (unread[ch.id] || 0)
        const last = locked ? null : lastMessages?.[ch.id]
        const displayName = channelDisplayName(ch)
        const preview = last ? (last.content || (last.media_kind === 'audio' ? '🎤 Voice message' : (last.media_kind === 'image' || last.image_url) ? '📷 Photo' : '')) : ''
        const senderName = last?.profiles?.full_name?.split(' ')[0]
        const previewText = locked
          ? 'Team only — tap for details'
          : (preview ? (senderName ? `${senderName}: ${preview}` : preview) : null)

        return (
          <button
            key={ch.id}
            onClick={() => onSelect(ch)}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              width: '100%', padding: '8px 16px 8px 20px',
              background: isSelected ? 'rgba(var(--brand-rgb),0.07)' : 'none',
              border: 'none',
              borderLeft: isSelected ? '2px solid var(--brand)' : '2px solid transparent',
              cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
            }}
          >
            <ChannelIcon ch={ch} isSelected={isSelected} size={32} />

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '14px', fontWeight: unreadCount > 0 ? 700 : 500, color: isSelected ? '#fff' : unreadCount > 0 ? '#ddd' : '#777', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                  {displayName}
                </span>
                {(() => {
                  const kind = raceChannelKind(ch)
                  if (kind === 'discussion') return <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '9.5px', fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', background: 'rgba(var(--highlight-rgb),0.13)', color: 'var(--highlight)', padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>Public</span>
                  if (kind === 'logistics') return <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '9.5px', fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', background: 'rgba(var(--brand-rgb),0.13)', color: 'var(--brand)', padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>Team</span>
                  return null
                })()}
              </div>
              {previewText && (
                <div style={{ fontSize: '11px', color: unreadCount > 0 ? '#999' : '#444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '1px' }}>
                  {previewText}
                </div>
              )}
            </div>

            {locked && <div style={{ fontSize: '13px', color: '#555', flexShrink: 0 }}>🔒</div>}
            {unreadCount > 0 && (
              <div style={{ background: 'var(--accent)', color: '#fff', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', fontWeight: 700, borderRadius: '999px', padding: '2px 8px', flexShrink: 0 }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

function MentionsView({ session, profile, isMobile, channels, teamView, onBack, onOpenChannel }) {
  const [mentions, setMentions] = useState([])
  const [loading, setLoading] = useState(true)
  const userId = session.user.id

  useEffect(() => { loadMentions() }, [])

  async function loadMentions() {
    // Step 1 — get all mentions for this user
    const { data: mentionData, error: mentionError } = await supabase
      .from('message_mentions')
      .select('*, channels(id, name, type, races(name))')
      .eq('mentioned_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (mentionError) { console.error('[Mentions] mention query error:', mentionError.message); setLoading(false); return }
    if (!mentionData?.length) { setLoading(false); return }

    // Step 2 — fetch the actual messages separately
    const messageIds = mentionData.map(m => m.message_id).filter(Boolean)
    const { data: messageData, error: messageError } = await supabase
      .from('messages')
      .select('id, content, created_at, athlete_id, profiles(full_name, avatar_color, avatar_url, role, member_class)')
      .in('id', messageIds)

    if (messageError) console.error('[Mentions] message query error:', messageError.message)

    const messageMap = {}
    messageData?.forEach(m => { messageMap[m.id] = m })

    // Merge, then apply the same presentation gate as the channel list:
    // a non-team view never renders message content from team-only channels.
    const merged = mentionData.map(m => ({
      ...m,
      message: messageMap[m.message_id] || null,
    })).filter(m => {
      if (teamView) return true
      const fullChannel = channels.find(ch => ch.id === m.channels?.id) || m.channels
      return !isTeamOnlyChannel(fullChannel)
    })

    setMentions(merged)
    setLoading(false)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: '#111' }}>
        {isMobile && <button aria-label="Back" onClick={onBack} style={{ background: 'none', border: 'none', color: '#999', fontSize: '20px', cursor: 'pointer', padding: '0', marginRight: '4px' }}>←</button>}
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '16px', fontWeight: 700, color: '#fff' }}>@ Mentions</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {loading ? <div style={{ color: '#555', fontSize: '13px' }}>Loading...</div>
          : mentions.length === 0 ? (
            <div style={{ textAlign: 'center', margin: 'auto', padding: '3rem', color: '#555', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '14px', letterSpacing: '1px', textTransform: 'uppercase' }}>
              No mentions yet
            </div>
          ) : mentions.map(m => {
            const ch = m.channels
            const msg = m.message
            const chName = ch ? channelDisplayName(ch) : ''
            return (
              <div key={m.id} onClick={() => onOpenChannel(channels.find(full => full.id === ch?.id) || ch)} style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderLeft: '3px solid var(--accent)', borderRadius: '8px', padding: '12px', marginBottom: '8px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span
                    onClick={(e) => { e.stopPropagation(); if (msg?.athlete_id) openMember(msg.athlete_id) }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: msg?.athlete_id ? 'pointer' : 'default' }}
                  >
                    <Avatar profile={msg?.profiles} size={24} />
                    <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 600, color: '#fff' }}>{msg?.profiles?.full_name || 'Athlete'}</span>
                  </span>
                  <MemberChips profile={msg?.profiles} />
                  <span style={{ fontSize: '11px', color: '#555' }}>in #{chName}</span>
                  <span style={{ fontSize: '11px', color: '#555', marginLeft: 'auto' }}>{timeAgo(m.created_at)}</span>
                </div>
                <div style={{ fontSize: '13px', color: '#bbb', lineHeight: 1.5 }}>{msg?.content}</div>
              </div>
            )
          })}
      </div>
    </div>
  )
}

// ─── StarredView — the user's saved messages across chats (M2b) ──────
function StarredView({ session, channels, dmChannels, isMobile, onBack, onJump }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const userId = session.user.id

  useEffect(() => { load() }, [])

  async function load() {
    const { data: stars } = await supabase.from('message_stars').select('message_id, created_at')
      .eq('athlete_id', userId).order('created_at', { ascending: false }).limit(100)
    if (!stars?.length) { setRows([]); setLoading(false); return }
    const { data: msgs } = await supabase.from('messages')
      .select('id, channel_id, content, image_url, media_kind, created_at, athlete_id, deleted_at, profiles(full_name, avatar_color, avatar_url)')
      .in('id', stars.map(s => s.message_id))
    const byId = {}
    ;(msgs || []).forEach(m => { byId[m.id] = m })
    setRows(stars.map(s => byId[s.message_id]).filter(Boolean))
    setLoading(false)
  }

  async function unstar(msg) {
    await supabase.from('message_stars').delete().eq('athlete_id', userId).eq('message_id', msg.id)
    setRows(prev => prev.filter(r => r.id !== msg.id))
  }

  function channelFor(msg) {
    return [...(channels || []), ...(dmChannels || [])].find(c => c.id === msg.channel_id) || null
  }

  function channelLabel(msg) {
    const ch = channelFor(msg)
    if (!ch) return 'Chat'
    if (ch.type === 'dm') return 'Direct message'
    return raceChannelKind(ch) ? channelDisplayName(ch) : prettyName(ch.name)
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', minWidth: 0, padding: '16px' }}>
      {isMobile && (
        <button aria-label="Back to chats" onClick={onBack} style={{ background: 'none', border: 'none', color: '#999', fontSize: '20px', cursor: 'pointer', padding: '0 0 8px' }}>←</button>
      )}
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '18px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff', marginBottom: '12px' }}>
        ★ Starred messages
      </div>
      {loading && <div style={{ color: '#666', fontSize: '13.5px' }}>Loading…</div>}
      {!loading && rows.length === 0 && (
        <div style={{ color: '#666', fontSize: '13.5px', lineHeight: 1.6 }}>
          Nothing starred yet. Hover (or long-press) a message and tap ☆ to save it here.
        </div>
      )}
      {rows.map(msg => (
        <div key={msg.id} onClick={() => { const ch = channelFor(msg); if (ch) onJump(ch, msg.id) }}
          style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderLeft: '3px solid var(--highlight)', borderRadius: '8px', padding: '12px', marginBottom: '8px', cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Avatar profile={msg.profiles} size={24} />
            <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 600, color: '#fff' }}>{msg.profiles?.full_name || 'Athlete'}</span>
            <span style={{ fontSize: '11px', color: '#555' }}>in {channelLabel(msg)}</span>
            <span style={{ fontSize: '11px', color: '#555', marginLeft: 'auto' }}>{timeAgo(msg.created_at)}</span>
            <button onClick={(e) => { e.stopPropagation(); unstar(msg) }} aria-label="Unstar"
              style={{ background: 'none', border: 'none', color: 'var(--highlight)', fontSize: '15px', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>★</button>
          </div>
          <div style={{ fontSize: '13px', color: '#bbb', lineHeight: 1.5 }}>
            {msg.deleted_at ? <span style={{ fontStyle: 'italic', color: '#777' }}>This message was deleted</span> : (msg.content || (msg.media_kind === 'audio' ? '🎤 Voice message' : (msg.media_kind === 'image' || msg.image_url) ? '📷 Photo' : ''))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MessageThread({ channel, session, profile, isMobile, onBack, onMarkRead, onMention, highlightId = null }) {
  const [messages, setMessages] = useState([])
  const [profiles, setProfiles] = useState([])
  const [reactions, setReactions] = useState({})
  const [text, setText] = useState(() => getDraft(channel.id))
  const [replyTo, setReplyTo] = useState(null)
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(null)
  const [showInputEmoji, setShowInputEmoji] = useState(false)
  const [mentionQuery, setMentionQuery] = useState(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [hoveredMsg, setHoveredMsg] = useState(null)
  const [modNotice, setModNotice] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [revealedHidden, setRevealedHidden] = useState(() => new Set())
  const [editingMsg, setEditingMsg] = useState(null) // { id, content }
  const [hasEarlier, setHasEarlier] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const lastMsgIdRef = useRef(null)
  const [editText, setEditText] = useState('')
  const bottomRef = useRef()
  const fileRef = useRef()
  const textareaRef = useRef()
  const userId = session.user.id
  // M2a — receipts, typing/presence, scroll management
  const [channelReads, setChannelReads] = useState([])
  const [typingUsers, setTypingUsers] = useState([])
  const [peerOnline, setPeerOnline] = useState(false)
  const [infoMsg, setInfoMsg] = useState(null)
  const [unseenNew, setUnseenNew] = useState(0)
  // M2b — stars, search jump-to, offline state
  const [starredIds, setStarredIds] = useState(() => new Set())
  const [flashId, setFlashId] = useState(null)
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const suppressScrollRef = useRef(false)
  // M3 — private media (signed URLs) + voice-note recording
  const [mediaUrls, setMediaUrls] = useState({})
  const [recState, setRecState] = useState('idle') // idle | recording | preview
  const [recElapsed, setRecElapsed] = useState(0)
  const [recPreview, setRecPreview] = useState(null) // { blob, url, duration, mime }
  const mediaRecorderRef = useRef(null)
  const recStreamRef = useRef(null)
  const recChunksRef = useRef([])
  const recStartRef = useRef(0)
  const recTimerRef = useRef(null)
  const recDiscardRef = useRef(false)

  // Resolve signed URLs for any message media on screen (private
  // message-media bucket, 1h URLs — re-signed on thread mount).
  useEffect(() => {
    const paths = [...new Set(messages.map(m => m.media_path).filter(Boolean))]
    const missing = paths.filter(p => !mediaUrls[p])
    if (!missing.length) return
    let cancelled = false
    supabase.storage.from('message-media').createSignedUrls(missing, 3600).then(({ data }) => {
      if (cancelled || !data) return
      const add = {}
      data.forEach(d => { if (d.signedUrl && d.path) add[d.path] = d.signedUrl })
      if (Object.keys(add).length) setMediaUrls(prev => ({ ...prev, ...add }))
    })
    return () => { cancelled = true }
  }, [messages, mediaUrls])

  // Stop the microphone if the thread unmounts mid-recording.
  useEffect(() => () => {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    recStreamRef.current?.getTracks().forEach(t => t.stop())
  }, [])
  const scrollRef = useRef()
  const pinnedRef = useRef(true)
  const prependRef = useRef(null)
  const presenceRef = useRef(null)
  const typingTimerRef = useRef(null)
  const typingSentRef = useRef(0)

  async function loadReads() {
    const { data } = await supabase.from('channel_reads').select('athlete_id, last_read_at').eq('channel_id', channel.id)
    if (data) setChannelReads(data)
  }

  async function markReadNow() {
    const readAt = new Date(Date.now() + 1000).toISOString()
    await supabase.from('channel_reads').upsert(
      { channel_id: channel.id, athlete_id: userId, last_read_at: readAt },
      { onConflict: 'channel_id,athlete_id' }
    )
    onMarkRead?.()
  }

  function noteTyping() {
    const now = Date.now()
    if (now - typingSentRef.current > 2000) {
      typingSentRef.current = now
      presenceRef.current?.track({ user_id: userId, name: profile?.full_name || 'Athlete', typing: true }).catch(() => {})
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      presenceRef.current?.track({ user_id: userId, name: profile?.full_name || 'Athlete', typing: false }).catch(() => {})
      typingSentRef.current = 0
    }, 3000)
  }

  function handleThreadScroll() {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
    if (pinnedRef.current && unseenNew > 0) setUnseenNew(0)
    if (el.scrollTop < 120 && hasEarlier && !loadingEarlier) loadEarlier()
  }

  useEffect(() => {
    // Analytics: opening the announcements thread is the suite's
    // announcement_viewed (owned-audience response; first view per
    // session — the tracker dedupes). Same predicate the list uses.
    if (channel.is_readonly || channel.category === 'announcements') track('announcement_viewed')
    if (highlightId) jumpToMessage(highlightId)
    else loadMessages()
    loadProfiles()
    loadReads()
    const sub = supabase.channel(`messages:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channel.id}` },
        async (payload) => {
          setMessages(prev => {
            if (prev.some(m => m.id === payload.new.id)) return prev
            supabase.from('messages').select('*, profiles(full_name, avatar_color, avatar_url, role, member_class), reply_msg:reply_to(id, content, deleted_at, profiles(full_name))').eq('id', payload.new.id).single()
              .then(({ data }) => {
                if (data) {
                  setMessages(p => p.some(m => m.id === data.id) ? p : [...p, data])
                  // M2a fix: a message arriving while this thread is
                  // open IS being read — advance my read marker so the
                  // unread badge doesn't resurrect it on reload.
                  if (payload.new.athlete_id === userId) onMarkRead()
                  else {
                    markReadNow()
                    if (!pinnedRef.current) setUnseenNew(n => n + 1)
                  }
                }
              })
            return prev
          })
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channel.id}` },
        (payload) => {
          // Other people's edits (and soft deletes, M2b) land live.
          setMessages(prev => prev.map(m => m.id === payload.new.id
            ? { ...m, content: payload.new.content, edited_at: payload.new.edited_at, deleted_at: payload.new.deleted_at }
            : m))
        })
      .subscribe()
    // Receipts: other members' read markers stream in (0011).
    const readsSub = supabase.channel(`reads:${channel.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_reads', filter: `channel_id=eq.${channel.id}` },
        () => loadReads())
      .subscribe()
    // Reactions stream live now (0010 put them in the publication and
    // added channel_id for this filter).
    const reactSub = supabase.channel(`reactions:${channel.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions', filter: `channel_id=eq.${channel.id}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const rid = payload.old?.id
            if (rid) setReactions(prev => {
              const next = {}
              for (const [mid, rows] of Object.entries(prev)) {
                const kept = rows.filter(r => r.id !== rid)
                if (kept.length) next[mid] = kept
              }
              return next
            })
          } else if (payload.new?.message_id) {
            const row = payload.new
            setReactions(prev => ({
              ...prev,
              [row.message_id]: [...(prev[row.message_id] || []).filter(r => r.id !== row.id), row],
            }))
          }
        })
      .subscribe()
    // Typing + in-thread presence: one presence channel per thread.
    const presence = supabase.channel(`typing:${channel.id}`, { config: { presence: { key: userId } } })
    presenceRef.current = presence
    presence
      .on('presence', { event: 'sync' }, () => {
        const state = presence.presenceState()
        const others = []
        Object.entries(state).forEach(([uid, metas]) => {
          if (uid !== userId && metas?.length) others.push(metas[0])
        })
        setTypingUsers(others.filter(o => o.typing).map(o => o.name || 'Someone'))
        setPeerOnline(others.length > 0)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try { await presence.track({ user_id: userId, name: profile?.full_name || 'Athlete', typing: false }) } catch { /* non-fatal */ }
        }
      })
    // Offline awareness + auto-retry of the outbox on reconnect.
    function onOnline() {
      setIsOffline(false)
      outboxForChannel(channel.id).forEach(q => {
        retrySend({ id: q.localId, content: q.content, image_url: q.image_url, media_path: q.media_path, media_kind: q.media_kind, audio_duration_s: q.audio_duration_s, reply_to: q.reply_to })
      })
    }
    function onOffline() { setIsOffline(true) }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      supabase.removeChannel(sub)
      supabase.removeChannel(readsSub)
      supabase.removeChannel(reactSub)
      supabase.removeChannel(presence)
      presenceRef.current = null
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [channel.id])

  useEffect(() => {
    // Search jump-to sets the window itself and scrolls to the target;
    // don't let the tail-follow logic fight it.
    if (suppressScrollRef.current) { suppressScrollRef.current = false; return }
    // History prepend: restore the reading position after older
    // messages land above (the container grew by the prepended
    // height; shift scrollTop by the same amount).
    if (prependRef.current != null && scrollRef.current) {
      const el = scrollRef.current
      el.scrollTop += el.scrollHeight - prependRef.current
      prependRef.current = null
      return
    }
    const lastId = messages[messages.length - 1]?.id
    if (lastId && lastId !== lastMsgIdRef.current) {
      const isFirstLoad = lastMsgIdRef.current === null
      lastMsgIdRef.current = lastId
      // Only follow the tail when the reader is pinned to the bottom
      // (or on first load) — never yank someone reading history.
      if (isFirstLoad || pinnedRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: isFirstLoad ? 'auto' : 'smooth' })
      }
    }
  }, [messages])

  async function loadProfiles() {
    const { data } = await supabase.from('profiles').select('id, full_name, avatar_color, avatar_url')
    if (data) setProfiles(data)
  }

  const MSG_PAGE = 100
  const MSG_SELECT = '*, profiles(full_name, avatar_color, avatar_url, role, member_class), reply_msg:reply_to(id, content, deleted_at, profiles(full_name))'

  async function mergeReactions(messageIds) {
    if (!messageIds.length) return
    const { data } = await supabase.from('message_reactions').select('*').in('message_id', messageIds)
    if (data) {
      setReactions(prev => {
        const next = { ...prev }
        data.forEach(r => { if (!next[r.message_id]) next[r.message_id] = []; if (!next[r.message_id].some(x => x.id === r.id)) next[r.message_id].push(r) })
        return next
      })
    }
  }

  // Latest page first (descending + reverse). The previous implementation
  // ordered ascending with limit 100, which loaded the OLDEST 100 messages
  // and silently dropped recent history in busy channels.
  async function mergeStars(messageIds) {
    if (!messageIds.length) return
    const { data } = await supabase.from('message_stars').select('message_id')
      .eq('athlete_id', userId).in('message_id', messageIds)
    if (data) setStarredIds(prev => {
      const next = new Set(prev)
      data.forEach(r => next.add(r.message_id))
      return next
    })
  }

  async function loadMessages() {
    const { data } = await supabase.from('messages').select(MSG_SELECT)
      .eq('channel_id', channel.id).order('created_at', { ascending: false }).limit(MSG_PAGE)
    if (data) {
      const page = [...data].reverse()
      // M2b outbox: this channel's queued sends return as failed
      // bubbles at the tail — they never silently disappear.
      const queued = outboxForChannel(channel.id).map(q => ({
        id: q.localId, channel_id: channel.id, athlete_id: userId,
        content: q.content, image_url: q.image_url || null,
        media_path: q.media_path || null, media_kind: q.media_kind || null,
        audio_duration_s: q.audio_duration_s || null,
        reply_to: q.reply_to || null, reply_msg: null,
        created_at: q.queued_at || new Date().toISOString(),
        profiles: profile, failed: true,
      }))
      setMessages([...page, ...queued])
      setHasEarlier(data.length === MSG_PAGE)
      await mergeReactions(page.map(m => m.id))
      await mergeStars(page.map(m => m.id))
    }
    setTimeout(() => bottomRef.current?.scrollIntoView(), 100)
  }

  // Search jump-to: load a window around the target message instead
  // of the latest page, then scroll to it and flash it.
  async function jumpToMessage(targetId) {
    const { data: target } = await supabase.from('messages').select('id, created_at')
      .eq('id', targetId).single()
    if (!target) { loadMessages(); return }
    const [beforeRes, afterRes] = await Promise.all([
      supabase.from('messages').select(MSG_SELECT)
        .eq('channel_id', channel.id).lte('created_at', target.created_at)
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('messages').select(MSG_SELECT)
        .eq('channel_id', channel.id).gt('created_at', target.created_at)
        .order('created_at', { ascending: true }).limit(25),
    ])
    const before = [...(beforeRes.data || [])].reverse()
    const win = [...before, ...(afterRes.data || [])]
    if (!win.length) { loadMessages(); return }
    suppressScrollRef.current = true
    setMessages(win)
    setHasEarlier((beforeRes.data || []).length === 50)
    await mergeReactions(win.map(m => m.id))
    await mergeStars(win.map(m => m.id))
    lastMsgIdRef.current = win[win.length - 1]?.id || null
    pinnedRef.current = false
    setTimeout(() => {
      const el = document.getElementById(`msg-${targetId}`)
      if (el) {
        el.scrollIntoView({ block: 'center' })
        setFlashId(targetId)
        setTimeout(() => setFlashId(null), 2400)
      }
    }, 120)
  }

  async function loadEarlier() {
    if (loadingEarlier || !messages.length) return
    setLoadingEarlier(true)
    // Capture the height now; the messages effect restores the
    // reading position once the older page has rendered above.
    prependRef.current = scrollRef.current?.scrollHeight ?? null
    const { data } = await supabase.from('messages').select(MSG_SELECT)
      .eq('channel_id', channel.id).lt('created_at', messages[0].created_at)
      .order('created_at', { ascending: false }).limit(MSG_PAGE)
    if (data) {
      const page = [...data].reverse()
      setHasEarlier(data.length === MSG_PAGE)
      setMessages(prev => [...page.filter(m => !prev.some(x => x.id === m.id)), ...prev])
      await mergeReactions(page.map(m => m.id))
      await mergeStars(page.map(m => m.id))
    }
    setLoadingEarlier(false)
  }

  // Parse @mentions from text by checking against known profile names
  function extractMentions(content) {
    if (!content || !profiles.length) return []
    const mentioned = []
    for (const p of profiles) {
      if (!p.full_name) continue
      // Check if @FullName appears anywhere in the content (case-insensitive)
      const escaped = p.full_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`@${escaped}`, 'i')
      if (regex.test(content)) {
        mentioned.push(p.id)
      }
    }
    return mentioned
  }

  async function sendMessage(imageUrl = null) {
    const content = text.trim()
    if (!content && !imageUrl) return

    // Auto-moderation gate (lib/moderation): severe language, spam,
    // flooding and rapid-fire sends are stopped before they land;
    // warnings send but tell the user. Image-only posts skip text rules.
    if (content) {
      const mentionCount = (content.match(/@/g) || []).length
      const verdict = moderateOutgoing(content, {
        channelId: channel.id,
        recentMine: messages.filter(m => m.athlete_id === userId).slice(-6).map(m => m.content),
        mentionCount,
      })
      if (verdict.action === 'block') {
        setModNotice(verdict.reason)
        return
      }
      if (verdict.action === 'warn') {
        setModNotice(verdict.reason)
        setTimeout(() => setModNotice(null), 5000)
      }
    }

    const optimisticId = `optimistic-${Date.now()}`
    const optimisticMsg = {
      id: optimisticId, channel_id: channel.id, athlete_id: userId,
      content: content || null, image_url: imageUrl || null,
      reply_to: replyTo?.id || null, reply_msg: replyTo ? { id: replyTo.id, content: replyTo.content, profiles: replyTo.profiles } : null,
      created_at: new Date().toISOString(), profiles: profile, optimistic: true,
    }
    pinnedRef.current = true
    setMessages(prev => [...prev, optimisticMsg])
    setText('')
    clearDraft(channel.id)
    setReplyTo(null)
    setSending(true)

    const payload = {
      channel_id: channel.id, athlete_id: userId,
      content: content || null, image_url: imageUrl || null,
      reply_to: replyTo?.id || null,
    }
    const ok = await attemptSend(payload, optimisticId)
    if (!ok) {
      // M2b outbox: a failed send no longer vanishes. It stays in the
      // thread as a failed bubble and in the durable queue for retry.
      setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, optimistic: false, failed: true } : m))
      outboxAdd({ localId: optimisticId, channel_id: channel.id, content: payload.content, image_url: payload.image_url, reply_to: payload.reply_to })
    }
    setSending(false)
  }

  // One insert + all post-send side effects, shared by the live send
  // path and outbox retries. Returns true when the message landed.
  async function attemptSend(payload, localId) {
    const { data, error } = await supabase.from('messages').insert(payload).select(MSG_SELECT).single()
    if (error || !data) return false
    setMessages(prev => prev.map(m => m.id === localId ? data : m))
    outboxRemove(localId)
    // Analytics: engagement is counted by channel category only —
    // never content (reporting-suite governance).
    track('message_posted', { category: raceChannelKind(channel) ? 'race' : (channel.type === 'dm' ? 'dm' : (channel.category || 'general')) })
    // Mark channel as read for sender — use a timestamp slightly ahead to ensure
    // the just-sent message is always counted as read by get_unread_counts
    const readAt = new Date(Date.now() + 1000).toISOString()
    await supabase.from('channel_reads').upsert(
      { channel_id: channel.id, athlete_id: userId, last_read_at: readAt },
      { onConflict: 'channel_id,athlete_id' }
    )
    onMarkRead?.()
    // Insert mentions
    const mentionedIds = extractMentions(payload.content || '')
    if (mentionedIds.length > 0) {
      const mentionRows = mentionedIds.filter(id => id !== userId).map(id => ({
        message_id: data.id, mentioned_user_id: id, channel_id: channel.id,
      }))
      const { error: mentionError } = await supabase.from('message_mentions').insert(mentionRows)
      if (mentionError) console.error('[Mentions] insert error:', mentionError.message)
      if (!mentionedIds.includes(userId)) onMention?.()
    }
    return true
  }

  async function retrySend(msg) {
    outboxBump(msg.id)
    const payload = {
      channel_id: channel.id, athlete_id: userId,
      content: msg.content || null, image_url: msg.image_url || null,
      media_path: msg.media_path || null, media_kind: msg.media_kind || null,
      audio_duration_s: msg.audio_duration_s || null,
      reply_to: msg.reply_to || null,
    }
    const ok = await attemptSend(payload, msg.id)
    if (!ok) setModNotice('Still could not send — it stays queued and will retry when you are back online.')
    else setModNotice(null)
  }

  async function toggleStar(msg) {
    if (starredIds.has(msg.id)) {
      const { error } = await supabase.from('message_stars').delete()
        .eq('athlete_id', userId).eq('message_id', msg.id)
      if (!error) setStarredIds(prev => { const next = new Set(prev); next.delete(msg.id); return next })
    } else {
      const { error } = await supabase.from('message_stars').insert({ athlete_id: userId, message_id: msg.id })
      if (!error) setStarredIds(prev => new Set(prev).add(msg.id))
    }
  }

  // Delete for everyone: soft delete (deleted_at) — the row stays so
  // replies and receipts keep their shape; everyone sees a tombstone.
  async function deleteMessage(msg) {
    if (!window.confirm('Delete this message for everyone?')) return
    const now = new Date().toISOString()
    const { error } = await supabase.from('messages').update({ deleted_at: now }).eq('id', msg.id)
    if (!error) setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, deleted_at: now } : m))
  }

  // M3 — media sends ride the same optimistic + attemptSend path as
  // text. The upload happens BEFORE the insert, so a failed insert
  // leaves a durable outbox entry keyed by media_path (no re-upload
  // needed on retry) — media sends now survive offline too.
  async function sendMediaMessage(media, localPreviewUrl = null) {
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimisticMsg = {
      id: optimisticId, channel_id: channel.id, athlete_id: userId,
      content: null, image_url: null, ...media,
      reply_to: replyTo?.id || null,
      reply_msg: replyTo ? { id: replyTo.id, content: replyTo.content, profiles: replyTo.profiles } : null,
      created_at: new Date().toISOString(), profiles: profile, optimistic: true,
      local_preview: localPreviewUrl,
    }
    pinnedRef.current = true
    setMessages(prev => [...prev, optimisticMsg])
    const replyId = replyTo?.id || null
    setReplyTo(null)
    const payload = {
      channel_id: channel.id, athlete_id: userId,
      content: null, image_url: null, reply_to: replyId, ...media,
    }
    const ok = await attemptSend(payload, optimisticId)
    if (!ok) {
      setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, optimistic: false, failed: true } : m))
      outboxAdd({ localId: optimisticId, channel_id: channel.id, content: null, image_url: null, reply_to: replyId, ...media })
    }
  }

  // M3 — images: compressed client-side, multi-select, uploaded to
  // the PRIVATE message-media bucket (the public avatars bucket is
  // retired for message media; avatars themselves stay there).
  async function handleImageUpload(e) {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        setModNotice('That image is over 25 MB and was skipped.')
        continue
      }
      try {
        const { blob, ext } = await compressImageFile(file)
        const path = mediaPathFor(channel.id, userId, ext)
        const { error } = await supabase.storage.from('message-media')
          .upload(path, blob, { contentType: blob.type || 'image/jpeg' })
        if (error) {
          setModNotice('Image upload failed — check your connection and try again.')
          continue
        }
        await sendMediaMessage({ media_path: path, media_kind: 'image', audio_duration_s: null })
      } catch {
        setModNotice('Image upload failed — check your connection and try again.')
      }
    }
    setUploading(false)
  }

  // ─── Voice notes (M3) — MediaRecorder, 5-minute cap ───────────────
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setModNotice('Voice notes are not supported in this browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recStreamRef.current = stream
      const mime = pickAudioMime(AUDIO_MIME_CANDIDATES, m => MediaRecorder.isTypeSupported(m))
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recChunksRef.current = []
      recDiscardRef.current = false
      rec.ondataavailable = ev => { if (ev.data && ev.data.size) recChunksRef.current.push(ev.data) }
      rec.onstop = handleRecStop
      mediaRecorderRef.current = rec
      recStartRef.current = Date.now()
      setRecElapsed(0)
      setRecState('recording')
      recTimerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - recStartRef.current) / 1000)
        setRecElapsed(s)
        if (s >= VOICE_NOTE_MAX_S) stopRecording()
      }, 250)
      rec.start(250)
    } catch {
      setModNotice('Microphone access was blocked — allow mic access to send a voice note.')
    }
  }

  function handleRecStop() {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    recStreamRef.current?.getTracks().forEach(t => t.stop())
    recStreamRef.current = null
    if (recDiscardRef.current) {
      recDiscardRef.current = false
      setRecState('idle')
      return
    }
    const mime = mediaRecorderRef.current?.mimeType || 'audio/webm'
    const blob = new Blob(recChunksRef.current, { type: mime })
    const duration = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000))
    if (!blob.size) { setRecState('idle'); return }
    setRecPreview({ blob, url: URL.createObjectURL(blob), duration, mime })
    setRecState('preview')
  }

  function stopRecording() {
    try { mediaRecorderRef.current?.stop() } catch { /* already stopped */ }
  }

  function cancelRecording() {
    recDiscardRef.current = true
    stopRecording()
  }

  function discardPreview() {
    if (recPreview?.url) URL.revokeObjectURL(recPreview.url)
    setRecPreview(null)
    setRecState('idle')
  }

  async function sendRecording() {
    const p = recPreview
    if (!p) return
    const path = mediaPathFor(channel.id, userId, audioExtForMime(p.mime))
    setUploading(true)
    const { error } = await supabase.storage.from('message-media')
      .upload(path, p.blob, { contentType: p.mime })
    setUploading(false)
    if (error) {
      setModNotice('Voice note upload failed — check your connection and try sending again.')
      return
    }
    const previewUrl = p.url
    setRecPreview(null)
    setRecState('idle')
    await sendMediaMessage(
      { media_path: path, media_kind: 'audio', audio_duration_s: p.duration },
      previewUrl
    )
  }

  async function toggleReaction(messageId, emoji) {
    setShowEmojiPicker(null)
    const existing = (reactions[messageId] || []).find(r => r.athlete_id === userId && r.emoji === emoji)
    if (existing) {
      await supabase.from('message_reactions').delete().eq('id', existing.id)
      setReactions(prev => ({ ...prev, [messageId]: (prev[messageId] || []).filter(r => r.id !== existing.id) }))
    } else {
      const { data, error } = await supabase.from('message_reactions').insert({ message_id: messageId, athlete_id: userId, emoji, channel_id: channel.id }).select().single()
      if (!error && data) setReactions(prev => ({ ...prev, [messageId]: [...(prev[messageId] || []), data] }))
    }
  }

  async function saveEdit() {
    const content = editText.trim()
    if (!content || !editingMsg) return
    // WhatsApp's edit window is 15 minutes; enforced client-side
    // (the button also hides) — a stale edit form fails honestly.
    if (Date.now() - new Date(editingMsg.created_at).getTime() >= 15 * 60 * 1000) {
      setModNotice('The 15-minute edit window has closed for that message.')
      setEditingMsg(null)
      setEditText('')
      return
    }
    const { error } = await supabase.from('messages')
      .update({ content, edited_at: new Date().toISOString() })
      .eq('id', editingMsg.id)
    if (!error) {
      setMessages(prev => prev.map(m => m.id === editingMsg.id ? { ...m, content, edited_at: new Date().toISOString() } : m))
    }
    setEditingMsg(null)
    setEditText('')
  }

  // Handle @mention detection in textarea
  function handleTextChange(e) {
    const val = e.target.value
    setText(val)
    setDraft(channel.id, val)
    noteTyping()
    const cursor = e.target.selectionStart
    const textUpToCursor = val.slice(0, cursor)
    const atMatch = textUpToCursor.match(/@(\w[\w\s]*)$/)
    if (atMatch) {
      const q = atMatch[1].toLowerCase()
      const filtered = profiles.filter(p => p.full_name?.toLowerCase().includes(q) && p.id !== userId)
      setMentionQuery({ query: q, filtered, atIndex: textUpToCursor.lastIndexOf('@') })
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
    }
  }

  function insertMention(p) {
    if (!mentionQuery) return
    const before = text.slice(0, mentionQuery.atIndex)
    const after = text.slice(mentionQuery.atIndex + mentionQuery.query.length + 1)
    const newText = `${before}@${p.full_name} ${after}`
    setText(newText)
    setMentionQuery(null)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e) {
    if (mentionQuery?.filtered?.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionQuery.filtered.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)) }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionQuery.filtered[mentionIndex]); return }
      if (e.key === 'Escape') { setMentionQuery(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const groupedMessages = messages.reduce((acc, msg, i) => {
    const prev = messages[i - 1]
    const sameAuthor = prev?.athlete_id === msg.athlete_id && !msg.reply_to
    const closeInTime = prev && (new Date(msg.created_at) - new Date(prev.created_at)) < 5 * 60 * 1000
    // WhatsApp date divider: breaks the run and labels the day.
    const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(msg.created_at).toDateString()
    acc.push({ ...msg, showHeader: !sameAuthor || !closeInTime || !!msg.reply_to || newDay, showDate: newDay, dateLabel: newDay ? waDayLabel(msg.created_at) : null })
    return acc
  }, [])

  const displayName = channelDisplayName(channel)
  const accessLabel = channelAccessLabel(channel)
  // M2a receipts derivation (channel_reads → ticks / seen-by)
  const rMap = readsMap(channelReads)
  const profilesById = {}
  profiles.forEach(p => { profilesById[p.id] = p })
  const dmPeer = channel.type === 'dm' ? dmOtherProfile(channel, userId) : null
  const dmPeerReadAt = dmPeer ? (channelReads.find(r => r.athlete_id === dmPeer.id)?.last_read_at || null) : null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: '#111' }}>
        {isMobile && <button aria-label="Back" onClick={onBack} style={{ background: 'none', border: 'none', color: '#999', fontSize: '20px', cursor: 'pointer', padding: '0', marginRight: '4px' }}>←</button>}
        {channel.type === 'dm' ? (
          // DM header — show other person's avatar + name
          (() => {
            const other = dmOtherProfile(channel, session.user.id)
            return (
              <>
                <Avatar profile={other} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '16px', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{other?.full_name || 'DM'}</div>
                  <div style={{ fontSize: '12px', color: typingUsers.length ? 'var(--brand)' : peerOnline ? '#7d7d7d' : '#555' }}>
                    {typingUsers.length ? 'typing…' : peerOnline ? 'online' : 'Direct message'}
                  </div>
                </div>
              </>
            )
          })()
        ) : (
          <>
            <ChannelDisc ch={channel} size={38} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '16px', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
              {(accessLabel || channel.description) && (
                <div style={{ fontSize: '12px', color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {accessLabel && <span style={{ color: accessLabel === 'Public discussion' ? 'var(--brand)' : 'var(--accent)', fontWeight: 600 }}>{accessLabel}</span>}
                  {accessLabel && channel.description && <span> · </span>}
                  {channel.description}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Messages — history loads on scroll-up now (the old button is
          gone); position is preserved across prepends. */}
      <div ref={scrollRef} onScroll={handleThreadScroll} style={{ flex: 1, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {loadingEarlier && (
          <div style={{ textAlign: 'center', padding: '6px 0 10px', color: '#666', fontSize: '12px', fontFamily: 'Barlow, sans-serif' }}>
            Loading earlier messages…
          </div>
        )}
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', margin: 'auto', color: '#555', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '14px', letterSpacing: '1px', textTransform: 'uppercase' }}>No messages yet — say hello!</div>
        )}
        {groupedMessages.map((msg) => {
          const msgReactions = reactions[msg.id] || []
          const grouped = msgReactions.reduce((acc, r) => { if (!acc[r.emoji]) acc[r.emoji] = []; acc[r.emoji].push(r.athlete_id); return acc }, {})
          const isHovered = hoveredMsg === msg.id
          const isOwn = msg.athlete_id === userId
          const modHidden = !msg.optimistic && shouldHide(msg.content) && !revealedHidden.has(msg.id)

          return (
            <div key={msg.id} id={`msg-${msg.id}`} style={{ marginTop: msg.showHeader ? '10px' : '2px', position: 'relative', background: flashId === msg.id ? 'rgba(var(--highlight-rgb),0.14)' : 'transparent', borderRadius: '12px', transition: 'background 0.6s' }}
              onMouseEnter={() => setHoveredMsg(msg.id)}
              onMouseLeave={() => { setHoveredMsg(null); setShowEmojiPicker(null) }}
            >
              {/* WhatsApp date divider */}
              {msg.showDate && (
                <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0 12px' }}>
                  <span style={{ background: '#1d1d1d', border: '1px solid rgba(255,255,255,0.07)', color: '#9a9a9a', fontSize: '11.5px', fontWeight: 600, padding: '4px 12px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}>{msg.dateLabel}</span>
                </div>
              )}

              {/* WhatsApp bubble row: own messages right in a brand-deep
                  bubble, everyone else left with sender name in-bubble. */}
              {modHidden ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
                  <button
                    onClick={() => setRevealedHidden(prev => new Set(prev).add(msg.id))}
                    style={{ background: '#181818', border: '1px dashed rgba(255,255,255,0.16)', borderRadius: '999px', padding: '6px 14px', fontSize: '12px', color: '#8a8a8a', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}
                  >
                    🛡️ Hidden by auto-moderation · Show
                  </button>
                </div>
              ) : msg.deleted_at ? (
                <div style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start', padding: '1px 0' }}>
                  <div style={{ background: '#181818', border: '1px dashed rgba(255,255,255,0.15)', color: '#777', fontStyle: 'italic', fontSize: '13px', borderRadius: '12px', padding: '7px 12px' }}>
                    🚫 This message was deleted
                  </div>
                </div>
              ) : (
              <div style={{ display: 'flex', justifyContent: isOwn ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '7px' }}>
                {!isOwn && (
                  <div style={{ width: 28, flexShrink: 0, visibility: msg.showHeader ? 'visible' : 'hidden' }}>
                    <Avatar profile={msg.profiles} size={28} />
                  </div>
                )}
                <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    background: isOwn ? 'rgba(var(--brand-rgb),0.24)' : '#1e1e1e',
                    borderRadius: '14px',
                    borderBottomRightRadius: isOwn ? '4px' : '14px',
                    borderBottomLeftRadius: isOwn ? '14px' : '4px',
                    padding: '7px 10px 5px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    opacity: msg.optimistic ? 0.55 : 1,
                    minWidth: '92px',
                  }}>
                    {!isOwn && msg.showHeader && channel.type !== 'dm' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '2px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: msg.profiles?.avatar_color || 'var(--brand)' }}>{msg.profiles?.full_name || 'Athlete'}</span>
                        <MemberChips profile={msg.profiles} />
                      </div>
                    )}
                    {msg.reply_msg && (
                      <div style={{ background: 'rgba(0,0,0,0.28)', borderLeft: '3px solid var(--brand)', borderRadius: '6px', padding: '5px 8px', marginBottom: '5px' }}>
                        <div style={{ color: 'var(--brand)', fontWeight: 600, fontSize: '12px', fontFamily: 'Barlow Condensed, sans-serif' }}>{msg.reply_msg.profiles?.full_name || 'Athlete'}</div>
                        <div style={{ fontSize: '12.5px', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '260px', fontStyle: msg.reply_msg.deleted_at ? 'italic' : 'normal' }}>{msg.reply_msg.deleted_at ? 'This message was deleted' : msg.reply_msg.content}</div>
                      </div>
                    )}
                {msg.content && editingMsg?.id === msg.id ? (
                  // Inline edit input
                  <div style={{ marginTop: '4px' }}>
                    <textarea
                      autoFocus
                      style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(var(--brand-rgb),0.4)', borderRadius: '6px', color: '#fff', padding: '8px 10px', fontSize: '14px', fontFamily: 'Barlow, sans-serif', outline: 'none', resize: 'none', lineHeight: 1.5, minHeight: '40px', maxHeight: '120px', boxSizing: 'border-box' }}
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
                        if (e.key === 'Escape') { setEditingMsg(null); setEditText('') }
                      }}
                    />
                    <div style={{ display: 'flex', gap: '6px', marginTop: '5px' }}>
                      <button onClick={saveEdit} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', padding: '4px 12px', background: 'var(--brand)', border: 'none', borderRadius: '4px', color: '#000', cursor: 'pointer' }}>Save</button>
                      <button onClick={() => { setEditingMsg(null); setEditText('') }} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', padding: '4px 12px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#999', cursor: 'pointer' }}>Cancel</button>
                      <span style={{ fontSize: '11px', color: '#555', alignSelf: 'center' }}>Enter to save · Esc to cancel</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '14px', color: '#ccc', lineHeight: 1.6, wordBreak: 'break-word', opacity: msg.optimistic ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                    <MessageContent content={msg.content} currentUserId={userId} profiles={profiles} />
                    {msg.edited_at && (
                      <span style={{ fontSize: '10px', color: '#555', marginLeft: '6px', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' }}>(edited)</span>
                    )}
                  </div>
                )}
                {msg.content && !msg.deleted_at && <LinkPreview text={msg.content} />}
                {msg.image_url && (
                  <img src={msg.image_url} alt="shared" style={{ maxWidth: '280px', maxHeight: '300px', borderRadius: '8px', marginTop: '4px', display: 'block', cursor: 'pointer', objectFit: 'cover', opacity: msg.optimistic ? 0.5 : 1, transition: 'opacity 0.2s' }} onClick={() => setLightbox(msg.image_url)} />
                )}
                {msg.media_kind === 'image' && msg.media_path && (
                  (mediaUrls[msg.media_path] || msg.local_preview) ? (
                    <img src={mediaUrls[msg.media_path] || msg.local_preview} alt="shared" style={{ maxWidth: '280px', maxHeight: '300px', borderRadius: '8px', marginTop: '4px', display: 'block', cursor: 'pointer', objectFit: 'cover', opacity: msg.optimistic ? 0.5 : 1, transition: 'opacity 0.2s' }} onClick={() => setLightbox(mediaUrls[msg.media_path] || msg.local_preview)} />
                  ) : (
                    <div style={{ width: '200px', height: '140px', borderRadius: '8px', marginTop: '4px', background: '#1c1c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', opacity: 0.6 }}>🖼️</div>
                  )
                )}
                {msg.media_kind === 'audio' && msg.media_path && (
                  <VoiceNotePlayer src={mediaUrls[msg.media_path] || msg.local_preview || null} durationS={msg.audio_duration_s} own={isOwn} />
                )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '3px' }}>
                      {msg.failed ? (
                        <button onClick={() => retrySend(msg)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 600, color: '#ff8a7a', padding: 0, fontFamily: 'Barlow, sans-serif' }}>
                          ⚠ Not sent — tap to retry
                        </button>
                      ) : (
                        <>
                          <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.52)' }}>{msg.optimistic ? 'Sending…' : waClock(msg.created_at)}</span>
                          {starredIds.has(msg.id) && <span style={{ fontSize: '10px', marginLeft: '4px', color: 'var(--highlight)' }}>★</span>}
                          {isOwn && !msg.optimistic && channel.type === 'dm' && (
                            <span style={{ fontSize: '10px', marginLeft: '4px', letterSpacing: '-2.5px', fontWeight: 700, color: dmTickState(msg.created_at, dmPeerReadAt) === 'read' ? '#53bdeb' : 'rgba(255,255,255,0.45)' }}>
                              {dmTickState(msg.created_at, dmPeerReadAt) === 'read' ? '✓✓' : '✓'}
                            </span>
                          )}
                          {isOwn && !msg.optimistic && channel.type !== 'dm' && (
                            <button onClick={() => setInfoMsg(msg)} aria-label="Message info — who has read this"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', fontWeight: 700, letterSpacing: '-2.5px', marginLeft: '4px', padding: 0, lineHeight: 1, color: seenByProfiles(msg, rMap, profilesById, userId).length ? '#53bdeb' : 'rgba(255,255,255,0.4)' }}>
                              {seenByProfiles(msg, rMap, profilesById, userId).length ? '✓✓' : '✓'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>{/* /bubble */}

                {/* Reaction pills */}
                {!msg.deleted_at && Object.keys(grouped).length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {Object.entries(grouped).map(([emoji, userIds]) => (
                      <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)}
                        style={{ display: 'flex', alignItems: 'center', gap: '3px', background: userIds.includes(userId) ? 'rgba(var(--brand-rgb),0.1)' : '#1a1a1a', border: `1px solid ${userIds.includes(userId) ? 'rgba(var(--brand-rgb),0.4)' : 'rgba(255,255,255,0.1)'}`, borderRadius: '12px', padding: '2px 8px', fontSize: '13px', cursor: 'pointer', color: '#bbb' }}>
                        {emoji} <span style={{ fontSize: '11px', fontFamily: 'Barlow Condensed, sans-serif' }}>{userIds.length}</span>
                      </button>
                    ))}
                  </div>
                )}
                </div>{/* /bubble column */}
              </div>)}{/* /bubble row */}

              {/* Hover actions */}
              {isHovered && !msg.optimistic && !modHidden && !msg.deleted_at && !msg.failed && (
                <div style={{ position: 'absolute', right: 0, top: '-8px', display: 'flex', gap: '2px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '3px 6px', zIndex: 5 }}>
                  {QUICK_EMOJIS.slice(0, 4).map(e => (
                    <button key={e} onClick={() => toggleReaction(msg.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px', lineHeight: 1 }}>{e}</button>
                  ))}
                  <button onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px', lineHeight: 1, color: '#555' }}>+</button>
                  <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
                  <button onClick={() => { setReplyTo(msg); textareaRef.current?.focus() }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px 4px', lineHeight: 1, color: '#999', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' }}>↩ Reply</button>
                  <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
                  <button onClick={() => toggleStar(msg)} aria-label={starredIds.has(msg.id) ? 'Unstar message' : 'Star message'} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px 4px', lineHeight: 1, color: starredIds.has(msg.id) ? 'var(--highlight)' : '#999' }}>{starredIds.has(msg.id) ? '★' : '☆'}</button>
                  {msg.athlete_id === userId && msg.content && (Date.now() - new Date(msg.created_at).getTime() < 15 * 60 * 1000) && (
                    <>
                      <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
                      <button onClick={() => { setEditingMsg(msg); setEditText(msg.content) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px 4px', lineHeight: 1, color: '#999', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' }}>✏️ Edit</button>
                    </>
                  )}
                  {msg.athlete_id === userId && (
                    <>
                      <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
                      <button onClick={() => deleteMessage(msg)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px 4px', lineHeight: 1, color: '#ff8a7a', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' }}>Delete</button>
                    </>
                  )}
                </div>
              )}

              {/* Full emoji picker */}
              {showEmojiPicker === msg.id && (
                <div style={{ position: 'absolute', bottom: '28px', right: 0, background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px', width: '200px', zIndex: 10, boxShadow: '0 -4px 20px rgba(0,0,0,0.4)' }}>
                  {ALL_EMOJIS.map(e => (
                    <button key={e} onClick={() => toggleReaction(msg.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', padding: '3px', borderRadius: '4px' }}>{e}</button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* New-messages pill: appears instead of yanking the scroll when
          messages land while reading history. */}
      {unseenNew > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 0', background: '#111' }}>
          <button onClick={() => { pinnedRef.current = true; setUnseenNew(0); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); markReadNow() }}
            style={{ background: 'var(--brand)', color: '#03292b', border: 'none', borderRadius: '999px', padding: '6px 14px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.4)' }}>
            ↓ {unseenNew} new message{unseenNew > 1 ? 's' : ''}
          </button>
        </div>
      )}
      {channel.type !== 'dm' && typingUsers.length > 0 && (
        <div style={{ background: '#111', padding: '6px 16px 0', fontSize: '12.5px', color: 'var(--brand)', fontStyle: 'italic' }}>
          {typingUsers.length === 1 ? `${typingUsers[0]} is typing…` : typingUsers.length === 2 ? `${typingUsers[0]} and ${typingUsers[1]} are typing…` : 'Several people are typing…'}
        </div>
      )}

      {/* Message info sheet (group seen-by) — portal to body so the
          fixed overlay escapes the scrolling <main> (run-46 rule). */}
      {infoMsg && createPortal((
        <div onClick={() => setInfoMsg(null)} style={{ position: 'fixed', inset: 0, zIndex: 230, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '480px', maxHeight: '70vh', overflow: 'auto', padding: '18px 20px calc(18px + env(safe-area-inset-bottom, 0px))' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ flex: 1, fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#fff' }}>Message info</span>
              <button onClick={() => setInfoMsg(null)} aria-label="Close message info" style={{ background: 'none', border: 'none', color: '#999', fontSize: '18px', cursor: 'pointer', padding: 0 }}>✕</button>
            </div>
            <div style={{ fontSize: '13.5px', color: '#bbb', background: 'rgba(var(--brand-rgb),0.14)', borderRadius: '10px', padding: '8px 12px', marginBottom: '14px', wordBreak: 'break-word' }}>
              {infoMsg.content ? infoMsg.content.slice(0, 140) : infoMsg.media_kind === 'audio' ? '🎤 Voice message' : '📷 Photo'}
              <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{waClock(infoMsg.created_at)}</div>
            </div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#888', marginBottom: '8px' }}>
              Read by {seenByProfiles(infoMsg, rMap, profilesById, userId).length}
            </div>
            {seenByProfiles(infoMsg, rMap, profilesById, userId).map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0' }}>
                <Avatar profile={s.profile} size={32} />
                <span style={{ flex: 1, fontSize: '14px', color: '#ddd' }}>{s.profile?.full_name || 'Athlete'}</span>
                <span style={{ fontSize: '11.5px', color: '#777' }}>{waClock(new Date(s.readAt).toISOString())}</span>
              </div>
            ))}
            {seenByProfiles(infoMsg, rMap, profilesById, userId).length === 0 && (
              <div style={{ fontSize: '13px', color: '#666', padding: '4px 0 8px' }}>Not read by anyone else yet.</div>
            )}
          </div>
        </div>
      ), document.body)}

      {isOffline && (
        <div style={{ background: 'rgba(255,138,122,0.12)', borderTop: '1px solid rgba(255,138,122,0.3)', padding: '7px 16px', fontSize: '12.5px', color: '#ffb4a6', textAlign: 'center' }}>
          You're offline — messages will queue here and send when you reconnect.
        </div>
      )}

      {/* Input area — hidden for readonly channels unless admin */}
      {channel.is_readonly && profile?.role !== 'admin' ? (
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#111', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>📢</span>
          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', letterSpacing: '1px', color: '#555', textTransform: 'uppercase' }}>Announcements — admin posts only</span>
        </div>
      ) : (
      <div style={{ padding: '8px 16px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#111', flexShrink: 0 }}>
        {/* Reply banner */}
        {replyTo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px 6px 0 0', padding: '6px 12px', marginBottom: '-4px' }}>
            <span style={{ fontSize: '12px', color: '#555' }}>↩ Replying to</span>
            <span style={{ fontSize: '12px', color: 'var(--brand)', fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 600 }}>{replyTo.profiles?.full_name || 'Athlete'}</span>
            <span style={{ fontSize: '12px', color: '#555', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{replyTo.content}</span>
            <button aria-label="Cancel reply" onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', color: '#555', fontSize: '16px', cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0 }}>×</button>
          </div>
        )}

        {/* Voice-note recording / preview bars (M3) */}
        {recState === 'recording' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,90,80,0.08)', border: '1px solid rgba(255,90,80,0.35)', borderRadius: '10px', padding: '8px 12px', marginBottom: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff5a50', animation: 'ttl-pulse 1s ease-in-out infinite', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: '13px', color: '#ffb4a6' }}>Recording… {formatDuration(recElapsed)} / {formatDuration(VOICE_NOTE_MAX_S)}</span>
            <button onClick={cancelRecording} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#ccc', fontSize: '12px', padding: '5px 10px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Cancel</button>
            <button onClick={stopRecording} style={{ background: 'var(--brand)', border: 'none', borderRadius: '6px', color: '#03292b', fontSize: '12px', fontWeight: 700, padding: '5px 12px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Done</button>
          </div>
        )}
        {recState === 'preview' && recPreview && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '8px 12px', marginBottom: '6px' }}>
            <audio controls src={recPreview.url} style={{ flex: 1, height: '34px', minWidth: 0 }} />
            <span style={{ fontSize: '12px', color: '#888', fontFamily: 'Barlow Condensed, sans-serif' }}>{formatDuration(recPreview.duration)}</span>
            <button onClick={discardPreview} aria-label="Delete voice note" style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#ff8a7a', fontSize: '12px', padding: '5px 10px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Delete</button>
            <button onClick={sendRecording} disabled={uploading} style={{ background: 'var(--brand)', border: 'none', borderRadius: '6px', color: '#03292b', fontSize: '12px', fontWeight: 700, padding: '5px 12px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>{uploading ? 'Sending…' : 'Send'}</button>
          </div>
        )}

        {/* Auto-moderation notice */}
        {lightbox && (
          <div
            onClick={() => setLightbox(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          >
            <img src={lightbox} alt="shared" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '10px', objectFit: 'contain' }} />
            <button onClick={() => setLightbox(null)} aria-label="Close image" style={{ position: 'absolute', top: 'calc(12px + env(safe-area-inset-top, 0px))', right: '14px', width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', fontSize: '16px', cursor: 'pointer' }}>✕</button>
          </div>
        )}
        {modNotice && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(var(--highlight-rgb),0.1)', border: '1px solid rgba(var(--highlight-rgb),0.35)', borderRadius: '10px', padding: '8px 12px', marginBottom: '6px' }}>
            <span style={{ fontSize: '13px' }}>🛡️</span>
            <span style={{ flex: 1, fontSize: '12.5px', color: '#e8d9a8', lineHeight: 1.4 }}>{modNotice}</span>
            <button aria-label="Dismiss notice" onClick={() => setModNotice(null)} style={{ background: 'none', border: 'none', color: '#999', fontSize: '15px', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
          </div>
        )}

        {/* @mention dropdown */}
        {mentionQuery?.filtered?.length > 0 && (
          <div style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', marginBottom: '6px', overflow: 'hidden', maxHeight: '160px', overflowY: 'auto' }}>
            {mentionQuery.filtered.slice(0, 6).map((p, i) => (
              <button key={p.id} onClick={() => insertMention(p)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', background: i === mentionIndex ? 'rgba(var(--brand-rgb),0.1)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <Avatar profile={p} size={24} idx={i} />
                <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '14px', color: '#fff' }}>{p.full_name}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.09)', borderRadius: replyTo ? '0 0 24px 24px' : '24px', padding: '6px 8px 6px 14px' }}>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleImageUpload} />
          <button onClick={() => fileRef.current.click()} style={{ background: 'none', border: 'none', color: '#555', fontSize: '20px', cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0 }}>📎</button>
          <textarea
            ref={textareaRef}
            style={{ flex: 1, background: 'none', border: 'none', color: '#fff', fontSize: '14px', fontFamily: 'Barlow, sans-serif', outline: 'none', resize: 'none', lineHeight: 1.5, minHeight: '20px', maxHeight: '120px', padding: '0' }}
            placeholder={channel.type === 'dm' ? `Message ${dmOtherProfile(channel, session.user.id)?.full_name?.split(' ')[0] || 'DM'}…` : `Message #${displayName} — type @ to mention`}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setShowInputEmoji(p => !p)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', padding: '0', lineHeight: 1 }}>😊</button>
            {showInputEmoji && (
              <div style={{ position: 'absolute', bottom: '30px', right: 0, background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px', width: '200px', zIndex: 10, boxShadow: '0 -4px 20px rgba(0,0,0,0.4)' }}>
                {ALL_EMOJIS.map(e => (
                  <button key={e} onClick={() => { setText(p => p + e); setShowInputEmoji(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', padding: '3px', borderRadius: '4px' }}>{e}</button>
                ))}
              </div>
            )}
          </div>
          {(text.trim() || uploading) ? (
            <button onClick={() => sendMessage()} disabled={sending || uploading} aria-label="Send message"
              style={{ background: 'var(--brand)', border: 'none', borderRadius: '50%', width: '40px', height: '40px', color: '#03292b', fontSize: '16px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(var(--brand-rgb),0.35)' }}>
              {uploading || sending ? '…' : '➤'}
            </button>
          ) : recState === 'idle' ? (
            <button onClick={startRecording} aria-label="Record a voice note"
              style={{ background: 'var(--brand)', border: 'none', borderRadius: '50%', width: '40px', height: '40px', color: '#03292b', fontSize: '16px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(var(--brand-rgb),0.35)' }}>
              🎤
            </button>
          ) : null}
        </div>
      </div>
      )}
    </div>
  )
}


// ─── DMGroup — sidebar section for direct messages ───────────────────────────
function DMGroup({ dmChannels, selected, unread, lastMessages, userId, onSelect, onNewDm }) {
  const [open, setOpen] = useState(true)
  const dmUnread = dmChannels.reduce((sum, ch) => sum + (unread[ch.id] || 0), 0)

  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '12px 20px 5px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: '#444', flex: 1 }}>Direct Messages</span>
        {!open && dmUnread > 0 && (
          <span style={{ background: 'var(--brand)', color: '#000', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10px', fontWeight: 700, borderRadius: '8px', padding: '1px 6px' }}>{dmUnread}</span>
        )}
        <span style={{ fontSize: '10px', color: '#333', marginLeft: '4px' }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <>
          {dmChannels.map(ch => {
            const other = dmOtherProfile(ch, userId)
            const isSelected = selected?.id === ch.id
            const unreadCount = unread[ch.id] || 0
            const last = lastMessages?.[ch.id]
            const preview = last ? (last.content || (last.media_kind === 'audio' ? '🎤 Voice message' : (last.media_kind === 'image' || last.image_url) ? '📷 Photo' : '')) : ''

            return (
              <button
                key={ch.id}
                onClick={() => onSelect(ch)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  width: '100%', padding: '8px 16px 8px 20px',
                  background: isSelected ? 'rgba(var(--brand-rgb),0.07)' : 'none',
                  border: 'none',
                  borderLeft: isSelected ? '2px solid var(--brand)' : '2px solid transparent',
                  cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
                }}
              >
                <Avatar profile={other} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '14px', fontWeight: unreadCount > 0 ? 700 : 500, color: isSelected ? '#fff' : unreadCount > 0 ? '#ddd' : '#777', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                    {other?.full_name || 'DM'}
                  </div>
                  {preview && (
                    <div style={{ fontSize: '11px', color: unreadCount > 0 ? '#999' : '#444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '1px' }}>
                      {preview}
                    </div>
                  )}
                </div>
                {unreadCount > 0 && (
                  <div style={{ background: 'var(--brand)', color: '#000', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', fontWeight: 700, borderRadius: '8px', padding: '1px 7px', flexShrink: 0 }}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </div>
                )}
              </button>
            )
          })}

          {/* New DM button */}
          <button
            onClick={onNewDm}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '7px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#555', flexShrink: 0 }}>+</div>
            <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', color: '#444', letterSpacing: '0.5px' }}>New message</span>
          </button>
        </>
      )}
    </div>
  )
}

// ─── NewDmModal — athlete picker to start a DM ───────────────────────────────
function NewDmModal({ userId, onClose, onCreated }) {
  const [profiles, setProfiles] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(null) // athlete id being DM'd

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, avatar_color, avatar_url').neq('id', userId).order('full_name')
      .then(({ data }) => { setProfiles(data || []); setLoading(false) })
  }, [])

  const filtered = profiles.filter(p =>
    !query.trim() || p.full_name?.toLowerCase().includes(query.toLowerCase())
  )

  async function startDm(athlete) {
    setStarting(athlete.id)
    const { data, error } = await supabase.rpc('create_dm_channel', { other_athlete_id: athlete.id })
    if (error) { console.error('create_dm_channel error:', error); setStarting(null); return }
    // Supabase wraps scalar RPC returns — unwrap if needed
    const channelId = typeof data === 'string' ? data : (data?.id ?? data)
    if (!channelId) { console.error('create_dm_channel returned no id:', data); setStarting(null); return }
    // Fetch both members via security definer RPC (RLS blocks direct channel_members reads)
    const { data: dmPeers } = await supabase.rpc('get_dm_peers', { p_channel_ids: [channelId] })
    const dmChannel = {
      id: channelId, type: 'dm',
      dm_members: (dmPeers || []).map(m => ({ id: m.id, full_name: m.full_name, avatar_color: m.avatar_color, avatar_url: m.avatar_url })).filter(Boolean),
    }
    onCreated(dmChannel)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', borderTop: '3px solid #a78bfa', borderRadius: '10px', padding: '2rem', width: '100%', maxWidth: '400px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '20px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#a78bfa', marginBottom: '1.25rem' }}>New Message</div>

        <input
          autoFocus
          placeholder="Search teammates…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ width: '100%', background: '#111', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff', padding: '10px 12px', fontSize: '14px', fontFamily: 'Barlow, sans-serif', outline: 'none', boxSizing: 'border-box', marginBottom: '12px' }}
        />

        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '2rem' }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '2rem' }}>No teammates found</div>
          ) : filtered.map(athlete => (
            <button
              key={athlete.id}
              onClick={() => startDm(athlete)}
              disabled={!!starting}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 8px', background: starting === athlete.id ? 'rgba(167,139,250,0.1)' : 'none', border: 'none', borderRadius: '6px', cursor: 'pointer', textAlign: 'left', marginBottom: '2px' }}
            >
              <Avatar profile={athlete} size={36} />
              <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', color: '#fff', fontWeight: 600 }}>{athlete.full_name}</span>
              {starting === athlete.id && <span style={{ fontSize: '12px', color: '#a78bfa', marginLeft: 'auto' }}>Opening…</span>}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={onClose} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', letterSpacing: '1px', textTransform: 'uppercase', padding: '10px 20px', background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px', color: '#999', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function NewChannelModal({ session, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('general')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const categoryOptions = [
    { value: 'general',  label: 'General',        icon: '#'  },
    { value: 'training', label: 'Training',        icon: '💪' },
    { value: 'interest', label: 'Groups',          icon: '👥' },
    { value: 'regions',  label: 'Regions',         icon: '📍' },
    { value: 'race',     label: 'Race Logistics',  icon: '🔒' },
  ]

  async function create() {
    const n = name.trim().toLowerCase().replace(/\s+/g, '-')
    if (!n) { setError('Please enter a channel name'); return }
    setSaving(true)
    const type = category === 'general' ? 'general' : category === 'race' ? 'race' : 'topic'
    // Race channels use the live-DB encoding (type 'race' + '-logistics'
    // name suffix): the live type CHECK constraint rejects new type values
    // until migration 0003 widens it. See lib/channels.js.
    const channelName = category === 'race' && !n.endsWith('-logistics') ? `${n}-logistics` : n
    const { data, error: err } = await supabase.from('channels')
      .insert({ name: channelName, type, category, description: description.trim() || null, created_by: session.user.id })
      .select('*, races(name)').single()
    if (err) { setError(err.message); setSaving(false); return }
    onCreated(data)
  }

  const inputStyle = { width: '100%', background: '#111', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff', padding: '10px 12px', fontSize: '14px', fontFamily: 'Barlow, sans-serif', outline: 'none', boxSizing: 'border-box' }
  const labelStyle = { display: 'block', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#999', marginBottom: '6px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', borderTop: '3px solid var(--brand)', borderRadius: '10px', padding: '2rem', width: '100%', maxWidth: '420px' }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '20px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--brand)', marginBottom: '1.5rem' }}>New Channel</div>

        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Category</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {categoryOptions.map(opt => (
              <button key={opt.value} onClick={() => setCategory(opt.value)}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: '6px', border: '1px solid', borderColor: category === opt.value ? 'var(--brand)' : 'rgba(255,255,255,0.12)', background: category === opt.value ? 'rgba(var(--brand-rgb),0.12)' : 'transparent', color: category === opt.value ? 'var(--brand)' : '#888', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.5px' }}>
                <span>{opt.icon}</span>{opt.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Channel Name</label>
          <input style={inputStyle} placeholder="e.g. southeast-region" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Description (optional)</label>
          <input style={inputStyle} placeholder="What's this channel about?" value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        {error && <div style={{ color: 'var(--accent)', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', letterSpacing: '1px', textTransform: 'uppercase', padding: '10px 20px', background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px', color: '#999', cursor: 'pointer' }}>Cancel</button>
          <button onClick={create} disabled={saving} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '10px 24px', background: 'var(--brand)', border: 'none', borderRadius: '5px', color: '#000', cursor: 'pointer' }}>{saving ? 'Creating...' : 'Create'}</button>
        </div>
      </div>
    </div>
  )
}
