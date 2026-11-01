import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Training from './Training'
import GearHub from './GearHub'
import TeamRoster from '../components/TeamRoster'
import InviteModal from '../components/InviteModal'

// Team hub — the 5-tab model's single home for everything member-only
// (ACCESS-AND-UI-SPEC): Training, partner deals, the gear guide, the garage
// sale, and the roster, as segments of one page instead of three separate
// nav destinations plus a roster buried inside Races.
const SEGMENTS = [
  { id: 'training', label: 'Training' },
  { id: 'deals', label: 'Deals' },
  { id: 'gear', label: 'Gear' },
  { id: 'garage', label: 'Garage' },
  { id: 'roster', label: 'Roster' },
]

const GEAR_TAB = { deals: 'deals', gear: 'guide', garage: 'garage' }

const S = {
  wrap: { maxWidth: '1100px', margin: '0 auto', padding: '1.5rem' },
  segBar: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '1.25rem' },
  seg: active => ({
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 600,
    letterSpacing: '1.5px', textTransform: 'uppercase',
    padding: '8px 16px', borderRadius: '999px', cursor: 'pointer',
    border: `1px solid ${active ? 'rgba(var(--brand-rgb),0.55)' : 'rgba(255,255,255,0.12)'}`,
    background: active ? 'rgba(var(--brand-rgb),0.12)' : 'transparent',
    color: active ? 'var(--brand)' : '#888', transition: 'all 0.15s',
  }),
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' },
  sectionTitle: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', letterSpacing: '2px', textTransform: 'uppercase', color: '#555' },
  btnGhost: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '1.5px', textTransform: 'uppercase', padding: '8px 16px', background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#ccc', cursor: 'pointer' },
  loading: { padding: '3rem', textAlign: 'center', fontFamily: 'Barlow Condensed', letterSpacing: 2, color: '#555', textTransform: 'uppercase' },
}

export default function Team({ session, profile }) {
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const [segment, setSegment] = useState(
    SEGMENTS.some(s => s.id === requested) ? requested : 'training'
  )

  // Roster data (moved out of the Races page): loaded lazily the first time
  // the Roster segment opens.
  const [roster, setRoster] = useState(null)
  const [showInvite, setShowInvite] = useState(false)

  // Hub pulse (mockups, 2026-10-31): light counts so the Training segment
  // can preview the hub's other rooms as living cards.
  const [hub, setHub] = useState(null)
  useEffect(() => {
    ;(async () => {
      const [profilesRes, dealsRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_color').limit(300),
        supabase.from('discounts').select('id', { count: 'exact', head: true }),
      ])
      setHub({ members: profilesRes.data || [], dealCount: dealsRes.count ?? 0 })
    })()
  }, [])

  useEffect(() => {
    if (segment !== 'roster' || roster) return
    ;(async () => {
      const today = new Date().toISOString().split('T')[0]
      const [racesRes, entriesRes, profilesRes] = await Promise.all([
        supabase.from('races').select('*').gte('race_date', today).order('race_date'),
        supabase.from('race_entries').select('*, profiles(full_name, id)'),
        supabase.from('profiles').select('*'),
      ])
      setRoster({
        races: racesRes.data || [],
        allEntries: entriesRes.data || [],
        profiles: profilesRes.data || [],
      })
    })()
  }, [segment, roster])

  return (
    <div>
      <div style={{ ...S.wrap, paddingBottom: 0 }}>
        <div style={S.segBar}>
          {SEGMENTS.map(s => (
            <button key={s.id} style={S.seg(segment === s.id)} onClick={() => setSegment(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {segment === 'training' && hub && (
        <div style={{ ...S.wrap, paddingTop: 0, paddingBottom: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px', marginBottom: '1.25rem' }}>
            <button onClick={() => setSegment('deals')} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '14px 16px', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ width: '46px', height: '46px', borderRadius: '12px', background: 'rgba(var(--accent-rgb),0.13)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, color: 'var(--accent)', fontSize: '13px', flexShrink: 0 }}>%</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: '15px', color: '#fff' }}>Partner deals</span>
                <span style={{ display: 'block', fontSize: '12.5px', color: '#999', marginTop: '1px' }}>{hub.dealCount} partner code{hub.dealCount !== 1 ? 's' : ''} in the hub</span>
              </span>
              <span style={{ color: 'var(--brand)', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '1px', fontSize: '12px', fontWeight: 700 }}>VIEW →</span>
            </button>
            <button onClick={() => setSegment('roster')} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '14px 16px', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ display: 'flex', flexShrink: 0 }}>
                {hub.members.slice(0, 3).map((m, i) => (
                  <span key={m.id} style={{ width: '30px', height: '30px', borderRadius: '50%', border: '2px solid #161616', marginLeft: i === 0 ? 0 : '-8px', background: m.avatar_color || '#3d7a8c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#10131a', fontFamily: 'Barlow Condensed, sans-serif' }}>
                    {(m.full_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2)}
                  </span>
                ))}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: '15px', color: '#fff' }}>{hub.members.length} teammates</span>
                <span style={{ display: 'block', fontSize: '12.5px', color: '#999', marginTop: '1px' }}>Roster, regions &amp; who's near you</span>
              </span>
              <span style={{ color: 'var(--brand)', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '1px', fontSize: '12px', fontWeight: 700 }}>VIEW →</span>
            </button>
          </div>
        </div>
      )}

      {segment === 'training' && <Training session={session} profile={profile} />}

      {GEAR_TAB[segment] && (
        <GearHub key={segment} profile={profile} initialTab={GEAR_TAB[segment]} lockTab />
      )}

      {segment === 'roster' && (
        <div style={{ ...S.wrap, paddingTop: 0 }}>
          <div style={S.sectionHead}>
            <div style={S.sectionTitle}>Team <span style={{ color: '#fff' }}>Members</span></div>
            {profile?.role === 'admin' && (
              <button style={S.btnGhost} onClick={() => setShowInvite(true)}>+ Invite Member</button>
            )}
          </div>
          {!roster
            ? <div style={S.loading}>Loading...</div>
            : <TeamRoster profiles={roster.profiles} allEntries={roster.allEntries} races={roster.races} />}
        </div>
      )}

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </div>
  )
}
