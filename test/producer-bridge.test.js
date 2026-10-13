'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProducerBridgeClient, endpoint } = require('../producer-bridge');

test('bridge accepts only the fixed OPS HTTPS producer endpoint', () => {
  assert.equal(endpoint('https://ops.codeblackwx.com/api/producer/v1'), 'https://ops.codeblackwx.com/api/producer/v1');
  assert.throws(() => endpoint('http://ops.codeblackwx.com/api/producer/v1'));
  assert.throws(() => endpoint('https://evil.example/api/producer/v1'));
});

test('bridge status payload excludes local files and source endpoints', () => {
  const engine = { status: () => ({ stateRevision: 2, state: 'STANDBY', stateReason: 'ready', source_state: 'WAITING_FOR_SOURCE', transport_state: 'DISCONNECTED', recording: { requested: false, writeToDisk: false, activeFile: 'secret.mkv' }, previews: {}, audio: {}, metrics: {}, broadcast: {}, overlays: {}, source: { endpoint: 'secret' } }) };
  const bridge = new ProducerBridgeClient(engine, '.', { endpoint: 'https://ops.codeblackwx.com/api/producer/v1' }, { fetch: async () => new Response('{}'), load: () => 'x'.repeat(48) });
  const payload = bridge.safeStatus();
  assert.equal(JSON.stringify(payload).includes('secret'), false);
  assert.deepEqual(payload.recording, { requested: false, writeToDisk: false });
});
