// Access tiers for the unified app (ACCESS-AND-UI-SPEC.md).
//
// Source of truth for team entitlement: profiles.member_class
// (migration 0006, live since 2026-11-02) — DECIDED by Zack 2026-11-06
// (migration README Q2). team / racing_division / pro are entitled;
// community is not. There is no team_entitled column: the 0002 draft
// dropped it in favour of this rule, so the class that drives the name
// chips is the same field that decides access — one switch, never two
// that can disagree. Server-side enforcement is still the 0003 RLS
// work; until that lands, this module shapes presentation only.
//
// The POC demo switch still exists so both presentations can be shown
// on one device (Profile → Demo view): 'fan' forces the public
// presentation regardless of class. Otherwise the stored class decides;
// a profile with no class information falls back to the demo default
// ('team') so synthetic/pre-0006 rows behave as they always have.
const KEY = 'ttl-demo-tier'

export const ENTITLED_CLASSES = ['team', 'racing_division', 'pro']

export function isEntitledClass(memberClass) {
  return ENTITLED_CLASSES.includes(memberClass)
}

// true / false when the profile carries entitlement information
// (member_class, or the legacy team_entitled boolean that synthetic
// demo rows still use); null when it carries neither.
export function profileEntitled(profile) {
  if (profile?.member_class) return isEntitledClass(profile.member_class)
  if (typeof profile?.team_entitled === 'boolean') return profile.team_entitled
  return null
}

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
  if (getDemoTier() === 'fan') return false
  const entitled = profileEntitled(profile)
  if (entitled !== null) return entitled
  return true
}
