import { useState, useEffect } from 'react'
import { useAudio } from '../lib/audio'

// Content tab — the TTL public content world inside the unified app.
// Stories come from the Shopify `journal` blog Atom feed, episodes from
// the Buzzsprout podcast RSS, and videos from the TTL YouTube channel's
// /videos page (YouTube's channel RSS 404s for this channel), all
// normalised by /api/content/feeds.
// TTL keeps publishing exactly where it already publishes; nothing here
// depends on the legacy app or Firebase.

const S = {
  wrap: { maxWidth: 760, margin: '0 auto', padding: '20px 16px 96px' },
  h: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#fff', margin: '26px 0 12px' },
  card: { display: 'flex', gap: 14, background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, marginBottom: 10, cursor: 'pointer', textAlign: 'left', width: '100%' },
  img: { width: 84, height: 84, objectFit: 'cover', borderRadius: 8, flexShrink: 0, background: '#1f1f1f' },
  title: { fontFamily: 'Barlow, sans-serif', fontSize: 16, fontWeight: 600, color: '#fff', lineHeight: 1.3 },
  meta: { fontFamily: 'Barlow, sans-serif', fontSize: 12, color: '#888', marginTop: 4 },
  summary: { fontFamily: 'Barlow, sans-serif', fontSize: 13, color: '#bbb', marginTop: 6, lineHeight: 1.45 },
  playBtn: { flexShrink: 0, width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'var(--brand)', color: '#06282a', fontSize: 17, cursor: 'pointer', alignSelf: 'center' },
  note: { fontFamily: 'Barlow, sans-serif', fontSize: 14, color: '#999', padding: '18px 0' },
}

function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  return isNaN(dt) ? '' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Content() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const audio = useAudio() // global player — playback survives navigation

  useEffect(() => {
    fetch('/api/content/feeds')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('feed'))))
      .then(setData)
      .catch(() => setError('Content is unavailable right now.'))
  }, [])

  if (error) return <div style={S.wrap}><div style={S.note}>{error}</div></div>
  if (!data) return (
    <div style={S.wrap}>
      <style>{`@keyframes ttlPulse { 0%,100% { opacity: .45 } 50% { opacity: .9 } }`}</style>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{ height: '96px', borderRadius: '12px', background: '#161616', border: '1px solid rgba(255,255,255,0.05)', animation: `ttlPulse 1.3s ease-in-out ${i * 0.15}s infinite`, marginBottom: '10px' }} />
      ))}
    </div>
  )

  return (
    <div style={S.wrap}>
      <div style={{ ...S.h, marginTop: 4 }}>Podcast</div>
      {data.episodes.map((ep, i) => {
        const isCurrent = audio.current?.audio === ep.audio
        return (
          <div key={i} style={{ ...S.card, cursor: 'default' }}>
            {ep.image && <img src={ep.image} alt="" loading="lazy" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0, alignSelf: 'center' }} />}
            <button style={S.playBtn} onClick={() => audio.playEpisode(ep)} aria-label={isCurrent && audio.playing ? 'Pause' : 'Play'}>
              {isCurrent && audio.playing ? '❚❚' : '▶'}
            </button>
            <div>
              <div style={S.title}>{ep.title}</div>
              <div style={S.meta}>{fmtDate(ep.published)}{ep.duration ? ` · ${ep.duration}` : ''}</div>
              {ep.summary && <div style={S.summary}>{ep.summary}</div>}
            </div>
          </div>
        )
      })}

      {data.videos?.length > 0 && (
        <>
          <div style={S.h}>Videos</div>
          {data.videos.map((v) => (
            <button key={v.id} style={{ ...S.card, flexDirection: 'column', gap: 10 }} onClick={() => window.open(v.link, '_blank', 'noopener')}>
              {v.image && (
                <div style={{ position: 'relative', width: '100%' }}>
                  <img style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 8, display: 'block', background: '#1f1f1f' }} src={v.image} alt="" loading="lazy" />
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 46, height: 46, borderRadius: '50%', background: 'rgba(0,0,0,0.62)', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▶</div>
                </div>
              )}
              <div>
                <div style={S.title}>{v.title}</div>
                <div style={S.meta}>{v.age || fmtDate(v.published)}{v.views ? ` · ${v.views}` : ''}</div>
              </div>
            </button>
          ))}
        </>
      )}

      <div style={S.h}>TTL Stories</div>
      {data.stories.map((st, i) => (
        <button key={i} style={S.card} onClick={() => window.open(st.link, '_blank', 'noopener')}>
          {st.image && <img style={S.img} src={st.image} alt="" loading="lazy" />}
          <div>
            <div style={S.title}>{st.title}</div>
            <div style={S.meta}>{fmtDate(st.published)}</div>
            {st.summary && <div style={S.summary}>{st.summary}</div>}
          </div>
        </button>
      ))}
    </div>
  )
}
