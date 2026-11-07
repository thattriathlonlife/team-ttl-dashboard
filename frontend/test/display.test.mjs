import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStandaloneDisplay, defaultAuthMode } from '../src/lib/display.js'

test('standalone when the display-mode media matches (Android/desktop PWA)', () => {
  assert.equal(isStandaloneDisplay({ mediaStandalone: true }), true)
})

test('standalone when iOS navigator.standalone is set', () => {
  assert.equal(isStandaloneDisplay({ iosStandalone: true }), true)
})

test('not standalone in a plain browser tab', () => {
  assert.equal(isStandaloneDisplay({ mediaStandalone: false, iosStandalone: false }), false)
  assert.equal(isStandaloneDisplay(), false)
})

test('installed app defaults to the email-code tab; browser keeps password', () => {
  assert.equal(defaultAuthMode(true), 'code')
  assert.equal(defaultAuthMode(false), 'password')
})
