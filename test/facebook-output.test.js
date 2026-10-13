'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { EventEmitter } = require('events');
const { FacebookOutput, facebookTarget, redact } = require('../facebook-output');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codeblack-fb-test-'));
  fs.mkdirSync(path.join(root, 'runtime'));
  const engine = { config: { productionBroadcastEnabled: true, source: { width: 1920, height: 1080, fps: 30, endpoint: 'srt://private/read' } }, sourceState: 'SOURCE_LIVE', ffmpeg: 'test', overlayFilter: () => 'null', encoderArgs: () => [], logger: { write() {} } };
  engine.recordingRequested = true;
  engine.videoAgeMs = () => 100;
  engine.audioProbe = { status: () => ({ process: 'RUNNING', available: true, silence: false, clipping: false, lastAudioAt: new Date().toISOString() }) };
  let proc;
  const output = new FacebookOutput(engine, root, { obsRunning: () => false, load: () => facebookTarget('rtmps://live-api-s.facebook.com:443/rtmp/', 'a'.repeat(48)), spawn: () => {
    proc = new EventEmitter(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
    proc.kill = () => { proc.emit('close', 0); }; proc.pid = 1234; return proc;
  } });
  return { root, engine, output, process: () => proc };
}

test('Facebook destinations reject unencrypted or foreign servers and malformed keys', () => {
  for (const server of ['rtmp://live-api-s.facebook.com/rtmp/', 'rtmps://evil.example/rtmp/', 'rtmps://live-api-s.facebook.com/other/']) assert.throws(() => facebookTarget(server, 'a'.repeat(48)));
  assert.throws(() => facebookTarget('rtmps://live-api-s.facebook.com/rtmp/', 'bad key\n'));
  assert.equal(redact('failed rtmps://live-api-s.facebook.com/rtmp/SECRET'), 'failed [stream endpoint redacted]');
});

test('output refuses absent source and never acquires the production lock', () => {
  const { engine, output } = setup(); engine.sourceState = 'SOURCE_LOST';
  assert.throws(() => output.start(), /fresh Nick video/);
  assert.equal(fs.existsSync(output.lockFile), false);
});
test('OBS ownership guard remains enforced independently of output tests', () => {
  const { output } = setup(); output.obsRunning = () => true;
  assert.throws(() => output.start(), /Close OBS/);
  assert.equal(fs.existsSync(output.lockFile), false);
});

test('fragmented progress updates require advancing frames; stop releases only its own lock', () => {
  const { output, process: proc } = setup();
  output.start(); assert.equal(output.state, 'CONNECTING');
  output.consume('fra'); output.consume('me=12\nbitrate=6000kbits/s\n');
  assert.equal(output.state, 'SENDING'); assert.equal(output.lastFrame, 12);
  const last = output.lastSuccessAt; output.consume('frame=12\n'); assert.equal(output.lastSuccessAt, last);
  assert.ok(fs.existsSync(output.lockFile));
  proc().stderr.write('failed rtmps://live-api-s.facebook.com/rtmp/SECRET\n');
  assert.equal(output.status().lastError.includes('SECRET'), false);
  output.stop(); assert.equal(output.state, 'OFF'); assert.equal(fs.existsSync(output.lockFile), false);
});

test('a second active owner is refused and its lock survives', () => {
  const { output } = setup();
  fs.writeFileSync(output.lockFile, JSON.stringify({ pid: process.pid, ownerId: 'another-owner' }));
  assert.throws(() => output.start(), /already owned/);
  output.stop();
  assert.equal(JSON.parse(fs.readFileSync(output.lockFile)).ownerId, 'another-owner');
});

test('Facebook start refuses stale video and unhealthy audio', () => {
  const { engine, output } = setup();
  engine.videoAgeMs = () => 9000;
  assert.throws(() => output.start(), /healthy audio/);
  engine.videoAgeMs = () => 100;
  engine.audioProbe.status = () => ({ available: true, process: 'RUNNING', silence: true, lastAudioAt: new Date().toISOString() });
  assert.throws(() => output.start(), /healthy audio/);
  assert.equal(fs.existsSync(output.lockFile), false);
});

test('managed destinations never appear in status and cannot change while sending', () => {
  const { output } = setup();
  const destination = facebookTarget('rtmps://live-api-s.facebook.com:443/rtmp/', 'a'.repeat(48));
  output.setManagedDestination({ destination, videoId: '123456789012345' });
  assert.equal(output.destination(), destination);
  assert.equal(output.status().managedVideoId, '123456789012345');
  assert.equal(JSON.stringify(output.status()).includes(destination), false);
  assert.throws(() => output.setManagedDestination({ destination: destination.replace('facebook.com', 'evil.test'), videoId: '123456789012345' }));
  output.start();
  assert.throws(() => output.setManagedDestination({ destination, videoId: '999999999999999' }), /Stop output/);
  output.setManagedDestination({ destination: null });
  assert.equal(output.requested, false);
  assert.equal(output.state, 'OFF');
  assert.equal(output.managedVideoId, null);
});
