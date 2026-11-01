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
