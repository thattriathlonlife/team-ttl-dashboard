/**
 * Vercel Serverless Function — /api/events
 *
 * Analytics event collector for the reporting suite's event taxonomy
 * (~/workspace/team-ttl/ANALYTICS-REPORTING-SUITE.md). The client
 * tracker (frontend/src/lib/track.js) batches events here; this
 * function validates them and inserts rows into `analytics_events`.
 *
 * Validation is the security boundary, not the client: the event name
 * must be in the taxonomy allowlist, properties are stripped to the
 * per-event allowlist, sizes are bounded, and user ids must look like
 * uuids. Events carry counts/enums/ids only — never message text or
 * free text.
 *
 * Fire-and-forget contract: this endpoint answers 202 to every POST,
 * whatever happens. Until migration 0007 creates `analytics_events`,
 * the insert fails (PostgREST 404) and events drop quietly — the
 * failure is logged server-side only and never surfaces to the app.
 * Inserts use the project's publishable (anon) key: the table's RLS
 * grants INSERT to anon/authenticated and nothing else, so reads stay
 * service-role-only by design.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

const EVENT_PROPS = {
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

const MAX_EVENTS_PER_REQUEST = 50
const MAX_PROPS_BYTES = 2048
const MAX_VALUE_LEN = 200
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sanitizeRow(raw) {
  if (!raw || typeof raw !== 'object') return null
  const allowed = EVENT_PROPS[raw.event]
  if (!allowed) return null
  const properties = {}
  const props = (raw.properties && typeof raw.properties === 'object' && !Array.isArray(raw.properties))
    ? raw.properties
    : {}
  for (const key of allowed) {
    const v = props[key]
    if (typeof v === 'string') properties[key] = v.slice(0, MAX_VALUE_LEN)
    else if (typeof v === 'number' && Number.isFinite(v)) properties[key] = v
    else if (typeof v === 'boolean') properties[key] = v
  }
  if (JSON.stringify(properties).length > MAX_PROPS_BYTES) return null
  return {
    event: raw.event,
    user_id: (typeof raw.user_id === 'string' && UUID_RE.test(raw.user_id)) ? raw.user_id : null,
    session_id: typeof raw.session_id === 'string' ? raw.session_id.slice(0, 64) : null,
    properties,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false })

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = null }
  }
  const list = Array.isArray(body) ? body.slice(0, MAX_EVENTS_PER_REQUEST) : []
  const rows = list.map(sanitizeRow).filter(Boolean)

  if (rows.length && SUPABASE_URL && ANON_KEY) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(rows),
      })
      if (!resp.ok) {
        // Expected until migration 0007 lands (table missing → 404).
        // Log server-side, swallow for the client.
        const text = await resp.text().catch(() => '')
        console.error('[api/events] insert failed', resp.status, text.slice(0, 200))
      }
    } catch (err) {
      console.error('[api/events] insert error', err?.message || err)
    }
  }

  return res.status(202).json({ ok: true, accepted: rows.length })
}
