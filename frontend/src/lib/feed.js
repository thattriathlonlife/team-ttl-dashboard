// Feed ranking + mixing, extracted from Home.jsx so the river's rules
// are unit-testable (Zack, 2026-11-01: "build out the remaining
// tests"). Behavior is byte-identical to the inline originals; Home
// imports postScore + buildFeed from here.

export function postScore(p) {
  const ageH = (Date.now() - new Date(p.created_at)) / 3600e3
  const recency = Math.max(0, 1 - ageH / (24 * 14)) * 2
  return p.reactionCount * 3 + p.replyCount * 2 + recency
}

export function buildFeed(content, posts, activity = []) {
  const ranked = [...posts].sort((a, b) => b.score - a.score)
  const out = []
  // Popular discussions lead the river (Zack, 2026-10-31): when the top
  // discussion has real engagement, it opens the feed instead of waiting
  // behind two content cards.
  const top = ranked[0]
  if (top && (top.data.reactionCount + top.data.replyCount) >= 3) out.push(ranked.shift())
  let ci = 0
  let pi = 0
  while (ci < content.length || pi < ranked.length) {
    for (let n = 0; n < 2 && ci < content.length; n++) out.push(content[ci++])
    if (pi < ranked.length) out.push(ranked[pi++])
  }
  applyMixRules(out)
  // Team activity cards (race buzz, just-added races) weave in at fixed
  // early slots so the river feels inhabited even before chat takes off
  // (Zack, 2026-11-01 — "make the feed feel alive").
  const slots = [3, 10, 18]
  activity.slice(0, 3).forEach((item, i) => {
    out.splice(Math.min(slots[i], out.length), 0, item)
  })
  return out
}

// The mix rules (Zack, 2026-11-01): chronology stays the spine, with two
// adjustments so the river breathes —
//  1. Story guarantee: TTL's own editorial voice shouldn't drown under a
//     weekly podcast cadence; the newest story (<45 days old) earns a
//     first-screen seat if chronology buried it deeper than slot 4.
//  2. Diversity: never 3+ cards of the same content kind in a row when a
//     different kind is available within the next few cards to swap in.
export function applyMixRules(out) {
  const storyIdx = out.findIndex(i => i.kind === 'story')
  if (storyIdx > 4) {
    const story = out[storyIdx]
    if ((Date.now() - (story.at || 0)) / 864e5 <= 45) {
      out.splice(storyIdx, 1)
      out.splice(4, 0, story)
    }
  }
  const isContent = k => k === 'episode' || k === 'video' || k === 'story'
  let runKind = null
  let runLen = 0
  for (let i = 0; i < out.length; i++) {
    const k = out[i].kind
    if (!isContent(k)) { runKind = null; runLen = 0; continue }
    if (k === runKind) runLen++
    else { runKind = k; runLen = 1 }
    if (runLen >= 3) {
      for (let j = i + 1; j <= Math.min(i + 4, out.length - 1); j++) {
        if (isContent(out[j].kind) && out[j].kind !== runKind) {
          const [swap] = out.splice(j, 1)
          out.splice(i, 0, swap)
          runKind = swap.kind
          runLen = 1
          break
        }
      }
    }
  }
}
