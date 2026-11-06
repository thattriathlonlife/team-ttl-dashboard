import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractFirstUrl, formatDuration, mediaPathFor, audioExtForMime,
  pickAudioMime, AUDIO_MIME_CANDIDATES, VOICE_NOTE_MAX_S,
} from '../src/lib/media.js'

test('extractFirstUrl finds the first http(s) URL', () => {
  assert.equal(extractFirstUrl('check this https://example.com/race out'), 'https://example.com/race')
  assert.equal(extractFirstUrl('http://a.co/x and https://b.co/y'), 'http://a.co/x')
})

test('extractFirstUrl trims trailing sentence punctuation', () => {
  assert.equal(extractFirstUrl('wow https://example.com/a.'), 'https://example.com/a')
  assert.equal(extractFirstUrl('(see https://example.com/a)'), 'https://example.com/a')
  assert.equal(extractFirstUrl('really https://example.com/a?!'), 'https://example.com/a')
})

test('extractFirstUrl returns null without a URL', () => {
  assert.equal(extractFirstUrl('no links here'), null)
  assert.equal(extractFirstUrl(''), null)
  assert.equal(extractFirstUrl(null), null)
  assert.equal(extractFirstUrl('www.example.com bare'), null)
})

test('formatDuration renders m:ss', () => {
  assert.equal(formatDuration(0), '0:00')
  assert.equal(formatDuration(9), '0:09')
  assert.equal(formatDuration(65), '1:05')
  assert.equal(formatDuration(300), '5:00')
  assert.equal(formatDuration(null), '0:00')
})

test('mediaPathFor follows the bucket policy shape channel/athlete/file', () => {
  const p = mediaPathFor('chan-1', 'user-2', 'jpg')
  const parts = p.split('/')
  assert.equal(parts.length, 3)
  assert.equal(parts[0], 'chan-1')
  assert.equal(parts[1], 'user-2')
  assert.ok(parts[2].endsWith('.jpg'))
})

test('audioExtForMime maps recorder mime types to extensions', () => {
  assert.equal(audioExtForMime('audio/webm;codecs=opus'), 'webm')
  assert.equal(audioExtForMime('audio/mp4'), 'm4a')
  assert.equal(audioExtForMime('audio/ogg;codecs=opus'), 'ogg')
  assert.equal(audioExtForMime(''), 'webm')
})

test('pickAudioMime returns the first supported candidate', () => {
  const picked = pickAudioMime(AUDIO_MIME_CANDIDATES, m => m === 'audio/mp4')
  assert.equal(picked, 'audio/mp4')
  assert.equal(pickAudioMime(AUDIO_MIME_CANDIDATES, () => false), '')
  assert.equal(pickAudioMime(AUDIO_MIME_CANDIDATES, () => { throw new Error('x') }), '')
})

test('voice note cap is five minutes', () => {
  assert.equal(VOICE_NOTE_MAX_S, 300)
})
