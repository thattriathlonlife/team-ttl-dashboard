import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { supabase } from '../lib/supabase'
import { ensureRaceChannel } from '../lib/channels'
import { isTeamTier } from '../lib/tier'
import RaceMapLeaflet from './RaceMapLeaflet'

// The 3D map (Zack, 2026-10-31: "I want a 3d map like the lovable one —
// in the current aesthetic of ours"). The teammate's Race Compass is
// Mapbox; this is MapLibre GL (the open-source GL engine): a real globe
// at low zoom with atmosphere, a tilted perspective camera, and vector
// tiles — recoloured at runtime into the app's Deep Atlas aesthetic
// (deep-navy water, charcoal land, brand-lit pins). Tile source: CARTO's
// keyless GL basemap (vector .mvt tiles verified by content on
// 2026-10-31 — valid gzipped protobuf; unlike CARTO's raster CDN, which
// watermarks). If WebGL or the style fails, the verified Leaflet map
// renders instead (RaceMapLeaflet).
const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MEMBER_COLORS = ['#2BB3A3', '#E87362', '#E8B84B', '#FF5A1F', '#a78bfa', '#34d399', '#f472b6', '#60a5fa']
const PITCH = 48

const MAP_CSS = `
.maplibregl-map { background: #05090e; font-family: 'Barlow', sans-serif; border-radius: 16px; }
.maplibregl-ctrl-group { background: rgba(18,21,23,.92) !important; border: 1px solid rgba(255,255,255,.12); border-radius: 10px !important; overflow: hidden; box-shadow: 0 10px 26px rgba(0,0,0,.5) !important; }
.maplibregl-ctrl-group button { background: transparent !important; }
.maplibregl-ctrl-group button span { filter: invert(0.85); }
.maplibregl-ctrl-attrib { background: rgba(10,12,13,.72) !important; color: #5c6a68 !important; font-size: 9px !important; }
.maplibregl-ctrl-attrib a { color: #7d8f8c !important; }
.maplibregl-ctrl-attrib-button { filter: invert(0.7); background-color: transparent !important; }
.ttl-pin { text-align: center; cursor: pointer; }
.ttl-pin .pill { display: inline-block; font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 13px; letter-spacing: .4px; padding: 5px 12px; border-radius: 999px; white-space: nowrap; background: var(--brand); color: #03292b; box-shadow: 0 0 0 4px rgba(var(--brand-rgb),.16), 0 10px 24px rgba(0,0,0,.55); }
.ttl-pin.coral .pill { background: var(--accent); color: #2b0f0b; box-shadow: 0 0 0 4px rgba(var(--accent-rgb),.16), 0 10px 24px rgba(0,0,0,.55); }
.ttl-pin.compact .pill { background: rgba(var(--brand-rgb),.18); color: #d8f2f0; border: 1px solid rgba(var(--brand-rgb),.45); box-shadow: 0 0 0 3px rgba(var(--brand-rgb),.1), 0 8px 20px rgba(0,0,0,.5); backdrop-filter: blur(2px); }
.ttl-pin.mine .pill { background: #101314; color: #fff; border: 2px solid var(--highlight); box-shadow: 0 0 0 4px rgba(232,184,75,.15), 0 10px 24px rgba(0,0,0,.55); }
.ttl-pin .dot { width: 9px; height: 9px; border-radius: 50%; margin: 4px auto 0; background: var(--brand); border: 2px solid rgba(255,255,255,.75); box-shadow: 0 2px 8px rgba(0,0,0,.6); }
.ttl-pin.coral .dot { background: var(--accent); }
.ttl-pin.compact .dot { background: #a8ccc9; }
.ttl-pin.mine .dot { background: var(--highlight); }
.ttl-pin.zero .dot { width: 12px; height: 12px; background: rgba(var(--brand-rgb),.3); border: 2px solid rgba(var(--brand-rgb),.85); margin: 0 auto; box-shadow: 0 0 10px rgba(var(--brand-rgb),.45); }
.ttl-pin .pulse { position: absolute; left: 50%; bottom: -1px; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%; border: 2px solid rgba(232,184,75,.65); animation: ttlPinPulse 2.2s ease-out infinite; }
@keyframes ttlPinPulse { 0% { transform: scale(.55); opacity: .9; } 70% { transform: scale(2.1); opacity: 0; } 100% { transform: scale(2.1); opacity: 0; } }
`

function pinHtml(count, mine) {
  let cls = 'ttl-pin'
  if (mine) cls += ' mine'
  else if (count >= 15) cls += ' coral'
  else if (count > 0 && count < 5) cls += ' compact'
  if (count === 0 && !mine) return `<div class="${cls} zero"><div class="dot"></div></div>`
  const label = mine ? `★ ${count}` : count >= 5 ? `${count} racing` : `${count}`
  return `<div class="${cls}" style="position: relative"><span class="pill">${label}</span><div class="dot"></div>${mine ? '<span class="pulse"></span>' : ''}</div>`
}

// Same cluster framing as the 2D map: the densest neighbourhood wins;
// far pins stay a pan away.
function clusterOf(pts) {
  if (pts.length <= 1) return pts
  let best = null
  for (const p of pts) {
    const hood = pts.filter(q => Math.abs(q[0] - p[0]) <= 45 && Math.abs(q[1] - p[1]) <= 35)
    if (!best || hood.length > best.length) best = hood
  }
  return best && (best.length >= 3 || best.length >= Math.ceil(pts.length / 2)) ? best : pts
}

// Paint the CARTO Dark Matter style into our aesthetic: Deep Atlas
// water/land, muted roads and boundaries, readable labels.
function recolor(map) {
  const layers = map.getStyle()?.layers || []
  for (const layer of layers) {
    const id = (layer.id || '').toLowerCase()
    try {
      if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#04070b')
      else if (id.includes('water') || id.includes('ocean') || id.includes('sea')) {
        // Water pushed DEEPER than the land (fix pass, 2026-10-31: the
        // first values made continents read as black holes in the sea).
        if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-color', '#0a2a44')
        if (layer.type === 'line') map.setPaintProperty(layer.id, 'line-color', '#14456b')
      } else if (id.includes('landcover')) {
        if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-color', '#223242')
      } else if (id.includes('landuse')) {
        if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-color', '#25384a')
      } else if (id.includes('land') || id.includes('earth')) {
        if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-color', '#2a3d4f')
      } else if (id.includes('building')) {
        if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-color', '#2f4356')
      } else if (id.includes('boundary') || id.includes('border') || id.includes('admin')) {
        if (layer.type === 'line') map.setPaintProperty(layer.id, 'line-color', 'rgba(158,184,198,0.3)')
      } else if (layer.type === 'line' && (id.includes('road') || id.includes('street') || id.includes('highway') || id.includes('transport') || id.includes('bridge') || id.includes('tunnel'))) {
        map.setPaintProperty(layer.id, 'line-color', 'rgba(160,185,200,0.4)')
      } else if (layer.type === 'symbol') {
        map.setPaintProperty(layer.id, 'text-color', '#cfe0e2')
        map.setPaintProperty(layer.id, 'text-halo-color', 'rgba(3,8,12,0.9)')
        map.setPaintProperty(layer.id, 'text-halo-width', 1.2)
      }
    } catch { /* a layer that doesn't take the paint is fine */ }
  }
}

function RaceMapGL({ races, allEntries = [], myEntries = [], profile, session, onToggle, onFail }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const fitKeyRef = useRef('')
  const loadedRef = useRef(false)
  const pendingFrameRef = useRef(null)
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

  // Create the globe once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current || racesWithCoords.length === 0) return
    let map
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE_URL,
        center: [-98, 24],
        zoom: 2.0,
        pitch: PITCH,
        bearing: -8,
        attributionControl: { compact: true },
        scrollZoom: false, // never trap page scroll (long-standing rule)
        dragRotate: true,
        touchPitch: true,
        pitchWithRotate: true,
        minZoom: 1.6,
        maxBounds: [[-178, -58], [190, 82]],
        maxPitch: 70,
      })
    } catch {
      onFail()
      return
    }
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

    const watchdog = setTimeout(() => { if (!loadedRef.current) onFail() }, 9000)
    map.on('load', () => {
      loadedRef.current = true
      clearTimeout(watchdog)
      try { map.setProjection({ type: 'globe' }) } catch { /* flat 3D is fine */ }
      try {
        map.setFog({
          range: [0.4, 9],
          color: '#0d2233',
          'high-color': '#1a4a66',
          'space-color': '#020507',
          'horizon-blend': 0.14,
          'star-intensity': 0.3,
        })
      } catch { /* atmosphere is decoration */ }
      recolor(map)
      // Apply framing only now (fix pass 2): an easeTo issued before
      // load runs in Mercator, then setProjection('globe') re-interprets
      // the camera — which is how the map could open over empty ocean.
      if (pendingFrameRef.current) {
        map.jumpTo(pendingFrameRef.current)
        pendingFrameRef.current = null
      }
    })
    map.on('error', () => { if (!loadedRef.current) { clearTimeout(watchdog); onFail() } })
    return () => { clearTimeout(watchdog); map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [racesWithCoords.length])

  // Sync markers + framing with the filtered race set.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    const pts = []
    for (const race of racesWithCoords) {
      const count = (entriesByRace[race.id] || []).length
      const mine = myEntries.includes(race.id)
      const el = document.createElement('div')
      el.innerHTML = pinHtml(count, mine)
      el.addEventListener('click', (ev) => { ev.stopPropagation(); setSelected(race); setNote('') })
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([race.longitude, race.latitude])
        .addTo(map)
      markersRef.current.push(marker)
      pts.push([race.longitude, race.latitude])
    }
    const fitKey = racesWithCoords.map(r => r.id).join(',')
    if (pts.length && fitKey !== fitKeyRef.current) {
      fitKeyRef.current = fitKey
      const cluster = clusterOf(pts)
      if (cluster.length === 1) {
        const frame = { center: cluster[0], zoom: 5, pitch: PITCH }
        if (loadedRef.current) map.jumpTo(frame)
        else pendingFrameRef.current = frame
      } else {
        // Frame by computed center + zoom on the cluster's hemisphere
        // (Zack's reference, 2026-10-31 23:29: the Americas disc with
        // the pins in frame — the Lovable globe framing). Span fills
        // ~40% of the world-width so neighbouring continents stay on
        // the disc; the frame is applied via jumpTo AFTER the style +
        // globe projection load (see pendingFrameRef), never before.
        const lngs = cluster.map(p => p[0])
        const lats = cluster.map(p => p[1])
        const spanLng = Math.max(...lngs) - Math.min(...lngs)
        const spanLat = Math.max(...lats) - Math.min(...lats)
        const zLng = Math.log2((360 * 0.40) / Math.max(spanLng, 4))
        const zLat = Math.log2((170 * 0.36) / Math.max(spanLat, 3))
        const zoom = Math.min(5, Math.max(1.9, Math.min(zLng, zLat)))
        const frame = {
          center: [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2],
          zoom, pitch: PITCH, bearing: -8,
        }
        if (loadedRef.current) map.jumpTo(frame)
        else pendingFrameRef.current = frame
      }
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
      position: 'relative', background: '#05090e',
      boxShadow: '0 20px 46px rgba(0,0,0,0.5)',
    }}>
      <style>{MAP_CSS}</style>
      <div ref={containerRef} style={{ width: '100%', height: '300px', zIndex: 0 }} />

      {/* Vignette + edge fades, same as the 2D panel */}
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

export default function RaceMap(props) {
  const [glFailed, setGlFailed] = useState(false)
  const webglOk = useMemo(() => {
    try {
      const canvas = document.createElement('canvas')
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')))
    } catch { return false }
  }, [])
  if (glFailed || !webglOk) return <RaceMapLeaflet {...props} />
  return <RaceMapGL {...props} onFail={() => setGlFailed(true)} />
}
