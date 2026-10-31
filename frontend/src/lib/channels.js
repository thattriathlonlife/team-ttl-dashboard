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
  if (channel.type === RACE_LOGISTICS_TYPE || channel.type === LEGACY_RACE_TYPE) return 'logistics'
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

  const base = shortRaceName(channel.races?.name || channel.name || 'Race')
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
