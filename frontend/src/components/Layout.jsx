import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import MiniPlayer from './MiniPlayer'

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
  </svg>
)
const BellIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>
  </svg>
)
const iconBtnStyle = { background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', padding: '6px', display: 'flex', position: 'relative' }
const badgeStyle = { position: 'absolute', top: '1px', right: '0px', background: 'var(--accent)', color: '#fff', fontSize: '9px', fontWeight: 700, borderRadius: '8px', padding: '1px 4px', minWidth: '14px', textAlign: 'center', fontFamily: 'Barlow Condensed, sans-serif' }

// Icons as simple SVG components
// The home page is the Feed (renamed by Zack, 2026-10-31) — a stacked
// river glyph replaces the house.
const HomeIcon = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round">
    <path d="M4 6h16"/>
    <path d="M4 12h10"/>
    <path d="M4 18h13"/>
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>
  </svg>
)
const RaceIcon = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5}>
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v5l3 3"/>
  </svg>
)
const MessageIcon = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5}>
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
  </svg>
)
const TeamIcon = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87"/>
    <path d="M16 3.13a4 4 0 010 7.75"/>
  </svg>
)
const ProfileIcon = ({ active, avatarUrl, color, initials }) => {
  if (avatarUrl) return <img src={avatarUrl} alt="profile" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', border: active ? '2px solid var(--brand)' : '1.5px solid rgba(255,255,255,0.2)' }} />
  return (
    <div style={{ width: 24, height: 24, borderRadius: '50%', background: active ? 'var(--brand)' : (color || '#444'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#000', border: active ? '2px solid var(--brand)' : 'none', fontFamily: 'Barlow Condensed, sans-serif' }}>
      {initials}
    </div>
  )
}

// 4-tab model (ACCESS-AND-UI-SPEC; Watch tab retired 2026-10-31 — the
// Home feed + its filters cover discovery, and /content survives as the
// archive page one tap deep). Profile is not a tab — behind the avatar.
const TABS = [
  { path: '/', label: 'Feed' },
  { path: '/races', label: 'Races' },
  { path: '/messages', label: 'Chat' },
  { path: '/team', label: 'Team' },
]

const DESKTOP_NAV = [
  { path: '/', label: 'Feed' },
  { path: '/races', label: 'Races' },
  { path: '/messages', label: 'Chat' },
  { path: '/team', label: 'Team' },
]

export default function Layout({ children, session, profile, onNavigateProfile, unreadCount = 0 }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [desktopDropdown, setDesktopDropdown] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])

  const email = session?.user?.email || ''
  const initials = (profile?.full_name || email).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const avatarColor = profile?.avatar_color || 'var(--brand)'
  const avatarUrl = profile?.avatar_url || null

  const signOut = async () => { await supabase.auth.signOut() }

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* Top stripe */}
        <div style={{ height: '3px', background: 'linear-gradient(90deg, var(--brand), var(--accent), var(--highlight), var(--accent))', flexShrink: 0 }} />

        {/* Slim top bar — wordmark + avatar. Profile is not a tab in the
            5-tab model; it lives behind the avatar. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#161616', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <button onClick={() => navigate('/')} aria-label="That Triathlon Life — home" style={{ display: 'flex', alignItems: 'center', gap: '9px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <img src="/icons/icon-192.png" alt="" style={{ width: '30px', height: '30px', borderRadius: '8px' }} />
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
              <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12.5px', fontWeight: 800, letterSpacing: '2.2px', color: '#fff' }}>THAT TRIATHLON</span>
              <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12.5px', fontWeight: 800, letterSpacing: '2.2px', color: 'var(--brand)' }}>LIFE</span>
            </span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button onClick={() => navigate('/search')} aria-label="Search" style={iconBtnStyle}>
              <SearchIcon />
            </button>
            <button onClick={() => navigate('/messages')} aria-label="Notifications" style={iconBtnStyle}>
              <BellIcon />
              {unreadCount > 0 && <span style={badgeStyle}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>
            <button onClick={onNavigateProfile} aria-label="Profile" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0 2px 4px', display: 'flex' }}>
              <ProfileIcon active={location.pathname === '/profile'} avatarUrl={avatarUrl} color={avatarColor} initials={initials} />
            </button>
          </div>
        </div>

        {/* Page content */}
        <main style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {children}
        </main>

        {/* Global mini-player — playback follows you (DESIGN-SPEC §4) */}
        <MiniPlayer />

        {/* Floating pill nav (DESIGN-SPEC §4) */}
        <div style={{ flexShrink: 0, zIndex: 100, padding: '2px 12px calc(10px + env(safe-area-inset-bottom))' }}>
        <nav style={{
          display: 'flex', background: 'rgba(22,22,22,0.94)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '999px',
          boxShadow: '0 14px 34px rgba(0,0,0,0.55)',
          padding: '6px',
        }}>
          {TABS.map(tab => {
            const active = location.pathname === tab.path
            const isMessages = tab.path === '/messages'
            return (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  padding: '7px 2px 6px',
                  background: active ? 'rgba(var(--brand-rgb),0.16)' : 'none',
                  border: 'none', borderRadius: '999px',
                  color: active ? 'var(--brand)' : '#666',
                  cursor: 'pointer', position: 'relative',
                  transition: 'all 0.15s',
                }}
              >
                {tab.path === '/' && <HomeIcon active={active} />}
                {tab.path === '/races' && <RaceIcon active={active} />}
                {tab.path === '/messages' && <MessageIcon active={active} />}
                {tab.path === '/team' && <TeamIcon active={active} />}
                <span style={{ fontSize: '10px', marginTop: '3px', letterSpacing: '0.5px', fontFamily: 'Barlow Condensed, sans-serif', textTransform: 'uppercase', fontWeight: active ? 700 : 400 }}>
                  {tab.label}
                </span>
                {isMessages && unreadCount > 0 && (
                  <div style={{ position: 'absolute', top: '6px', left: '50%', marginLeft: '6px', background: 'var(--accent)', color: '#fff', fontSize: '9px', fontWeight: 700, borderRadius: '8px', padding: '1px 4px', minWidth: '14px', textAlign: 'center', fontFamily: 'Barlow Condensed, sans-serif' }}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </div>
                )}
              </button>
            )
          })}
        </nav>
        </div>
      </div>
    )
  }

  // Desktop — keep top nav
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <div style={{ height: '3px', background: 'linear-gradient(90deg, var(--brand), var(--accent), var(--highlight), var(--accent))' }} />
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.5rem', height: '56px', background: '#161616', borderBottom: '1px solid rgba(255,255,255,0.08)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          <button style={{ display: 'flex', alignItems: 'center', gap: '10px', marginRight: '20px', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }} onClick={() => navigate('/')} aria-label="That Triathlon Life — home">
            <img src="/icons/icon-192.png" alt="" style={{ width: '34px', height: '34px', borderRadius: '9px' }} />
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
              <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '14px', fontWeight: 800, letterSpacing: '2.4px', color: '#fff' }}>THAT TRIATHLON</span>
              <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '14px', fontWeight: 800, letterSpacing: '2.4px', color: 'var(--brand)' }}>LIFE</span>
            </span>
          </button>
          {DESKTOP_NAV.map(link => (
            <button key={link.path}
              style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '13px', letterSpacing: '2px', textTransform: 'uppercase', padding: '0 12px', height: '56px', display: 'flex', alignItems: 'center', color: location.pathname === link.path ? '#fff' : '#888', cursor: 'pointer', background: 'none', border: 'none', borderBottom: location.pathname === link.path ? '2px solid var(--brand)' : '2px solid transparent', transition: 'all 0.15s', position: 'relative', flexShrink: 0 }}
              onClick={() => navigate(link.path)}
            >
              {link.label}
              {link.path === '/messages' && unreadCount > 0 && (
                <span style={{ position: 'absolute', top: '10px', right: '4px', background: 'var(--accent)', color: '#fff', fontSize: '10px', fontWeight: 700, borderRadius: '8px', padding: '1px 5px', fontFamily: 'Barlow Condensed, sans-serif' }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button onClick={() => navigate('/search')} aria-label="Search" style={iconBtnStyle}>
            <SearchIcon />
          </button>
          <button onClick={() => navigate('/messages')} aria-label="Notifications" style={iconBtnStyle}>
            <BellIcon />
            {unreadCount > 0 && <span style={badgeStyle}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
          {/* Avatar dropdown */}
          <div style={{ position: 'relative' }}>
            <div onClick={() => setDesktopDropdown(p => !p)} style={{ cursor: 'pointer' }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="avatar" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                : <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, fontWeight: 700, color: '#000' }}>{initials}</div>
              }
            </div>
            {desktopDropdown && (
              <div style={{ position: 'absolute', top: '42px', right: 0, background: '#1f1f1f', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '6px', minWidth: '180px', zIndex: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
                <div style={{ padding: '8px 12px 6px', fontSize: '11px', color: '#555', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'Barlow, sans-serif' }}>{email}</div>
                <button style={{ padding: '8px 12px', borderRadius: '4px', fontSize: '13px', color: '#ccc', cursor: 'pointer', fontFamily: 'Barlow, sans-serif', background: 'none', border: 'none', width: '100%', textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#2a2a2a'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  onClick={() => { setDesktopDropdown(false); onNavigateProfile() }}>Profile Settings</button>
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
                <button style={{ padding: '8px 12px', borderRadius: '4px', fontSize: '13px', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'Barlow, sans-serif', background: 'none', border: 'none', width: '100%', textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#2a2a2a'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  onClick={signOut}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </nav>
      <main style={{ flex: 1 }} onClick={() => desktopDropdown && setDesktopDropdown(false)}>{children}</main>
      <MiniPlayer floating />
    </div>
  )
}
