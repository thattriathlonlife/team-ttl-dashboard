// presence.js — app-wide "who's online" via one Supabase Realtime
// presence channel (M2a). Module singleton, same pattern as
// memberView.js: App initialises it once per session; components
// subscribe for a Map(userId -> presence meta).
//
// Typing indicators do NOT live here — they ride a per-thread
// presence channel inside MessageThread (scoped, high-churn).

import { supabase } from './supabase'

let channel = null
let online = new Map()
const listeners = new Set()

function emit() {
  listeners.forEach((fn) => {
    try { fn(online) } catch { /* listener errors never break presence */ }
  })
}

export function initPresence(userId, name) {
  if (!userId || channel) return
  channel = supabase.channel('ttl-online', {
    config: { presence: { key: userId } },
  })
  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      const next = new Map()
      Object.entries(state).forEach(([uid, metas]) => {
        if (metas && metas.length) next.set(uid, metas[0])
      })
      online = next
      emit()
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try { await channel.track({ user_id: userId, name: name || '' }) } catch { /* non-fatal */ }
      }
    })
}

export function stopPresence() {
  if (channel) {
    supabase.removeChannel(channel)
    channel = null
    online = new Map()
    emit()
  }
}

export function subscribeOnline(fn) {
  listeners.add(fn)
  fn(online)
  return () => listeners.delete(fn)
}

export function getOnline() {
  return online
}
