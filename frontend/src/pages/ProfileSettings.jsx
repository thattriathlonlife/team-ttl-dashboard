import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const AVATAR_COLORS = [
  { value: '#00C4B4', label: 'Teal' },
  { value: '#FF3D8B', label: 'Pink' },
  { value: '#E8B84B', label: 'Gold' },
  { value: '#FF5A1F', label: 'Orange' },
  { value: '#a78bfa', label: 'Purple' },
  { value: '#34d399', label: 'Green' },
  { value: '#60a5fa', label: 'Blue' },
  { value: '#f472b6', label: 'Rose' },
]

const S = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '2.5rem 1.5rem' },
  backBtn: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase',
    color: '#999', background: 'none', border: 'none',
    cursor: 'pointer', padding: '0', marginBottom: '2rem',
    display: 'flex', alignItems: 'center', gap: '6px',
  },
  heading: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '32px', fontWeight: 800,
    letterSpacing: '2px', textTransform: 'uppercase',
    color: '#fff', marginBottom: '4px',
  },
  sub: { fontSize: '14px', color: '#999', marginBottom: '2.5rem' },
  divider: {
    height: '1px', background: 'rgba(255,255,255,0.06)',
    margin: '2rem 0',
  },
  sectionTitle: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase',
    color: '#999', marginBottom: '1rem',
  },
  avatarWrap: {
    display: 'flex', alignItems: 'center', gap: '1.5rem',
    marginBottom: '1.5rem',
  },
  avatarImg: {
    width: '72px', height: '72px', borderRadius: '50%',
    objectFit: 'cover', border: '2px solid rgba(255,255,255,0.1)',
  },
  avatarPlaceholder: {
    width: '72px', height: '72px', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '24px', fontWeight: 700, color: '#000',
    border: '2px solid rgba(255,255,255,0.1)',
    flexShrink: 0,
  },
  uploadBtn: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '12px', letterSpacing: '1.5px', textTransform: 'uppercase',
    padding: '8px 16px', background: 'none',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '4px', color: '#ccc', cursor: 'pointer',
    display: 'block', marginBottom: '6px',
  },
  uploadHint: { fontSize: '11px', color: '#555' },
  colorGrid: {
    display: 'flex', gap: '10px', flexWrap: 'wrap',
    marginBottom: '1.5rem',
  },
  colorSwatch: {
    width: '36px', height: '36px', borderRadius: '50%',
    cursor: 'pointer', border: '3px solid transparent',
    transition: 'border-color 0.15s, transform 0.15s',
  },
  formGroup: { marginBottom: '1.25rem' },
  label: {
    display: 'block',
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '11px', letterSpacing: '1.5px', textTransform: 'uppercase',
    color: '#999', marginBottom: '6px',
  },
  input: {
    width: '100%', background: '#1f1f1f',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '6px', color: '#fff',
    padding: '12px 14px', fontSize: '15px',
    fontFamily: 'Barlow, sans-serif', outline: 'none',
    transition: 'border-color 0.15s',
  },
  inputReadonly: {
    opacity: 0.5, cursor: 'not-allowed',
  },
  hint: { fontSize: '12px', color: '#555', marginTop: '5px' },
  saveBtn: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '15px', fontWeight: 700,
    letterSpacing: '2px', textTransform: 'uppercase',
    padding: '14px 32px', background: '#00C4B4',
    border: 'none', borderRadius: '6px',
    color: '#000', cursor: 'pointer',
    transition: 'opacity 0.15s', width: '100%',
    marginTop: '0.5rem',
  },
  success: {
    background: 'rgba(0,196,180,0.1)',
    border: '1px solid rgba(0,196,180,0.25)',
    borderRadius: '6px', padding: '12px 16px',
    color: '#00C4B4', fontSize: '14px',
    fontFamily: 'Barlow Condensed', letterSpacing: '0.5px',
    marginBottom: '1rem',
  },
  error: {
    background: 'rgba(255,61,139,0.1)',
    border: '1px solid rgba(255,61,139,0.2)',
    borderRadius: '6px', padding: '12px 16px',
    color: '#FF3D8B', fontSize: '13px',
    marginBottom: '1rem',
  },
}

export default function ProfileSettings({ session, onBack }) {
  const [profile, setProfile] = useState(null)
  const [fullName, setFullName] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [avatarColor, setAvatarColor] = useState('#00C4B4')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef()

  const userId = session.user.id
  const email = session.user.email

  useEffect(() => { loadProfile() }, [])

  async function loadProfile() {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (data) {
      setProfile(data)
      setFullName(data.full_name || '')
      setWhatsapp(data.whatsapp_number || '')
      setAvatarColor(data.avatar_color || '#00C4B4')
      setAvatarUrl(data.avatar_url || null)
    }
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be under 2MB')
      return
    }

    setUploading(true)
    setError('')

    const ext = file.name.split('.').pop()
    const path = `${userId}/avatar.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })

    if (uploadError) {
      setError('Upload failed — ' + uploadError.message)
      setUploading(false)
      return
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
    setAvatarUrl(publicUrl)
    setUploading(false)
  }

  async function handleSave() {
    if (!fullName.trim()) { setError('Name cannot be empty'); return }
    setSaving(true)
    setError('')
    setSuccess(false)

    const { error: saveError } = await supabase.from('profiles').update({
      full_name: fullName.trim(),
      whatsapp_number: whatsapp.trim() || null,
      avatar_color: avatarColor,
      avatar_url: avatarUrl,
    }).eq('id', userId)

    if (saveError) {
      setError('Save failed — ' + saveError.message)
    } else {
      await supabase.auth.updateUser({ data: { full_name: fullName.trim() } })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    }
    setSaving(false)
  }

  const initials = fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <div style={S.page}>
      <button style={S.backBtn} onClick={onBack}>← Back</button>

      <div style={S.heading}>Profile</div>
      <div style={S.sub}>Update your name, avatar and contact details.</div>

      {success && <div style={S.success}>✓ Profile saved successfully</div>}
      {error && <div style={S.error}>{error}</div>}

      {/* Avatar */}
      <div style={S.sectionTitle}>Profile Picture</div>
      <div style={S.avatarWrap}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="avatar" style={S.avatarImg} />
        ) : (
          <div style={{ ...S.avatarPlaceholder, background: avatarColor }}>
            {initials}
          </div>
        )}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarUpload}
          />
          <button style={S.uploadBtn} onClick={() => fileRef.current.click()}>
            {uploading ? 'Uploading...' : avatarUrl ? 'Change photo' : 'Upload photo'}
          </button>
          {avatarUrl && (
            <button style={{ ...S.uploadBtn, color: '#FF3D8B', borderColor: 'rgba(255,61,139,0.2)' }}
              onClick={() => setAvatarUrl(null)}>
              Remove photo
            </button>
          )}
          <div style={S.uploadHint}>JPG or PNG, max 2MB</div>
        </div>
      </div>

      <div style={S.divider} />

      {/* Avatar color */}
      <div style={S.sectionTitle}>Avatar Color</div>
      <div style={S.colorGrid}>
        {AVATAR_COLORS.map(c => (
          <div
            key={c.value}
            title={c.label}
            style={{
              ...S.colorSwatch,
              background: c.value,
              borderColor: avatarColor === c.value ? '#fff' : 'transparent',
              transform: avatarColor === c.value ? 'scale(1.15)' : 'scale(1)',
            }}
            onClick={() => setAvatarColor(c.value)}
          />
        ))}
      </div>

      <div style={S.divider} />

      {/* Name */}
      <div style={S.sectionTitle}>Personal Details</div>
      <div style={S.formGroup}>
        <label style={S.label}>Full Name</label>
        <input
          style={S.input}
          value={fullName}
          onChange={e => setFullName(e.target.value)}
          placeholder="Your full name"
        />
      </div>

      <div style={S.formGroup}>
        <label style={S.label}>Email</label>
        <input
          style={{ ...S.input, ...S.inputReadonly }}
          value={email}
          readOnly
        />
        <div style={S.hint}>Email cannot be changed here</div>
      </div>

      <div style={S.formGroup}>
        <label style={S.label}>WhatsApp Number</label>
        <input
          style={S.input}
          value={whatsapp}
          onChange={e => setWhatsapp(e.target.value)}
          placeholder="+1 555 000 0000"
        />
        <div style={S.hint}>Used for race weekend notifications when enabled</div>
      </div>

      <button style={S.saveBtn} onClick={handleSave} disabled={saving || uploading}>
        {saving ? 'Saving...' : 'Save Profile'}
      </button>
    </div>
  )
}
