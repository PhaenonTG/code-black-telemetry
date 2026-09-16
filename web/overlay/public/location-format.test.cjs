'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { usStateAbbreviation } = require('./location-format.js');

// Regression matrix for the "Topeka, KA" bug: state.slice(0,2).toUpperCase() applied to a
// full state name. Every one of these collides badly under a first-two-letters heuristic.
const CASES = [
  ['Kansas', 'KS'],
  ['Arkansas', 'AR'],
  ['Oklahoma', 'OK'],
  ['Missouri', 'MO'],
  ['Alabama', 'AL'],
  ['Alaska', 'AK'],
];

for (const [full, expected] of CASES) {
  test(`usStateAbbreviation: "${full}" -> "${expected}"`, () => {
    assert.equal(usStateAbbreviation(full, null), expected);
  });
}

test('usStateAbbreviation: prefers an authoritative ISO3166-2 code over name-matching', () => {
  assert.equal(usStateAbbreviation('Kansas', 'US-KS'), 'KS');
  // Even a wrong/mismatched name is overridden by the authoritative code, since the code is
  // the more trustworthy signal per the documented precedence.
  assert.equal(usStateAbbreviation('Some Weird Label', 'US-OK'), 'OK');
});

test('usStateAbbreviation: an already-valid 2-letter code is preserved, not re-derived', () => {
  assert.equal(usStateAbbreviation('ks', null), 'KS');
  assert.equal(usStateAbbreviation('KS', null), 'KS');
});

test('usStateAbbreviation: unmapped/unknown region name returns null, never a guessed fragment', () => {
  assert.equal(usStateAbbreviation('Some Made Up Region', null), null);
  assert.equal(usStateAbbreviation(null, null), null);
  assert.equal(usStateAbbreviation('', null), null);
});

test('usStateAbbreviation: never derives via slice/substring/first-two-letters (regression guard)', () => {
  // The exact bug class: "Kansas".slice(0,2).toUpperCase() = "KA", not the real code "KS".
  // Several other states coincidentally collide with their own correct code under this
  // heuristic (Arkansas/AR, Oklahoma/OK, Alabama/AL, Missouri/MO) and can't demonstrate the
  // bug -- Kansas can, and proves a reintroduced slice(0,2) shortcut would be caught here.
  const wrong = 'Kansas'.slice(0, 2).toUpperCase();
  assert.notEqual(usStateAbbreviation('Kansas', null), wrong);
});
