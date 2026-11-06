import { test } from 'node:test'
import assert from 'node:assert/strict'
import { urlBase64ToUint8Array, VAPID_PUBLIC_KEY } from '../src/lib/push.js'

// push.js imports ./supabase, which builds a client at module load —
// in node that is harmless (no network), and import.meta.env access
// is the one Vite-ism to stub if it ever appears there.

test('urlBase64ToUint8Array decodes unpadded base64url', () => {
  const bytes = urlBase64ToUint8Array('SGVsbG8') // "Hello"
  assert.deepEqual([...bytes], [72, 101, 108, 108, 111])
})

test('urlBase64ToUint8Array handles - and _ alphabet', () => {
  const bytes = urlBase64ToUint8Array('-_8')
  assert.deepEqual([...bytes], [251, 255])
})

test('the VAPID public key decodes to a 65-byte uncompressed point', () => {
  const bytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  assert.equal(bytes.length, 65)
  assert.equal(bytes[0], 0x04)
})
