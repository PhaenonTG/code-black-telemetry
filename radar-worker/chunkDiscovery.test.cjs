const { test } = require('node:test');
const assert = require('node:assert/strict');
const { discoverLatestChunkVolume: discover } = require('./chunkDiscovery.cjs');
const bucket = 'https://example.invalid';
const xml = (keys, more = '') => `<ListBucketResult>${keys.map(k => `<Key>KSRX/${k}</Key>`).join('')}<IsTruncated>${!!more}</IsTruncated>${more ? `<NextContinuationToken>${more}</NextContinuationToken>` : ''}</ListBucketResult>`;
test('selects current scan past gaps, not old folder 542', async () => {
  assert.equal(await discover('KSRX', async () => xml(['542/20261005-092944-1-S','939/20261007-225530-1-S']), bucket), 939);
});
test('timestamp order survives volume rollover and lexical ordering', async () => {
  assert.equal(await discover('KSRX', async () => xml(['999/20261007-220000-1-S','1/20261007-230000-1-S']), bucket), 1);
});
test('paginates and decodes continuation token without returning early', async () => {
  let calls = 0;
  const result = await discover('KSRX', async url => {
    if (++calls === 1) return xml(['939/20261007-220000-1-S'], 'a&amp;b');
    assert.equal(new URL(url).searchParams.get('continuation-token'), 'a&b');
    return xml(['940/20261007-230000-1-S']);
  }, bucket);
  assert.equal(result, 940); assert.equal(calls, 2);
});
test('fails closed for empty, malformed, failed or looping listings', async () => {
  for (const body of [xml([]), '<html>error</html>', xml([], 'same')]) await assert.rejects(discover('KSRX', async () => body, bucket));
  await assert.rejects(discover('KSRX', async () => {throw Error('offline');}, bucket), /offline/);
});
test('bounds scan deadline', async () => {
  let now = 0;
  await assert.rejects(discover('KSRX', async () => {now = 61000; return xml([], 'next');}, bucket, () => now), /deadline/);
});
