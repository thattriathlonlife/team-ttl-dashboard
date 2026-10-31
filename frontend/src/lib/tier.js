// Access tiers for the unified app (ACCESS-AND-UI-SPEC.md).
//
// Real entitlement is server-side (profiles.team_entitled + RLS, see
// supabase/draft-migrations/0002). Until that ships, the POC demonstrates
// both presentations with a local demo switch: 'fan' shows the public
// presentation (team surfaces locked as a showcase), 'team' shows the
// entitled presentation. The switch lives in Profile and defaults to
// 'team' so existing members see no change.
const KEY = 'ttl-demo-tier'

export function getDemoTier() {
  try {
    return localStorage.getItem(KEY) === 'fan' ? 'fan' : 'team'
  } catch {
    return 'team'
  }
}

export function setDemoTier(tier) {
  try {
    localStorage.setItem(KEY, tier === 'fan' ? 'fan' : 'team')
  } catch { /* storage unavailable */ }
  window.location.reload()
}

export function isTeamTier(profile) {
  if (profile?.team_entitled) return true
  return getDemoTier() === 'team'
}
