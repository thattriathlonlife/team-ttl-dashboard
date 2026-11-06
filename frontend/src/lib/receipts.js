// receipts.js — read-receipt derivation for messaging (M2a).
//
// Receipts are DERIVED from channel_reads (one row per athlete per
// channel carrying last_read_at) — there is no per-message receipt
// table, same as WhatsApp's own model of "read up to a point".
// Pure functions, unit-tested in test/receipts.test.mjs.

// reads: array of { athlete_id, last_read_at } rows for ONE channel.
// Returns Map athleteId -> last_read_at (ms epoch).
export function readsMap(reads) {
  const map = new Map()
  for (const r of reads || []) {
    if (!r || !r.athlete_id) continue
    const t = new Date(r.last_read_at).getTime()
    if (Number.isNaN(t)) continue
    if (!map.has(r.athlete_id) || map.get(r.athlete_id) < t) map.set(r.athlete_id, t)
  }
  return map
}

// Has athleteId read at or after this message's timestamp?
export function readBy(map, msgCreatedAt, athleteId) {
  const t = map.get(athleteId)
  if (t === undefined) return false
  return t >= new Date(msgCreatedAt).getTime()
}

// DM tick state for an own message: 'read' once the peer's read marker
// passes the message, otherwise 'sent' (server has it; for a
// server-centric app, stored = delivered).
export function dmTickState(msgCreatedAt, peerReadAt) {
  if (!peerReadAt) return 'sent'
  return new Date(peerReadAt).getTime() >= new Date(msgCreatedAt).getTime() ? 'read' : 'sent'
}

// Group seen-by: profiles (from a by-id map) who have read this
// message, excluding the author. Order: earliest reader first.
export function seenByProfiles(msg, map, profilesById, authorId) {
  const out = []
  for (const [athleteId, t] of map.entries()) {
    if (athleteId === authorId) continue
    if (t >= new Date(msg.created_at).getTime()) {
      out.push({ id: athleteId, readAt: t, profile: profilesById?.[athleteId] || null })
    }
  }
  return out.sort((a, b) => a.readAt - b.readAt)
}
