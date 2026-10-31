import { createContext, useContext, useRef, useState, useCallback } from 'react'

// Global podcast player (DESIGN-SPEC §2.3): one <audio> element owned by the
// provider, mounted above the router, so playback follows the member around
// the app — Home, Watch, Races, Chat — instead of being trapped on the
// screen where it started. The MiniPlayer component renders the chrome.
const AudioCtx = createContext(null)

export function AudioPlayerProvider({ children }) {
  const audioRef = useRef(null)
  const [current, setCurrent] = useState(null) // { audio, title, image }
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // seconds
  const [duration, setDuration] = useState(0)

  const playEpisode = useCallback((ep) => {
    if (!ep?.audio) return
    if (current?.audio === ep.audio) {
      const el = audioRef.current
      if (!el) return
      if (el.paused) { el.play(); } else { el.pause(); }
      return
    }
    setCurrent({ audio: ep.audio, title: ep.title, image: ep.image || null })
    setProgress(0)
    // The <audio> element picks up the new src on this render, then plays.
    requestAnimationFrame(() => {
      const el = audioRef.current
      if (el) { el.load(); el.play().catch(() => {}) }
    })
  }, [current])

  const toggle = useCallback(() => {
    const el = audioRef.current
    if (!el || !current) return
    if (el.paused) { el.play(); } else { el.pause(); }
  }, [current])

  const close = useCallback(() => {
    const el = audioRef.current
    if (el) { el.pause(); el.removeAttribute('src'); el.load() }
    setCurrent(null)
    setPlaying(false)
    setProgress(0)
    setDuration(0)
  }, [])

  const seek = useCallback((seconds) => {
    const el = audioRef.current
    if (el) el.currentTime = seconds
  }, [])

  return (
    <AudioCtx.Provider value={{ current, playing, progress, duration, playEpisode, toggle, close, seek }}>
      {children}
      <audio
        ref={audioRef}
        src={current?.audio || undefined}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={e => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)}
        onEnded={() => setPlaying(false)}
      />
    </AudioCtx.Provider>
  )
}

export function useAudio() {
  const ctx = useContext(AudioCtx)
  if (!ctx) throw new Error('useAudio must be used inside AudioPlayerProvider')
  return ctx
}

export function fmtClock(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`
}
