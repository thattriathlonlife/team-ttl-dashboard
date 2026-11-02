import { test } from 'node:test'
import assert from 'node:assert/strict'
import { raceChannelKind, isRaceChannel, isTeamOnlyChannel, raceChannelType, raceChannelAudience, shortRaceName, channelDisplayName, channelAccessLabel } from '../src/lib/channels.js'
import { normalizeText, findSevereTerm, shouldHide, moderateOutgoing } from '../src/lib/moderation.js'
import { isTeamTier } from '../src/lib/tier.js'

// ── channels.js ──
test('canonical types classify', () => {
  assert.equal(raceChannelKind({ type: 'race_discussion' }), 'discussion')
  assert.equal(raceChannelKind({ type: 'race_logistics' }), 'logistics')
})
test('legacy suffix encoding classifies', () => {
  assert.equal(raceChannelKind({ type: 'race', name: 'ironman-texas-discussion' }), 'discussion')
  assert.equal(raceChannelKind({ type: 'race', name: 'ironman-texas-logistics' }), 'logistics')
})
test('unsuffixed legacy race channel is logistics (team history)', () => {
  assert.equal(raceChannelKind({ type: 'race', name: 'ironman-texas' }), 'logistics')
})
test('audience field wins over suffix when race-linked', () => {
  assert.equal(raceChannelKind({ race_id: 'r1', type: 'race', name: 'x-discussion', audience: 'team' }), 'logistics')
  assert.equal(raceChannelKind({ race_id: 'r1', type: 'race', name: 'x-logistics', audience: 'public' }), 'discussion')
})
test('non-race channel has no kind', () => {
  assert.equal(raceChannelKind({ type: 'text', category: 'general', name: 'general' }), null)
  assert.equal(raceChannelKind(null), null)
  assert.equal(isRaceChannel({ type: 'text', category: 'general' }), false)
})
test('team-only rules', () => {
  assert.equal(isTeamOnlyChannel({ type: 'dm' }), true)
  assert.equal(isTeamOnlyChannel({ type: 'race', name: 'x-logistics' }), true)
  assert.equal(isTeamOnlyChannel({ type: 'race', name: 'x-discussion' }), false)
  assert.equal(isTeamOnlyChannel({ type: 'text', category: 'training' }), true)
})
test('type/audience helpers round-trip', () => {
  assert.equal(raceChannelType('discussion'), 'race_discussion')
  assert.equal(raceChannelType('logistics'), 'race_logistics')
  assert.equal(raceChannelAudience('discussion'), 'public')
  assert.equal(raceChannelAudience('logistics'), 'team')
})
test('display names', () => {
  assert.equal(shortRaceName('Ironman 70.3 Texas'), 'Texas')
  assert.equal(shortRaceName('Ironman Texas'), 'Texas')
  assert.equal(channelDisplayName({ type: 'race', name: 'ironman-texas-discussion', races: { name: 'Ironman Texas' } }), 'Texas · Discussion')
  assert.equal(channelAccessLabel({ type: 'race', name: 'x-logistics' }), 'Team logistics')
  assert.equal(channelAccessLabel({ type: 'race', name: 'x-discussion' }), 'Public discussion')
})

// ── moderation.js: the 13 known cases ──
test('mod 1: plain message allowed', () => assert.equal(moderateOutgoing('Great ride today!').action, 'allow'))
test('mod 2: severe term blocked', () => assert.equal(moderateOutgoing('that was fucked').action, 'block'))
test('mod 3: censored form blocked (f*ck -> fck)', () => assert.equal(moderateOutgoing('f*ck this').action, 'block'))
test('mod 4: leetspeak blocked', () => assert.equal(moderateOutgoing('sh1t day').action, 'block'))
test('mod 5: innocent trap — cocktail allowed', () => assert.equal(moderateOutgoing('cocktail party after the race').action, 'allow'))
test('mod 6: innocent trap — shiitake allowed', () => assert.equal(moderateOutgoing('shiitake mushrooms for dinner').action, 'allow'))
test('mod 7: innocent trap — class/grape substrings allowed', () => {
  assert.equal(moderateOutgoing('first class effort, grape job').action, 'allow')
  assert.equal(moderateOutgoing('see you in Scunthorpe').action, 'allow')
})
test('mod 8: render-time hide on severe', () => { assert.equal(shouldHide('bullshit'), true); assert.equal(shouldHide('nice work'), false) })
test('mod 9: spam links+phrase blocked', () => assert.equal(moderateOutgoing('https://a.com https://b.com crypto giveaway now').action, 'block'))
test('mod 10: three links blocked even without spam phrase', () => assert.equal(moderateOutgoing('https://a.com https://b.com https://c.com').action, 'block'))
test('mod 11: repeat flood blocked', () => assert.equal(moderateOutgoing('same post', { recentMine: ['same post', 'same post'] }).action, 'block'))
test('mod 12: caps warning still sends', () => assert.equal(moderateOutgoing('THIS IS A VERY LONG SHOUTY MESSAGE INDEED').action, 'warn'))
test('mod 13: mass mention warning', () => assert.equal(moderateOutgoing('hey all', { mentionCount: 5 }).action, 'warn'))
test('normalizeText strips accents and case', () => assert.equal(normalizeText('  Café FUCK  '), 'cafe fuck'))
test('findSevereTerm returns the term', () => assert.equal(findSevereTerm('what the fuck'), 'fuck'))

// ── tier.js ──
test('entitled profile is team tier', () => assert.equal(isTeamTier({ team_entitled: true }), true))
test('no profile falls back to demo tier default (team in node, no localStorage)', () => assert.equal(isTeamTier(null), true))
test('non-entitled profile uses demo tier default', () => assert.equal(isTeamTier({ team_entitled: false }), true))
