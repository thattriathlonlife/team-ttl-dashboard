// media.js — message media helpers (M3: voice notes + private media).
//
// New message media never touches the public avatars bucket again:
// files go to the PRIVATE `message-media` bucket (migration 0010) at
// `<channel_id>/<athlete_id>/<file>` — the storage policies require
// the uploader's own athlete segment and channel visibility — and the
// message row carries media_path / media_kind ('image' | 'audio') /
// audio_duration_s. Reads resolve through short-lived signed URLs.
//
// The pure helpers here are unit-tested; the browser-only pieces
// (canvas compression) fail soft to the original file.

export function extractFirstUrl(text) {
  if (!text) return null
  const m = String(text).match(/https?:\/\/[^\s<>"')\]]+/)
  if (!m) return null
  // Trailing sentence punctuation is not part of the link.
  return m[0].replace(/[.,!?;:]+$/, '')
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export function mediaPathFor(channelId, userId, ext) {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${channelId}/${userId}/${Date.now()}-${rand}.${ext}`
}

export function audioExtForMime(mime) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('mp4')) return 'm4a'
  if (m.includes('ogg')) return 'ogg'
  return 'webm'
}

export function pickAudioMime(candidates, isSupported) {
  for (const c of candidates) {
    try { if (isSupported(c)) return c } catch { /* keep looking */ }
  }
  return ''
}

export const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

export const VOICE_NOTE_MAX_S = 300 // WhatsApp-style 5-minute cap

// Downscale + JPEG-encode a picked image before upload. Phone photos
// drop from ~4 MB to a few hundred KB, which is also what makes
// multi-image sends tolerable on trail-grade connections. GIFs pass
// through untouched (canvas would flatten the animation).
export async function compressImageFile(file, maxDim = 1600, quality = 0.82) {
  const fallbackExt = (file.name.split('.').pop() || 'jpg').toLowerCase()
  try {
    if (!file.type || !file.type.startsWith('image/') || file.type === 'image/gif') {
      return { blob: file, ext: fallbackExt }
    }
    let bmp
    if (typeof createImageBitmap === 'function') {
      bmp = await createImageBitmap(file)
    } else {
      bmp = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = URL.createObjectURL(file)
      })
    }
    const w = bmp.width, h = bmp.height
    if (!w || !h) return { blob: file, ext: fallbackExt }
    const scale = Math.min(1, maxDim / Math.max(w, h))
    if (scale === 1 && file.size < 700 * 1024 && file.type === 'image/jpeg') {
      return { blob: file, ext: 'jpg' }
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) return { blob: file, ext: fallbackExt }
    return { blob, ext: 'jpg' }
  } catch {
    return { blob: file, ext: fallbackExt }
  }
}
