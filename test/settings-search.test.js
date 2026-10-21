'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matches, filterSections } = require('../src/renderer/settings-search');

test('matches: every word of the search, in any order, ignoring case and accents', () => {
  assert.equal(matches('Remove filler words um, uh', 'filler'), true);
  assert.equal(matches('Remove filler words um, uh', 'WORDS remove'), true);
  assert.equal(matches('Remove filler words', 'filler cloud'), false);
  assert.equal(matches('Prepoznavanje govora', 'govora'), true);
  assert.equal(matches('Ključ je šifriran', 'kljuc sifriran'), true, 'Croatian without the accents');
  assert.equal(matches('anything', '   '), true, 'an empty search shows everything');
});

test('filterSections: a section stays when its title matches (all its rows) or when some of its rows match', () => {
  const sections = [
    { title: 'Speech recognition', rows: ['Acceleration GPU', 'API key', 'Languages you speak'] },
    { title: 'Text', rows: ['Remove filler words', 'Capitalize sentences'] },
    { title: 'Privacy', rows: ['Transcript history', 'Delete all my data'] },
  ];
  assert.deepEqual(filterSections(sections, 'key'), [{ show: true, rows: [false, true, false] }, { show: false, rows: [false, false] }, { show: false, rows: [false, false] }]);
  assert.deepEqual(filterSections(sections, 'privacy'), [{ show: false, rows: [false, false, false] }, { show: false, rows: [false, false] }, { show: true, rows: [true, true] }]);
  assert.deepEqual(filterSections(sections, '').map((s) => s.show), [true, true, true]);
  assert.deepEqual(filterSections(sections, 'zzz').map((s) => s.show), [false, false, false]);
});
