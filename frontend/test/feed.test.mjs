import { test } from 'node:test'
import assert from 'node:assert/strict'
import { postScore, buildFeed, applyMixRules } from '../src/lib/feed.js'

// Feed ranking + mix rules (extracted from Home.jsx, 2026-11-01).
// Items are plain { kind, key, at, data, score } objects — the same
// shapes Home builds — so these tests pin the river's behavior without
// a browser.

const now = Date.now()
const HOUR = 3600e3
const DAY = 864e5

const post = (key, score, reactions = 0, replies = 0) => ({
  kind: 'post', key, at: now, score,
  data: { reactionCount: reactions, replyCount: replies },
})
const card = (kind, key, at = now) => ({ kind, key, at, data: {}, score: 0 })

// ── postScore ──
test('postScore: a fresh post with no engagement is worth ~2 (pure recency)', () => {
  const s = postScore({ reactionCount: 0, replyCount: 0, created_at: new Date(now).toISOString() })
  assert.ok(s > 1.9 && s <= 2, `got ${s}`)
})
test('postScore: recency is gone at 14 days; engagement weights are 3/2', () => {
  const s = postScore({ reactionCount: 2, replyCount: 1, created_at: new Date(now - 20 * DAY).toISOString() })
  assert.equal(s, 8) // 2*3 + 1*2 + 0
})
test('postScore: engagement outweighs freshness', () => {
  const hot = postScore({ reactionCount: 3, replyCount: 0, created_at: new Date(now - 10 * DAY).toISOString() })
  const fresh = postScore({ reactionCount: 0, replyCount: 0, created_at: new Date(now).toISOString() })
  assert.ok(hot > fresh)
})

// ── buildFeed: lead rule + interleave ──
test('buildFeed: a hot discussion (>=3 engagement) leads the river', () => {
  const content = [card('episode', 'e1'), card('episode', 'e2'), card('episode', 'e3')]
  const posts = [post('pHot', 10, 2, 1), post('pCold', 1)]
  const out = buildFeed(content, posts)
  assert.equal(out[0].key, 'pHot')
})
test('buildFeed: below the engagement threshold, content leads', () => {
  const content = [card('episode', 'e1'), card('episode', 'e2')]
  const posts = [post('pWarm', 10, 1, 1)] // engagement 2 < 3
  const out = buildFeed(content, posts)
  assert.equal(out[0].key, 'e1')
})
test('buildFeed: interleave is 2 content : 1 post until a side runs out', () => {
  const content = ['c1', 'c2', 'c3', 'c4', 'c5'].map(k => card('episode', k))
  const posts = [post('p1', 3), post('p2', 2), post('p3', 1)]
  const out = buildFeed(content, posts)
  assert.deepEqual(out.map(i => i.key), ['c1', 'c2', 'p1', 'c3', 'c4', 'p2', 'c5', 'p3'])
})
test('buildFeed: posts are ranked by score before interleaving', () => {
  const content = [card('episode', 'c1'), card('episode', 'c2'), card('episode', 'c3')]
  const posts = [post('pLow', 1), post('pHigh', 9)]
  const out = buildFeed(content, posts)
  assert.ok(out.findIndex(i => i.key === 'pHigh') < out.findIndex(i => i.key === 'pLow'))
})
test('buildFeed: activity cards weave in at slots 3, 10, 18', () => {
  const content = Array.from({ length: 8 }, (_, i) => card('episode', `c${i}`))
  const act = [{ kind: 'activity', key: 'a1', at: now, data: {}, score: 0 }]
  const out = buildFeed(content, [], act)
  assert.equal(out[3].key, 'a1')
  assert.equal(out.length, 9)
})
test('buildFeed: empty in, empty out', () => {
  assert.deepEqual(buildFeed([], []), [])
})

// ── applyMixRules ──
test('mix: a fresh story buried past slot 4 floats up to slot 4', () => {
  const out = [
    post('p1', 0), card('episode', 'e1'), post('p2', 0), card('episode', 'e2'),
    post('p3', 0), card('episode', 'e3'), card('story', 's1', now - DAY),
  ]
  applyMixRules(out)
  assert.equal(out[4].kind, 'story')
})
test('mix: a stale story (>45 days) stays buried', () => {
  const out = [
    post('p1', 0), card('episode', 'e1'), post('p2', 0), card('episode', 'e2'),
    post('p3', 0), card('episode', 'e3'), card('story', 's1', now - 50 * DAY),
  ]
  applyMixRules(out)
  assert.equal(out[6].kind, 'story')
})
test('mix: a story already in the first screen is left alone', () => {
  const out = [card('episode', 'e1'), card('story', 's1'), card('episode', 'e2')]
  applyMixRules(out)
  assert.equal(out[1].kind, 'story')
})
test('mix: diversity breaks 3-in-a-row by swapping in a different kind', () => {
  const out = [card('video', 'v1'), card('video', 'v2'), card('video', 'v3'), card('episode', 'e1')]
  applyMixRules(out)
  assert.deepEqual(out.map(i => i.key), ['v1', 'v2', 'e1', 'v3'])
})
test('mix: no different kind within reach means no swap', () => {
  const out = [card('video', 'v1'), card('video', 'v2'), card('video', 'v3'), card('video', 'v4'), card('video', 'v5')]
  applyMixRules(out)
  assert.deepEqual(out.map(i => i.key), ['v1', 'v2', 'v3', 'v4', 'v5'])
})
test('mix: posts reset a content run (no false 3-in-a-row)', () => {
  const out = [card('video', 'v1'), card('video', 'v2'), post('p1', 0), card('video', 'v3'), card('video', 'v4')]
  applyMixRules(out)
  assert.deepEqual(out.map(i => i.key), ['v1', 'v2', 'p1', 'v3', 'v4'])
})
