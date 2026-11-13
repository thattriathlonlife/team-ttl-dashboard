import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { rankRaces, densityByRegion, recentSignups, racePlace, parseImportCsv, matchImport } from '../lib/ops'

// Team Ops (run 70) — the staff surface for race-density decisions:
// which races the team is converging on, where, and who — plus the
// merge on-ramp: bulk-import another system's start lines by CSV.
// Admin-only: App routes here only for profiles with role = 'admin',
// and the import RPC enforces the same gate server-side.

const H = { fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff' }
const CARD = { background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 16 }
const SUB = { fontFamily: 'Barlow, sans-serif', fontSize: 12.5, color: '#888', lineHeight: 1.5 }

function SectionTitle({ children }) {
  return <div style={{ ...H, fontSize: 14, letterSpacing: '1.5px', marginBottom: 10 }}>{children}</div>
}

function RosterCopy({ names }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(names.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', padding: '5px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, color: copied ? 'var(--brand)' : '#ccc', cursor: 'pointer' }}
    >{copied ? '✓ Copied' : 'Copy roster'}</button>
  )
}

export default function Ops({ profile }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [races, setRaces] = useState([])
  const [entries, setEntries] = useState([])
  const [profiles, setProfiles] = useState([])
  const [openRace, setOpenRace] = useState(null)

  const [csvText, setCsvText] = useState('')
  const [preview, setPreview] = useState(null)
  const [importMsg, setImportMsg] = useState(null)
  const [importing, setImporting] = useState(false)

  const today = useMemo(() => new Date().toISOString().split('T')[0], [])

  async function load() {
    setLoading(true)
    const [r, e, p] = await Promise.all([
      supabase.from('races').select('*').gte('race_date', today).order('race_date'),
      supabase.from('race_entries').select('*, profiles(full_name)').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, email'),
    ])
    if (r.error || e.error || p.error) setError((r.error || e.error || p.error).message)
    setRaces(r.data ?? [])
    setEntries(e.data ?? [])
    setProfiles(p.data ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const ranked = useMemo(() => rankRaces(races, entries, today), [races, entries, today])
  const density = useMemo(() => densityByRegion(races, entries, today), [races, entries, today])
  const recent = useMemo(() => recentSignups(entries, 10), [entries])
  const raceById = useMemo(() => new Map(races.map(r => [r.id, r])), [races])
  const profileById = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles])
  const upcomingEntries = useMemo(() => entries.filter(e => (raceById.get(e.race_id)?.race_date ?? '') >= today), [entries, raceById, today])
  const membersRacing = useMemo(() => new Set(upcomingEntries.map(e => e.athlete_id)).size, [upcomingEntries])
  const maxDensity = density[0]?.count ?? 1

  function doPreview() {
    setImportMsg(null)
    const { rows, errors } = parseImportCsv(csvText)
    if (errors.length && rows.length === 0) { setPreview({ matched: [], errors }); return }
    const matched = matchImport(rows, profiles, races, entries)
    setPreview({ matched, errors })
  }

  async function doImport() {
    const ready = (preview?.matched ?? []).filter(m => m.status === 'ready')
    if (ready.length === 0) return
    setImporting(true)
    const { data, error: rpcError } = await supabase.rpc('admin_import_race_entries', {
      p_entries: ready.map(m => ({ race_id: m.raceId, athlete_id: m.athleteId })),
    })
    setImporting(false)
    if (rpcError) { setImportMsg({ err: rpcError.message }); return }
    setImportMsg({ ok: `Imported ${data.inserted} start line${data.inserted === 1 ? '' : 's'}${data.skipped ? ` · ${data.skipped} already present` : ''}${data.errors ? ` · ${data.errors} failed` : ''}.` })
    setPreview(null)
    setCsvText('')
    load()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888', fontFamily: 'Barlow, sans-serif' }}>Loading team ops…</div>

  const stat = (label, value) => (
    <div style={{ ...CARD, flex: '1 1 140px', textAlign: 'center', padding: 13 }}>
      <div style={{ ...H, fontSize: 27 }}>{value}</div>
      <div style={{ ...SUB, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
    </div>
  )

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 16px 48px' }}>
      <div style={{ ...H, fontSize: 27, marginBottom: 4 }}>Team Ops</div>
      <div style={{ ...SUB, marginBottom: 16 }}>Where the team is racing, in one place — the meetup-planning view. Staff only.</div>
      {!!error && <div style={{ ...SUB, color: '#ff8a7a', marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {stat('Start lines (upcoming)', upcomingEntries.length)}
        {stat('Members racing', membersRacing)}
        {stat('Races with TTLers', ranked.length)}
        {stat('Upcoming races listed', races.length)}
      </div>

      <div style={{ ...CARD, marginBottom: 14 }}>
        <SectionTitle>Biggest team races</SectionTitle>
        {ranked.length === 0 && <div style={SUB}>No upcoming start lines yet.</div>}
        {ranked.slice(0, 15).map(({ race, count, athleteIds }) => {
          const open = openRace === race.id
          const names = athleteIds.map(id => profileById.get(id)?.full_name ?? 'Member')
          return (
            <div key={race.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpenRace(open ? null : race.id)}>
                <div style={{ minWidth: 42, textAlign: 'center', background: 'rgba(var(--brand-rgb),0.13)', border: '1px solid rgba(var(--brand-rgb),0.35)', borderRadius: 8, padding: '4px 0' }}>
                  <span style={{ ...H, fontSize: 18, color: 'var(--brand)' }}>{count}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'Barlow, sans-serif', fontWeight: 600, fontSize: 15, color: '#fff' }}>{race.name}</div>
                  <div style={SUB}>{new Date(`${race.race_date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · {racePlace(race)}</div>
                </div>
                <span style={{ color: '#888', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
              </div>
              {open && (
                <div style={{ marginTop: 8, marginLeft: 52 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {names.map((n, i) => (
                      <span key={i} style={{ fontFamily: 'Barlow, sans-serif', fontSize: 12.5, color: '#ddd', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '3px 10px' }}>{n}</span>
                    ))}
                  </div>
                  <RosterCopy names={names} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ ...CARD, flex: '1 1 300px' }}>
          <SectionTitle>Density by region</SectionTitle>
          {density.slice(0, 10).map(({ region, count }) => (
            <div key={region} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
              <div style={{ width: 110, fontFamily: 'Barlow, sans-serif', fontSize: 13, color: '#ddd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{region}</div>
              <div style={{ flex: 1, height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ width: `${Math.round((count / maxDensity) * 100)}%`, height: '100%', background: 'var(--brand)', borderRadius: 5 }} />
              </div>
              <div style={{ fontFamily: 'Barlow, sans-serif', fontSize: 13, color: '#fff', minWidth: 22, textAlign: 'right' }}>{count}</div>
            </div>
          ))}
          {density.length === 0 && <div style={SUB}>No regional data yet.</div>}
        </div>

        <div style={{ ...CARD, flex: '1 1 300px' }}>
          <SectionTitle>Recent signups</SectionTitle>
          {recent.map(e => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontFamily: 'Barlow, sans-serif', fontSize: 13, color: '#ddd' }}>
                {e.profiles?.full_name ?? profileById.get(e.athlete_id)?.full_name ?? 'Member'}
                <span style={{ color: '#888' }}> → {raceById.get(e.race_id)?.name ?? 'a past race'}</span>
              </div>
              <div style={{ ...SUB, whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
            </div>
          ))}
          {recent.length === 0 && <div style={SUB}>No signups yet.</div>}
        </div>
      </div>

      <div style={CARD}>
        <SectionTitle>Import start lines</SectionTitle>
        <div style={{ ...SUB, marginBottom: 10 }}>
          Bring another system's start list over: paste CSV with an athlete (email or full name), a race name, and an optional date —
          e.g. <span style={{ color: '#bbb' }}>email,race,date</span>. Nothing is written until you preview and confirm; duplicates are skipped.
        </div>
        <textarea
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          placeholder={'email,race,date\nexample@member.com,Ironman Texas,2027-04-24'}
          rows={6}
          style={{ width: '100%', boxSizing: 'border-box', background: '#111', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '10px 12px', fontSize: 13, fontFamily: 'ui-monospace, monospace', outline: 'none', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={doPreview} disabled={!csvText.trim()} style={{ background: 'var(--brand)', color: '#06282a', border: 'none', borderRadius: 6, padding: '9px 18px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', opacity: csvText.trim() ? 1 : 0.5 }}>
            Preview matches
          </button>
          {preview && (
            <span style={SUB}>
              {(preview.matched ?? []).filter(m => m.status === 'ready').length} ready · {(preview.matched ?? []).filter(m => m.status === 'duplicate').length} already present · {(preview.matched ?? []).filter(m => !['ready', 'duplicate'].includes(m.status)).length} need attention
            </span>
          )}
        </div>
        {preview?.errors?.length > 0 && (
          <div style={{ ...SUB, color: '#ff8a7a', marginTop: 8 }}>{preview.errors.map((e, i) => <div key={i}>{e}</div>)}</div>
        )}
        {preview && preview.matched.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {preview.matched.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', borderTop: '1px solid rgba(255,255,255,0.05)', fontFamily: 'Barlow, sans-serif', fontSize: 13 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: m.status === 'ready' ? '#7ac74f' : m.status === 'duplicate' ? '#999' : '#ff8a7a', minWidth: 86 }}>{m.status.replace('_', ' ')}</span>
                <span style={{ color: '#ddd' }}>{m.detail || `${m.athlete} → ${m.race}`}</span>
              </div>
            ))}
            <button onClick={doImport} disabled={importing || !preview.matched.some(m => m.status === 'ready')} style={{ marginTop: 12, background: 'var(--brand)', color: '#06282a', border: 'none', borderRadius: 6, padding: '10px 20px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13.5, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer', opacity: importing ? 0.6 : 1 }}>
              {importing ? 'Importing…' : `Import ${preview.matched.filter(m => m.status === 'ready').length} start lines`}
            </button>
          </div>
        )}
        {importMsg?.ok && <div style={{ ...SUB, color: '#7ac74f', marginTop: 10 }}>{importMsg.ok}</div>}
        {importMsg?.err && <div style={{ ...SUB, color: '#ff8a7a', marginTop: 10 }}>{importMsg.err}</div>}
      </div>
    </div>
  )
}
