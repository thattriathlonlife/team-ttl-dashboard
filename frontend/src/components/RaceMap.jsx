import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import { ensureRaceChannel } from '../lib/channels'
import { isTeamTier } from '../lib/tier'

// The modern map (Concept A, approved 2026-10-31): Leaflet on CARTO dark
// tiles — a real dark basemap instead of the light OpenStreetMap iframe —
// with count pins as first-class data: pills carry start-line counts, big
// fields go coral, races the member has entered get a gold ring, and
// tapping a pin opens the race's card in place with its roster.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MEMBER_COLORS = ['#2BB3A3', '#E87362', '#E8B84B', '#FF5A1F', '#a78bfa', '#34d399', '#f472b6', '#60a5fa']

const MAP_CSS = `
.leaflet-container { background: #0d1316; font-family: 'Barlow', sans-serif; }
.leaflet-div-icon { background: transparent; border: none; }
.ttl-pin { transform: translate(-50%, -100%); text-align: center; cursor: pointer; }
.ttl-pin .pill { display: inline-block; font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 12.5px; letter-spacing: .4px; padding: 4px 10px; border-radius: 999px; box-shadow: 0 6px 18px rgba(0,0,0,.55); white-space: nowrap; background: var(--brand); color: #03292b; }
.ttl-pin.coral .pill { background: var(--accent); color: #2b0f0b; }
.ttl-pin.compact .pill { background: #1c262b; color: #cfe3e1; border: 1px solid rgba(255,255,255,.25); }
.ttl-pin.mine .pill { background: #101314; color: #fff; border: 2px solid var(--highlight); }
.ttl-pin .dot { width: 8px; height: 8px; border-radius: 50%; margin: 3px auto 0; background: var(--brand); border: 2px solid rgba(0,0,0,.35); }
.ttl-pin.coral .dot { background: var(--accent); }
.ttl-pin.compact .dot { background: #8fb5b2; }
.ttl-pin.mine .dot { background: var(--highlight); }
.ttl-pin.zero .dot { width: 11px; height: 11px; background: rgba(var(--brand-rgb),.35); border: 2px solid rgba(var(--brand-rgb),.7); margin: 0 auto; }
.leaflet-control-attribution { background: rgba(10,12,13,.72) !important; color: #5c6a68 !important; font-size: 9px !important; padding: 1px 5px; }
.leaflet-control-attribution a { color: #7d8f8c !important; }
.leaflet-bar a { background: #15181a !important; color: #cfd8d6 !important; border-color: rgba(255,255,255,.12) !important; }
.leaflet-bar { border: 1px solid rgba(255,255,255,.12) !important; box-shadow: 0 8px 22px rgba(0,0,0,.45) !important; }
`

function pinIcon(race, count, mine) {
  let cls = 'ttl-pin'
  if (mine) cls += ' mine'
  else if (count >= 15) cls += ' coral'
  else if (count > 0 && count < 5) cls += ' compact'
  let html
  if (count === 0 && !mine) {
    html = `<div class="${cls} zero"><div class="dot"></div></div>`
  } else {
    const label = mine ? `★ ${count}` : count >= 5 ? `${count} racing` : `${count}`
    html = `<div class="${cls}"><span class="pill">${label}</span><div class="dot"></div></div>`
  }
  return L.divIcon({ html, className: '', iconSize: [0, 0] })
}

export default function RaceMap({ races, allEntries = [], myEntries = [], profile, session, onToggle }) {
  const mapRef = useRef(null)
  const mapObjRef = useRef(null)
  const layerRef = useRef(null)
  const fitKeyRef = useRef('')
  const [selected, setSelected] = useState(null)
  const [opening, setOpening] = useState(null)
  const [note, setNote] = useState('')
  const navigate = useNavigate()
  const teamView = isTeamTier(profile)

  const racesWithCoords = useMemo(
    () => races.filter(r => r.latitude && r.longitude),
    [races]
  )
  const entriesByRace = useMemo(() => {
    const map = {}
    for (const e of allEntries) {
      if (!map[e.race_id]) map[e.race_id] = []
      map[e.race_id].push(e)
    }
    return map
  }, [allEntries])

  // Create the map once (Dashboard gates rendering on data being loaded,
  // so the geocoded set is present on first render in practice; the guard
  // also covers it arriving later).
  useEffect(() => {
    if (!mapRef.current || mapObjRef.current || racesWithCoords.length === 0) return
    const map = L.map(mapRef.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: true,
    })
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapObjRef.current = map
    return () => { map.remove(); mapObjRef.current = null; layerRef.current = null }
  }, [racesWithCoords.length])

  // Sync markers with the (filtered) race set + entry counts.
  useEffect(() => {
    const map = mapObjRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const bounds = []
    for (const race of racesWithCoords) {
      const count = (entriesByRace[race.id] || []).length
      const mine = myEntries.includes(race.id)
      const marker = L.marker([race.latitude, race.longitude], { icon: pinIcon(race, count, mine) })
      marker.on('click', () => { setSelected(race); setNote('') })
      marker.addTo(layer)
      bounds.push([race.latitude, race.longitude])
    }
    const fitKey = racesWithCoords.map(r => r.id).join(',')
    if (bounds.length && fitKey !== fitKeyRef.current) {
      fitKeyRef.current = fitKey
      if (bounds.length === 1) map.setView(bounds[0], 6)
      else map.fitBounds(bounds, { padding: [34, 34] })
    }
  }, [racesWithCoords, entriesByRace, myEntries])

  async function openChannel(kind) {
    if (!selected) return
    if (kind === 'logistics' && !teamView) {
      setNote('Logistics channels are team-only — open the race from the list below for the full picture.')
      return
    }
    if (opening) return
    setOpening(kind)
    const { channel } = await ensureRaceChannel(supabase, selected, kind, session.user.id)
    setOpening(null)
    if (channel) navigate(`/messages?channel=${channel.id}`)
    else setNote(`Couldn't open the ${kind} channel — try from the race list below.`)
  }

  if (racesWithCoords.length === 0) {
    return (
      <div style={{
        background: '#0d1316',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px', height: '300px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '12px',
      }}>
        <div style={{ fontSize: '32px' }}>🗺️</div>
        <div style={{
          fontFamily: 'Barlow Condensed, sans-serif',
          fontSize: '14px', letterSpacing: '2px',
          textTransform: 'uppercase', color: '#5c6a68',
        }}>
          No location data for these races
        </div>
      </div>
    )
  }

  const selEntries = selected ? (entriesByRace[selected.id] || []) : []
  const selDate = selected ? new Date(selected.race_date + 'T12:00:00') : null
  const selMine = selected ? myEntries.includes(selected.id) : false

  return (
    <div style={{
      borderRadius: '16px', overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.1)',
      position: 'relative', background: '#0d1316',
    }}>
      <style>{MAP_CSS}</style>
      <div ref={mapRef} style={{ width: '100%', height: '320px', zIndex: 0 }} />

      {/* On-map title chip */}
      <div style={{
        position: 'absolute', left: '12px', top: '12px', zIndex: 500,
        background: 'rgba(13,17,19,0.88)', border: '1px solid rgba(255,255,255,0.14)',
        backdropFilter: 'blur(6px)', borderRadius: '999px', padding: '5px 12px',
        fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', fontWeight: 700,
        letterSpacing: '1.8px', textTransform: 'uppercase', color: '#d7e8e6', pointerEvents: 'none',
      }}>
        Where the team races
      </div>
      <div style={{
        position: 'absolute', left: '12px', bottom: '12px', zIndex: 500,
        background: 'rgba(13,17,19,0.88)', border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(6px)', borderRadius: '10px', padding: '6px 11px',
        fontSize: '11.5px', color: '#a9c4c1', pointerEvents: 'none',
      }}>
        {racesWithCoords.length} races pinned · tap a pin for the roster
      </div>

      {/* In-place race card */}
      {selected && (
        <div style={{
          position: 'absolute', left: '10px', right: '10px', bottom: '10px', zIndex: 600,
          background: 'rgba(18,20,22,0.97)', border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: '16px', padding: '13px 14px',
          boxShadow: '0 18px 44px rgba(0,0,0,0.55)',
        }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ textAlign: 'center', background: '#1f1f1f', borderRadius: '12px', padding: '7px 0', width: '52px', flexShrink: 0 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10.5px', letterSpacing: '1.5px', color: 'var(--accent)', fontWeight: 700 }}>{MONTHS[selDate.getMonth()]}</div>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '23px', fontWeight: 800, lineHeight: 1, color: '#fff' }}>{selDate.getDate()}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '15.5px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected.name}</div>
              <div style={{ fontSize: '12.5px', color: '#999' }}>{selected.location}</div>
              {selEntries.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                  <div style={{ display: 'flex' }}>
                    {selEntries.slice(0, 4).map((entry, idx) => (
                      <div key={entry.id} title={entry.profiles?.full_name} style={{
                        width: '24px', height: '24px', borderRadius: '50%',
                        border: '2px solid #121416', marginLeft: idx === 0 ? 0 : '-7px',
                        background: entry.profiles?.avatar_color || MEMBER_COLORS[idx % MEMBER_COLORS.length],
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '9px', fontWeight: 700, color: '#10131a',
                        fontFamily: 'Barlow Condensed, sans-serif',
                      }}>
                        {(entry.profiles?.full_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2)}
                      </div>
                    ))}
                    {selEntries.length > 4 && (
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', border: '2px solid #121416', marginLeft: '-7px', background: '#2a2a2a', color: '#999', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700 }}>+{selEntries.length - 4}</div>
                    )}
                  </div>
                  <span style={{ fontSize: '12.5px', color: '#aaa' }}>{selEntries.length} racing</span>
                </div>
              )}
            </div>
            <button onClick={() => setSelected(null)} aria-label="Close race card" style={{ background: 'none', border: 'none', color: '#777', fontSize: '17px', cursor: 'pointer', alignSelf: 'flex-start', padding: '2px 4px' }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: '7px', marginTop: '11px', flexWrap: 'wrap' }}>
            <button
              onClick={() => onToggle?.(selected.id)}
              style={{
                fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', fontWeight: 700,
                letterSpacing: '1.2px', textTransform: 'uppercase', padding: '7px 15px',
                borderRadius: '999px', cursor: 'pointer',
                border: `1px solid ${selMine ? 'rgba(var(--brand-rgb),0.55)' : 'rgba(255,255,255,0.18)'}`,
                background: selMine ? 'rgba(var(--brand-rgb),0.1)' : 'none',
                color: selMine ? 'var(--brand)' : '#ddd',
              }}
            >
              {selMine ? '✓ Entered' : 'Enter race'}
            </button>
            <button onClick={() => openChannel('discussion')} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase', padding: '7px 13px', borderRadius: '999px', cursor: 'pointer', background: '#101314', border: '1px solid rgba(255,255,255,0.14)', color: '#bbb' }}>
              {opening === 'discussion' ? 'Opening…' : '💬 Discussion'}
            </button>
            <button onClick={() => openChannel('logistics')} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase', padding: '7px 13px', borderRadius: '999px', cursor: 'pointer', background: '#101314', border: '1px solid rgba(255,255,255,0.14)', color: '#bbb' }}>
              {opening === 'logistics' ? 'Opening…' : '🔒 Logistics'}
            </button>
          </div>
          {note && <div style={{ fontSize: '12px', color: 'var(--highlight)', marginTop: '9px', lineHeight: 1.45 }}>{note}</div>}
        </div>
      )}
    </div>
  )
}
