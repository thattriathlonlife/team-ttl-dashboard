import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { track } from '../lib/track'

// The public website embed (/embed) — Eric's original ask: the race
// map living on the TTL website. It renders with NO login and NO app
// chrome, and it is counts-only by construction: the data comes from
// /api/embed-data, which returns aggregates only (no names, no
// rosters, no member data of any kind ever reaches this page).
//
// Why this file re-implements the map composition instead of reusing
// RaceMapGL / RaceMapLeaflet: both engines are wired for the signed-in
// app (router navigation, session channel openers, named roster cards,
// and the GL map is a module-scope singleton keyed to the signed-in
// race set). None of that may run for an anonymous website visitor.
// So this is a thin embed-specific composition over the SAME engines
// with the SAME parked visuals — identical style URL, recolor paints,
// fog, pin language and framing math, copied from the in-app
// components (which are deliberately left untouched) — with an
// embed-local map instance and the simplified counts-only card.

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PITCH = 48
const APP_RACES_URL = '/races'

// Pin + engine CSS, identical to the in-app maps (RaceMapGL.jsx /
// RaceMapLeaflet.jsx MAP_CSS): filled pill = team racing, hollow =
// community. The embed never renders the gold "you're in" variant.
const EMBED_CSS = `
.maplibregl-map { background: #05090e; font-family: 'Barlow', sans-serif; }
.maplibregl-ctrl-group { background: rgba(18,21,23,.92) !important; border: 1px solid rgba(255,255,255,.12); border-radius: 10px !important; overflow: hidden; box-shadow: 0 10px 26px rgba(0,0,0,.5) !important; }
.maplibregl-ctrl-group button { background: transparent !important; }
.maplibregl-ctrl-group button span { filter: invert(0.85); }
.maplibregl-ctrl-attrib { background: rgba(10,12,13,.72) !important; color: #5c6a68 !important; font-size: 9px !important; }
.maplibregl-ctrl-attrib a { color: #7d8f8c !important; }
.maplibregl-ctrl-attrib-button { filter: invert(0.7); background-color: transparent !important; }
.leaflet-container { background: #0a0f12; font-family: 'Barlow', sans-serif; }
.leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) saturate(.72) brightness(.9) contrast(1.07); }
.leaflet-div-icon { background: transparent; border: none; }
.leaflet-control-attribution { background: rgba(10,12,13,.72) !important; color: #5c6a68 !important; font-size: 9px !important; padding: 1px 5px; }
.leaflet-control-attribution a { color: #7d8f8c !important; }
.leaflet-bar a { background: rgba(18,21,23,.92) !important; color: #cfd8d6 !important; border-color: rgba(255,255,255,.1) !important; backdrop-filter: blur(6px); }
.leaflet-bar { border: 1px solid rgba(255,255,255,.12) !important; border-radius: 10px !important; overflow: hidden; box-shadow: 0 10px 26px rgba(0,0,0,.5) !important; }
.ttl-pin { text-align: center; cursor: pointer; }
.ttl-pin .pill { display: inline-block; font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 13px; letter-spacing: .4px; padding: 5px 12px; border-radius: 999px; white-space: nowrap; background: var(--brand); color: #03292b; box-shadow: 0 0 0 4px rgba(var(--brand-rgb),.16), 0 10px 24px rgba(0,0,0,.55); }
.ttl-pin.comm .pill { background: rgba(8,18,24,.8); color: #c4d6dd; border: 1.5px solid rgba(196,214,221,.55); box-shadow: 0 0 0 3px rgba(196,214,221,.08), 0 8px 20px rgba(0,0,0,.5); }
.ttl-pin .dot { width: 9px; height: 9px; border-radius: 50%; margin: 4px auto 0; background: var(--brand); border: 2px solid rgba(255,255,255,.75); box-shadow: 0 2px 8px rgba(0,0,0,.6); }
.ttl-pin.comm .dot { background: #8fa9b5; }
`

function pinHtml(count, kind) {
  const cls = kind === 'community' ? 'ttl-pin comm' : 'ttl-pin'
  return `<div class="${cls}" style="position: relative"><span class="pill">${count}</span><div class="dot"></div></div>`
}

function pinIcon(count, kind) {
  return L.divIcon({ html: pinHtml(count, kind), className: '', iconSize: [0, 0] })
}

// Same cluster framing as the in-app maps: the densest neighbourhood
// wins; far pins stay a pan away.
function clusterOf(pts) {
  if (pts.length <= 1) return pts
  let best = null
  for (const p of pts) {
    const hood = pts.filter(q => Math.abs(q[0] - p[0]) <= 45 && Math.abs(q[1] - p[1]) <= 35)
    if (!best || hood.length > best.length) best = hood
  }
  return best && (best.length >= 3 || best.length >= Math.ceil(pts.length / 2)) ? best : pts
}

function frameFor(races) {
  const pts = races.map(r => [r.longitude, r.latitude])
  const cluster = clusterOf(pts)
  if (cluster.length === 1) return { center: cluster[0], zoom: 5, pitch: PITCH }
  const lngs = cluster.map(p => p[0])
  const lats = cluster.map(p => p[1])
  const spanLng = Math.max(...lngs) - Math.min(...lngs)
  const spanLat = Math.max(...lats) - Math.min(...lats)
  const zLng = Math.log2((360 * 0.40) / Math.max(spanLng, 4))
  const zLat = Math.log2((170 * 0.36) / Math.max(spanLat, 3))
  const zoom = Math.min(5, Math.max(1.9, Math.min(zLng, zLat)))
  return {
    center: [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2],
    zoom, pitch: PITCH, bearing: -8,
  }
}

function frameLeaflet(map, races) {
  const pts = races.map(r => [r.latitude, r.longitude])
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

// Paint the CARTO Dark Matter style into the app's aesthetic — values
// identical to RaceMapGL.jsx's recolor (pass 2, parked 2026-10-31).
function recolor(map) {
  const layers = map.getStyle()?.layers || []
  for (const layer of layers) {
    const id = (layer.id || '').toLowerCase()
    try {
      if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#04070b')
      else if (id.includes('water') || id.includes('ocean') || id.includes('sea')) {
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

// ── GL engine (embed-local instance — NOT the in-app singleton) ────
function EmbedGLMap({ races, onSelect, onFail }) {
  const containerRef = useRef(null)
  const failRef = useRef(onFail)
  failRef.current = onFail

  useEffect(() => {
    const host = containerRef.current
    if (!host || races.length === 0) return
    let map = null
    let markers = []
    let disposed = false
    let loaded = false
    let pendingFrame = frameFor(races)
    const watchdog = setTimeout(() => { if (!loaded) failRef.current?.() }, 9000)

    // Dynamic import, like the in-app wrapper: a GL load failure must
    // degrade to the Leaflet map, never blank the embed.
    import('maplibre-gl').then((mod) => {
      if (disposed) return
      const maplibregl = mod.default || mod
      try {
        map = new maplibregl.Map({
          container: host,
          style: STYLE_URL,
          center: [-98, 24],
          zoom: 2.0,
          pitch: PITCH,
          bearing: -8,
          attributionControl: { compact: true },
          scrollZoom: false, // an embed must never trap the host page's scroll
          dragRotate: true,
          touchPitch: true,
          pitchWithRotate: true,
          minZoom: 1.6,
          maxBounds: [[-178, -58], [190, 82]],
          maxPitch: 70,
        })
      } catch {
        clearTimeout(watchdog)
        failRef.current?.()
        return
      }
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
      map.on('load', () => {
        loaded = true
        clearTimeout(watchdog)
        if (disposed) return
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
        // Frame only after load (same rule as the in-app map): an
        // easeTo issued before load runs in Mercator and the globe
        // projection then re-interprets the camera.
        if (pendingFrame) { map.jumpTo(pendingFrame); pendingFrame = null }
        for (const race of races) {
          const kind = race.team_entries > 0 ? 'team' : 'community'
          const el = document.createElement('div')
          el.innerHTML = pinHtml(race.entries, kind)
          el.addEventListener('click', (ev) => { ev.stopPropagation(); onSelect(race) })
          const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([race.longitude, race.latitude])
            .addTo(map)
          markers.push(marker)
        }
      })
      map.on('error', () => {
        if (!loaded) { clearTimeout(watchdog); failRef.current?.() }
      })
    }).catch(() => { clearTimeout(watchdog); failRef.current?.() })

    return () => {
      disposed = true
      clearTimeout(watchdog)
      markers.forEach(m => { try { m.remove() } catch { /* already gone */ } })
      if (map) { try { map.remove() } catch { /* already gone */ } }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [races])

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
}

// ── Leaflet engine (Deep Atlas fallback, same as in-app) ───────────
function EmbedLeafletMap({ races, onSelect }) {
  const mapRef = useRef(null)

  useEffect(() => {
    const host = mapRef.current
    if (!host || races.length === 0) return
    const map = L.map(host, {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: true,
      minZoom: 2,
      maxBounds: [[-58, -178], [80, 190]],
      maxBoundsViscosity: 0.8,
      worldCopyJump: true,
    })
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map)
    const layer = L.layerGroup().addTo(map)
    for (const race of races) {
      const kind = race.team_entries > 0 ? 'team' : 'community'
      const marker = L.marker([race.latitude, race.longitude], { icon: pinIcon(race.entries, kind) })
      marker.on('click', () => onSelect(race))
      marker.addTo(layer)
    }
    frameLeaflet(map, races)
    return () => { map.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [races])

  return <div ref={mapRef} style={{ position: 'absolute', inset: 0 }} />
}

// ── The embed page ──────────────────────────────────────────────────
export default function EmbedMap() {
  const [status, setStatus] = useState('loading') // loading | ready | empty | error
  const [races, setRaces] = useState([])
  const [selected, setSelected] = useState(null)
  const [glFailed, setGlFailed] = useState(false)
  const webglOk = useMemo(() => {
    try {
      const canvas = document.createElement('canvas')
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')))
    } catch { return false }
  }, [])

  // Analytics (reporting-suite taxonomy): the embed opening is
  // map_viewed reach on the embed surface. Anonymous — no user id.
  useEffect(() => { track('map_viewed', { surface: 'embed' }) }, [])

  useEffect(() => {
    let live = true
    fetch('/api/embed-data')
      .then(r => { if (!r.ok) throw new Error(`embed-data ${r.status}`); return r.json() })
      .then(data => {
        if (!live) return
        const list = Array.isArray(data?.races) ? data.races : []
        setRaces(list)
        setStatus(list.length > 0 ? 'ready' : 'empty')
      })
      .catch(() => { if (live) setStatus('error') })
    return () => { live = false }
  }, [])

  const selDate = selected ? new Date(selected.race_date + 'T12:00:00') : null
  const selPlace = selected
    ? (selected.location || [selected.city, selected.country].filter(Boolean).join(', '))
    : ''

  return (
    <div style={{ position: 'relative', width: '100%', height: '100dvh', background: '#05090e', overflow: 'hidden', fontFamily: "'Barlow', sans-serif" }}>
      <style>{EMBED_CSS}</style>

      {status === 'ready' && (
        (glFailed || !webglOk)
          ? <EmbedLeafletMap races={races} onSelect={setSelected} />
          : <EmbedGLMap races={races} onSelect={setSelected} onFail={() => setGlFailed(true)} />
      )}

      {/* Vignette + edge fades, same as the in-app panel */}
      {status === 'ready' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 450, pointerEvents: 'none',
          background: 'radial-gradient(125% 95% at 50% 38%, transparent 56%, rgba(4,6,8,0.5)), linear-gradient(180deg, rgba(10,13,14,0.28), transparent 16%, transparent 84%, rgba(10,13,14,0.5))',
        }} />
      )}

      {status === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '15px', letterSpacing: '2.5px', textTransform: 'uppercase', color: '#5c6a68' }}>
            Loading the team race map…
          </div>
        </div>
      )}

      {(status === 'empty' || status === 'error') && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', background: '#0d1316' }}>
          <div style={{ fontSize: '32px' }}>🗺️</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '14px', letterSpacing: '2px', textTransform: 'uppercase', color: '#5c6a68', textAlign: 'center', padding: '0 20px' }}>
            {status === 'error' ? 'The race map could not load — please try again shortly' : 'No start lines on the map yet'}
          </div>
        </div>
      )}

      {/* Caption chip, same copy as the in-app map panel */}
      {status === 'ready' && !selected && (
        <div style={{
          position: 'absolute', left: '10px', bottom: '10px', zIndex: 500, pointerEvents: 'none',
          background: 'rgba(10,13,14,0.78)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '999px', padding: '5px 12px',
          fontSize: '12px', color: '#c4d6dd', backdropFilter: 'blur(6px)',
        }}>
          {races.length} race{races.length !== 1 ? 's' : ''} with TTLers in them
        </div>
      )}

      {/* Counts-only race card: name, date, place, how many TTLers are
          racing, and the way into the app. Nothing else exists in the
          data this page receives, so nothing else can render. */}
      {selected && (
        <div style={{
          position: 'absolute', left: '10px', right: '10px', bottom: '10px', zIndex: 600,
          background: 'rgba(18,20,22,0.97)', border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: '16px', padding: '13px 14px',
          boxShadow: '0 18px 44px rgba(0,0,0,0.55)',
        }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ textAlign: 'center', background: '#1f1f1f', borderRadius: '12px', padding: '7px 0', width: '52px', flexShrink: 0 }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '10.5px', letterSpacing: '1.5px', color: 'var(--accent)', fontWeight: 700 }}>{MONTHS[selDate.getMonth()]}</div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: '23px', fontWeight: 800, lineHeight: 1, color: '#fff' }}>{selDate.getDate()}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '15.5px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected.name}</div>
              <div style={{ fontSize: '12.5px', color: '#999' }}>{selPlace}</div>
              <div style={{ fontSize: '12.5px', color: '#aaa', marginTop: '4px' }}>
                🏁 {selected.entries} TTLer{selected.entries !== 1 ? 's' : ''} racing
              </div>
            </div>
            <button onClick={() => setSelected(null)} aria-label="Close race card" style={{ background: 'none', border: 'none', color: '#777', fontSize: '17px', cursor: 'pointer', alignSelf: 'flex-start', padding: '2px 4px' }}>✕</button>
          </div>
          <div style={{ marginTop: '11px' }}>
            <a
              href={APP_RACES_URL}
              target="_top"
              rel="noreferrer"
              style={{
                display: 'inline-block', fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: '12px', fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase',
                padding: '7px 15px', borderRadius: '999px', textDecoration: 'none',
                border: '1px solid rgba(var(--brand-rgb),0.55)', background: 'rgba(var(--brand-rgb),0.1)',
                color: 'var(--brand)',
              }}
            >
              Open in the Team TTL app ↗
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
