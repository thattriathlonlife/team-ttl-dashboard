// outbox.js — offline send queue for messaging (M2b).
//
// Text sends that fail (offline, tunnel, dead zone) are kept in a
// localStorage-backed outbox instead of vanishing, and retried when
// the app comes back online or the user taps retry. Media sends
// (M3) enter the queue too: the file is uploaded to the private
// message-media bucket BEFORE the insert, so the queued payload
// only needs the durable media_path — no File has to persist.
//
// The queue operations are pure (unit-tested); the storage wrappers
// are thin. Key: ttl-outbox-v1.

const KEY = 'ttl-outbox-v1'

export function enqueue(list, item) {
  if (!item || !item.localId) return list || []
  const existing = (list || []).find((x) => x.localId === item.localId)
  if (existing) return list
  return [...(list || []), { attempts: 0, queued_at: new Date().toISOString(), ...item }]
}

export function dequeue(list, localId) {
  return (list || []).filter((x) => x.localId !== localId)
}

export function bumpAttempt(list, localId) {
  return (list || []).map((x) =>
    x.localId === localId ? { ...x, attempts: (x.attempts || 0) + 1 } : x
  )
}

export function forChannel(list, channelId) {
  return (list || []).filter((x) => x.channel_id === channelId)
}

export function loadOutbox() {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveOutbox(list) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list || []))
  } catch {
    // storage full/blocked — the in-memory copy still drives retries
  }
}

export function outboxAdd(item) {
  const next = enqueue(loadOutbox(), item)
  saveOutbox(next)
  return next
}

export function outboxRemove(localId) {
  const next = dequeue(loadOutbox(), localId)
  saveOutbox(next)
  return next
}

export function outboxBump(localId) {
  const next = bumpAttempt(loadOutbox(), localId)
  saveOutbox(next)
  return next
}

export function outboxForChannel(channelId) {
  return forChannel(loadOutbox(), channelId)
}
