import { getDemoTier, setDemoTier, isTeamTier } from '../lib/tier'
import { BRAND_THEME, TEAM_THEME } from '../lib/theme'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Avatar paint choices are stored data (profiles.avatar_color), so they
// stay literal colours and never become theme variables.
const AVATAR_COLORS = [
  { value: '#00B5B9', label: 'Teal' },
  { value: '#E87362', label: 'Coral' },
  { value: '#E8B84B', label: 'Gold' },
  { value: '#FF5A1F', label: 'Orange' },
  { value: '#a78bfa', label: 'Purple' },
  { value: '#34d399', label: 'Green' },
  { value: '#60a5fa', label: 'Blue' },
  { value: '#f472b6', label: 'Rose' },
]

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const FULL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function getBadgeStyle(type) {
  if (type === 'IRONMAN') return { background: 'rgba(var(--brand-rgb),0.12)', color: 'var(--brand)', border: '1px solid rgba(var(--brand-rgb),0.25)' }
  if (type === '70.3') return { background: 'rgba(var(--accent-rgb),0.12)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.25)' }
  return { background: 'rgba(var(--highlight-rgb),0.1)', color: 'var(--highlight)', border: '1px solid rgba(var(--highlight-rgb),0.2)' }
}

function getDaysAway(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const race = new Date(dateStr + 'T00:00:00')
  const diff = Math.ceil((race - today) / 86400000)
  if (diff === 0) return { text: 'Today!', color: 'var(--accent)' }
  if (diff === 1) return { text: 'Tomorrow!', color: 'var(--accent)' }
  if (diff <= 7) return { text: `${diff} days`, color: 'var(--highlight)' }
  if (diff <= 30) return { text: `${diff} days`, color: 'var(--accent)' }
  return { text: `${diff} days`, color: '#999' }
}

function generateIcal(races) {
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Team TTL//Race Schedule//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH']
  races.forEach(race => {
    const d = race.race_date.replace(/-/g, '')
    lines.push('BEGIN:VEVENT',`DTSTART;VALUE=DATE:${d}`,`DTEND;VALUE=DATE:${d}`,`SUMMARY:${race.name}`,`LOCATION:${race.location || ''}`,`DESCRIPTION:${race.type} Triathlon`,`UID:ttl-race-${race.id}@teamttl`,'END:VEVENT')
  })
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

const S = {
  page: { maxWidth: '700px', margin: '0 auto', padding: '2rem 1.5rem' },
  sectionTitle: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', color: '#999', marginBottom: '1rem' },
  divider: { height: '1px', background: 'rgba(255,255,255,0.06)', margin: '2rem 0' },
  avatarWrap: { display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem' },
  avatarImg: { width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.1)' },
  avatarPlaceholder: { width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '22px', fontWeight: 700, color: '#000', flexShrink: 0 },
  uploadBtn: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '1.5px', textTransform: 'uppercase', padding: '7px 14px', background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#ccc', cursor: 'pointer', display: 'block', marginBottom: '6px' },
  uploadHint: { fontSize: '11px', color: '#555' },
  colorGrid: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '1.5rem' },
  colorSwatch: { width: '34px', height: '34px', borderRadius: '50%', cursor: 'pointer', border: '3px solid transparent', transition: 'border-color 0.15s, transform 0.15s' },
  formGroup: { marginBottom: '1.25rem' },
  label: { display: 'block', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#999', marginBottom: '6px' },
  input: { width: '100%', background: '#1f1f1f', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff', padding: '12px 14px', fontSize: '15px', fontFamily: 'Barlow, sans-serif', outline: 'none' },
  inputReadonly: { opacity: 0.5, cursor: 'not-allowed' },
  hint: { fontSize: '12px', color: '#555', marginTop: '5px' },
  saveBtn: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', padding: '13px 24px', background: 'var(--brand)', border: 'none', borderRadius: '6px', color: '#000', cursor: 'pointer', width: '100%', marginTop: '4px' },
  signOutBtn: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', letterSpacing: '1.5px', textTransform: 'uppercase', padding: '11px 24px', background: 'none', border: '1px solid rgba(var(--accent-rgb),0.3)', borderRadius: '6px', color: 'var(--accent)', cursor: 'pointer', width: '100%', marginTop: '10px' },
  success: { background: 'rgba(var(--brand-rgb),0.1)', border: '1px solid rgba(var(--brand-rgb),0.25)', borderRadius: '6px', padding: '12px 16px', color: 'var(--brand)', fontSize: '14px', marginBottom: '1rem' },
  error: { background: 'rgba(var(--accent-rgb),0.1)', border: '1px solid rgba(var(--accent-rgb),0.2)', borderRadius: '6px', padding: '12px 16px', color: 'var(--accent)', fontSize: '13px', marginBottom: '1rem' },
  // My races
  exportBtn: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '1.5px', textTransform: 'uppercase', padding: '7px 14px', background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#ccc', cursor: 'pointer', marginBottom: '1rem', display: 'inline-block' },
  raceCard: { background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'grid', gridTemplateColumns: '56px 1fr auto', alignItems: 'center', gap: '1rem', marginBottom: '8px' },
  dateBlock: { textAlign: 'center' },
  dateDay: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '26px', fontWeight: 700, lineHeight: 1, color: '#fff' },
  dateMonth: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', color: '#999' },
  raceName: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 600, color: '#fff', marginBottom: '2px' },
  raceLoc: { fontSize: '12px', color: '#999' },
  badge: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', padding: '2px 8px', borderRadius: '3px', textTransform: 'uppercase', display: 'inline-block', marginTop: '4px' },
  monthLabel: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', color: '#444', marginBottom: '8px', marginTop: '1rem', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  emptyRaces: { textAlign: 'center', padding: '2rem', background: '#161616', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' },
  // Badges
  badgeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' },
  badgeTile: { background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '14px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', textAlign: 'center' },
  badgeTileEarned: { background: 'rgba(var(--highlight-rgb),0.05)', border: '1px solid rgba(var(--highlight-rgb),0.2)' },
  badgeTileLocked: { opacity: 0.35, filter: 'grayscale(1)' },
  badgeIcon: { fontSize: '28px', lineHeight: 1 },
  badgeName: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 700, color: '#fff', lineHeight: 1.2 },
  badgeDesc: { fontSize: '11px', color: '#666', lineHeight: 1.4 },
  badgeDate: { fontSize: '10px', color: 'var(--highlight)', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' },
  badgeTierLabel: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', padding: '2px 6px', borderRadius: '3px' },
  badgeTierElite: { background: 'rgba(var(--highlight-rgb),0.1)', color: 'var(--highlight)', border: '1px solid rgba(var(--highlight-rgb),0.2)' },
}

export default function ProfilePage({ session, profile: initialProfile, onSave }) {
  const [profile, setProfile] = useState(initialProfile)
  const [fullName, setFullName] = useState(initialProfile?.full_name || '')
  const [whatsapp, setWhatsapp] = useState(initialProfile?.whatsapp_number || '')
  const [avatarColor, setAvatarColor] = useState(initialProfile?.avatar_color || '#00B5B9')
  const [avatarUrl, setAvatarUrl] = useState(initialProfile?.avatar_url || null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [myRaces, setMyRaces] = useState([])
  const [loadingRaces, setLoadingRaces] = useState(true)
  const [earnedBadges, setEarnedBadges] = useState([])
  const [allBadges, setAllBadges] = useState([])
  const [loadingBadges, setLoadingBadges] = useState(true)
  const fileRef = useRef()
  const userId = session.user.id
  const email = session.user.email

  useEffect(() => { loadMyRaces(); loadBadges() }, [])

  async function loadMyRaces() {
    const { data } = await supabase.from('race_entries').select('*, races(*)').eq('athlete_id', userId)
    if (data) {
      const upcoming = data.map(e => e.races).filter(Boolean)
        .filter(r => r.race_date >= new Date().toISOString().split('T')[0])
        .sort((a, b) => new Date(a.race_date) - new Date(b.race_date))
      setMyRaces(upcoming)
    }
    setLoadingRaces(false)
  }

  async function loadBadges() {
    const [earnedRes, allRes] = await Promise.all([
      supabase
        .from('profile_badges')
        .select('badge_key, earned_at, badges(name, icon, tier, description, sort_order)')
        .eq('athlete_id', userId)
        .order('earned_at', { ascending: false }),
      supabase
        .from('badges')
        .select('key, name, icon, tier, description, sort_order')
        .order('sort_order'),
    ])
    if (earnedRes.data) setEarnedBadges(earnedRes.data)
    if (allRes.data)    setAllBadges(allRes.data)
    setLoadingBadges(false)
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setError('Image must be under 2MB'); return }
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${userId}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadError) { setError('Upload failed — ' + uploadError.message); setUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
    setAvatarUrl(publicUrl)
    setUploading(false)
  }

  async function handleSave() {
    if (!fullName.trim()) { setError('Name cannot be empty'); return }
    setSaving(true); setError(''); setSuccess(false)
    const { error: saveError } = await supabase.from('profiles').update({
      full_name: fullName.trim(), whatsapp_number: whatsapp.trim() || null,
      avatar_color: avatarColor, avatar_url: avatarUrl,
    }).eq('id', userId)
    if (saveError) { setError('Save failed — ' + saveError.message) }
    else { await supabase.auth.updateUser({ data: { full_name: fullName.trim() } }); setSuccess(true); onSave?.(); setTimeout(() => setSuccess(false), 3000) }
    setSaving(false)
  }

  // Location setting (moved here from the Feed, Zack 2026-11-01): the
  // Feed prompts for nothing. 'ttl-geo-enabled' is the member's switch
  // ('0' = off); the browser permission is the other half of the state.
  const [geoSetting, setGeoSetting] = useState('loading')
  useEffect(() => {
    ;(async () => {
      if (!('geolocation' in navigator)) { setGeoSetting('unsupported'); return }
      let pref = null
      try { pref = localStorage.getItem('ttl-geo-enabled') } catch { /* private mode */ }
      if (pref === '0') { setGeoSetting('off'); return }
      try {
        const perm = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null)
        if (perm?.state === 'granted') setGeoSetting('on')
        else if (perm?.state === 'denied') setGeoSetting('denied')
        else setGeoSetting('prompt')
      } catch { setGeoSetting('prompt') }
    })()
  }, [])
  function enableLocation() {
    try { localStorage.setItem('ttl-geo-enabled', '1') } catch { /* private mode */ }
    navigator.geolocation.getCurrentPosition(
      () => setGeoSetting('on'),
      async () => {
        try {
          const perm = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null)
          setGeoSetting(perm?.state === 'denied' ? 'denied' : 'prompt')
        } catch { setGeoSetting('prompt') }
      },
      { timeout: 8000 },
    )
  }
  function disableLocation() {
    try { localStorage.setItem('ttl-geo-enabled', '0') } catch { /* private mode */ }
    setGeoSetting('off')
  }

  async function signOut() { await supabase.auth.signOut() }

  function handleExport() {
    const ical = generateIcal(myRaces)
    const blob = new Blob([ical], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'ttl-my-races.ics'; a.click()
    URL.revokeObjectURL(url)
  }

  const initials = fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'

  // Group races by month
  const grouped = myRaces.reduce((acc, race) => {
    const d = new Date(race.race_date + 'T12:00:00')
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (!acc[key]) acc[key] = { label: `${FULL_MONTHS[d.getMonth()]} ${d.getFullYear()}`, races: [] }
    acc[key].races.push(race)
    return acc
  }, {})

  const teamView = isTeamTier(profile)
  const palette = teamView ? TEAM_THEME : BRAND_THEME
  const nextRace = myRaces[0] || null
  const nextDate = nextRace ? new Date(nextRace.race_date + 'T12:00:00') : null

  return (
    <div style={S.page}>

      {/* Identity card (mockups, 2026-10-31): who you are in this app,
          before any form fields. */}
      <div style={{
        background: 'linear-gradient(160deg, rgba(var(--brand-rgb),0.12), rgba(var(--accent-rgb),0.05))',
        border: '1px solid rgba(255,255,255,0.09)', borderRadius: '16px',
        padding: '22px 16px 18px', textAlign: 'center', marginBottom: '12px',
      }}>
        {avatarUrl
          ? <img src={avatarUrl} alt="avatar" style={{ width: 76, height: 76, borderRadius: '50%', objectFit: 'cover', border: '3px solid rgba(var(--brand-rgb),0.45)', display: 'block', margin: '0 auto' }} />
          : <div style={{ width: 76, height: 76, borderRadius: '50%', background: avatarColor, border: '3px solid rgba(var(--brand-rgb),0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 26, fontWeight: 800, color: '#10131a' }}>{initials}</div>
        }
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 24, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#fff', marginTop: 11, lineHeight: 1.1 }}>
          {fullName || 'Your profile'}
        </div>
        <div style={{ fontSize: 13, color: '#999', marginTop: 3 }}>{email}</div>
        <div style={{ display: 'flex', gap: 7, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 10.5, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', background: 'rgba(var(--brand-rgb),0.13)', color: 'var(--brand)', border: '1px solid rgba(var(--brand-rgb),0.3)', padding: '3px 9px', borderRadius: 5 }}>
            {teamView ? 'Team TTL member' : 'Community member'}
          </span>
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', background: '#101010', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '3px 10px' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: palette.brand }} />
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: palette.accent }} />
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: palette.highlight }} />
            <span style={{ fontSize: 10.5, color: '#999', marginLeft: 2 }}>{teamView ? 'Kit palette' : 'Brand palette'}</span>
          </span>
        </div>
      </div>

      {/* Athlete stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        {[
          { v: loadingRaces ? '—' : myRaces.length, l: 'Upcoming races', c: '#fff' },
          { v: loadingBadges ? '—' : earnedBadges.length, l: 'Badges earned', c: 'var(--highlight)' },
          { v: profile?.training_streak_current ?? 0, l: 'Week streak', c: 'var(--brand)' },
        ].map(t => (
          <div key={t.l} style={{ flex: 1, background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '13px 8px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 25, fontWeight: 800, color: t.c, lineHeight: 1 }}>{t.v}</div>
            <div style={{ fontSize: 10.5, color: '#777', letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 }}>{t.l}</div>
          </div>
        ))}
      </div>

      {/* Next race — the same date-block card as the Races page */}
      {nextRace && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '13px 15px', marginBottom: '1.75rem' }}>
          <div style={{ textAlign: 'center', background: '#1f1f1f', borderRadius: 12, padding: '8px 0', width: 56, flexShrink: 0 }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)' }}>{nextDate.toLocaleDateString('en-US', { month: 'short' })}</div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 25, fontWeight: 800, lineHeight: 1.05, color: '#fff' }}>{nextDate.getDate()}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--brand)', fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700 }}>Your next race</div>
            <div style={{ fontWeight: 700, fontSize: 15.5, color: '#fff', marginTop: 2 }}>{nextRace.name}</div>
            <div style={{ fontSize: 12.5, color: '#999' }}>{nextRace.location} · <span style={{ color: getDaysAway(nextRace.race_date).color }}>{getDaysAway(nextRace.race_date).text} away</span></div>
          </div>
        </div>
      )}

      {success && <div style={S.success}>✓ Profile saved</div>}
      {error && <div style={S.error}>{error}</div>}

      {/* Avatar */}
      <div style={S.sectionTitle}>Profile Picture</div>
      <div style={S.avatarWrap}>
        {avatarUrl
          ? <img src={avatarUrl} alt="avatar" style={S.avatarImg} />
          : <div style={{ ...S.avatarPlaceholder, background: avatarColor }}>{initials}</div>
        }
        <div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />
          <button style={S.uploadBtn} onClick={() => fileRef.current.click()}>{uploading ? 'Uploading...' : avatarUrl ? 'Change photo' : 'Upload photo'}</button>
          {avatarUrl && <button style={{ ...S.uploadBtn, color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.2)' }} onClick={() => setAvatarUrl(null)}>Remove photo</button>}
          <div style={S.uploadHint}>JPG or PNG, max 2MB</div>
        </div>
      </div>

      <div style={S.divider} />

      <div style={S.sectionTitle}>Avatar Color</div>
      <div style={S.colorGrid}>
        {AVATAR_COLORS.map(c => (
          <div key={c.value} title={c.label} style={{ ...S.colorSwatch, background: c.value, borderColor: avatarColor === c.value ? '#fff' : 'transparent', transform: avatarColor === c.value ? 'scale(1.15)' : 'scale(1)' }} onClick={() => setAvatarColor(c.value)} />
        ))}
      </div>

      <div style={S.divider} />

      <div style={S.sectionTitle}>Personal Details</div>
      <div style={S.formGroup}>
        <label style={S.label}>Full Name</label>
        <input style={S.input} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your full name" />
      </div>
      <div style={S.formGroup}>
        <label style={S.label}>Email</label>
        <input style={{ ...S.input, ...S.inputReadonly }} value={email} readOnly />
        <div style={S.hint}>Email cannot be changed here</div>
      </div>
      <div style={S.formGroup}>
        <label style={S.label}>WhatsApp Number</label>
        <input style={S.input} value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+1 555 000 0000" />
        <div style={S.hint}>Used for race weekend notifications when enabled</div>
      </div>

      <button style={S.saveBtn} onClick={handleSave} disabled={saving || uploading}>{saving ? 'Saving...' : 'Save Profile'}</button>
      <div style={{ marginTop: 18, padding: '14px', background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16 }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: '#fff', marginBottom: 4 }}>Location</div>
        <div style={{ fontFamily: 'Barlow, sans-serif', fontSize: 12, color: '#888', marginBottom: 10 }}>Float races &amp; chats near you to the top of your Feed when you travel. Your position stays on this device — it's never stored or shared.</div>
        {geoSetting === 'on' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: '#3ecf8e', flex: 1 }}>📍 On — near-you ranking is active in your Feed</span>
            <button onClick={disableLocation} style={{ background: '#1f1f1f', color: '#ccc', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '8px 14px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>Turn off</button>
          </div>
        )}
        {(geoSetting === 'off' || geoSetting === 'prompt') && (
          <button onClick={enableLocation} style={{ width: '100%', background: 'var(--brand)', color: '#06282a', border: 'none', borderRadius: 6, padding: '9px 4px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>Enable location</button>
        )}
        {geoSetting === 'denied' && <div style={{ fontSize: 12.5, color: '#999' }}>Location is blocked for this site in your browser settings. Allow it there, then come back and enable it here.</div>}
        {geoSetting === 'unsupported' && <div style={{ fontSize: 12.5, color: '#999' }}>This browser doesn't support location.</div>}
      </div>
      <div style={{ marginTop: 18, padding: '14px', background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16 }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: '#fff', marginBottom: 4 }}>Demo view (proof of concept)</div>
        <div style={{ fontFamily: 'Barlow, sans-serif', fontSize: 12, color: '#888', marginBottom: 10 }}>Preview the app as a fan or as a team member. Real access is set by team entitlement.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['fan', 'team'].map(t => (
            <button key={t} onClick={() => setDemoTier(t)} style={{ flex: 1, background: getDemoTier() === t ? 'var(--brand)' : '#1f1f1f', color: getDemoTier() === t ? '#06282a' : '#ccc', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '9px 4px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>{t === 'fan' ? 'Fan view' : 'Team view'}</button>
          ))}
        </div>
      </div>
      <button style={S.signOutBtn} onClick={signOut}>Sign Out</button>

      <div style={S.divider} />

      {/* Badges */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '32px', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff' }}>Badges</div>
        {!loadingBadges && (
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '1px', color: '#555' }}>
            {earnedBadges.length} / {allBadges.length} earned
          </div>
        )}
      </div>

      {loadingBadges ? (
        <div style={{ color: '#555', fontSize: '13px' }}>Loading...</div>
      ) : (
        <>
          {/* Standard badges */}
          {(() => {
            const earnedKeys = new Set(earnedBadges.map(b => b.badge_key))
            const standard = allBadges.filter(b => b.tier === 'standard')
            const elite    = allBadges.filter(b => b.tier === 'elite')

            return (
              <>
                {/* Standard */}
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: '#555', marginBottom: '10px' }}>Standard</div>
                <div style={{ ...S.badgeGrid, marginBottom: '1.5rem' }}>
                  {standard.map(b => {
                    const earned = earnedBadges.find(e => e.badge_key === b.key)
                    return (
                      <div key={b.key} style={{ ...S.badgeTile, ...(earned ? S.badgeTileEarned : S.badgeTileLocked) }}>
                        <div style={S.badgeIcon}>{b.icon}</div>
                        <div style={S.badgeName}>{b.name}</div>
                        <div style={S.badgeDesc}>{b.description}</div>
                        {earned && (
                          <div style={S.badgeDate}>
                            {new Date(earned.earned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Elite */}
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: '#555', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  Elite
                  <span style={{ ...S.badgeTierLabel, ...S.badgeTierElite }}>Hard to earn</span>
                </div>
                <div style={S.badgeGrid}>
                  {elite.map(b => {
                    const earned = earnedBadges.find(e => e.badge_key === b.key)
                    return (
                      <div key={b.key} style={{ ...S.badgeTile, ...(earned ? S.badgeTileEarned : S.badgeTileLocked) }}>
                        <div style={S.badgeIcon}>{b.icon}</div>
                        <div style={S.badgeName}>{b.name}</div>
                        <div style={S.badgeDesc}>{b.description}</div>
                        {earned && (
                          <div style={S.badgeDate}>
                            {new Date(earned.earned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )
          })()}
        </>
      )}

      <div style={S.divider} />

      {/* My Races */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '32px', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff' }}>My Races</div>
        {myRaces.length > 0 && <button style={S.exportBtn} onClick={handleExport}>📅 Export .ics</button>}
      </div>

      {loadingRaces ? (
        <div style={{ color: '#555', fontSize: '13px' }}>Loading...</div>
      ) : myRaces.length === 0 ? (
        <div style={S.emptyRaces}>
          <div style={{ fontSize: '32px', marginBottom: '10px' }}>🏊</div>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '16px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff', marginBottom: '6px' }}>No races entered yet</div>
          <div style={{ fontSize: '13px', color: '#999' }}>Head to Races and hit Enter on any race to add it here.</div>
        </div>
      ) : (
        Object.values(grouped).map(group => (
          <div key={group.label}>
            <div style={S.monthLabel}>{group.label}</div>
            {group.races.map(race => {
              const d = new Date(race.race_date + 'T12:00:00')
              const daysAway = getDaysAway(race.race_date)
              return (
                <div key={race.id} style={S.raceCard}>
                  <div style={S.dateBlock}>
                    <div style={S.dateDay}>{d.getDate()}</div>
                    <div style={S.dateMonth}>{MONTHS[d.getMonth()]}</div>
                  </div>
                  <div>
                    <div style={S.raceName}>{race.name}</div>
                    <div style={S.raceLoc}>{race.location}</div>
                    <span style={{ ...S.badge, ...getBadgeStyle(race.type) }}>{race.type}</span>
                  </div>
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 600, color: daysAway.color, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {daysAway.text}
                  </div>
                </div>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
