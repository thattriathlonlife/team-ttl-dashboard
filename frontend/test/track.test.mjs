import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ANALYTICS_EVENTS, sanitizeEvent, dedupeKeyFor, createEventQueue } from '../src/lib/track.js'

// ── sanitizeEvent: taxonomy allowlist ──
test('every taxonomy event is accepted', () => {
  for (const name of ANALYTICS_EVENTS) {
    const out = sanitizeEvent(name, {})
    assert.equal(out.event, name)
    assert.deepEqual(out.properties, {})
  }
})
test('unknown event names are rejected', () => {
  assert.equal(sanitizeEvent('user_clicked_thing', {}), null)
  assert.equal(sanitizeEvent('', {}), null)
  assert.equal(sanitizeEvent(undefined, {}), null)
})
test('allowlisted props survive, everything else is stripped', () => {
  const out = sanitizeEvent('race_viewed', { race_id: 'r-1', content: 'secret text', user_id: 'x' })
  assert.deepEqual(out.properties, { race_id: 'r-1' })
})
test('events with an empty prop allowlist carry no props', () => {
  const out = sanitizeEvent('app_session', { race_id: 'r-1', anything: 1 })
  assert.deepEqual(out.properties, {})
})
test('prop value coercion: scalars kept, objects and null dropped', () => {
  const out = sanitizeEvent('content_played', { kind: 'podcast', item_id: { nested: true } })
  assert.deepEqual(out.properties, { kind: 'podcast' })
  const out2 = sanitizeEvent('map_viewed', { surface: null })
  assert.deepEqual(out2.properties, {})
})
test('long string props are truncated, not rejected', () => {
  const out = sanitizeEvent('race_viewed', { race_id: 'x'.repeat(500) })
  assert.equal(out.properties.race_id.length, 200)
})
test('non-object props are treated as empty', () => {
  assert.deepEqual(sanitizeEvent('map_viewed', 'app').properties, {})
  assert.deepEqual(sanitizeEvent('map_viewed', ['surface']).properties, {})
  assert.deepEqual(sanitizeEvent('map_viewed').properties, {})
})

// ── dedupeKeyFor: session-scoped dedupe ──
test('app_session and announcement_viewed dedupe to a constant key', () => {
  assert.equal(dedupeKeyFor('app_session', {}), 'app_session')
  assert.equal(dedupeKeyFor('announcement_viewed', {}), 'announcement_viewed')
})
test('race_viewed dedupes per race, not globally', () => {
  assert.equal(dedupeKeyFor('race_viewed', { race_id: 'a' }), 'race_viewed:a')
  assert.equal(dedupeKeyFor('race_viewed', { race_id: 'b' }), 'race_viewed:b')
  assert.notEqual(
    dedupeKeyFor('race_viewed', { race_id: 'a' }),
    dedupeKeyFor('race_viewed', { race_id: 'b' }),
  )
})
test('deal_viewed dedupes per deal', () => {
  assert.equal(dedupeKeyFor('deal_viewed', { deal_id: 7 }), 'deal_viewed:7')
})
test('content_played dedupes per kind and item', () => {
  assert.equal(
    dedupeKeyFor('content_played', { kind: 'video', item_id: 'v1' }),
    'content_played:video:v1',
  )
  assert.notEqual(
    dedupeKeyFor('content_played', { kind: 'video', item_id: 'v1' }),
    dedupeKeyFor('content_played', { kind: 'story', item_id: 'v1' }),
  )
})
test('action events are never deduped', () => {
  for (const name of ['race_entered', 'race_withdrawn', 'map_viewed', 'message_posted', 'deal_clicked', 'deal_code_copied', 'profile_completed']) {
    assert.equal(dedupeKeyFor(name, { race_id: 'a', deal_id: 1 }), null, name)
  }
})

// ── createEventQueue: batching ──
test('queue flushes exactly at the batch threshold', () => {
  const q = createEventQueue(20)
  for (let i = 0; i < 19; i++) assert.equal(q.push({ event: 'map_viewed' }), false)
  assert.equal(q.size(), 19)
  assert.equal(q.push({ event: 'map_viewed' }), true)
  assert.equal(q.size(), 20)
})
test('drain returns the batch in order and empties the queue', () => {
  const q = createEventQueue(3)
  q.push({ event: 'a' })
  q.push({ event: 'b' })
  assert.deepEqual(q.drain(), [{ event: 'a' }, { event: 'b' }])
  assert.equal(q.size(), 0)
  assert.deepEqual(q.drain(), [])
})
test('custom batch sizes are honoured', () => {
  const q = createEventQueue(2)
  assert.equal(q.push({ event: 'a' }), false)
  assert.equal(q.push({ event: 'b' }), true)
})
