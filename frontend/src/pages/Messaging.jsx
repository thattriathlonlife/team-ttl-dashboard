import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isTeamTier } from '../lib/tier'
import { channelAccessLabel, channelDisplayName, isRaceChannel, isTeamOnlyChannel, raceChannelKind } from '../lib/channels'
import TeamLocked from '../components/TeamLocked'
import { moderateOutgoing, shouldHide } from '../lib/moderation'

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

// Render message content with @mentions highlighted
function MessageContent({ content, currentUserId, profiles }) {
  if (!content) return null
  const parts = content.split(/(@\w[\w\s]*)/g)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('@')) {
          const name = part.slice(1).trim()
          const mentioned = profiles?.find(p => p.full_name?.toLowerCase() === name.toLowerCase())
          const isMe = mentioned?.id === currentUserId
          return (
            <span key={i} style={{
              background: isMe ? 'rgba(var(--accent-rgb),0.2)' : 'rgba(var(--brand-rgb),0.15)',
              color: isMe ? 'var(--accent)' : 'var(--brand)',
              borderRadius: '3px', padding: '0 3px',
              fontWeight: 600,
            }}>{part}</span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

export default function Messaging({ session, profile, onReadChannel }) {
  const [channels, setChannels] = useState([])
  const [selectedChannel, setSelectedChannel] = useState(null)
  const [unreadCounts, setUnreadCounts] = useState({})
  const [mentionCount, setMentionCount] = useState(0)
  const [showSidebar, setShowSidebar] = useState(true)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 680)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showMentions, setShowMentions] = useState(false)
  const [sideFilter, setSideFilter] = useState('all') // sidebar category chips
  const [dmChannels, setDmChannels] = useState([])
  const [showNewDm, setShowNewDm] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [lockedChannel, setLockedChannel] = useState(null)
  const [loading, setLoading] = useState(true)
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
    if (channelId && channels.length > 0) {
      const ch = channels.find(c => c.id === channelId)
      if (ch) openChannel(ch)
    }
    if (dmId && dmChannels.length > 0) {
      const dm = dmChannels.find(c => c.id === dmId)
      if (dm) openChannel(dm)
    }
  }, [searchParams, channels, dmChannels])

  const [lastMessages, setLastMessages] = useState({})

  async function loadChannels() {
    // 3 parallel queries instead of N+1
    const [channelsRes, readsRes, mentionsRes, msgsRes, dmMembersRes] = await Promise.all([
      supabase.from('channels').select('*, races(name)').neq('type', 'dm').order('sort_order').order('name'),
      supabase.from('channel_reads').select('*').eq('athlete_id', userId),
      supabase.from('message_mentions').select('*', { count: 'exact', head: true }).eq('mentioned_user_id', userId).is('seen_at', null),
      // Fetch last message per channel in one query using a recent window
      supabase.from('messages').select('channel_id, content, image_url, created_at, athlete_id, profiles(full_name)').order('created_at', { ascending: false }).limit(300),
      // Fetch this user's DM channel memberships + the other member's profile
      supabase.from('channel_members').select('channel_id, channels!inner(id, type, created_at), athlete:profiles!athlete_id(id, full_name, avatar_color, avatar_url)').eq('athlete_id', userId),
    ])

    setMentionCount(mentionsRes.count || 0)

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

  // Realtime: increment sidebar unread badge instantly when a new message arrives
  // in any channel the user is not currently viewing
  useEffect(() => {
    const sub = supabase.channel('global-message-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const { channel_id, athlete_id, content, image_url, created_at } = payload.new
          // Ignore own messages — sender already marked read in sendMessage
          if (athlete_id === userId) return
          // Update last message preview for sidebar regardless of which channel is open
          setLastMessages(prev => ({
            ...prev,
            [channel_id]: { content, image_url, created_at }
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

  async function openChannel(channel) {
    if (!teamView && isTeamOnlyChannel(channel)) {
      selectedChannelRef.current = null
      setSelectedChannel(null)
      setLockedChannel(channel)
      setShowMentions(false)
      if (isMobile) setShowSidebar(false)
      return
    }
    setLockedChannel(null)
    selectedChannelRef.current = channel
    setSelectedChannel(channel)
    setShowMentions(false)
    if (isMobile) setShowSidebar(false)
    await supabase.from('channel_reads').upsert(
      { channel_id: channel.id, athlete_id: userId, last_read_at: new Date(Date.now() + 1000).toISOString() },
      { onConflict: 'channel_id,athlete_id' }
    )
    setUnreadCounts(prev => ({ ...prev, [channel.id]: 0 }))
    onReadChannel?.()
  }

  async function openMentions() {
    setShowMentions(true)
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
    const allChans = channels.filter(c => !isAnnouncementCh(c))
    const byKind = (k) => allChans.filter(c => raceChannelKind(c) === k)
    const byCats = (cats) => allChans.filter(c => cats.includes(c.category) && !raceChannelKind(c))
    const dmItems = teamView
      ? dmChannels.map(ch => ({ kind: 'dm', ch }))
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
    const sortItems = (arr) => arr.sort((a, b) => (tsOf(b.ch.id) - tsOf(a.ch.id)) || nameOf(a).localeCompare(nameOf(b)))
    return [
      { id: 'groups', label: 'Group chats', items: sortItems(groups) },
      { id: 'team', label: 'Team chats', items: sortItems(team) },
      { id: 'dms', label: 'Direct messages', items: sortItems(dms) },
    ].filter(s => s.items.length > 0)
  })()

  function renderChatItem(item) {
            const ch = item.ch
            const last = lastMessages?.[ch.id]
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
              return (
                <ChatRow
                  key={ch.id}
                  avatar={<Avatar profile={other} size={52} />}
                  name={other?.full_name || 'Direct message'}
                  preview={last ? `${senderPrefix}${last.content || '📷 Photo'}` : 'No messages yet'}
                  time={waListTime(last?.created_at)}
                  unread={unread}
                  selected={isSelected}
                  onClick={() => openChannel(ch)}
                />
              )
            }

            const locked = !teamView && isTeamOnlyChannel(ch)
            const kind = raceChannelKind(ch)
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
                preview={locked ? '🔒 Team only' : last ? `${sender ? `${sender}: ` : ''}${last.content || '📷 Photo'}` : 'No messages yet'}
                time={locked ? '' : waListTime(last?.created_at)}
                unread={locked ? 0 : unread}
                selected={isSelected}
                badge={badge}
                dimmed={locked}
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
            {pinnedAnnouncement && sideFilter === 'all' && (() => {
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
            {sideFilter === 'all' && <ChatRow
              avatar={<div style={{ width: 52, height: 52, borderRadius: '50%', background: '#232323', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0, color: '#999' }}>@</div>}
              name="Mentions"
              preview="Messages where you're tagged"
              unread={mentionCount}
              selected={showMentions}
              onClick={openMentions}
            />}

            {/* The three clean sections (Zack, 2026-10-31) */}
            {sections.map(section => (
              <div key={section.id}>
                <div style={{ fontFamily: 'Barlow, sans-serif', fontSize: '16px', fontWeight: 600, color: '#8a8a8a', padding: '16px 16px 2px' }}>
                  {section.label}
                </div>
                {section.items.map(renderChatItem)}
              </div>
            ))}
            {sections.length === 0 && (
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
            <button onClick={() => { setShowSidebar(true); setLockedChannel(null) }} style={{ background: 'none', border: 'none', color: '#999', fontSize: '20px', cursor: 'pointer', padding: '14px 16px 0' }}>←</button>
          )}
          <TeamLocked feature={lockedChannel.type === 'dm' ? 'Direct messages' : channelDisplayName(lockedChannel)} />
        </div>
      )}

      {/* Message thread */}
      {(!showSidebar || !isMobile) && selectedChannel && !showMentions && (
        <MessageThread
          key={selectedChannel.id}
          channel={selectedChannel}
          session={session}
          profile={profile}
          isMobile={isMobile}
          onBack={() => { setShowSidebar(true); selectedChannelRef.current = null; setSelectedChannel(null) }}
          onMarkRead={() => { setUnreadCounts(prev => ({ ...prev, [selectedChannel.id]: 0 })); onReadChannel?.() }}
          onMention={() => setMentionCount(prev => prev + 1)}
        />
      )}

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

export function ChatRow({ avatar, name, preview, time, unread = 0, selected = false, onClick, badge = null, dimmed = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', gap: '12px', width: '100%', padding: '10px 16px 0',
        background: selected ? 'rgba(255,255,255,0.05)' : 'none',
        border: 'none', cursor: 'pointer', textAlign: 'left', alignItems: 'flex-start',
      }}
    >
      {avatar}
      <div style={{ flex: 1, minWidth: 0, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '11px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: 'Barlow, sans-serif', fontSize: '16px', fontWeight: unread > 0 ? 700 : 600, color: dimmed ? '#777' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.25 }}>
            {name}
          </span>
          {badge}
          {time && (
            <span style={{ fontSize: '12px', color: unread > 0 ? 'var(--brand)' : '#777', flexShrink: 0, fontWeight: unread > 0 ? 600 : 400 }}>
              {time}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: '13.5px', color: dimmed ? '#555' : unread > 0 ? '#bbb' : '#8a8a8a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.35 }}>
            {preview || ' '}
          </span>
          {unread > 0 && (
            <span style={{ background: 'var(--brand)', color: '#03292b', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', minWidth: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0 }}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
      </div>
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
        const preview = last ? (last.content || (last.image_url ? '📎 Image' : '')) : ''
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
      .select('id, content, created_at, athlete_id, profiles(full_name, avatar_color, avatar_url)')
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
        {isMobile && <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#999', fontSize: '20px', cursor: 'pointer', padding: '0', marginRight: '4px' }}>←</button>}
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
                  <Avatar profile={msg?.profiles} size={24} />
                  <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 600, color: '#fff' }}>{msg?.profiles?.full_name || 'Athlete'}</span>
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

function MessageThread({ channel, session, profile, isMobile, onBack, onMarkRead, onMention }) {
  const [messages, setMessages] = useState([])
  const [profiles, setProfiles] = useState([])
  const [reactions, setReactions] = useState({})
  const [text, setText] = useState('')
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

  useEffect(() => {
    loadMessages()
    loadProfiles()
    const sub = supabase.channel(`messages:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channel.id}` },
        async (payload) => {
          setMessages(prev => {
            if (prev.some(m => m.id === payload.new.id)) return prev
            supabase.from('messages').select('*, profiles(full_name, avatar_color, avatar_url), reply_msg:reply_to(id, content, profiles(full_name))').eq('id', payload.new.id).single()
              .then(({ data }) => {
                if (data) {
                  setMessages(p => p.some(m => m.id === data.id) ? p : [...p, data])
                  // Only mark read automatically if the message is from the current user
                  // (they're already looking at it). Other people's messages stay unread
                  // until the user explicitly opens the channel.
                  if (payload.new.athlete_id === userId) onMarkRead()
                }
              })
            return prev
          })
        })
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [channel.id])

  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id
    if (lastId && lastId !== lastMsgIdRef.current) {
      lastMsgIdRef.current = lastId
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  async function loadProfiles() {
    const { data } = await supabase.from('profiles').select('id, full_name, avatar_color, avatar_url')
    if (data) setProfiles(data)
  }

  const MSG_PAGE = 100
  const MSG_SELECT = '*, profiles(full_name, avatar_color, avatar_url), reply_msg:reply_to(id, content, profiles(full_name))'

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
  async function loadMessages() {
    const { data } = await supabase.from('messages').select(MSG_SELECT)
      .eq('channel_id', channel.id).order('created_at', { ascending: false }).limit(MSG_PAGE)
    if (data) {
      const page = [...data].reverse()
      setMessages(page)
      setHasEarlier(data.length === MSG_PAGE)
      await mergeReactions(page.map(m => m.id))
    }
    setTimeout(() => bottomRef.current?.scrollIntoView(), 100)
  }

  async function loadEarlier() {
    if (loadingEarlier || !messages.length) return
    setLoadingEarlier(true)
    const { data } = await supabase.from('messages').select(MSG_SELECT)
      .eq('channel_id', channel.id).lt('created_at', messages[0].created_at)
      .order('created_at', { ascending: false }).limit(MSG_PAGE)
    if (data) {
      const page = [...data].reverse()
      setHasEarlier(data.length === MSG_PAGE)
      setMessages(prev => [...page.filter(m => !prev.some(x => x.id === m.id)), ...prev])
      await mergeReactions(page.map(m => m.id))
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
    setMessages(prev => [...prev, optimisticMsg])
    setText('')
    setReplyTo(null)
    setSending(true)

    const { data, error } = await supabase.from('messages').insert({
      channel_id: channel.id, athlete_id: userId,
      content: content || null, image_url: imageUrl || null,
      reply_to: replyTo?.id || null,
    }).select('*, profiles(full_name, avatar_color, avatar_url), reply_msg:reply_to(id, content, profiles(full_name))').single()

    if (!error && data) {
      setMessages(prev => prev.map(m => m.id === optimisticId ? data : m))
      // Mark channel as read for sender — use a timestamp slightly ahead to ensure
      // the just-sent message is always counted as read by get_unread_counts
      const readAt = new Date(Date.now() + 1000).toISOString()
      await supabase.from('channel_reads').upsert(
        { channel_id: channel.id, athlete_id: userId, last_read_at: readAt },
        { onConflict: 'channel_id,athlete_id' }
      )
      onMarkRead?.()
      // Insert mentions
      const mentionedIds = extractMentions(content || '')
      if (mentionedIds.length > 0) {
        const mentionRows = mentionedIds.filter(id => id !== userId).map(id => ({
          message_id: data.id, mentioned_user_id: id, channel_id: channel.id,
        }))
        const { error: mentionError } = await supabase.from('message_mentions').insert(mentionRows)
        if (mentionError) console.error('[Mentions] insert error:', mentionError.message)
        if (!mentionedIds.includes(userId)) onMention?.()
      }
    } else {
      setMessages(prev => prev.filter(m => m.id !== optimisticId))
    }
    setSending(false)
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5MB'); return }
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `messages/${channel.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('avatars').upload(path, file)
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      await sendMessage(publicUrl)
    }
    setUploading(false)
    e.target.value = ''
  }

  async function toggleReaction(messageId, emoji) {
    setShowEmojiPicker(null)
    const existing = (reactions[messageId] || []).find(r => r.athlete_id === userId && r.emoji === emoji)
    if (existing) {
      await supabase.from('message_reactions').delete().eq('id', existing.id)
      setReactions(prev => ({ ...prev, [messageId]: (prev[messageId] || []).filter(r => r.id !== existing.id) }))
    } else {
      const { data, error } = await supabase.from('message_reactions').insert({ message_id: messageId, athlete_id: userId, emoji }).select().single()
      if (!error && data) setReactions(prev => ({ ...prev, [messageId]: [...(prev[messageId] || []), data] }))
    }
  }

  async function saveEdit() {
    const content = editText.trim()
    if (!content || !editingMsg) return
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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: '#111' }}>
        {isMobile && <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#999', fontSize: '20px', cursor: 'pointer', padding: '0', marginRight: '4px' }}>←</button>}
        {channel.type === 'dm' ? (
          // DM header — show other person's avatar + name
          (() => {
            const other = dmOtherProfile(channel, session.user.id)
            return (
              <>
                <Avatar profile={other} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '16px', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{other?.full_name || 'DM'}</div>
                  <div style={{ fontSize: '12px', color: '#555' }}>Direct message</div>
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

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {hasEarlier && messages.length > 0 && (
          <div style={{ textAlign: 'center', padding: '6px 0 10px' }}>
            <button onClick={loadEarlier} disabled={loadingEarlier} style={{ background: '#1f1f1f', border: '1px solid rgba(255,255,255,0.12)', color: '#ccc', borderRadius: 999, padding: '6px 14px', fontSize: 12, fontFamily: 'Barlow, sans-serif', cursor: 'pointer' }}>
              {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
            </button>
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
            <div key={msg.id} style={{ marginTop: msg.showHeader ? '10px' : '2px', position: 'relative' }}
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
                      <div style={{ fontSize: '13px', fontWeight: 700, color: msg.profiles?.avatar_color || 'var(--brand)', marginBottom: '2px' }}>{msg.profiles?.full_name || 'Athlete'}</div>
                    )}
                    {msg.reply_msg && (
                      <div style={{ background: 'rgba(0,0,0,0.28)', borderLeft: '3px solid var(--brand)', borderRadius: '6px', padding: '5px 8px', marginBottom: '5px' }}>
                        <div style={{ color: 'var(--brand)', fontWeight: 600, fontSize: '12px', fontFamily: 'Barlow Condensed, sans-serif' }}>{msg.reply_msg.profiles?.full_name || 'Athlete'}</div>
                        <div style={{ fontSize: '12.5px', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '260px' }}>{msg.reply_msg.content}</div>
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
                {msg.image_url && (
                  <img src={msg.image_url} alt="shared" style={{ maxWidth: '280px', maxHeight: '300px', borderRadius: '8px', marginTop: '4px', display: 'block', cursor: 'pointer', objectFit: 'cover', opacity: msg.optimistic ? 0.5 : 1, transition: 'opacity 0.2s' }} onClick={() => setLightbox(msg.image_url)} />
                )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '3px' }}>
                      <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.52)' }}>{msg.optimistic ? 'Sending…' : waClock(msg.created_at)}</span>
                    </div>
                  </div>{/* /bubble */}

                {/* Reaction pills */}
                {Object.keys(grouped).length > 0 && (
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
              {isHovered && !msg.optimistic && !modHidden && (
                <div style={{ position: 'absolute', right: 0, top: '-8px', display: 'flex', gap: '2px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '3px 6px', zIndex: 5 }}>
                  {QUICK_EMOJIS.slice(0, 4).map(e => (
                    <button key={e} onClick={() => toggleReaction(msg.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px', lineHeight: 1 }}>{e}</button>
                  ))}
                  <button onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px', lineHeight: 1, color: '#555' }}>+</button>
                  <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
                  <button onClick={() => { setReplyTo(msg); textareaRef.current?.focus() }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px 4px', lineHeight: 1, color: '#999', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' }}>↩ Reply</button>
                  {msg.athlete_id === userId && msg.content && (
                    <>
                      <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />
                      <button onClick={() => { setEditingMsg(msg); setEditText(msg.content) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px 4px', lineHeight: 1, color: '#999', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' }}>✏️ Edit</button>
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
            <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', color: '#555', fontSize: '16px', cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0 }}>×</button>
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
            <button onClick={() => setModNotice(null)} style={{ background: 'none', border: 'none', color: '#999', fontSize: '15px', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
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
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
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
          {(text.trim() || uploading) && (
            <button onClick={() => sendMessage()} disabled={sending || uploading} aria-label="Send message"
              style={{ background: 'var(--brand)', border: 'none', borderRadius: '50%', width: '40px', height: '40px', color: '#03292b', fontSize: '16px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(var(--brand-rgb),0.35)' }}>
              {uploading || sending ? '…' : '➤'}
            </button>
          )}
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
            const preview = last ? (last.content || (last.image_url ? '📎 Image' : '')) : ''

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
