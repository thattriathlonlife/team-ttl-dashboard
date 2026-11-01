import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import { ensureRaceChannel } from '../lib/channels'
import { isTeamTier } from '../lib/tier'

// FALLBACK map (Leaflet / Deep Atlas) — used when WebGL is unavailable
// or the GL style fails to load. The primary map is the 3D MapLibre
// globe in RaceMap.jsx (Zack, 2026-10-31: "a 3d map like the lovable
// one, in the current aesthetic of ours").
// The modern map (Concept A, approved 2026-10-31; visual v3 "Deep Atlas"
// picked 2026-10-31): Leaflet on inverted full-colour OpenStreetMap
// tiles, framed on the densest race cluster instead of the whole world,
// with count pins as first-class data: pills carry start-line counts,
// big fields go coral, races the member has entered get a gold ring, and
// tapping a pin opens the race's card in place with its roster. (Tile
// history: CARTO watermarked its free tiles "API KEY REQUIRED"; Esri
// Dark Gray worked but read flat at world framing.)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MEMBER_COLORS = ['#2BB3A3', '#E87362', '#E8B84B', '#FF5A1F', '#a78bfa', '#34d399', '#f472b6', '#60a5fa']

const MAP_CSS = `
.leaflet-container { background: #0a0f12; font-family: 'Barlow', sans-serif; }
/* Deep Atlas recipe: invert the full-colour OSM tiles and rotate the
   hue back, so oceans land deep navy and land keeps its tint variation
   instead of flattening to grey. Tiles only — markers live in other
   panes and keep their true colours. */
.leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) saturate(.72) brightness(.9) contrast(1.07); }
.leaflet-div-icon { background: transparent; border: none; }
.ttl-pin { transform: translate(-50%, -100%); text-align: center; cursor: pointer; }
.ttl-pin .pill { display: inline-block; font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 13px; letter-spacing: .4px; padding: 5px 12px; border-radius: 999px; white-space: nowrap; background: var(--brand); color: #03292b; box-shadow: 0 0 0 4px rgba(var(--brand-rgb),.16), 0 10px 24px rgba(0,0,0,.55); }
.ttl-pin.comm .pill { background: rgba(8,18,24,.8); color: #c4d6dd; border: 1.5px solid rgba(196,214,221,.55); box-shadow: 0 0 0 3px rgba(196,214,221,.08), 0 8px 20px rgba(0,0,0,.5); }
.ttl-pin.mine .pill { background: #101314; color: #fff; border: 2px solid var(--highlight); box-shadow: 0 0 0 4px rgba(232,184,75,.15), 0 10px 24px rgba(0,0,0,.55); }
.ttl-pin .dot { width: 9px; height: 9px; border-radius: 50%; margin: 4px auto 0; background: var(--brand); border: 2px solid rgba(255,255,255,.75); box-shadow: 0 2px 8px rgba(0,0,0,.6); }
.ttl-pin.comm .dot { background: #8fa9b5; }
.ttl-pin.mine .dot { background: var(--highlight); }
.ttl-pin.zero .dot { width: 12px; height: 12px; background: rgba(var(--brand-rgb),.3); border: 2px solid rgba(var(--brand-rgb),.85); margin: 0 auto; box-shadow: 0 0 10px rgba(var(--brand-rgb),.45); }
.ttl-pin .pulse { position: absolute; left: 50%; bottom: -1px; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%; border: 2px solid rgba(232,184,75,.65); animation: ttlPinPulse 2.2s ease-out infinite; }
@keyframes ttlPinPulse { 0% { transform: scale(.55); opacity: .9; } 70% { transform: scale(2.1); opacity: 0; } 100% { transform: scale(2.1); opacity: 0; } }
.leaflet-control-attribution { background: rgba(10,12,13,.72) !important; color: #5c6a68 !important; font-size: 9px !important; padding: 1px 5px; }
.leaflet-control-attribution a { color: #7d8f8c !important; }
.leaflet-bar a { background: rgba(18,21,23,.92) !important; color: #cfd8d6 !important; border-color: rgba(255,255,255,.1) !important; backdrop-filter: blur(6px); }
.leaflet-bar { border: 1px solid rgba(255,255,255,.12) !important; border-radius: 10px !important; overflow: hidden; box-shadow: 0 10px 26px rgba(0,0,0,.5) !important; }
`

// Pin language (Zack, 2026-11-01): filled = team, hollow = community,
// gold ring + star = you're in. See RaceMap.jsx for the same rules.
function pinIcon(race, count, mine, kind) {
  let cls = 'ttl-pin'
  if (mine) cls += ' mine'
  else if (kind === 'community') cls += ' comm'
  let html
  if (count === 0 && !mine) {
    html = `<div class="${cls} zero"><div class="dot"></div></div>`
  } else {
    const label = mine ? `★ ${count}` : `${count}`
    html = `<div class="${cls}" style="position: relative"><span class="pill">${label}</span><div class="dot"></div>${mine ? '<span class="pulse"></span>' : ''}</div>`
  }
  return L.divIcon({ html, className: '', iconSize: [0, 0] })
}

// Framing (visual v3): never fit the whole world — six pins on four
// continents framed that way is what made the map read "uninspired"
// (grey blobs, an Antarctica band, no labels at that zoom). Instead,
// find the pin with the most neighbours inside a regional box and frame
// that neighbourhood; for TTL today it is the Americas cluster, and the
// far pins stay a pan away. Falls back to fitting everything only when
// no real cluster exists.
function frameRaces(map, pts) {
  if (pts.length === 1) { map.setView(pts[0], 5); return }
  let best = null
  for (const p of pts) {
    const hood = pts.filter(q => Math.abs(q[1] - p[1]) <= 45 && Math.abs(q[0] - p[0]) <= 35)
    if (!best || hood.length > best.length) best = hood
  }
  const use = best && (best.length >= 3 || best.length >= Math.ceil(pts.length / 2)) ? best : pts
  if (use.length === 1) map.setView(use[0], 5)
  else map.fitBounds(use, { padding: [30, 30], maxZoom: 5 })
}

export default function RaceMapLeaflet({ races, allEntries = [], myEntries = [], profile, session, onToggle, teamIds = [] }) {
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
      // Bounds: Antarctica and the pole caps are cut, the world doesn't
      // tile-repeat into mush, and zooming out stops at a useful floor.
      minZoom: 2,
      maxBounds: [[-58, -178], [80, 190]],
      maxBoundsViscosity: 0.8,
      worldCopyJump: true,
    })
    L.control.zoom({ position: 'topright' }).addTo(map)
    // Deep Atlas (visual v3, picked by Zack 2026-10-31 from rendered
    // mockups): OpenStreetMap's full-colour tiles, darkened by the
    // tile-pane filter in MAP_CSS — navy oceans, tinted land, real place
    // labels. Tile history: CARTO watermarked its free tiles ("API KEY
    // REQUIRED", 22:13 screenshot); Esri Dark Gray worked but read flat
    // and uninspired at world framing. OSM tiles are fine at POC volume
    // with attribution; a production rollout moves to a tile host.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
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
      const raceEntries = entriesByRace[race.id] || []
      const count = raceEntries.length
      const kind = raceEntries.some(e => teamIds.includes(e.athlete_id)) ? 'team' : 'community'
      const mine = myEntries.includes(race.id)
      const marker = L.marker([race.latitude, race.longitude], { icon: pinIcon(race, count, mine, kind) })
      marker.on('click', () => { setSelected(race); setNote('') })
      marker.addTo(layer)
      bounds.push([race.latitude, race.longitude])
    }
    const fitKey = racesWithCoords.map(r => r.id).join(',')
    if (bounds.length && fitKey !== fitKeyRef.current) {
      fitKeyRef.current = fitKey
      frameRaces(map, bounds)
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
          No start lines on the map yet
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
      position: 'relative', background: '#0a0f12',
      boxShadow: '0 20px 46px rgba(0,0,0,0.5)',
    }}>
      <style>{MAP_CSS}</style>
      <div ref={mapRef} style={{ width: '100%', height: '262px', zIndex: 0 }} />

      {/* Vignette + edge fades: the panel melts into the page instead of
          ending at a hard rectangle — the difference between an embed and
          a designed surface. Pointer-transparent; the race card (z 600)
          renders above it. */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 450, pointerEvents: 'none',
        background: 'radial-gradient(125% 95% at 50% 38%, transparent 56%, rgba(4,6,8,0.5)), linear-gradient(180deg, rgba(10,13,14,0.28), transparent 16%, transparent 84%, rgba(10,13,14,0.5))',
      }} />

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
          {isTeamTier(profile) && (
            <div style={{ marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '9px' }}>
              {selEntries.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {selEntries.slice(0, 6).map((entry, idx) => (
                    <span key={entry.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#1c1f22', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '999px', padding: '3px 10px 3px 4px', fontSize: '12px', color: '#ddd' }}>
                      <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: entry.profiles?.avatar_color || MEMBER_COLORS[idx % MEMBER_COLORS.length], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 700, color: '#10131a', fontFamily: 'Barlow Condensed, sans-serif' }}>{(entry.profiles?.full_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
                      {entry.profiles?.full_name || 'TTL Member'}
                    </span>
                  ))}
                  {selEntries.length > 6 && <span style={{ fontSize: '12px', color: '#888', alignSelf: 'center' }}>+{selEntries.length - 6} more</span>}
                </div>
              ) : (
                <div style={{ fontSize: '12.5px', color: '#888' }}>No teammates entered yet — be the first on this start line.</div>
              )}
            </div>
          )}
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
