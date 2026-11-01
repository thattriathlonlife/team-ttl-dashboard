// MemberChips — the membership-class flair (DECIDED by Zack 2026-11-01:
// option C, name chips, from flair-comparison.html). A labeled chip rides
// beside the member's name in chat threads, feed post cards, the roster
// and search — everywhere a name carries identity. Avatars stay plain.
//
// Resolution order (forward-compatible):
//   1. profile.member_class (migration 0006, staff-assigned) wins:
//      racing_division / pro / team / community.
//   2. team_entitled === false → COMMUNITY.
//   3. Otherwise TEAM TTL — POC default: a profile in the members table
//      is a team member until entitlements say otherwise.
// role === 'admin' always adds the ADMIN chip (admin is an overlay; a
// pro can also be an admin). The author joins must carry `role` today;
// add `member_class, team_entitled` to those joins only AFTER migration
// 0006 is applied — PostgREST fails whole queries on missing columns.

const CHIP = {
  pro: { label: 'PRO', style: { color: '#E8B84B', borderColor: 'rgba(232,184,75,0.55)', background: 'rgba(232,184,75,0.07)' } },
  racing_division: { label: 'RACING DIVISION', style: { color: '#D9DBCE', borderColor: 'rgba(167,33,57,0.85)', background: '#2C3343' } },
  team: { label: 'TEAM TTL', style: { color: 'var(--brand)', borderColor: 'rgba(var(--brand-rgb),0.5)', background: 'rgba(var(--brand-rgb),0.07)' } },
  community: { label: 'COMMUNITY', style: { color: '#8fa0a8', borderColor: 'rgba(255,255,255,0.16)', background: 'transparent' } },
  admin: { label: 'ADMIN', style: { color: '#aebfc9', borderColor: 'rgba(174,191,201,0.4)', background: 'rgba(174,191,201,0.06)' } },
}

export function memberChips(profile) {
  if (!profile) return []
  const out = []
  if (profile.member_class && CHIP[profile.member_class]) out.push(CHIP[profile.member_class])
  else if (profile.team_entitled === false) out.push(CHIP.community)
  else out.push(CHIP.team)
  if (profile.role === 'admin') out.push(CHIP.admin)
  return out
}

export default function MemberChips({ profile }) {
  const chips = memberChips(profile)
  if (!chips.length) return null
  return (
    <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
      {chips.map(c => (
        <span key={c.label} style={{
          fontFamily: 'Barlow Condensed, sans-serif', fontSize: '8.5px', fontWeight: 700,
          letterSpacing: '1px', textTransform: 'uppercase', padding: '2px 6px',
          borderRadius: '999px', border: '1px solid', whiteSpace: 'nowrap', ...c.style,
        }}>{c.label}</span>
      ))}
    </span>
  )
}
