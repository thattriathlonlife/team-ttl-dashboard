// Auto-moderation v1 (Zack, 2026-10-31: "I won't be able to monitor so
// we need that automated").
//
// Design: nobody watches this community full-time, so the first line of
// moderation is automatic and boring — the way Discord AutoMod /
// WhatsApp group tooling works. This module is the rule engine; it runs
// at send time (block/warn before a message lands) and at render time
// (already-posted severe content renders collapsed for everyone).
//
// HONEST LIMIT, stated in AUTO-MODERATION.md: a client-side engine is a
// strong deterrent and keeps the visible community clean, but a
// determined user can call the API directly. The pilot step moves the
// same rules server-side (draft migration 0004: moderation_events +
// a messages trigger), where they can't be bypassed.
//
// Verdicts: allow | warn (sends, user sees a notice) | block (does not
// send, user sees why) | hide (render-time collapse).

// Severe terms: blocked on send, hidden on render. Matching is
// whole-word against curated inflection variants (fuck/fucked/fucking),
// after normalization (case, accents, common leetspeak, symbol-stripped
// censored forms like f*ck -> fck). Whole-word + variants + an allowlist
// is deliberate: prefix matching false-positives on real vocabulary
// (cocktail, shiitake) and substring matching on classics like class /
// grape / Scunthorpe. Mild terms with name collisions (dick, cock) are
// intentionally NOT in the severe list for a sports community.
const SEVERE_TERMS = [
  'fuck', 'fucks', 'fucked', 'fucking', 'fucker', 'fck', 'motherfucker',
  'shit', 'shits', 'shitty', 'shitshow', 'bullshit', 'sht',
  'bitch', 'bitches', 'btch', 'bastard', 'bastards', 'asshole', 'assholes',
  'whore', 'whores', 'slut', 'sluts', 'cunt', 'cunts',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded',
  'kike', 'spic', 'chink', 'pussy', 'porn', 'rape', 'rapist',
]
const ALLOWLIST = new Set(['cocktail', 'cocktails', 'shiitake', 'scunthorpe'])

// Promotional-spam fingerprints: links + money bait in the same message.
const SPAM_PHRASES = [
  'crypto giveaway', 'double your', 'free money', 'click here to claim',
  'guaranteed income', 'work from home and earn', 'send me your',
  'investment opportunity', 'telegram me', 'whatsapp me at',
]

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '@': 'a', '$': 's', '5': 's', '7': 't' }

export function normalizeText(text) {
  if (!text) return ''
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split('')
    .map(c => LEET[c] || c)
    .join('')
    .replace(/[*_~]/g, '') // censored forms rejoin: f*ck -> fck
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function findSevereTerm(text) {
  const n = normalizeText(text)
  if (!n) return null
  const words = n.split(' ')
  return SEVERE_TERMS.find(t => words.some(w => w === t && !ALLOWLIST.has(w))) || null
}

// Render-time: should this existing message be collapsed for everyone?
export function shouldHide(text) {
  return !!findSevereTerm(text)
}

function countLinks(text) {
  if (!text) return 0
  const m = text.match(/https?:\/\/|www\.[a-z0-9-]+\./gi)
  return m ? m.length : 0
}

// ─── Send-rate tracking (slow mode) ─────────────────────────────────────
// Module-level so it survives re-renders; keyed by channel. More than
// SEND_BURST messages inside SEND_WINDOW_MS is treated as flooding.
const SEND_WINDOW_MS = 8000
const SEND_BURST = 4
const sendLog = new Map()

function rateVerdict(channelId) {
  const now = Date.now()
  const log = (sendLog.get(channelId) || []).filter(t => now - t < SEND_WINDOW_MS)
  log.push(now)
  sendLog.set(channelId, log)
  return log.length > SEND_BURST
}

// Outgoing check. ctx: { channelId, recentMine: string[] (the sender's
// latest contents in this channel, newest last), mentionCount }
export function moderateOutgoing(text, ctx = {}) {
  const content = (text || '').trim()
  if (!content) return { action: 'allow' }

  const term = findSevereTerm(content)
  if (term) {
    return { action: 'block', reason: 'That message contains language that isn’t allowed here, so it wasn’t sent.' }
  }

  const links = countLinks(content)
  const n = normalizeText(content)
  if (links >= 2 && SPAM_PHRASES.some(p => n.includes(p))) {
    return { action: 'block', reason: 'That looks like promotional spam, so it wasn’t sent.' }
  }
  if (links >= 3) {
    return { action: 'block', reason: 'Too many links in one message — it wasn’t sent. Split them up if they’re legit.' }
  }

  // Flood: the same text three times in the sender's recent history.
  const norm = normalizeText(content)
  const repeats = (ctx.recentMine || []).filter(m => normalizeText(m) === norm && norm.length > 0).length
  if (repeats >= 2) {
    return { action: 'block', reason: 'You’ve already posted that a few times — it wasn’t sent again.' }
  }

  if (ctx.channelId && rateVerdict(ctx.channelId)) {
    return { action: 'block', reason: 'Slow down a moment — messages are coming too fast for auto-moderation to keep up.' }
  }

  // Warnings (message still sends).
  const letters = content.replace(/[^a-zA-Z]/g, '')
  if (letters.length >= 20) {
    const caps = letters.replace(/[^A-Z]/g, '').length / letters.length
    if (caps > 0.7) return { action: 'warn', reason: 'Heads up: all-caps reads as shouting — sent anyway.' }
  }
  if ((ctx.mentionCount || 0) >= 4) {
    return { action: 'warn', reason: 'That mentions a lot of people at once — sent, but go easy on mass mentions.' }
  }
  if (content.length > 1200) {
    return { action: 'warn', reason: 'That’s a very long message — sent, but consider breaking it up.' }
  }
  return { action: 'allow' }
}
