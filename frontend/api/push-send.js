/**
 * Vercel Serverless Function — POST /api/push-send (M4)
 *
 * Web Push fan-out for a just-sent message. Called fire-and-forget
 * from the client's send path with the sender's session JWT; the
 * message itself is re-loaded server-side (the client supplies only
 * ids, never content), and the sender identity comes from the JWT —
 * a caller can only fan out their OWN messages.
 *
 * Who gets pushed (the parity spec's fan-out set):
 *   - DMs: the other member(s)
 *   - @mentions in any channel: the mentioned members
 *   - Announcement (readonly) channels: every entitled member
 * Plain group messages push nobody — opening the app shows the
 * unread badge, exactly like a muted-by-default group chat should.
 * Muted chats (channel_user_state.muted_until in the future) and
 * members who can't see the channel are always skipped.
 *
 * VAPID keys live in private_config (service-role only); dead
 * subscriptions (404/410 from the push service) are pruned.
 */

import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service role — bypasses RLS
)

let vapidReady = null
async function ensureVapid() {
  if (!vapidReady) {
    vapidReady = (async () => {
      const { data, error } = await supabase.from('private_config')
        .select('key, value').in('key', ['vapid_public_key', 'vapid_private_key', 'vapid_subject'])
      if (error) throw error
      const cfg = Object.fromEntries((data || []).map(r => [r.key, r.value]))
      if (!cfg.vapid_public_key || !cfg.vapid_private_key) throw new Error('VAPID keys not configured')
      webpush.setVapidDetails(cfg.vapid_subject || 'https://team-ttl-dashboard.vercel.app', cfg.vapid_public_key, cfg.vapid_private_key)
    })()
  }
  return vapidReady
}

function prettyChannelName(ch) {
  if (ch.type === 'dm') return 'Direct message'
  const base = String(ch.name || 'Chat')
    .replace(/-(discussion|logistics)$/, '')
    .replace(/-/g, ' ')
    .trim()
  return base ? base.replace(/\b\w/g, c => c.toUpperCase()) : 'Chat'
}

function previewOf(msg) {
  if (msg.content) return msg.content.slice(0, 140)
  if (msg.media_kind === 'audio') return '🎤 Voice message'
  if (msg.media_kind === 'image' || msg.image_url) return '📷 Photo'
  return 'New message'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Missing auth' })
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid auth' })
  const senderId = userData.user.id

  const { channel_id, message_id } = req.body || {}
  if (!channel_id || !message_id) return res.status(400).json({ error: 'channel_id and message_id required' })

  const { data: msg } = await supabase.from('messages')
    .select('id, channel_id, athlete_id, content, image_url, media_kind, deleted_at')
    .eq('id', message_id).single()
  if (!msg || msg.channel_id !== channel_id) return res.status(404).json({ error: 'Message not found' })
  if (msg.athlete_id !== senderId) return res.status(403).json({ error: 'Not your message' })
  if (msg.deleted_at) return res.status(200).json({ sent: 0, reason: 'deleted' })

  const { data: channel } = await supabase.from('channels')
    .select('id, name, type, category, is_readonly').eq('id', channel_id).single()
  if (!channel) return res.status(404).json({ error: 'Channel not found' })

  // ── Recipient selection ──────────────────────────────────────────
  let recipientIds = []
  let kind = null
  if (channel.type === 'dm') {
    kind = 'dm'
    const { data: members } = await supabase.from('channel_members')
      .select('athlete_id').eq('channel_id', channel_id)
    recipientIds = (members || []).map(m => m.athlete_id)
  } else {
    const { data: mentions } = await supabase.from('message_mentions')
      .select('mentioned_user_id').eq('message_id', message_id)
    if (mentions?.length) {
      kind = 'mention'
      recipientIds = mentions.map(m => m.mentioned_user_id)
    } else if (channel.is_readonly) {
      kind = 'announcement'
      const { data: entitled } = await supabase.from('profiles')
        .select('id').or('member_class.in.(team,racing_division,pro),role.eq.admin')
      recipientIds = (entitled || []).map(p => p.id)
    }
  }
  recipientIds = [...new Set(recipientIds)].filter(id => id !== senderId)
  if (!recipientIds.length) return res.status(200).json({ sent: 0, reason: kind ? 'no-recipients' : 'no-fanout' })

  // Visibility + mute filters.
  const visible = []
  for (const uid of recipientIds) {
    const { data: can } = await supabase.rpc('channel_visible_to', { cid: channel_id, uid })
    if (can) visible.push(uid)
  }
  const { data: states } = await supabase.from('channel_user_state')
    .select('athlete_id, muted_until').eq('channel_id', channel_id).in('athlete_id', visible)
  const muted = new Set((states || [])
    .filter(s => s.muted_until && new Date(s.muted_until) > new Date())
    .map(s => s.athlete_id))
  const targets = visible.filter(id => !muted.has(id))
  if (!targets.length) return res.status(200).json({ sent: 0, reason: 'all-muted-or-hidden' })

  const { data: subs } = await supabase.from('push_subscriptions')
    .select('id, athlete_id, endpoint, p256dh, auth')
    .eq('kind', 'webpush').in('athlete_id', targets)
  if (!subs?.length) return res.status(200).json({ sent: 0, reason: 'no-subscriptions' })

  const { data: sender } = await supabase.from('profiles')
    .select('full_name').eq('id', senderId).single()
  const senderName = sender?.full_name || 'A teammate'
  const label = prettyChannelName(channel)
  const preview = previewOf(msg)
  const payload = JSON.stringify({
    title: kind === 'dm' ? senderName : label,
    body: kind === 'dm' ? preview : `${senderName}: ${preview}`,
    url: `/messages?${channel.type === 'dm' ? 'dm' : 'channel'}=${channel_id}&highlight=${message_id}`,
    tag: channel_id,
  })

  await ensureVapid()
  let sent = 0, pruned = 0
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 3600 }
      )
      sent++
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', s.id)
        pruned++
      }
    }
  }))
  return res.status(200).json({ sent, pruned, recipients: targets.length, kind })
}
