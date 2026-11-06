// Analytics event tracker — the client half of the reporting suite's
// event taxonomy (~/workspace/team-ttl/ANALYTICS-REPORTING-SUITE.md).
//
// Events carry counts, enums and ids ONLY — never message text, never
// free text, never anything traceable beyond the member's own account
// id (which the collector stores so internal funnel math can key
// events to accounts; sponsor outputs are aggregates computed from
// them). The collector (frontend/api/events.js) re-validates every
// event server-side and strips any property outside the allowlists
// below, so these lists are the contract, not the security boundary.
//
// Fire-and-forget by design: track() never throws, never blocks, and
// a lost batch is acceptable. Events queue in memory and flush at 20
// queued or after 10s, plus a pagehide flush via sendBeacon. Until
// migration 0007 (analytics_events) is applied, the collector's
// inserts fail server-side and events simply drop — the app neither
// knows nor cares.

export const ANALYTICS_EVENTS = [
  'app_session',
  'race_viewed',
  'race_entered',
  'race_withdrawn',
  'map_viewed',
  'message_posted',
  'content_played',
  'deal_viewed',
  'deal_clicked',
  'deal_code_copied',
  'announcement_viewed',
  'profile_completed',
]

// Per-event property allowlist. Anything not listed is stripped.
export const EVENT_PROPS = {
  app_session: [],
  race_viewed: ['race_id'],
  race_entered: ['race_id'],
  race_withdrawn: ['race_id'],
  map_viewed: ['surface'],
  message_posted: ['category'],
  content_played: ['kind', 'item_id'],
  deal_viewed: ['deal_id'],
  deal_clicked: ['deal_id'],
  deal_code_copied: ['deal_id'],
  announcement_viewed: [],
  profile_completed: [],
}

const MAX_VALUE_LEN = 200

// ── Pure core (unit-tested in frontend/test/track.test.mjs) ────────

// Returns { event, properties } with only allowlisted, scalar props,
// or null when the event name is not in the taxonomy.
export function sanitizeEvent(name, props) {
  if (!ANALYTICS_EVENTS.includes(name)) return null
  const allowed = EVENT_PROPS[name] || []
  const out = {}
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const key of allowed) {
      const v = props[key]
      if (typeof v === 'string') out[key] = v.slice(0, MAX_VALUE_LEN)
      else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
      else if (typeof v === 'boolean') out[key] = v
    }
  }
  return { event: name, properties: out }
}

// Session-scoped dedupe: some events mean "first time this session"
// (the suite's definitions count announcement opens and deal
// impressions once), so repeats within a session are dropped.
// Returns the dedupe key, or null when the event is never deduped.
export function dedupeKeyFor(name, properties = {}) {
  switch (name) {
    case 'app_session':
      return 'app_session'
    case 'announcement_viewed':
      return 'announcement_viewed'
    case 'race_viewed':
      return `race_viewed:${properties.race_id ?? ''}`
    case 'deal_viewed':
      return `deal_viewed:${properties.deal_id ?? ''}`
    case 'content_played':
      return `content_played:${properties.kind ?? ''}:${properties.item_id ?? ''}`
    default:
      return null
  }
}

// Minimal batch queue: push() reports when the batch threshold is hit.
export function createEventQueue(maxBatch = 20) {
  let queue = []
  return {
    push(evt) {
      queue.push(evt)
      return queue.length >= maxBatch
    },
    drain() {
      const out = queue
      queue = []
      return out
    },
    size() {
      return queue.length
    },
  }
}

// ── Browser shell ──────────────────────────────────────────────────

const SESSION_KEY = 'ttl-session-id'
const SEEN_KEY = 'ttl-track-seen'
const FLUSH_MS = 10000

let queue = null
let flushTimer = null
let currentUserId = null
let seenCache = null

function getQueue() {
  if (!queue) queue = createEventQueue(20)
  return queue
}

function getSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return 'unknown-session'
  }
}

function loadSeen() {
  if (seenCache) return seenCache
  try {
    const raw = sessionStorage.getItem(SEEN_KEY)
    seenCache = new Set(raw ? JSON.parse(raw) : [])
  } catch {
    seenCache = new Set()
  }
  return seenCache
}

function markSeen(key) {
  const seen = loadSeen()
  seen.add(key)
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen])) } catch {}
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; flushEvents() }, FLUSH_MS)
}

export function setAnalyticsUser(userId) {
  currentUserId = userId || null
}

export function flushEvents(useBeacon = false) {
  try {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    const batch = getQueue().drain()
    if (!batch.length) return
    const payload = JSON.stringify(batch.map(e => ({
      event: e.event,
      properties: e.properties,
      session_id: getSessionId(),
      user_id: currentUserId,
    })))
    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/events', new Blob([payload], { type: 'application/json' }))
      return
    }
    fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {})
  } catch {}
}

// The one call fire points make. Never throws.
export function track(name, props) {
  try {
    const evt = sanitizeEvent(name, props)
    if (!evt) return
    const key = dedupeKeyFor(evt.event, evt.properties)
    if (key) {
      if (loadSeen().has(key)) return
      markSeen(key)
    }
    if (getQueue().push(evt)) flushEvents()
    else scheduleFlush()
  } catch {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushEvents(true))
}
