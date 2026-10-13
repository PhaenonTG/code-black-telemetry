'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { html } = require('../producer-ui');

test('producer does not present cached snapshots while preview is stopped', () => {
  const page = html();

  assert.match(page, /PREVIEW STOPPED/);
  assert.match(page, /recording&&meta\.state==='ACTIVE'&&sourceState==='SOURCE_LIVE'/);
  assert.match(page, /image\.removeAttribute\('src'\)/);
  assert.doesNotMatch(page, /<img[^>]+src=/);
});
