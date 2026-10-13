'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hlsArgs, prunePreviewSegments } = require('../milestone2');
const { ProducerBridgeClient } = require('../producer-bridge');
const { ProgramMediaUploader, programSegments } = require('../program-monitor');

const name = `program-${'a'.repeat(32)}-0000000000.ts`;
function fixture(request = async () => new Response(null, { status: 202 })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeblack-monitor-test-'));
  const dir = path.join(root, 'runtime', 'previews', 'program'); fs.mkdirSync(dir, { recursive: true });
  const manifest = `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1.000000,\n${name}\n`;
  fs.writeFileSync(path.join(dir, 'index.m3u8'), manifest);
  fs.writeFileSync(path.join(dir, name), Buffer.alloc(188, 0x47));
  const status = { source_state: 'SOURCE_LIVE', previews: { program: { state: 'ACTIVE' } }, metrics: { last_video_timestamp: new Date().toISOString() } };
  return { root, dir, manifest, status, uploader: new ProgramMediaUploader(root, () => status, request) };
}
test('PROGRAM preview carries AAC while CLEAN remains video-only; restart filenames are unique', () => {
  const { dir } = fixture();
  const program = hlsArgs('ffmpeg', 'input.mp4', dir, true, 'null');
  const clean = hlsArgs('ffmpeg', 'input.mp4', dir, false, 'null');
  assert.ok(program.includes('aac')); assert.ok(program.includes('0:a?')); assert.ok(!program.includes('-an'));
  assert.ok(clean.includes('-an')); assert.ok(!clean.includes('aac'));
  const filename = args => args[args.indexOf('-hls_segment_filename') + 1];
  assert.notEqual(filename(program), filename(hlsArgs('ffmpeg', 'input.mp4', dir, true, 'null')));
});
test('uploader sends completed segments before the manifest and never repeats an unchanged playlist', async () => {
  const requests = [];
  const { uploader } = fixture(async (route, init) => { requests.push({ route, init }); return new Response(null, { status: 202 }); });
  await uploader.cycle(); await uploader.cycle();
  assert.equal(requests.length, 2);
  assert.match(requests[0].route, /\.ts$/); assert.match(requests[1].route, /index\.m3u8$/);
  assert.equal(requests[0].init.headers['Content-Type'], 'video/mp2t');
  assert.equal(uploader.status().state, 'CURRENT');
});

test('native uploader stamps the actual composition and refuses mismatched generations', async () => {
  const requests = [];
  const { uploader, status } = fixture(async (route, init) => { requests.push({ route, init }); return new Response(null, { status: 202 }); });
  const id = 'b'.repeat(24);
  status.composition = { id };
  status.previews.program.compositionId = 'c'.repeat(24);
  await uploader.cycle(); assert.equal(requests.length, 0);
  status.previews.program.compositionId = id;
  status.previews.program.generation = 'c'.repeat(32);
  await uploader.cycle(); assert.equal(requests.length, 0);
  status.previews.program.generation = 'a'.repeat(32);
  await uploader.cycle();
  assert.equal(requests.at(-1).init.headers['X-Producer-Composition'], id);
  assert.equal(uploader.status().compositionId, id);
  status.composition.id = 'd'.repeat(24);
  await uploader.cycle(); assert.equal(uploader.status().state, 'WAITING_FOR_COMPOSITION');
});
test('source loss, old video evidence and old manifests never upload cached media', async () => {
  let calls = 0; const { uploader, status, dir } = fixture(async () => { calls++; });
  status.source_state = 'SOURCE_LOST'; await uploader.cycle(); assert.equal(calls, 0);
  status.source_state = 'SOURCE_LIVE'; status.metrics.last_video_timestamp = new Date(Date.now() - 10000).toISOString(); await uploader.cycle(); assert.equal(calls, 0);
  status.metrics.last_video_timestamp = new Date().toISOString(); const old = new Date(Date.now() - 10000); fs.utimesSync(path.join(dir, 'index.m3u8'), old, old); await uploader.cycle(); assert.equal(calls, 0);
});
test('an upload failure is contained and cannot throw into the command loop', async () => {
  const { uploader } = fixture(async () => { throw new Error('srt://secret-private-endpoint'); });
  await uploader.cycle();
  assert.equal(uploader.running, false); assert.equal(uploader.status().state, 'UNAVAILABLE');
  assert.ok(!JSON.stringify(uploader.status()).includes('secret-private-endpoint'));
});
test('untrusted filenames and ended manifests are never uploaded', () => {
  assert.equal(programSegments('#EXTM3U\n../secret.ts\n'), null);
  assert.equal(programSegments('#EXTM3U\nhttps://evil.test/video.ts\n'), null);
  assert.equal(programSegments(`#EXTM3U\n${name}\n#EXT-X-ENDLIST\n`), null);
});
test('media work never blocks the independent command cycle and remains opt-in', async () => {
  const client = new ProducerBridgeClient({}, '.', { endpoint: 'https://ops.codeblackwx.com/api/producer/v1', programMonitorEnabled: true });
  let commands = 0; client.cycle = async () => { commands++; };
  client.media.cycle = () => new Promise(() => {});
  try { client.start(); await client.cycle(); assert.equal(commands, 2); assert.ok(client.mediaTimer); } finally { client.stop(); }
  const disabled = new ProducerBridgeClient({}, '.', { endpoint: 'https://ops.codeblackwx.com/api/producer/v1' });
  disabled.cycle = async () => {};
  try { disabled.start(); assert.equal(disabled.mediaTimer, null); assert.equal(disabled.status().programMonitor.enabled, false); } finally { disabled.stop(); }
});
test('preview cleanup touches only expired generated TS files, never archives or other files', () => {
  const { dir } = fixture(); const old = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(dir, name), old, old);
  const protectedFile = path.join(dir, 'archive.mkv'); fs.writeFileSync(protectedFile, 'keep'); fs.utimesSync(protectedFile, old, old);
  prunePreviewSegments(dir, 'program');
  assert.equal(fs.existsSync(path.join(dir, name)), false); assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'keep');
});
