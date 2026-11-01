import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ensureRaceChannel } from '../lib/channels'
import { isTeamTier } from '../lib/tier'
import RaceDetail from './RaceDetail'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MEMBER_COLORS = ['#2BB3A3','#E87362','#E8B84B','#FF5A1F','#a78bfa','#34d399','#f472b6','#60a5fa']

const S = {
  list: { display: 'flex', flexDirection: 'column', gap: '10px' },
  row: {
    background: '#161616', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px', padding: '14px 16px',
    display: 'grid', gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'center', gap: '14px',
    transition: 'border-color 0.15s, background 0.15s',
    cursor: 'pointer',
  },
  // Entered races get the gradient-border treatment from the mockups:
  // a brand-to-coral hairline frame over the standard card surface.
  rowMine: {
    border: '1px solid transparent',
    background: 'linear-gradient(#161616, #161616) padding-box, linear-gradient(135deg, rgba(var(--brand-rgb),0.6), rgba(var(--accent-rgb),0.5)) border-box',
  },
  dateTile: {
    textAlign: 'center', background: '#1f1f1f', borderRadius: '12px',
    padding: '8px 0', width: '56px',
  },
  dateMonth: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '11px', letterSpacing: '1.5px', fontWeight: 700,
    textTransform: 'uppercase', color: 'var(--accent)',
  },
  dateDay: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '25px', fontWeight: 800, lineHeight: 1.05, color: '#fff',
  },
  dateYear: { fontSize: '10.5px', color: '#777', marginTop: '1px' },
  raceName: {
    fontFamily: 'Barlow, sans-serif',
    fontSize: '15.5px', fontWeight: 700, color: '#fff', marginBottom: '2px',
    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
  },
  youIn: {
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10.5px', fontWeight: 700,
    letterSpacing: '1.4px', textTransform: 'uppercase',
    background: 'rgba(var(--brand-rgb),0.13)', color: 'var(--brand)',
    border: '1px solid rgba(var(--brand-rgb),0.3)',
    padding: '2px 8px', borderRadius: '5px',
  },
  raceLoc: { fontSize: '12.5px', color: '#999' },
  peopleRow: { display: 'flex', alignItems: 'center', gap: '9px', marginTop: '8px' },
  countText: { fontSize: '12.5px', color: '#aaa' },
  badge: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
    padding: '3px 10px', borderRadius: '5px', textTransform: 'uppercase', whiteSpace: 'nowrap',
  },
  badgeFull: { background: 'rgba(var(--brand-rgb),0.12)', color: 'var(--brand)', border: '1px solid rgba(var(--brand-rgb),0.25)' },
  badge703: { background: 'rgba(var(--accent-rgb),0.12)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.25)' },
  badgeOther: { background: 'rgba(var(--highlight-rgb),0.1)', color: 'var(--highlight)', border: '1px solid rgba(var(--highlight-rgb),0.2)' },
  right: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '9px' },
  avatars: { display: 'flex' },
  avatar: {
    width: '26px', height: '26px', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '10px', fontWeight: 700,
    border: '2px solid #161616', color: '#10131a',
  },
  btn: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 600,
    padding: '7px 15px', background: 'none',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: '999px', color: '#ccc',
    cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
  },
  btnJoined: { borderColor: 'rgba(var(--brand-rgb),0.55)', color: 'var(--brand)', background: 'rgba(var(--brand-rgb),0.08)' },
  quickRow: { display: 'flex', gap: '7px', marginTop: '10px' },
  quickChip: {
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11.5px', fontWeight: 600,
    letterSpacing: '1.2px', textTransform: 'uppercase',
    padding: '5px 12px', borderRadius: '999px', cursor: 'pointer',
    background: '#101010', border: '1px solid rgba(255,255,255,0.13)', color: '#bbb',
  },
  empty: {
    textAlign: 'center', padding: '3rem',
    fontFamily: 'Barlow Condensed, sans-serif',
    letterSpacing: '2px', color: '#444',
    textTransform: 'uppercase', fontSize: '14px',
  },
}

function getBadgeStyle(type) {
  if (type === 'IRONMAN') return { ...S.badge, ...S.badgeFull }
  if (type === '70.3') return { ...S.badge, ...S.badge703 }
  return { ...S.badge, ...S.badgeOther }
}

export default function RaceList({ races, myEntries, allEntries, profiles, profile, onToggle, session }) {
  const [selectedRace, setSelectedRace] = useState(null)
  const [openingKey, setOpeningKey] = useState(null)
  const navigate = useNavigate()
  const teamView = isTeamTier(profile)

  // One-tap channel actions from the card (mockups, 2026-10-31): the same
  // ensure-or-create path RaceDetail uses, via lib/channels.
  async function openChannel(e, race, kind) {
    e.stopPropagation()
    if (kind === 'logistics' && !teamView) {
      setSelectedRace(race) // the detail sheet carries the lock showcase
      return
    }
    const key = `${race.id}-${kind}`
    if (openingKey) return
    setOpeningKey(key)
    const { channel } = await ensureRaceChannel(supabase, race, kind, session.user.id)
    setOpeningKey(null)
    if (channel) navigate(`/messages?channel=${channel.id}`)
    else setSelectedRace(race) // detail sheet surfaces the error properly
  }

  if (races.length === 0) return <div style={S.empty}>No upcoming races found</div>

  return (
    <>
      <div style={S.list}>
        {races.map((race) => {
          const d = new Date(race.race_date + 'T12:00:00')
          const isMine = myEntries.includes(race.id)
          const raceEntries = allEntries.filter(e => e.race_id === race.id)

          return (
            <div
              key={race.id}
              style={{ ...S.row, ...(isMine ? S.rowMine : {}) }}
              onClick={() => setSelectedRace(race)}
              onMouseEnter={e => { if (!isMine) e.currentTarget.style.background = '#1a1a1a' }}
              onMouseLeave={e => { if (!isMine) e.currentTarget.style.background = '#161616' }}
            >
              <div style={S.dateTile}>
                <div style={S.dateMonth}>{MONTHS[d.getMonth()]}</div>
                <div style={S.dateDay}>{d.getDate()}</div>
                <div style={S.dateYear}>{d.getFullYear()}</div>
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={S.raceName}>
                  {race.name}
                  {isMine && <span style={S.youIn}>You're in</span>}
                </div>
                <div style={S.raceLoc}>{race.location}</div>
                {raceEntries.length > 0 && (
                  <div style={S.peopleRow}>
                    <div style={S.avatars}>
                      {raceEntries.slice(0, 4).map((entry, idx) => {
                        const initials = (entry.profiles?.full_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2)
                        return (
                          <div
                            key={entry.id}
                            style={{
                              ...S.avatar,
                              background: entry.profiles?.avatar_color || MEMBER_COLORS[idx % MEMBER_COLORS.length],
                              marginLeft: idx === 0 ? 0 : '-7px',
                            }}
                            title={entry.profiles?.full_name}
                          >
                            {initials}
                          </div>
                        )
                      })}
                      {raceEntries.length > 4 && (
                        <div style={{ ...S.avatar, background: '#2a2a2a', color: '#999', marginLeft: '-7px' }}>
                          +{raceEntries.length - 4}
                        </div>
                      )}
                    </div>
                    <span style={S.countText}>{raceEntries.length} racing</span>
                  </div>
                )}
                {isMine && (
                  <div style={S.quickRow}>
                    <button style={S.quickChip} onClick={e => openChannel(e, race, 'discussion')}>
                      {openingKey === `${race.id}-discussion` ? 'Opening…' : '💬 Discussion'}
                    </button>
                    <button style={S.quickChip} onClick={e => openChannel(e, race, 'logistics')}>
                      {openingKey === `${race.id}-logistics` ? 'Opening…' : '🔒 Logistics'}
                    </button>
                  </div>
                )}
              </div>

              <div style={S.right}>
                <span style={getBadgeStyle(race.type)}>{race.type}</span>
                <button
                  style={{ ...S.btn, ...(isMine ? S.btnJoined : {}) }}
                  onClick={e => { e.stopPropagation(); onToggle(race.id) }}
                >
                  {isMine ? '✓ Entered' : 'Enter'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {selectedRace && (
        <RaceDetail
          race={selectedRace}
          session={session}
          profile={profile}
          isEntered={myEntries.includes(selectedRace.id)}
          onClose={() => setSelectedRace(null)}
          onToggleEntry={async (raceId) => {
            await onToggle(raceId)
          }}
        />
      )}
    </>
  )
}
