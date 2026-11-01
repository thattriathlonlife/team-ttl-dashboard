// Channel taxonomy for the unified Team TTL app.
//
// Race conversations deliberately come in two forms:
// - race_discussion: public to every signed-in account; fans/community can
//   follow the race conversation and post once they have an account.
// - race_logistics: team-only coordination (travel, lodging, meetups).
//
// Legacy race channels used type='race'. They were created inside the
// members-only prototype, so they normalize to logistics rather than being
// silently reclassified as public. The matching database shape is drafted in
// supabase/draft-migrations/0003_race_channel_split.sql.
//
// LIVE-DB CONSTRAINT (documented in the repo's CLAUDE.md): channels.type and
// channels.category carry CHECK constraints, so new type values are rejected
// by the live database until a migration widens them. Until then the split
// is ALSO encoded with the proven-valid type='race' + a name suffix
// ('-discussion' / '-logistics'), which raceChannelKind recognizes. The
// canonical type/audience encoding wins wherever it exists.

export const RACE_DISCUSSION_TYPE = 'race_discussion'
export const RACE_LOGISTICS_TYPE = 'race_logistics'
export const LEGACY_RACE_TYPE = 'race'

const TEAM_CHANNEL_CATEGORIES = new Set(['general', 'training', 'interest', 'regions'])

export function raceChannelKind(channel) {
  if (!channel) return null

  // The explicit audience field wins once migration 0003 has landed.
  if (channel.race_id || channel.category === 'race') {
    if (channel.audience === 'public') return 'discussion'
    if (channel.audience === 'team') return 'logistics'
  }

  if (channel.type === RACE_DISCUSSION_TYPE) return 'discussion'
  if (channel.type === RACE_LOGISTICS_TYPE) return 'logistics'

  // Live-DB-compatible encoding: type stays 'race' (a value the live CHECK
  // constraint accepts) and the kind rides in the channel name suffix.
  if (channel.type === LEGACY_RACE_TYPE || channel.category === 'race') {
    if (channel.name?.endsWith('-discussion')) return 'discussion'
    if (channel.name?.endsWith('-logistics')) return 'logistics'
    // Unsuffixed legacy race channels are team history: logistics.
    if (channel.type === LEGACY_RACE_TYPE) return 'logistics'
  }
  return null
}

export function isRaceChannel(channel) {
  return raceChannelKind(channel) !== null
}

export function raceChannelType(kind) {
  return kind === 'discussion' ? RACE_DISCUSSION_TYPE : RACE_LOGISTICS_TYPE
}

export function raceChannelAudience(kind) {
  return kind === 'discussion' ? 'public' : 'team'
}

export function isTeamOnlyChannel(channel) {
  if (!channel) return false
  if (channel.type === 'dm') return true
  if (raceChannelKind(channel) === 'logistics') return true
  if (channel.audience === 'team') return true

  // Existing team-space categories predate an explicit audience column.
  // Public race discussions are the exception carved out above.
  return TEAM_CHANNEL_CATEGORIES.has(channel.category)
}

export function shortRaceName(name) {
  if (!name) return ''
  return name
    .replace(/ironman\s+70\.3\s+/i, '')
    .replace(/ironman\s+/i, '')
    .trim()
}

export function channelDisplayName(channel) {
  if (!channel) return ''
  const kind = raceChannelKind(channel)
  if (!kind) return channel.name || ''

  const fallbackName = (channel.name || 'Race')
    .replace(/-(discussion|logistics)$/, '')
    .replace(/-/g, ' ')
  const base = shortRaceName(channel.races?.name || fallbackName)
  return `${base} · ${kind === 'discussion' ? 'Discussion' : 'Logistics'}`
}

export function channelAccessLabel(channel) {
  if (!channel) return null
  const kind = raceChannelKind(channel)
  if (kind === 'discussion') return 'Public discussion'
  if (kind === 'logistics') return 'Team logistics'
  if (isTeamOnlyChannel(channel)) return 'Team only'
  return null
}

// Find a race's channel of the given kind, creating it if needed.
// Extracted from RaceDetail (2026-10-31) so race cards can offer the same
// one-tap Discussion / Logistics actions. Tries the canonical encoding
// first (migration 0003), then the live-DB encoding (type='race' + name
// suffix) the CHECK constraint accepts today. Returns { channel } or
// { error } — never fails silently.
export async function ensureRaceChannel(supabase, race, kind, userId) {
  async function find() {
    const { data } = await supabase
      .from('channels')
      .select('id, name, type, category, race_id')
      .eq('race_id', race.id)
    return (data || []).find(ch => raceChannelKind(ch) === kind) || null
  }

  let channel = null
  try { channel = await find() } catch { /* fall through to create */ }
  if (channel) return { channel }

  const slug = race.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  const suffix = kind === 'discussion' ? 'discussion' : 'logistics'
  const basePayload = {
    name: `${slug}-${suffix}`,
    category: 'race',
    race_id: race.id,
    description: kind === 'discussion'
      ? `Public race discussion for ${race.name}`
      : `Team-only logistics for ${race.name}: travel, lodging, and meetups`,
    created_by: userId,
  }

  let { data: newChannel, error } = await supabase.from('channels')
    .insert({ ...basePayload, type: raceChannelType(kind), audience: raceChannelAudience(kind) })
    .select('id').single()
  if (!error && newChannel) return { channel: newChannel }

  channel = await find() // a parallel tap may have won
  if (channel) return { channel }

  ;({ data: newChannel, error } = await supabase.from('channels')
    .insert({ ...basePayload, type: 'race' })
    .select('id').single())
  if (!error && newChannel) return { channel: newChannel }

  channel = await find()
  if (channel) return { channel }
  return { error: error?.message || 'unknown error' }
}
