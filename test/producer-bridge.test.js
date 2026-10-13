'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProducerBridgeClient, endpoint } = require('../producer-bridge');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('native bridge emits composition status and JPEG headers only for the matching captured frame', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeblack-header-test-'));
  const directory = path.join(root, 'runtime', 'previews', 'program'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'latest.jpg'), Buffer.from([255,216,255,217]));
  const id = 'a'.repeat(24);
  const status = { stateRevision: 1, recording: { requested: true, writeToDisk: false }, source_state: 'SOURCE_LIVE', previews: { program: { state: 'ACTIVE', frameCompositionId: id } }, composition: { id }, formats: { program: { width: 1920, height: 1080 } } };
  const engine = { status: () => status, producerCommands: { capabilities: () => ({ actions: { composition: ['overlay.set'] } }) } };
  const bridge = new ProducerBridgeClient(engine, root, { endpoint: 'https://ops.codeblackwx.com/api/producer/v1' }, { load: () => 'x'.repeat(48) });
  const requests = []; bridge.request = async (route, init) => { requests.push({ route, init }); return new Response(null, { status: 202 }); };
  assert.equal(bridge.safeStatus().composition.id, id);
  assert.equal(bridge.safeStatus().formats.program.width, 1920);
  status.previews.program.frameCompositionId = 'b'.repeat(24);
  await bridge.pushFrame(); assert.equal(requests.length, 0);
  status.previews.program.frameCompositionId = id;
  await bridge.pushFrame(); assert.equal(requests[0].init.headers['X-Producer-Composition'], id);
});

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
