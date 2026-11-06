// drafts.js — per-channel composer drafts in localStorage (M2a).
// On-device only, like WhatsApp's local drafts: never sent to the
// server, never shared. Key: ttl-draft:<channelId>.

const PREFIX = 'ttl-draft:'

export function getDraft(channelId) {
  try {
    return window.localStorage.getItem(PREFIX + channelId) || ''
  } catch {
    return ''
  }
}

export function setDraft(channelId, text) {
  try {
    if (text) window.localStorage.setItem(PREFIX + channelId, text)
    else window.localStorage.removeItem(PREFIX + channelId)
  } catch {
    // storage full/blocked — drafts are best-effort
  }
}

export function clearDraft(channelId) {
  setDraft(channelId, '')
}

export function hasDraft(channelId) {
  return getDraft(channelId).trim().length > 0
}
