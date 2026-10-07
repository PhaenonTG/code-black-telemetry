const { test } = require('node:test');
const assert = require('node:assert/strict');
const worker = require('./worker.cjs');
for (const sawE of [true, false]) test(`recovers ${sawE ? 'completed' : 'stalled incomplete'} scan across a gap`, async () => {
  const original = worker.discoverLatestChunkVolume, fetchOriginal = global.fetch;
  worker._resetChunkState();
  worker.chunkVolumeState.set('KSRX', { volumeNum: 542, chunks: new Map(), newestChunkTime: '2026-01-01T00:00:00Z', sawE, lastAdvanceAt: 0, lastDiscoveryAt: 0, lastDecodedChunkCount: 0, trustworthyEmitted: new Set() });
  let discoveries = 0;
  worker.discoverLatestChunkVolume = async () => { discoveries++; return 939; };
  global.fetch = async () => ({ok:true, text: async () => '<ListBucketResult></ListBucketResult>'});
  try {
    await worker.advanceChunkAssembly('KSRX');
    assert.equal(discoveries, 1);
    assert.equal(worker.chunkVolumeState.get('KSRX').volumeNum, 939);
    assert.equal(worker.frames.size, 0, 'must not publish unverified frames');
  } finally { worker.discoverLatestChunkVolume = original; global.fetch = fetchOriginal; worker._resetChunkState(); }
});
test('a failed completed-scan download remains retryable', async () => {
  const savedFetch = global.fetch;
  worker._resetChunkState();
  const now = Date.now();
  worker.chunkVolumeState.set('KSRX', {volumeNum:939,chunks:new Map(),newestChunkTime:new Date(now).toISOString(),sawE:false,lastAdvanceAt:0,lastDiscoveryAt:now,lastDecodedChunkCount:0,trustworthyEmitted:new Set()});
  let downloads = 0;
  global.fetch = async url => {
    if (String(url).includes('?')) return {ok:true,text:async()=>String(url).includes('940') ? '<ListBucketResult/>' : `<Contents><Key>KSRX/939/20261007-225500-1-E</Key><LastModified>${new Date(now).toISOString()}</LastModified><Size>10</Size></Contents>`};
    downloads++; throw Error('simulated download failure');
  };
  try {
    await worker.advanceChunkAssembly('KSRX');
    assert.equal(worker.chunkVolumeState.get('KSRX').lastDecodedChunkCount,0);
    worker.chunkVolumeState.get('KSRX').lastAdvanceAt=0;
    await worker.advanceChunkAssembly('KSRX');
    assert.equal(downloads,2);
  } finally {global.fetch=savedFetch;worker._resetChunkState();}
});
