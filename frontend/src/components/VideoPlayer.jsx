import { useEffect } from 'react'

// In-app YouTube player (Zack, 2026-11-01): videos used to kick members
// out to YouTube in a new tab; now they play inline in a sheet via
// YouTube's official embed (youtube-nocookie), which still counts the
// view on TTL's channel. "Watch on YouTube" stays for anyone who wants
// the app switch. Podcasts remain the mini-player's job — this is only
// for video.
export default function VideoPlayer({ video, onClose }) {
  useEffect(() => {
    if (!video) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [video, onClose])

  if (!video) return null
  const embedUrl = `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1`

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '18px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: '860px' }}
      >
        <div style={{
          position: 'relative', width: '100%', paddingTop: '56.25%',
          borderRadius: '14px', overflow: 'hidden', background: '#000',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        }}>
          <iframe
            src={embedUrl}
            title={video.title || 'YouTube video'}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
          <button
            onClick={onClose}
            aria-label="Close player"
            style={{
              position: 'absolute', top: '10px', right: '10px', zIndex: 2,
              width: '34px', height: '34px', borderRadius: '50%',
              background: 'rgba(10,10,10,0.75)', border: '1px solid rgba(255,255,255,0.25)',
              color: '#fff', fontSize: '15px', cursor: 'pointer', lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', marginTop: '12px' }}>
          <div style={{ fontFamily: 'Barlow, sans-serif', fontSize: '15px', fontWeight: 600, color: '#fff', lineHeight: 1.35 }}>
            {video.title}
          </div>
          {video.link && (
            <a
              href={video.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12px', fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--brand)', textDecoration: 'none', whiteSpace: 'nowrap', paddingTop: '2px' }}
            >
              Watch on YouTube ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
