import { createContext, useContext, useRef, useState, useCallback } from 'react'

// Global podcast player (DESIGN-SPEC §2.3): one <audio> element owned by the
// provider, mounted above the router, so playback follows the member around
// the app — Home, Watch, Races, Chat — instead of being trapped on the
// screen where it started. The MiniPlayer component renders the chrome.
const AudioCtx = createContext(null)

const LISTEN_KEY = 'ttl-last-listen'

function readLastListen() {
  try {
    const raw = localStorage.getItem(LISTEN_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (!v?.audio || !(v.progress > 10)) return null
    if (v.duration && v.progress > v.duration - 20) return null // finished
    return v
  } catch { return null }
}

export function AudioPlayerProvider({ children }) {
  const audioRef = useRef(null)
  const pendingSeekRef = useRef(0)
  const lastSavedRef = useRef(0)
  const [current, setCurrent] = useState(null) // { audio, title, image }
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // seconds
  const [duration, setDuration] = useState(0)
  const [lastListen, setLastListen] = useState(readLastListen)

  const saveListen = useCallback((cur, prog, dur) => {
    if (!cur?.audio || !(prog > 10)) return
    const entry = { audio: cur.audio, title: cur.title, image: cur.image || null, progress: prog, duration: dur || 0, savedAt: Date.now() }
    try { localStorage.setItem(LISTEN_KEY, JSON.stringify(entry)) } catch {}
    setLastListen(entry)
  }, [])

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

  // Resume the saved episode at its saved position (Archive's Continue
  // Listening card).
  const resumeLast = useCallback(() => {
    const saved = readLastListen()
    if (!saved) return
    if (current?.audio === saved.audio) {
      const el = audioRef.current
      if (el) { el.currentTime = saved.progress; el.play().catch(() => {}) }
      return
    }
    pendingSeekRef.current = saved.progress
    setCurrent({ audio: saved.audio, title: saved.title, image: saved.image })
    setProgress(saved.progress)
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
    <AudioCtx.Provider value={{ current, playing, progress, duration, playEpisode, toggle, close, seek, lastListen, resumeLast }}>
      {children}
      <audio
        ref={audioRef}
        src={current?.audio || undefined}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={(e) => { setPlaying(false); saveListen(current, e.currentTarget.currentTime, e.currentTarget.duration || duration) }}
        onTimeUpdate={e => {
          const t = e.currentTarget.currentTime
          setProgress(t)
          if (Math.abs(t - lastSavedRef.current) > 15) {
            lastSavedRef.current = t
            saveListen(current, t, e.currentTarget.duration || duration)
          }
        }}
        onLoadedMetadata={e => {
          setDuration(e.currentTarget.duration || 0)
          if (pendingSeekRef.current > 0) {
            e.currentTarget.currentTime = pendingSeekRef.current
            pendingSeekRef.current = 0
          }
        }}
        onEnded={() => {
          setPlaying(false)
          try { localStorage.removeItem(LISTEN_KEY) } catch {}
          setLastListen(null)
        }}
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
