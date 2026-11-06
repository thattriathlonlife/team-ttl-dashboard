import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { subscribeMemberView, closeMember } from '../lib/memberView'
import MemberChips from './MemberChips'

// Public member profile (PROFILE-REFRESH-SPEC §2): tapping a member
// anywhere — roster, search, a feed post, a mention — opens this
// read-only view. Until now profiles were private by accident: nobody
// could see anyone else's. Shows identity + class chips, upcoming
// races and earned badges, all from data the app already reads for
// other surfaces (roster, map). The editable fields (bio, home city,
// achievement line, pinned badge) arrive with migration 0006.

export default function MemberProfileHost() {
  const [memberId, setMemberId] = useState(null)
  useEffect(() => subscribeMemberView(setMemberId), [])
  if (!memberId) return null
  return <MemberProfile key={memberId} memberId={memberId} onClose={closeMember} />
}

function MemberProfile({ memberId, onClose }) {
  const [state, setState] = useState({ loading: true, profile: null, races: [], badges: null })

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const today = new Date().toISOString().slice(0, 10)
      const [profileRes, entriesRes, badgesRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_color, avatar_url, role, member_class').eq('id', memberId).single(),
        supabase.from('race_entries').select('id, races(name, race_date, type)').eq('athlete_id', memberId),
        supabase.from('profile_badges').select('badge_key, earned_at, badges(name, icon, tier)').eq('athlete_id', memberId),
      ])
      if (cancelled) return
      const races = (entriesRes.data || [])
        .map(e => e.races)
        .filter(r => r && r.race_date >= today)
        .sort((a, b) => a.race_date.localeCompare(b.race_date))
      setState({
        loading: false,
        profile: profileRes.data || null,
        races,
        badges: badgesRes.error ? null : (badgesRes.data || []),
      })
    })()
    return () => { cancelled = true }
  }, [memberId])

  const { loading, profile, races, badges } = state
  const name = profile?.full_name || 'TTL Member'
  const initials = name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'T'
  const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return createPortal(
    <div style={S.overlay} role="dialog" aria-modal="true" aria-label={`${name} — member profile`}>
      <div style={S.header}>
        <button onClick={onClose} aria-label="Back" style={S.backBtn}>‹ <span>Back</span></button>
        <span style={S.kicker}>Member</span>
        <button onClick={onClose} aria-label="Close profile" style={S.closeBtn}>✕</button>
      </div>
      <div style={S.scroll}>
        <div style={S.wrap}>
          {loading && <div style={S.note}>Loading…</div>}
          {!loading && !profile && <div style={S.note}>That member could not be loaded.</div>}
          {!loading && profile && (
            <>
              {profile.avatar_url
                ? <img src={profile.avatar_url} alt="" style={S.avatarImg} />
                : <div style={{ ...S.avatarDisc, background: profile.avatar_color || '#3d7a8c' }}>{initials}</div>}
              <div style={S.name}>{name}</div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 7 }}>
                <MemberChips profile={profile} />
              </div>

              <div style={{ display: 'flex', gap: 10, margin: '18px 0 6px' }}>
                <div style={S.tile}>
                  <div style={S.tileNum}>{races.length}</div>
                  <div style={S.tileLabel}>Upcoming races</div>
                </div>
                <div style={S.tile}>
                  <div style={{ ...S.tileNum, color: 'var(--highlight)' }}>{badges ? badges.length : '—'}</div>
                  <div style={S.tileLabel}>Badges earned</div>
                </div>
              </div>

              {races.length > 0 && (
                <>
                  <div style={S.section}>Racing next</div>
                  {races.slice(0, 8).map((r, i) => (
                    <div key={`${r.name}-${r.race_date}-${i}`} style={S.raceRow}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={S.raceName}>{r.name}</span>
                        <span style={S.raceDate}>{fmtDate(r.race_date)}</span>
                      </span>
                      {r.type && <span style={S.typeChip}>{r.type}</span>}
                    </div>
                  ))}
                  {races.length > 8 && <div style={S.note}>+{races.length - 8} more</div>}
                </>
              )}

              {badges && badges.length > 0 && (
                <>
                  <div style={S.section}>Badges</div>
                  <div style={S.badgeGrid}>
                    {badges.map(b => (
                      <div key={b.badge_key} style={S.badge} title={b.badges?.name || b.badge_key}>
                        <div style={{ fontSize: 19 }}>{b.badges?.icon || '🎖️'}</div>
                        <div style={S.badgeName}>{b.badges?.name || b.badge_key}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

const S = {
  overlay: { position: 'fixed', inset: 0, zIndex: 210, background: '#0d0d0d', display: 'flex', flexDirection: 'column' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: 'calc(0.7rem + env(safe-area-inset-top, 0px)) 1.1rem 0.7rem',
    borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
  },
  kicker: { fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--accent)', flex: 1, textAlign: 'center', textTransform: 'uppercase' },
  backBtn: {
    display: 'flex', alignItems: 'center', gap: '2px', background: 'none', border: 'none',
    color: '#fff', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '19px', fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', padding: '4px 8px 4px 0', flexShrink: 0,
  },
  closeBtn: { background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', width: 34, height: 34, borderRadius: '50%', fontSize: 15, cursor: 'pointer', flexShrink: 0 },
  scroll: { overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch' },
  wrap: { maxWidth: 560, margin: '0 auto', padding: '1.4rem 1.25rem 3rem' },
  avatarImg: { width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', border: '3px solid rgba(var(--brand-rgb),0.45)', display: 'block', margin: '0 auto' },
  avatarDisc: { width: 84, height: 84, borderRadius: '50%', border: '3px solid rgba(var(--brand-rgb),0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 28, fontWeight: 800, color: '#10131a' },
  name: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 27, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: '#fff', textAlign: 'center', marginTop: 12, lineHeight: 1.1 },
  tile: { flex: 1, background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '13px 8px', textAlign: 'center' },
  tileNum: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 25, fontWeight: 800, color: '#fff', lineHeight: 1 },
  tileLabel: { fontSize: 10.5, color: '#777', letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 },
  section: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#999', margin: '20px 0 10px' },
  raceRow: { display: 'flex', alignItems: 'center', gap: 10, background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '10px 12px', marginBottom: 8 },
  raceName: { display: 'block', fontSize: 14, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  raceDate: { display: 'block', fontSize: 12, color: '#888', marginTop: 1 },
  typeChip: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--brand)', border: '1px solid rgba(var(--brand-rgb),0.4)', borderRadius: 999, padding: '2px 8px', flexShrink: 0 },
  badgeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(74px, 1fr))', gap: 8 },
  badge: { background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '9px 4px 7px', textAlign: 'center' },
  badgeName: { fontSize: 9.5, color: '#aaa', lineHeight: 1.25, marginTop: 3 },
  note: { fontSize: 13, color: '#888', textAlign: 'center', padding: '10px 0' },
}
