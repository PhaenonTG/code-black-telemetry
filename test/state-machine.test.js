'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STATES, Broadcaster, safeError } = require('../native-broadcaster.js');

test('explicit Native Broadcaster states include source loss and reconnect', () => {
  for (const state of ['STANDBY', 'SOURCE_CONNECTING', 'SOURCE_LIVE', 'SOURCE_LOST', 'RECONNECTING', 'ERROR']) {
    assert.equal(typeof STATES[state], 'string');
  }
});

test('diagnostics redact SRT endpoint material', () => {
  assert.equal(safeError('failed srt://host:8890?streamid=read:nick'), 'failed [stream endpoint redacted]');
});

test('field preview can encode without consuming disk for a PROGRAM archive', () => {
  const engine = new Broadcaster({
    source: { endpoint: 'srt://example.invalid:8890?streamid=read:test', width: 1920, height: 1080, fps: 30 },
    encoder: { codec: 'h264_nvenc', bitrateKbps: 6000, keyframeSeconds: 2, preset: 'p5', tune: 'hq', profile: 'high', lookahead: false, spatialAq: true, bFrames: 2 },
    recording: { directory: 'recordings', writeToDisk: false },
  });

  const args = engine.sourceArgs();
  assert.deepEqual(args.slice(-3), ['-f', 'null', 'NUL']);
  assert.equal(engine.status().recording.writeToDisk, false);
  assert.equal(engine.status().recording.activeFile, null);
});
