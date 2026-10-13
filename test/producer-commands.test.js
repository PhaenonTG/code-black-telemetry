'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProducerCommands } = require('../producer-commands');

function fixture() {
  const calls = [];
  const engine = {
    stateRevision: 7,
    startRecording: () => { calls.push('preview.start'); engine.stateRevision++; return { changed: true }; },
    stopRecording: () => { calls.push('preview.stop'); engine.stateRevision++; return { changed: true }; },
    broadcastStart: () => { calls.push('facebook.output.start'); engine.stateRevision++; return { changed: true }; },
    broadcastStop: () => { calls.push('facebook.output.stop'); engine.stateRevision++; return { changed: true }; },
    setOverlays: (value) => { calls.push(value); engine.stateRevision++; return value; },
    cleanSink: {
      start: () => { calls.push('archive.camera.start'); engine.stateRevision++; return { changed: true }; },
      stop: () => { calls.push('archive.camera.stop'); engine.stateRevision++; return { changed: true }; },
    },
  };
  return { engine, calls, commands: new ProducerCommands(engine) };
}

test('reports only capabilities currently implemented by Native Broadcaster', () => {
  const { commands } = fixture();
  const capabilities = commands.capabilities();
  assert.deepEqual(capabilities.actions.facebook, ['output.start', 'output.stop']);
  assert.deepEqual(capabilities.actions.camera360, []);
  assert.match(capabilities.unavailable['facebook.publish'], /Facebook Live Producer/);
});

test('executes a command once and returns the prior result for a duplicate command ID', () => {
  const { commands, calls } = fixture();
  const command = { commandId: '2bd3ed52-786b-4ead-a77a-a6438fd9b772', expectedStateRevision: 7, action: 'preview.start' };
  const first = commands.execute(command);
  const duplicate = commands.execute(command);
  assert.equal(first.state, 'succeeded');
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(calls, ['preview.start']);
});

test('rejects a command made against stale producer state', () => {
  const { commands } = fixture();
  assert.throws(
    () => commands.execute({ commandId: '827f4148-0a4b-4bb9-b9be-ff42ac237ebd', expectedStateRevision: 6, action: 'preview.start' }),
    (error) => error.statusCode === 409 && error.message === 'STATE_CHANGED',
  );
});

test('refuses unqualified Facebook publish and validates lower-third text', () => {
  const { commands } = fixture();
  assert.throws(
    () => commands.execute({ commandId: '5c15afee-159e-41c4-b8bf-0aa90eb7e850', expectedStateRevision: 7, action: 'facebook.publish' }),
    (error) => error.statusCode === 409 && error.message === 'META_PUBLISHING_NOT_QUALIFIED',
  );
  assert.throws(
    () => commands.execute({ commandId: '076b2357-4bce-412b-abec-fbc9cc76af59', expectedStateRevision: 7, action: 'lowerThird.set', payload: { text: '' } }),
    (error) => error.statusCode === 400,
  );
});

test('emergency stop bypasses stale revision but expired commands never execute', () => {
  const { commands, calls } = fixture();
  const command = { commandId: '067169a4-52c0-4d08-8d7f-638e93ee8451', expectedStateRevision: 0, action: 'facebook.output.stop' };
  assert.equal(commands.execute(command).state, 'succeeded');
  assert.deepEqual(calls, ['facebook.output.stop']);
  assert.throws(() => commands.execute({ ...command, action: 'preview.start' }), /COMMAND_ID_CONFLICT/);
  assert.throws(() => commands.execute({ ...command, commandId: '338274ab-bf75-4f45-8b56-ed5b70d562b5', createdAt: new Date(Date.now() - 20000).toISOString() }), /COMMAND_EXPIRED/);
});
