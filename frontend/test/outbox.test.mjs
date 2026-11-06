// Tests for lib/outbox.js pure queue operations (M2b).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enqueue, dequeue, bumpAttempt, forChannel } from '../src/lib/outbox.js'

const item = (localId, channel_id = 'c1') => ({
  localId,
  channel_id,
  content: 'hello',
  image_url: null,
  reply_to: null,
})

test('enqueue appends and dedupes by localId', () => {
  let q = enqueue([], item('a'))
  q = enqueue(q, item('b'))
  assert.equal(q.length, 2)
  q = enqueue(q, item('a'))
  assert.equal(q.length, 2)
  assert.equal(q[0].attempts, 0)
  assert.ok(q[0].queued_at)
})

test('dequeue removes only the matching entry', () => {
  const q = [item('a'), item('b'), item('c')]
  const next = dequeue(q, 'b')
  assert.deepEqual(next.map((x) => x.localId), ['a', 'c'])
  assert.equal(dequeue(q, 'nope').length, 3)
})

test('bumpAttempt increments only the target', () => {
  let q = [item('a'), item('b')]
  q = bumpAttempt(q, 'a')
  assert.equal(q[0].attempts, 1)
  assert.equal(q[1].attempts, undefined)
  q = bumpAttempt(q, 'a')
  assert.equal(q[0].attempts, 2)
})

test('forChannel filters to one channel', () => {
  const q = [item('a', 'c1'), item('b', 'c2'), item('c', 'c1')]
  assert.deepEqual(forChannel(q, 'c1').map((x) => x.localId), ['a', 'c'])
  assert.equal(forChannel(q, 'cX').length, 0)
  assert.equal(forChannel(null, 'c1').length, 0)
})
