import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'

// In-app article reader (Zack, 2026-11-01): stories are read INSIDE the
// app, never by booting the user to the TTL website. The feeds API
// supplies the full article HTML from the blog's own Atom feed; this
// component sanitizes it (scripts/iframes/forms removed, in-article
// links neutralized so a tap mid-article can't exit either) and renders
// it in the app's own type and theme.

const ARTICLE_CSS = `
.ttl-article { font-size: 16.5px; line-height: 1.68; color: #e9e9e9; }
.ttl-article p { margin: 0 0 1.05em; }
.ttl-article h1, .ttl-article h2, .ttl-article h3, .ttl-article h4 {
  font-family: 'Barlow Condensed', sans-serif; text-transform: uppercase;
  letter-spacing: 0.02em; line-height: 1.15; margin: 1.3em 0 0.5em; color: #fff;
}
.ttl-article h2 { font-size: 24px; } .ttl-article h3 { font-size: 20px; }
.ttl-article img { max-width: 100%; height: auto; border-radius: 12px; display: block; margin: 1.1em auto; }
.ttl-article a { color: var(--brand); text-decoration: none; pointer-events: none; }
.ttl-article ul, .ttl-article ol { margin: 0 0 1.05em; padding-left: 1.3em; }
.ttl-article li { margin-bottom: 0.4em; }
.ttl-article blockquote { margin: 1.1em 0; padding: 0.2em 0 0.2em 1em; border-left: 3px solid var(--brand); color: #cfcfcf; font-style: italic; }
.ttl-article strong { color: #fff; }
`

function sanitize(html) {
  if (!html) return ''
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('script, iframe, form, object, embed, link, meta, style, noscript').forEach(el => el.remove())
    doc.querySelectorAll('*').forEach(el => {
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase()
        if (n.startsWith('on') || n === 'style') el.removeAttribute(attr.name)
        if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
      }
      if (el.tagName === 'A') el.removeAttribute('href')
      if (el.tagName === 'IMG') { el.setAttribute('loading', 'lazy'); el.removeAttribute('srcset') }
    })
    return doc.body.innerHTML
  } catch {
    return ''
  }
}

export default function StoryReader({ story, onClose }) {
  // The reader renders through a portal to <body>: inside the app's
  // scrolling <main> its fixed overlay was trapped under the app chrome
  // and its own header (with the close button) never reached the screen
  // (Zack, 2026-11-01: "no way to get out of it"). The portal makes the
  // overlay truly viewport-fixed, above header and nav.
  const overlayRef = useRef(null)
  const dragRef = useRef(null)
  // Swipe back to the feed: a rightward, mostly-horizontal drag pulls
  // the article with the finger; past ~90px it dismisses, short of that
  // it snaps back. Transform only — the scroll position never fights it
  // because engagement requires horizontal dominance.
  const swipe = {
    onTouchStart: (e) => {
      const t = e.touches[0]
      dragRef.current = { x: t.clientX, y: t.clientY, dx: 0, active: false }
    },
    onTouchMove: (e) => {
      const d = dragRef.current
      const el = overlayRef.current
      if (!d || !el) return
      const t = e.touches[0]
      const dx = t.clientX - d.x
      const dy = t.clientY - d.y
      if (!d.active && dx > 14 && dx > Math.abs(dy) * 1.6) d.active = true
      if (d.active) {
        d.dx = dx
        el.style.transition = 'none'
        el.style.transform = `translateX(${dx}px)`
      }
    },
    onTouchEnd: () => {
      const d = dragRef.current
      const el = overlayRef.current
      dragRef.current = null
      if (!el) return
      if (d?.active && d.dx > 90) { onClose(); return }
      el.style.transition = 'transform 0.22s ease'
      el.style.transform = ''
    },
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const bodyHtml = useMemo(() => sanitize(story?.body), [story])
  if (!story) return null

  const dateLabel = story.published
    ? new Date(story.published).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  return createPortal(
    <div ref={overlayRef} style={S.overlay} role="dialog" aria-modal="true" aria-label={story.title} {...swipe}>
      <style>{ARTICLE_CSS}</style>
      <div style={S.header}>
        <button onClick={onClose} aria-label="Back to feed" style={S.backBtn}>‹ <span>Back</span></button>
        <span style={S.kicker}>STORY{dateLabel ? ` · ${dateLabel.toUpperCase()}` : ''}</span>
        <button onClick={onClose} aria-label="Close article" style={S.closeBtn}>✕</button>
      </div>
      <div style={S.scroll}>
        <div style={S.articleWrap}>
          {story.image && <img src={story.image} alt="" style={S.hero} />}
          <h1 style={S.title}>{story.title}</h1>
          {(story.author || dateLabel) && (
            <div style={S.byline}>{[story.author, dateLabel].filter(Boolean).join(' · ')}</div>
          )}
          {bodyHtml
            ? <div className="ttl-article" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            : <p style={S.fallback}>{story.summary || 'The full text of this story is not available in the app yet.'}</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 200, background: '#0d0d0d',
    display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: 'calc(0.7rem + env(safe-area-inset-top, 0px)) 1.1rem 0.7rem',
    borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
  },
  kicker: { fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--accent)', flex: 1, textAlign: 'center' },
  backBtn: {
    display: 'flex', alignItems: 'center', gap: '2px', background: 'none', border: 'none',
    color: '#fff', fontFamily: "'Barlow Condensed', sans-serif", fontSize: '19px', fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', padding: '4px 8px 4px 0', flexShrink: 0,
  },
  closeBtn: {
    background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff',
    width: 34, height: 34, borderRadius: '50%', fontSize: 15, cursor: 'pointer', flexShrink: 0,
  },
  scroll: { overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch' },
  articleWrap: { maxWidth: 680, margin: '0 auto', padding: '1.1rem 1.25rem 3rem' },
  hero: { width: '100%', borderRadius: 14, display: 'block', marginBottom: '1.1rem' },
  title: {
    fontFamily: "'Barlow Condensed', sans-serif", fontSize: 34, lineHeight: 1.08,
    textTransform: 'uppercase', margin: '0 0 0.5rem', color: '#fff',
  },
  byline: { fontSize: 13, color: '#999', marginBottom: '1.2rem' },
  fallback: { fontSize: 16, lineHeight: 1.6, color: '#ccc' },
}
