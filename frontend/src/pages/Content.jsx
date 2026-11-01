import { useState, useEffect } from 'react'
import { useAudio, fmtClock } from '../lib/audio'

// The Archive — TTL's complete public catalogue, one tap deep from the
// Home feed (the Watch tab was retired 2026-10-31: the feed covers
// discovery; this page is for browsing the back catalogue in order).
// Stories come from the Shopify `journal` blog Atom feed, episodes from
// the Buzzsprout podcast RSS, and videos from the TTL YouTube channel's
// /videos page (YouTube's channel RSS 404s for this channel), all
// normalised by /api/content/feeds?full=1.
// TTL keeps publishing exactly where it already publishes; nothing here
// depends on the legacy app or Firebase.

const S = {
  wrap: { maxWidth: 760, margin: '0 auto', padding: '20px 16px 96px' },
  h: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#fff', margin: '22px 0 12px', position: 'sticky', top: 0, background: '#0d0d0d', padding: '8px 0 6px', zIndex: 5 },
  card: { display: 'flex', gap: 14, background: '#161616', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 14, marginBottom: 10, cursor: 'pointer', textAlign: 'left', width: '100%' },
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
    fetch('/api/content/feeds?full=1')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('feed'))))
      .then(setData)
      .catch(() => setError('Content is unavailable right now.'))
  }, [])

  // Deep links from Home's filter views and Search land on a section.
  useEffect(() => {
    if (!data || !window.location.hash) return
    const el = document.querySelector(window.location.hash)
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }))
  }, [data])

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
      <h1 style={{
        fontFamily: 'Barlow Condensed, sans-serif', fontSize: '32px', fontWeight: 900,
        letterSpacing: '2px', lineHeight: 1, color: '#fff', marginTop: '2px',
      }}>
        THE ARCHIVE
      </h1>
      <div style={{ fontSize: '13.5px', color: '#999', marginTop: '7px', lineHeight: 1.5 }}>
        Everything That Triathlon Life publishes, in order —{' '}
        {data.episodesTotal ?? data.episodes.length} episodes · {data.videos?.length || 0} videos · {data.storiesTotal ?? data.stories.length} stories.
      </div>

      {/* Continue Listening — resume position saved by the global player */}
      {audio.lastListen && audio.current?.audio !== audio.lastListen.audio && (
        <button
          onClick={() => audio.resumeLast()}
          style={{
            display: 'block', width: '100%', textAlign: 'left', marginTop: '16px',
            background: 'linear-gradient(135deg, rgba(var(--brand-rgb),0.12), rgba(var(--brand-rgb),0.03))',
            border: '1px solid rgba(var(--brand-rgb),0.4)', borderRadius: '16px',
            padding: '14px 16px', cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '10.5px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', background: 'rgba(var(--brand-rgb),0.14)', color: 'var(--brand)', padding: '3px 8px', borderRadius: '5px' }}>Continue listening</span>
            {audio.lastListen.duration > 0 && (
              <span style={{ fontSize: '11.5px', color: '#888' }}>{fmtClock(audio.lastListen.duration - audio.lastListen.progress)} left</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {audio.lastListen.image && <img src={audio.lastListen.image} alt="" style={{ width: 48, height: 48, borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: '15px', color: '#fff', lineHeight: 1.35 }}>{audio.lastListen.title}</div>
            <span style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--brand)', color: '#04282a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>▶</span>
          </div>
          {audio.lastListen.duration > 0 && (
            <div style={{ height: 5, background: '#26292b', borderRadius: 3, marginTop: 12 }}>
              <div style={{ width: `${Math.min(100, (audio.lastListen.progress / audio.lastListen.duration) * 100)}%`, height: '100%', background: 'var(--brand)', borderRadius: 3 }} />
            </div>
          )}
        </button>
      )}

      <div id="podcast" style={{ ...S.h, scrollMarginTop: '12px' }}>Podcast · {data.episodesTotal ?? data.episodes.length}</div>
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
          <div id="videos" style={{ ...S.h, scrollMarginTop: '12px' }}>Videos · {data.videos.length}</div>
          {data.videos.map((v, vi) => vi === 0 ? (
            // Hero treatment for the newest video: full-bleed thumbnail,
            // scrim headline (mockups, 2026-10-31).
            <button key={v.id} onClick={() => window.open(v.link, '_blank', 'noopener')} style={{ display: 'block', width: '100%', padding: 0, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, overflow: 'hidden', position: 'relative', cursor: 'pointer', background: '#161616', marginBottom: 10, textAlign: 'left' }}>
              {v.image && <img style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} src={v.image} alt="" loading="lazy" />}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 42%, rgba(4,6,8,0.9))' }} />
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -68%)', width: 52, height: 52, borderRadius: '50%', background: 'rgba(0,0,0,0.62)', color: '#fff', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▶</div>
              <div style={{ position: 'absolute', left: 14, bottom: 12, right: 14 }}>
                <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', background: 'rgba(var(--accent-rgb),0.16)', color: 'var(--accent)', padding: '3px 8px', borderRadius: 5 }}>Latest video</span>
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 21, fontWeight: 800, letterSpacing: 0.5, color: '#fff', marginTop: 6, lineHeight: 1.1, textTransform: 'uppercase' }}>{v.title}</div>
                <div style={{ fontSize: 12, color: '#bbb', marginTop: 3 }}>{v.age || fmtDate(v.published)}{v.views ? ` · ${v.views}` : ''}</div>
              </div>
            </button>
          ) : (
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

      <div id="stories" style={{ ...S.h, scrollMarginTop: '12px' }}>TTL Stories · {data.storiesTotal ?? data.stories.length}</div>
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
