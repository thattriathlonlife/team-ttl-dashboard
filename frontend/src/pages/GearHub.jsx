/**
 * GearHub.jsx
 * Replaces Discounts.jsx as the /discounts route.
 * Three tabs: Partner Deals (existing discounts logic) | Gear Guide | Garage Sale
 *
 * New tables required (see gear-hub-migration.sql):
 *   gear_categories, gear_picks, gear_pick_votes, gear_pick_reviews,
 *   garage_listings, channel_members
 * New RPC: create_dm_channel(other_athlete_id)
 *
 * Layout.jsx change: rename "Discounts" → "Gear" in nav + bottom tab label.
 * All existing Discounts.jsx queries are preserved verbatim in the
 * PartnerDeals component below.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const GOOD_FOR_TAGS = [
  'Women', 'Men', 'All / Non-binary',
  'XS / Petite', 'XL / Plus',
  'Beginners', 'Intermediate', 'Advanced',
  'Speed', 'Comfort', 'Durability', 'Budget',
  'Cold water', 'Open water', 'Pool',
  'Triathlon-specific',
]

const TAG_COLORS = {
  'Women':              { bg: 'rgba(255,61,139,0.15)',  color: '#FF3D8B' },
  'Men':                { bg: 'rgba(0,196,180,0.15)',   color: '#00C4B4' },
  'All / Non-binary':   { bg: 'rgba(139,92,246,0.15)',  color: '#a78bfa' },
  'XS / Petite':        { bg: 'rgba(255,90,31,0.15)',   color: '#FF5A1F' },
  'XL / Plus':          { bg: 'rgba(255,90,31,0.15)',   color: '#FF5A1F' },
  'Beginners':          { bg: 'rgba(34,197,94,0.15)',   color: '#4ade80' },
  'Intermediate':       { bg: 'rgba(232,184,75,0.15)',  color: '#E8B84B' },
  'Advanced':           { bg: 'rgba(239,68,68,0.15)',   color: '#f87171' },
  'Speed':              { bg: 'rgba(255,61,139,0.15)',  color: '#FF3D8B' },
  'Comfort':            { bg: 'rgba(0,196,180,0.15)',   color: '#00C4B4' },
  'Durability':         { bg: 'rgba(232,184,75,0.15)',  color: '#E8B84B' },
  'Budget':             { bg: 'rgba(34,197,94,0.15)',   color: '#4ade80' },
  'Cold water':         { bg: 'rgba(96,165,250,0.15)',  color: '#60a5fa' },
  'Open water':         { bg: 'rgba(96,165,250,0.15)',  color: '#60a5fa' },
  'Pool':               { bg: 'rgba(0,196,180,0.15)',   color: '#00C4B4' },
  'Triathlon-specific': { bg: 'rgba(255,90,31,0.15)',   color: '#FF5A1F' },
}

const CONDITION_LABELS = {
  new:       { label: 'New',       color: '#4ade80' },
  like_new:  { label: 'Like New',  color: '#00C4B4' },
  good:      { label: 'Good',      color: '#E8B84B' },
  fair:      { label: 'Fair',      color: '#FF5A1F' },
}

// ─────────────────────────────────────────────
// Shared style primitives (Discounts.jsx pattern)
// ─────────────────────────────────────────────

const S = {
  page: {
    maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem',
    fontFamily: 'Barlow, sans-serif', color: '#fff',
  },
  // Tab bar
  tabBar: {
    display: 'flex', gap: 4, marginBottom: '2rem',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    paddingBottom: 0,
  },
  tab: (active) => ({
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 13, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
    padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#00C4B4' : '#555',
    borderBottom: active ? '2px solid #00C4B4' : '2px solid transparent',
    marginBottom: -1, transition: 'color 0.15s',
  }),
  // Cards
  card: {
    background: '#161616', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10, padding: '1.25rem',
  },
  // Modal overlay + box (matches ChallengeAdminModal exactly)
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200, padding: '1rem',
  },
  modalBox: (accentColor) => ({
    background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)',
    borderTop: `3px solid ${accentColor}`,
    borderRadius: 10, padding: '2rem',
    width: '100%', maxWidth: 520,
    maxHeight: '90vh', overflowY: 'auto',
  }),
  modalTitle: (color) => ({
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 22, fontWeight: 700,
    letterSpacing: '2px', textTransform: 'uppercase', color, marginBottom: 4,
  }),
  modalSub: { fontSize: 13, color: '#555', marginBottom: '1.5rem' },
  input: {
    width: '100%', background: '#111', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6, color: '#fff', padding: '10px 12px', fontSize: 14,
    fontFamily: 'Barlow, sans-serif', outline: 'none', boxSizing: 'border-box',
  },
  label: {
    display: 'block', fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase',
    color: '#999', marginBottom: 5,
  },
  group: { marginBottom: 12 },
  btnPrimary: (color) => ({
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, fontWeight: 700,
    letterSpacing: '1.5px', textTransform: 'uppercase',
    padding: '10px 24px', background: color, border: 'none',
    borderRadius: 5, color: '#000', cursor: 'pointer',
  }),
  btnSecondary: {
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13,
    letterSpacing: '1px', textTransform: 'uppercase',
    padding: '10px 20px', background: 'none',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 5, color: '#888', cursor: 'pointer',
  },
  btnDanger: {
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12,
    letterSpacing: '1px', textTransform: 'uppercase',
    padding: '9px 16px', background: 'none',
    border: '1px solid rgba(255,61,139,0.25)',
    borderRadius: 5, color: '#FF3D8B', cursor: 'pointer',
  },
  errorBox: {
    background: 'rgba(255,61,139,0.1)', border: '1px solid rgba(255,61,139,0.2)',
    borderRadius: 6, padding: '10px 12px', color: '#FF3D8B',
    fontSize: 13, marginBottom: 12,
  },
  // Section headers
  sectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: '1.5rem',
  },
  sectionTitle: {
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 20, fontWeight: 700,
    letterSpacing: '2px', textTransform: 'uppercase', color: '#fff',
  },
  adminBtn: {
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11,
    letterSpacing: '1.5px', textTransform: 'uppercase',
    padding: '7px 14px', background: 'none',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 5, color: '#555', cursor: 'pointer',
  },
  addBtn: {
    fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11, fontWeight: 700,
    letterSpacing: '1.5px', textTransform: 'uppercase',
    padding: '6px 12px', background: 'none',
    border: '1px solid rgba(0,196,180,0.3)',
    borderRadius: 5, color: '#00C4B4', cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  tag: (tagName) => {
    const c = TAG_COLORS[tagName] || { bg: 'rgba(255,255,255,0.1)', color: '#aaa' }
    return {
      display: 'inline-block', fontSize: 11, padding: '2px 8px',
      borderRadius: 4, background: c.bg, color: c.color,
      fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px',
      marginRight: 4, marginBottom: 3, whiteSpace: 'nowrap',
    }
  },
}

// ─────────────────────────────────────────────
// Small shared components
// ─────────────────────────────────────────────

function AvatarCircle({ name, color, size = 28 }) {
  const initials = name
    ? (name.split(' ')[0]?.[0] || '') + (name.split(' ')[1]?.[0] || '')
    : '?'
  const colors = {
    'color-a': '#FF5A1F', 'color-b': '#00C4B4', 'color-c': '#FF3D8B',
    'color-d': '#E8B84B', 'color-e': '#a78bfa', 'color-f': '#60a5fa',
  }
  const bg = colors[color] || '#444'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Barlow Condensed, sans-serif', fontSize: size * 0.38,
      fontWeight: 700, color: '#fff', flexShrink: 0,
      textTransform: 'uppercase',
    }}>
      {initials.toUpperCase()}
    </div>
  )
}

function TagChip({ tag }) {
  return <span style={S.tag(tag)}>{tag}</span>
}

function ErrorMsg({ msg }) {
  if (!msg) return null
  return <div style={S.errorBox}>{msg}</div>
}

// ═══════════════════════════════════════════════
// TAB 1 — PARTNER DEALS (exact Discounts.jsx code, wrapped in a tab panel)
// ═══════════════════════════════════════════════

function CopyButton({ code }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy} style={{
      fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', fontWeight: 700,
      letterSpacing: '1px', textTransform: 'uppercase', padding: '6px 14px',
      background: copied ? 'rgba(0,196,180,0.15)' : 'rgba(255,255,255,0.06)',
      border: `1px solid ${copied ? 'rgba(0,196,180,0.4)' : 'rgba(255,255,255,0.12)'}`,
      borderRadius: '4px', color: copied ? '#00C4B4' : '#ccc', cursor: 'pointer', transition: 'all 0.15s',
    }}>
      {copied ? '✓ Copied' : code}
    </button>
  )
}

function DiscountCard({ discount, isAdmin, onEdit, onDelete }) {
  const isExpired = discount.expiry && new Date(discount.expiry) < new Date()
  const daysLeft = discount.expiry ? Math.ceil((new Date(discount.expiry) - new Date()) / 86400000) : null

  return (
    <div style={{
      background: '#161616', border: `1px solid ${isExpired ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      opacity: isExpired ? 0.5 : 1, position: 'relative',
    }}>
      {isAdmin && (
        <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '4px', zIndex: 2 }}>
          <button onClick={() => onEdit(discount)} style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#aaa', fontSize: '11px', padding: '3px 8px', cursor: 'pointer', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' }}>Edit</button>
          <button onClick={() => onDelete(discount)} style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,61,139,0.2)', borderRadius: '4px', color: '#FF3D8B', fontSize: '11px', padding: '3px 8px', cursor: 'pointer', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' }}>×</button>
        </div>
      )}

      <div style={{ padding: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {discount.logo_url ? (
          <img src={discount.logo_url} alt={discount.brand} style={{ width: '44px', height: '44px', borderRadius: '8px', objectFit: 'contain', background: '#fff', padding: '4px', flexShrink: 0 }} />
        ) : (
          <div style={{ width: '44px', height: '44px', borderRadius: '8px', background: discount.color || 'rgba(0,196,180,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '14px', fontWeight: 800, color: '#fff', flexShrink: 0 }}>
            {discount.brand.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '2px' }}>{discount.brand}</div>
          <div style={{ fontSize: '12px', color: '#999' }}>{discount.category}</div>
        </div>
        {discount.amount && (
          <div style={{ flexShrink: 0, fontFamily: 'Barlow Condensed, sans-serif', fontSize: '22px', fontWeight: 800, color: '#00C4B4' }}>{discount.amount}</div>
        )}
      </div>

      <div style={{ padding: '1rem 1.25rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '13px', color: '#bbb', lineHeight: 1.5 }}>{discount.description}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: 'auto' }}>
          {discount.code
            ? <CopyButton code={discount.code} />
            : <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', color: '#555', padding: '6px 0' }}>Code coming soon</div>
          }
          {discount.single_use && (
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', padding: '3px 8px', background: 'rgba(232,184,75,0.1)', color: '#E8B84B', border: '1px solid rgba(232,184,75,0.25)', borderRadius: '3px' }}>Single use</div>
          )}
          {discount.note === 'rolling-availability' && (
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', padding: '3px 8px', background: 'rgba(0,196,180,0.08)', color: '#00C4B4', border: '1px solid rgba(0,196,180,0.2)', borderRadius: '3px' }}>Rolling offer</div>
          )}
          {daysLeft !== null && (
            <div style={{ fontSize: '11px', color: daysLeft <= 7 ? '#FF5A1F' : '#555', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px', marginLeft: 'auto' }}>
              {isExpired ? 'Expired' : daysLeft === 0 ? 'Expires today' : `${daysLeft}d left`}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const EMPTY_DISCOUNT_FORM = { brand: '', code: '', amount: '', description: '', category: '', color: '#00C4B4', expiry: '', single_use: false, note: '', active: true, sort_order: 0 }

function DiscountModal({ discount, onSave, onClose }) {
  const [form, setForm] = useState(discount ? {
    ...discount,
    expiry: discount.expiry ? discount.expiry.slice(0, 10) : '',
    note: discount.note || '',
    code: discount.code || '',
    amount: discount.amount || '',
    color: discount.color || '#00C4B4',
    logo_url: discount.logo_url || '',
  } : { ...EMPTY_DISCOUNT_FORM, logo_url: '' })
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [error, setError] = useState('')
  const logoFileRef = useRef()
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 1 * 1024 * 1024) { setError('Logo must be under 1MB'); return }
    setUploadingLogo(true)
    const ext = file.name.split('.').pop()
    const slug = (form.brand || 'brand').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const path = `${slug}-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('logos').upload(path, file, { upsert: true })
    if (uploadError) { setError('Upload failed — ' + uploadError.message); setUploadingLogo(false); return }
    const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(path)
    set('logo_url', publicUrl)
    setUploadingLogo(false)
  }

  const inputStyle = { width: '100%', background: '#111', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff', padding: '10px 12px', fontSize: '14px', fontFamily: 'Barlow, sans-serif', outline: 'none', boxSizing: 'border-box' }
  const labelStyle = { display: 'block', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '11px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#999', marginBottom: '5px' }
  const groupStyle = { marginBottom: '12px' }

  async function save() {
    if (!form.brand.trim()) { setError('Brand name is required'); return }
    setSaving(true)
    const payload = {
      brand: form.brand.trim(),
      code: form.code.trim() || null,
      amount: form.amount.trim() || null,
      description: form.description.trim() || null,
      category: form.category.trim() || null,
      color: form.color || null,
      expiry: form.expiry || null,
      single_use: form.single_use,
      note: form.note.trim() || null,
      active: form.active,
      sort_order: parseInt(form.sort_order) || 0,
      logo_url: form.logo_url.trim() || null,
    }
    const { error: err } = discount?.id
      ? await supabase.from('discounts').update(payload).eq('id', discount.id)
      : await supabase.from('discounts').insert(payload)
    if (err) { setError(err.message); setSaving(false); return }
    onSave()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', borderTop: '3px solid #00C4B4', borderRadius: '10px', padding: '2rem', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '20px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#00C4B4', marginBottom: '1.5rem' }}>
          {discount?.id ? 'Edit Discount' : 'Add Discount'}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={groupStyle}>
            <label style={labelStyle}>Brand *</label>
            <input style={inputStyle} value={form.brand} onChange={e => set('brand', e.target.value)} placeholder="Orca" />
          </div>
          <div style={groupStyle}>
            <label style={labelStyle}>Category</label>
            <input style={inputStyle} value={form.category} onChange={e => set('category', e.target.value)} placeholder="Wetsuits & Swimwear" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={groupStyle}>
            <label style={labelStyle}>Discount Code</label>
            <input style={inputStyle} value={form.code} onChange={e => set('code', e.target.value)} placeholder="TTL20 (leave blank = coming soon)" />
          </div>
          <div style={groupStyle}>
            <label style={labelStyle}>Amount</label>
            <input style={inputStyle} value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="20% off" />
          </div>
        </div>

        <div style={groupStyle}>
          <label style={labelStyle}>Brand Logo</label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {form.logo_url && (
              <img src={form.logo_url} alt="logo" style={{ width: '44px', height: '44px', borderRadius: '6px', objectFit: 'contain', background: '#fff', padding: '4px', border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }} />
            )}
            <div style={{ flex: 1 }}>
              <input ref={logoFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
              <button onClick={() => logoFileRef.current.click()} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 14px', background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#ccc', cursor: 'pointer', display: 'block', marginBottom: '5px' }}>
                {uploadingLogo ? 'Uploading...' : form.logo_url ? 'Change Logo' : 'Upload Logo'}
              </button>
              <div style={{ fontSize: '11px', color: '#555' }}>PNG or SVG recommended, max 1MB</div>
            </div>
            {form.logo_url && (
              <button onClick={() => set('logo_url', '')} style={{ background: 'none', border: 'none', color: '#FF3D8B', fontSize: '18px', cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0 }}>×</button>
            )}
          </div>
        </div>

        <div style={groupStyle}>
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '72px' }} value={form.description} onChange={e => set('description', e.target.value)} placeholder="What does this discount cover?" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: '12px' }}>
          <div style={groupStyle}>
            <label style={labelStyle}>Expiry Date</label>
            <input style={inputStyle} type="date" value={form.expiry} onChange={e => set('expiry', e.target.value)} />
          </div>
          <div style={groupStyle}>
            <label style={labelStyle}>Brand Colour</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input style={{ ...inputStyle, flex: 1 }} value={form.color} onChange={e => set('color', e.target.value)} placeholder="#e63946" />
              <input type="color" value={form.color || '#00C4B4'} onChange={e => set('color', e.target.value)} style={{ width: '36px', height: '36px', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: 0 }} />
            </div>
          </div>
          <div style={groupStyle}>
            <label style={labelStyle}>Order</label>
            <input style={inputStyle} type="number" value={form.sort_order} onChange={e => set('sort_order', e.target.value)} min="0" />
          </div>
        </div>

        <div style={groupStyle}>
          <label style={labelStyle}>Note</label>
          <input style={inputStyle} value={form.note} onChange={e => set('note', e.target.value)} placeholder="rolling-availability (optional)" />
        </div>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: '#ccc' }}>
            <input type="checkbox" checked={form.single_use} onChange={e => set('single_use', e.target.checked)} />
            Single-use code
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: '#ccc' }}>
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
            Active
          </label>
        </div>

        {error && <div style={{ color: '#FF3D8B', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', letterSpacing: '1px', textTransform: 'uppercase', padding: '10px 20px', background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px', color: '#999', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '10px 24px', background: '#00C4B4', border: 'none', borderRadius: '5px', color: '#000', cursor: 'pointer' }}>
            {saving ? 'Saving...' : discount?.id ? 'Save Changes' : 'Add Discount'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PartnerDeals({ profile }) {
  const [discounts, setDiscounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingDiscount, setEditingDiscount] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const isAdmin = profile?.role === 'admin'

  useEffect(() => { loadDiscounts() }, [])

  async function loadDiscounts() {
    const { data } = await supabase.from('discounts').select('*').eq('active', true).order('sort_order').order('brand')
    if (data) setDiscounts(data)
    setLoading(false)
  }

  async function handleDelete(discount) {
    if (!confirm(`Remove ${discount.brand} discount?`)) return
    await supabase.from('discounts').update({ active: false }).eq('id', discount.id)
    setDiscounts(prev => prev.filter(d => d.id !== discount.id))
  }

  function handleEdit(discount) { setEditingDiscount(discount); setShowModal(true) }
  function handleAdd() { setEditingDiscount(null); setShowModal(true) }
  async function handleSave() { setShowModal(false); setLoading(true); await loadDiscounts() }

  const activeDiscounts  = discounts.filter(d => !d.expiry || new Date(d.expiry) >= new Date())
  const expiredDiscounts = discounts.filter(d => d.expiry && new Date(d.expiry) < new Date())

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'Barlow Condensed', letterSpacing: 2, color: '#999', textTransform: 'uppercase' }}>Loading...</div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '28px', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff', marginBottom: '4px' }}>Partner Deals</div>
          <div style={{ fontSize: '14px', color: '#999' }}>Exclusive member benefits from our partners. Tap a code to copy it.</div>
        </div>
        {isAdmin && (
          <button onClick={handleAdd} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '10px 20px', background: '#00C4B4', border: 'none', borderRadius: '6px', color: '#000', cursor: 'pointer', flexShrink: 0 }}>
            + Add Discount
          </button>
        )}
      </div>

      {discounts.length === 0 ? (
        <div style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '4rem 2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏷️</div>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '20px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff', marginBottom: '8px' }}>No discounts yet</div>
          <div style={{ fontSize: '14px', color: '#999' }}>{isAdmin ? 'Click "+ Add Discount" to add your first partner benefit.' : 'Partner discounts will appear here soon.'}</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px', marginBottom: expiredDiscounts.length > 0 ? '2.5rem' : 0 }}>
            {activeDiscounts.map(d => <DiscountCard key={d.id} discount={d} isAdmin={isAdmin} onEdit={handleEdit} onDelete={handleDelete} />)}
          </div>
          {expiredDiscounts.length > 0 && (
            <>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', color: '#444', marginBottom: '12px' }}>Expired</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
                {expiredDiscounts.map(d => <DiscountCard key={d.id} discount={d} isAdmin={isAdmin} onEdit={handleEdit} onDelete={handleDelete} />)}
              </div>
            </>
          )}
        </>
      )}

      {showModal && <DiscountModal discount={editingDiscount} onSave={handleSave} onClose={() => setShowModal(false)} />}
    </div>
  )
}

// ═══════════════════════════════════════════════
// TAB 2 — GEAR GUIDE
// ═══════════════════════════════════════════════

function GearGuide({ profile }) {
  const [categories, setCategories] = useState([])
  const [picks, setPicks]           = useState([])        // all picks
  const [votes, setVotes]           = useState([])        // all votes
  const [reviews, setReviews]       = useState([])        // all reviews
  const [expanded, setExpanded]     = useState({})        // categoryId → bool
  const [loading, setLoading]       = useState(true)
  const [showPickModal, setShowPickModal] = useState(false)
  const [editingPick, setEditingPick]     = useState(null)
  const [defaultCategory, setDefaultCategory] = useState(null)
  const isAdmin = profile?.role === 'admin'

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [catRes, pickRes, voteRes, reviewRes] = await Promise.all([
      supabase.from('gear_categories').select('*').order('sort_order'),
      supabase.from('gear_picks').select('*, added_by_profile:profiles!added_by(id,full_name,avatar_color)').order('created_at'),
      supabase.from('gear_pick_votes').select('*'),
      supabase.from('gear_pick_reviews').select('*, athlete:profiles!athlete_id(id,full_name,avatar_color)').order('created_at'),
    ])
    setCategories(catRes.data || [])
    setPicks(pickRes.data || [])
    setVotes(voteRes.data || [])
    setReviews(reviewRes.data || [])
    setLoading(false)
  }

  function toggleExpand(catId) {
    setExpanded(e => ({ ...e, [catId]: !e[catId] }))
  }

  // Net score for a pick
  function netScore(pickId) {
    const v = votes.filter(v => v.pick_id === pickId)
    return v.filter(v => v.direction === 'up').length - v.filter(v => v.direction === 'down').length
  }

  function myVote(pickId) {
    return votes.find(v => v.pick_id === pickId && v.athlete_id === profile?.id)?.direction || null
  }

  async function handleVote(pickId, direction) {
    if (!profile) return
    const existing = myVote(pickId)
    if (existing === direction) {
      // Toggle off — delete
      await supabase.from('gear_pick_votes').delete()
        .eq('pick_id', pickId).eq('athlete_id', profile.id)
    } else {
      // Upsert (handles switching direction too)
      await supabase.from('gear_pick_votes').upsert(
        { pick_id: pickId, athlete_id: profile.id, direction },
        { onConflict: 'pick_id,athlete_id' }
      )
    }
    // Optimistic update
    setVotes(prev => {
      const filtered = prev.filter(v => !(v.pick_id === pickId && v.athlete_id === profile.id))
      if (existing === direction) return filtered
      return [...filtered, { pick_id: pickId, athlete_id: profile.id, direction }]
    })
  }

  async function handleDeletePick(pickId) {
    if (!confirm('Delete this gear pick?')) return
    await supabase.from('gear_picks').delete().eq('id', pickId)
    setPicks(prev => prev.filter(p => p.id !== pickId))
  }

  if (loading) return <div style={{ color: '#555', padding: '3rem 0', textAlign: 'center' }}>Loading gear guide…</div>

  return (
    <div>
      <div style={S.sectionHeader}>
        <div>
          <div style={S.sectionTitle}>Community Gear Guide</div>
          <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
            Community picks for triathlon — add your own, vote on what works.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {categories.map(cat => {
          const catPicks = picks.filter(p => p.category_id === cat.id)
          const isOpen   = !!expanded[cat.id]
          return (
            <div key={cat.id} style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, overflow: 'hidden' }}>
              {/* Category row */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', cursor: 'pointer',
                  background: isOpen ? 'rgba(0,196,180,0.05)' : '#161616',
                  transition: 'background 0.15s',
                }}
                onClick={() => toggleExpand(cat.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>{cat.icon}</span>
                  <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 15, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: isOpen ? '#00C4B4' : '#ccc' }}>
                    {cat.name}
                  </span>
                  <span style={{ fontSize: 12, color: '#555', background: 'rgba(255,255,255,0.05)', padding: '1px 7px', borderRadius: 10 }}>
                    {catPicks.length}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    style={S.addBtn}
                    onClick={e => { e.stopPropagation(); setEditingPick(null); setDefaultCategory(cat.id); setShowPickModal(true) }}
                  >
                    + Add
                  </button>
                  <span style={{ color: '#555', fontSize: 12, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
                </div>
              </div>

              {/* Expanded picks table */}
              {isOpen && (
                <div style={{ overflowX: 'auto' }}>
                  {catPicks.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#555', fontSize: 14 }}>
                      No picks yet. Be the first to add one!
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                          {['Votes','Brand','Model','Type','Link','Good For','Reviews',''].map(h => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#444', fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...catPicks]
                          .sort((a, b) => netScore(b.id) - netScore(a.id))
                          .map(pick => (
                            <GearPickRow
                              key={pick.id}
                              pick={pick}
                              reviews={reviews.filter(r => r.pick_id === pick.id)}
                              netScore={netScore(pick.id)}
                              myVote={myVote(pick.id)}
                              onVote={dir => handleVote(pick.id, dir)}
                              onEdit={() => { setEditingPick(pick); setDefaultCategory(pick.category_id); setShowPickModal(true) }}
                              onDelete={() => handleDeletePick(pick.id)}
                              onReviewAdded={loadAll}
                              onReviewDeleted={loadAll}
                              profile={profile}
                              isAdmin={isAdmin}
                            />
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showPickModal && (
        <GearPickModal
          pick={editingPick}
          categories={categories}
          defaultCategoryId={defaultCategory}
          profile={profile}
          onSave={() => { setShowPickModal(false); loadAll() }}
          onClose={() => setShowPickModal(false)}
        />
      )}
    </div>
  )
}

function GearPickRow({ pick, reviews, netScore, myVote, onVote, onEdit, onDelete, onReviewAdded, onReviewDeleted, profile, isAdmin }) {
  const [showAllReviews, setShowAllReviews] = useState(false)
  const [showAddReview, setShowAddReview]   = useState(false)
  const [reviewText, setReviewText]         = useState('')
  const [savingReview, setSavingReview]     = useState(false)
  const canEdit = isAdmin || pick.added_by === profile?.id

  async function submitReview() {
    if (!reviewText.trim()) return
    setSavingReview(true)
    await supabase.from('gear_pick_reviews').insert({
      pick_id: pick.id, athlete_id: profile.id, body: reviewText.trim()
    })
    setReviewText(''); setShowAddReview(false); setSavingReview(false)
    onReviewAdded()
  }

  async function deleteReview(reviewId) {
    if (!confirm('Delete this review?')) return
    await supabase.from('gear_pick_reviews').delete().eq('id', reviewId)
    onReviewDeleted()
  }

  const visibleReviews = showAllReviews ? reviews : reviews.slice(0, 1)

  return (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'top' }}>
      {/* Votes */}
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 44 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => onVote('up')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: myVote === 'up' ? 1 : 0.3, padding: 2 }}
              title="Upvote"
            >🔥</button>
            <button
              onClick={() => onVote('down')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: myVote === 'down' ? 1 : 0.3, padding: 2 }}
              title="Downvote"
            >👎</button>
          </div>
          <span style={{
            fontSize: 11, fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700,
            color: netScore > 0 ? '#00C4B4' : netScore < 0 ? '#FF3D8B' : '#555',
            background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '1px 6px',
            minWidth: 24, textAlign: 'center',
          }}>
            {netScore > 0 ? `+${netScore}` : netScore}
          </span>
        </div>
      </td>

      {/* Brand */}
      <td style={{ padding: '10px 12px', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap' }}>{pick.brand}</td>

      {/* Model */}
      <td style={{ padding: '10px 12px', color: '#ccc', whiteSpace: 'nowrap' }}>{pick.model}</td>

      {/* Type */}
      <td style={{ padding: '10px 12px', color: '#888', whiteSpace: 'nowrap', fontSize: 12 }}>{pick.type}</td>

      {/* Link */}
      <td style={{ padding: '10px 12px' }}>
        {pick.link
          ? <a href={pick.link} target="_blank" rel="noopener noreferrer" style={{ color: '#00C4B4', fontSize: 16, textDecoration: 'none' }} title="Product link">↗</a>
          : <span style={{ color: '#333' }}>–</span>
        }
      </td>

      {/* Good For */}
      <td style={{ padding: '10px 12px', minWidth: 120, maxWidth: 200 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {(pick.good_for || []).map(tag => <TagChip key={tag} tag={tag} />)}
        </div>
      </td>

      {/* Reviews */}
      <td style={{ padding: '10px 12px', minWidth: 220, maxWidth: 340 }}>
        {reviews.length === 0 && !showAddReview && (
          <span style={{ color: '#444', fontSize: 12 }}>No reviews yet</span>
        )}

        {visibleReviews.map((r, i) => (
          <div key={r.id} style={{ marginBottom: reviews.length > 1 || showAddReview ? 8 : 0 }}>
            <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>
              {r.body.length > 120 && !showAllReviews
                ? <>{r.body.slice(0, 120)}… <button onClick={() => setShowAllReviews(true)} style={{ background: 'none', border: 'none', color: '#00C4B4', cursor: 'pointer', fontSize: 12, padding: 0 }}>more ▼</button></>
                : r.body
              }
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <span style={{ fontSize: 12, color: '#555', fontStyle: 'italic' }}>— {r.athlete?.full_name || 'Athlete'}</span>
              {(isAdmin || r.athlete_id === profile?.id) && (
                <button onClick={() => deleteReview(r.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 11, padding: 0 }} title="Delete review">🗑</button>
              )}
            </div>
          </div>
        ))}

        {reviews.length > 1 && !showAllReviews && (
          <button onClick={() => setShowAllReviews(true)} style={{ background: 'none', border: 'none', color: '#00C4B4', cursor: 'pointer', fontSize: 12, padding: '2px 0', display: 'block', marginBottom: 4 }}>
            +{reviews.length - 1} more ▼
          </button>
        )}
        {showAllReviews && reviews.length > 1 && (
          <button onClick={() => setShowAllReviews(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12, padding: '2px 0', display: 'block', marginBottom: 4 }}>
            Show less ▲
          </button>
        )}

        {showAddReview ? (
          <div style={{ marginTop: 6 }}>
            <textarea
              autoFocus
              value={reviewText}
              onChange={e => setReviewText(e.target.value)}
              placeholder="Share your experience…"
              rows={3}
              style={{ ...S.input, resize: 'vertical', fontSize: 13 }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button style={S.btnPrimary('#00C4B4')} onClick={submitReview} disabled={savingReview}>
                {savingReview ? 'Saving…' : 'Post'}
              </button>
              <button style={S.btnSecondary} onClick={() => { setShowAddReview(false); setReviewText('') }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddReview(true)}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12, padding: '4px 0', display: 'block', marginTop: reviews.length > 0 ? 4 : 0 }}
          >
            + add review
          </button>
        )}
      </td>

      {/* Edit/delete (submitter or admin) */}
      <td style={{ padding: '10px 8px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
        {canEdit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button onClick={onEdit} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: '#666', cursor: 'pointer', fontSize: 11, padding: '3px 8px', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' }}>
              edit
            </button>
            {isAdmin && (
              <button onClick={onDelete} style={{ background: 'none', border: '1px solid rgba(255,61,139,0.2)', borderRadius: 4, color: '#FF3D8B', cursor: 'pointer', fontSize: 11, padding: '3px 8px', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' }}>
                delete
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

function GearPickModal({ pick, categories, defaultCategoryId, profile, onSave, onClose }) {
  const empty = { brand: '', model: '', type: '', category_id: defaultCategoryId || categories[0]?.id || '', link: '', good_for: [], notes: '' }
  const [form, setForm]   = useState(pick ? { ...pick, good_for: pick.good_for || [] } : empty)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function toggleTag(tag) {
    setForm(f => ({
      ...f,
      good_for: f.good_for.includes(tag)
        ? f.good_for.filter(t => t !== tag)
        : [...f.good_for, tag]
    }))
  }

  async function handleSave() {
    if (!form.brand.trim()) return setError('Brand is required.')
    if (!form.model.trim()) return setError('Model is required.')
    if (!form.type.trim())  return setError('Type is required.')
    if (!form.category_id)  return setError('Category is required.')
    setError(''); setSaving(true)

    const payload = {
      brand: form.brand.trim(), model: form.model.trim(),
      type: form.type.trim(), category_id: form.category_id,
      link: form.link.trim() || null, good_for: form.good_for,
      notes: form.notes.trim() || null,
    }

    let err
    if (pick) {
      ;({ error: err } = await supabase.from('gear_picks').update(payload).eq('id', pick.id))
    } else {
      ;({ error: err } = await supabase.from('gear_picks').insert({ ...payload, added_by: profile.id }))
    }
    setSaving(false)
    if (err) return setError(err.message)
    onSave()
  }

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modalBox('#E8B84B')}>
        <div style={S.modalTitle('#E8B84B')}>{pick ? 'Edit Pick' : 'Add a Pick'}</div>
        <div style={S.modalSub}>Share a piece of gear you'd recommend to the team.</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={S.label}>Brand</label>
            <input style={S.input} placeholder="e.g. Orca" value={form.brand} onChange={e => set('brand', e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Model</label>
            <input style={S.input} placeholder="e.g. Athlex Float V2" value={form.model} onChange={e => set('model', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={S.label}>Type</label>
            <input style={S.input} placeholder="e.g. Wetsuit" value={form.type} onChange={e => set('type', e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Category</label>
            <select style={{ ...S.input, cursor: 'pointer' }} value={form.category_id} onChange={e => set('category_id', e.target.value)}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
        </div>

        <div style={S.group}>
          <label style={S.label}>Product link (optional)</label>
          <input style={S.input} placeholder="https://…" value={form.link} onChange={e => set('link', e.target.value)} />
        </div>

        <div style={S.group}>
          <label style={S.label}>Good for</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {GOOD_FOR_TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                style={{
                  ...S.tag(tag),
                  cursor: 'pointer', border: 'none',
                  opacity: form.good_for.includes(tag) ? 1 : 0.35,
                  transform: form.good_for.includes(tag) ? 'scale(1.05)' : 'scale(1)',
                  transition: 'opacity 0.1s, transform 0.1s',
                  outline: form.good_for.includes(tag) ? `1px solid ${TAG_COLORS[tag]?.color || '#aaa'}` : 'none',
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div style={S.group}>
          <label style={S.label}>Notes (optional)</label>
          <textarea
            style={{ ...S.input, resize: 'vertical' }}
            rows={2}
            placeholder="Any tips or context…"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
          />
        </div>

        <ErrorMsg msg={error} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1.5rem' }}>
          <button style={S.btnSecondary} onClick={onClose}>Cancel</button>
          <button style={S.btnPrimary('#E8B84B')} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : pick ? 'Save changes' : 'Add pick'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// TAB 3 — GARAGE SALE
// ═══════════════════════════════════════════════

function GarageSale({ profile }) {
  const [listings, setListings]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('available')  // available | all
  const [catFilter, setCatFilter]   = useState('all')
  const [showModal, setShowModal]   = useState(false)
  const [editingListing, setEditingListing] = useState(null)
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'

  useEffect(() => { loadListings() }, [])

  async function loadListings() {
    setLoading(true)
    const { data } = await supabase
      .from('garage_listings')
      .select('*, seller:profiles!seller_id(id,full_name,avatar_color,whatsapp_number)')
      .order('created_at', { ascending: false })
    setListings(data || [])
    setLoading(false)
  }

  async function handleMessageSeller(sellerId) {
    if (!profile) return
    // create_dm_channel returns existing or new channel id
    const { data, error } = await supabase.rpc('create_dm_channel', { other_athlete_id: sellerId })
    if (error) { console.error(error); return }
    // Navigate to messages tab with the DM channel pre-selected
    navigate(`/messages?dm=${data}`)
  }

  async function handleMarkStatus(listing, status) {
    await supabase.from('garage_listings').update({ status }).eq('id', listing.id)
    loadListings()
  }

  async function handleDelete(listingId) {
    if (!confirm('Delete this listing?')) return
    await supabase.from('garage_listings').delete().eq('id', listingId)
    loadListings()
  }

  const filtered = listings
    .filter(l => filter === 'all' || l.status === 'available')
    .filter(l => catFilter === 'all' || l.category === catFilter)

  if (loading) return <div style={{ color: '#555', padding: '3rem 0', textAlign: 'center' }}>Loading listings…</div>

  return (
    <div>
      <div style={S.sectionHeader}>
        <div>
          <div style={S.sectionTitle}>TTL Garage Sale</div>
          <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
            Buy, sell, and trade gear within the team.
          </div>
        </div>
        <button style={S.addBtn} onClick={() => { setEditingListing(null); setShowModal(true) }}>
          + Post listing
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {['available','all'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12, letterSpacing: '1px', textTransform: 'uppercase',
            padding: '6px 14px', borderRadius: 5, cursor: 'pointer', background: 'none',
            border: `1px solid ${filter === f ? 'rgba(0,196,180,0.4)' : 'rgba(255,255,255,0.1)'}`,
            color: filter === f ? '#00C4B4' : '#555',
          }}>
            {f === 'available' ? 'Available' : 'All listings'}
          </button>
        ))}
        <div style={{ width: 1, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />
        {['all','swim','bike','run','other'].map(c => (
          <button key={c} onClick={() => setCatFilter(c)} style={{
            fontFamily: 'Barlow Condensed, sans-serif', fontSize: 12, letterSpacing: '1px', textTransform: 'uppercase',
            padding: '6px 14px', borderRadius: 5, cursor: 'pointer', background: 'none',
            border: `1px solid ${catFilter === c ? 'rgba(255,90,31,0.4)' : 'rgba(255,255,255,0.1)'}`,
            color: catFilter === c ? '#FF5A1F' : '#555',
          }}>
            {c === 'all' ? 'All categories' : c}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', color: '#555', padding: '3rem 0' }}>
          {filter === 'available' ? 'No listings available right now.' : 'No listings yet.'}<br />
          <button style={{ ...S.addBtn, marginTop: 12 }} onClick={() => { setEditingListing(null); setShowModal(true) }}>
            Post the first one
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
        {filtered.map(listing => (
          <GarageListingCard
            key={listing.id}
            listing={listing}
            profile={profile}
            isAdmin={isAdmin}
            onMessageSeller={() => handleMessageSeller(listing.seller_id)}
            onMarkStatus={status => handleMarkStatus(listing, status)}
            onEdit={() => { setEditingListing(listing); setShowModal(true) }}
            onDelete={() => handleDelete(listing.id)}
          />
        ))}
      </div>

      {showModal && (
        <GarageListingModal
          listing={editingListing}
          profile={profile}
          onSave={() => { setShowModal(false); loadListings() }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}

function GarageListingCard({ listing: l, profile, isAdmin, onMessageSeller, onMarkStatus, onEdit, onDelete }) {
  const isMine  = l.seller_id === profile?.id
  const canEdit = isMine || isAdmin
  const isSold  = l.status !== 'available'
  const cond    = CONDITION_LABELS[l.condition] || { label: l.condition, color: '#888' }

  return (
    <div style={{ ...S.card, opacity: isSold ? 0.55 : 1, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
      {/* Status badge */}
      {isSold && (
        <div style={{
          position: 'absolute', top: 10, right: 10, fontFamily: 'Barlow Condensed, sans-serif',
          fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
          padding: '3px 10px', borderRadius: 4,
          background: l.status === 'sold' ? 'rgba(255,61,139,0.2)' : 'rgba(232,184,75,0.2)',
          color: l.status === 'sold' ? '#FF3D8B' : '#E8B84B',
        }}>
          {l.status === 'sold' ? 'Sold' : 'Traded'}
        </div>
      )}

      {/* Image */}
      {l.image_url && (
        <div style={{ height: 160, borderRadius: 6, overflow: 'hidden', background: '#111' }}>
          <img src={l.image_url} alt={l.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

      {/* Title + price */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 15, color: '#fff', marginBottom: 4 }}>{l.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'Barlow Condensed, sans-serif', color: '#00C4B4' }}>
            {l.is_trade ? 'Trade / Free' : l.price != null ? `$${l.price}` : 'Free'}
          </span>
          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: cond.color, fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px' }}>
            {cond.label}
          </span>
          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#666', fontFamily: 'Barlow Condensed, sans-serif', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {l.category}
          </span>
        </div>
      </div>

      {/* Description */}
      {l.description && (
        <div style={{ fontSize: 13, color: '#888', lineHeight: 1.5 }}>{l.description}</div>
      )}

      {/* Seller */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <AvatarCircle name={l.seller?.full_name} color={l.seller?.avatar_color} size={24} />
        <span style={{ fontSize: 13, color: '#888' }}>{l.seller?.full_name}</span>
        <span style={{ fontSize: 12, color: '#444', marginLeft: 'auto' }}>
          {new Date(l.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!isMine && !isSold && (
          <button style={{ ...S.btnPrimary('#00C4B4'), flex: 1, fontSize: 12, padding: '8px 12px' }} onClick={onMessageSeller}>
            Message seller
          </button>
        )}
        {isMine && !isSold && (
          <>
            <button style={{ ...S.btnSecondary, fontSize: 11, padding: '6px 10px' }} onClick={() => onMarkStatus('sold')}>Mark sold</button>
            <button style={{ ...S.btnSecondary, fontSize: 11, padding: '6px 10px' }} onClick={() => onMarkStatus('traded')}>Mark traded</button>
          </>
        )}
        {canEdit && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            <button onClick={onEdit} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: '#555', cursor: 'pointer', fontSize: 11, padding: '4px 8px' }}>✎</button>
            <button onClick={onDelete} style={{ background: 'none', border: '1px solid rgba(255,61,139,0.2)', borderRadius: 4, color: '#FF3D8B', cursor: 'pointer', fontSize: 11, padding: '4px 8px' }}>✕</button>
          </div>
        )}
      </div>
    </div>
  )
}

function GarageListingModal({ listing, profile, onSave, onClose }) {
  const empty = { title: '', description: '', price: '', is_trade: false, condition: 'good', category: 'bike', image_url: '' }
  const [form, setForm]         = useState(listing ? { ...listing, price: listing.price ?? '' } : empty)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(listing?.image_url || null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const fileRef = useRef()
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function handleImageChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setError('Image must be under 5MB.'); return }
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    setError('')
  }

  async function handleSave() {
    if (!form.title.trim()) return setError('Title is required.')
    if (!form.condition)    return setError('Condition is required.')
    setError(''); setSaving(true)

    let image_url = form.image_url || null

    // Upload new image if selected
    if (imageFile) {
      const ext  = imageFile.name.split('.').pop()
      const path = `${profile.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('garage-images')
        .upload(path, imageFile, { upsert: true })
      if (upErr) { setSaving(false); return setError('Image upload failed: ' + upErr.message) }
      const { data: urlData } = supabase.storage.from('garage-images').getPublicUrl(path)
      image_url = urlData.publicUrl
    }

    const payload = {
      title:       form.title.trim(),
      description: form.description.trim() || null,
      price:       form.is_trade ? null : (form.price !== '' ? Number(form.price) : null),
      is_trade:    form.is_trade,
      condition:   form.condition,
      category:    form.category,
      image_url,
    }

    let err
    if (listing) {
      ;({ error: err } = await supabase.from('garage_listings').update(payload).eq('id', listing.id))
    } else {
      ;({ error: err } = await supabase.from('garage_listings').insert({ ...payload, seller_id: profile.id, status: 'available' }))
    }
    setSaving(false)
    if (err) return setError(err.message)
    onSave()
  }

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modalBox('#FF5A1F')}>
        <div style={S.modalTitle('#FF5A1F')}>{listing ? 'Edit Listing' : 'Post a Listing'}</div>
        <div style={S.modalSub}>Sell or trade gear with your teammates.</div>

        {/* Image upload */}
        <div style={S.group}>
          <label style={S.label}>Photo (optional)</label>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: `1px dashed ${imagePreview ? 'rgba(0,196,180,0.4)' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 8, cursor: 'pointer', overflow: 'hidden',
              height: imagePreview ? 160 : 80,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#111', transition: 'border-color 0.15s',
            }}
          >
            {imagePreview
              ? <img src={imagePreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ color: '#555', fontSize: 13 }}>Click to upload (max 5MB)</span>
            }
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
        </div>

        <div style={S.group}>
          <label style={S.label}>Title</label>
          <input style={S.input} placeholder="e.g. Garmin 945 — like new" value={form.title} onChange={e => set('title', e.target.value)} />
        </div>

        <div style={S.group}>
          <label style={S.label}>Description (optional)</label>
          <textarea style={{ ...S.input, resize: 'vertical' }} rows={3} placeholder="Size, usage, reason for selling…" value={form.description} onChange={e => set('description', e.target.value)} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={S.label}>Condition</label>
            <select style={{ ...S.input, cursor: 'pointer' }} value={form.condition} onChange={e => set('condition', e.target.value)}>
              <option value="new">New</option>
              <option value="like_new">Like New</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Category</label>
            <select style={{ ...S.input, cursor: 'pointer' }} value={form.category} onChange={e => set('category', e.target.value)}>
              <option value="swim">Swim</option>
              <option value="bike">Bike</option>
              <option value="run">Run</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={S.label}>Price ($)</label>
            <input
              style={{ ...S.input, opacity: form.is_trade ? 0.4 : 1 }}
              type="number" min="0" placeholder="0 = free"
              value={form.price} disabled={form.is_trade}
              onChange={e => set('price', e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
            <input type="checkbox" id="isTrade" checked={form.is_trade} onChange={e => set('is_trade', e.target.checked)} style={{ accentColor: '#FF5A1F' }} />
            <label htmlFor="isTrade" style={{ ...S.label, marginBottom: 0, cursor: 'pointer' }}>Trade / Free</label>
          </div>
        </div>

        <ErrorMsg msg={error} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1.5rem' }}>
          <button style={S.btnSecondary} onClick={onClose}>Cancel</button>
          <button style={S.btnPrimary('#FF5A1F')} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : listing ? 'Save changes' : 'Post listing'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// ROOT — GearHub page
// ═══════════════════════════════════════════════

const TABS = [
  { id: 'deals',  label: 'Partner Deals' },
  { id: 'guide',  label: 'Gear Guide'    },
  { id: 'garage', label: 'Garage Sale'   },
]

export default function GearHub() {
  const [tab, setTab]       = useState('deals')
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      setProfile(data)
    })
  }, [])

  return (
    <div style={S.page}>
      {/* Tab bar */}
      <div style={S.tabBar}>
        {TABS.map(t => (
          <button key={t.id} style={S.tab(tab === t.id)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {tab === 'deals'  && <PartnerDeals profile={profile} />}
      {tab === 'guide'  && <GearGuide   profile={profile} />}
      {tab === 'garage' && <GarageSale  profile={profile} />}
    </div>
  )
}
