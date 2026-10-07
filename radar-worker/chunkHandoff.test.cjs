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
