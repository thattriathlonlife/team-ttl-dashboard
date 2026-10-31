import { useAudio, fmtClock } from '../lib/audio'

// Persistent mini-player (DESIGN-SPEC §4): renders inside Layout whenever an
// episode is loaded, floating above the nav. Progress bar seeks on click.
export default function MiniPlayer({ floating = false }) {
  const { current, playing, progress, duration, toggle, close, seek } = useAudio()
  if (!current) return null

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0

  return (
    <div style={{
      ...(floating
        ? { position: 'fixed', right: '16px', bottom: '16px', width: 'min(380px, calc(100vw - 32px))', zIndex: 300 }
        : { margin: '0 12px 8px' }),
      background: 'rgba(24,24,24,0.96)', backdropFilter: 'blur(12px)',
      border: '1px solid rgba(0, 181, 185,0.35)', borderRadius: '14px',
      padding: '10px 12px', boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {current.image
          ? <img src={current.image} alt="" style={{ width: 38, height: 38, borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
          : <div style={{ width: 38, height: 38, borderRadius: '8px', background: 'rgba(0, 181, 185,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', flexShrink: 0 }}>🎧</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {current.title}
          </div>
          <div style={{ fontSize: '11px', color: '#888', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '1px' }}>
            {fmtClock(progress)} / {fmtClock(duration)} · THAT TRIATHLON LIFE PODCAST
          </div>
        </div>
        <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} style={{
          width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0,
          background: '#00B5B9', border: 'none', color: '#06282a',
          fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button onClick={close} aria-label="Close player" style={{
          width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
          background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: '#999',
          fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          ✕
        </button>
      </div>
      <div
        onClick={e => {
          if (!duration) return
          const rect = e.currentTarget.getBoundingClientRect()
          seek(((e.clientX - rect.left) / rect.width) * duration)
        }}
        style={{ height: '12px', display: 'flex', alignItems: 'center', cursor: duration ? 'pointer' : 'default', marginTop: '2px' }}
      >
        <div style={{ height: '3px', flex: 1, background: 'rgba(255,255,255,0.12)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: '#00B5B9', borderRadius: '2px', transition: 'width 0.25s linear' }} />
        </div>
      </div>
    </div>
  )
}
