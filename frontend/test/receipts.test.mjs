// Tests for lib/receipts.js — read-receipt derivation (M2a).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readsMap, readBy, dmTickState, seenByProfiles } from '../src/lib/receipts.js'

const reads = [
  { athlete_id: 'a', last_read_at: '2026-11-06T10:00:00Z' },
  { athlete_id: 'b', last_read_at: '2026-11-06T12:00:00Z' },
  { athlete_id: 'a', last_read_at: '2026-11-06T11:00:00Z' }, // later dup wins
  { athlete_id: 'bad', last_read_at: 'not-a-date' },
  null,
]

test('readsMap keeps the latest timestamp per athlete and skips junk', () => {
  const m = readsMap(reads)
  assert.equal(m.size, 2)
  assert.equal(m.get('a'), new Date('2026-11-06T11:00:00Z').getTime())
  assert.equal(readsMap([]).size, 0)
  assert.equal(readsMap(undefined).size, 0)
})

test('readBy compares against the message timestamp', () => {
  const m = readsMap(reads)
  assert.equal(readBy(m, '2026-11-06T10:30:00Z', 'a'), true)
  assert.equal(readBy(m, '2026-11-06T11:30:00Z', 'a'), false)
  assert.equal(readBy(m, '2026-11-06T11:30:00Z', 'b'), true)
  assert.equal(readBy(m, '2026-11-06T10:00:00Z', 'nobody'), false)
})

test('dmTickState: sent until the peer read marker passes the message', () => {
  assert.equal(dmTickState('2026-11-06T10:00:00Z', null), 'sent')
  assert.equal(dmTickState('2026-11-06T10:00:00Z', '2026-11-06T09:00:00Z'), 'sent')
  assert.equal(dmTickState('2026-11-06T10:00:00Z', '2026-11-06T10:00:00Z'), 'read')
  assert.equal(dmTickState('2026-11-06T10:00:00Z', '2026-11-06T10:05:00Z'), 'read')
})

test('seenByProfiles excludes the author and sorts earliest first', () => {
  const m = readsMap(reads)
  const profilesById = { a: { full_name: 'A' }, b: { full_name: 'B' } }
  const msg = { created_at: '2026-11-06T09:00:00Z' }
  const seen = seenByProfiles(msg, m, profilesById, 'author')
  assert.deepEqual(seen.map((s) => s.id), ['a', 'b'])
  const seenByA = seenByProfiles(msg, m, profilesById, 'a')
  assert.deepEqual(seenByA.map((s) => s.id), ['b'])
  const none = seenByProfiles({ created_at: '2026-11-06T13:00:00Z' }, m, profilesById, 'author')
  assert.equal(none.length, 0)
})
