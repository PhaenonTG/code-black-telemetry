'use strict';

const COMMAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ProducerCommands {
  constructor(engine, now = () => Date.now()) {
    this.engine = engine;
    this.now = now;
    this.completed = new Map();
    this.ttlMs = 10 * 60 * 1000;
  }

  capabilities() {
    return {
      schemaVersion: '1.0.0',
      actions: {
        source: [],
        preview: ['start', 'stop'],
        composition: ['lowerThird.set', 'lowerThird.hide'],
        facebook: ['output.start', 'output.stop'],
        archive: ['camera.start', 'camera.stop'],
        camera360: [],
      },
      unavailable: {
        'facebook.publish': 'Use Facebook Live Producer until server-side Meta publishing is qualified.',
        'facebook.end': 'Use Facebook Live Producer until server-side Meta publishing is qualified.',
        camera360: 'The Insta360 control SDK is not connected to Native Broadcaster yet.',
      },
    };
  }

  prune() {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, entry] of this.completed) if (entry.completedAt < cutoff) this.completed.delete(id);
  }

  execute(command) {
    this.prune();
    if (!command || typeof command !== 'object') throw this.error(400, 'command must be an object');
    if (!COMMAND_ID.test(command.commandId || '')) throw this.error(400, 'commandId must be a UUID');
    const prior = this.completed.get(command.commandId);
    const digest = JSON.stringify({ action: command.action, payload: command.payload || {} });
    if (prior) {
      if (prior.digest !== digest) throw this.error(409, 'COMMAND_ID_CONFLICT');
      return { ...prior.result, duplicate: true };
    }
    if (!Number.isSafeInteger(command.expectedStateRevision)) throw this.error(400, 'expectedStateRevision is required');
    if (command.createdAt && (!Number.isFinite(Date.parse(command.createdAt)) || this.now() - Date.parse(command.createdAt) > 15000)) throw this.error(409, 'COMMAND_EXPIRED');
    const stop = ['preview.stop', 'facebook.output.stop', 'archive.camera.stop'].includes(command.action);
    if (!stop && command.expectedStateRevision !== this.engine.stateRevision) throw this.error(409, 'STATE_CHANGED');

    let detail;
    switch (command.action) {
      case 'preview.start': detail = this.engine.startRecording(); break;
      case 'preview.stop': detail = this.engine.stopRecording(); break;
      case 'facebook.output.start': detail = this.engine.broadcastStart(); break;
      case 'facebook.output.stop': detail = this.engine.broadcastStop(); break;
      case 'archive.camera.start': detail = this.engine.cleanSink.start(); break;
      case 'archive.camera.stop': detail = this.engine.cleanSink.stop(); break;
      case 'lowerThird.set': {
        const text = command.payload?.text;
        if (typeof text !== 'string' || !text.trim() || text.length > 120) throw this.error(400, 'lower third text must be 1-120 characters');
        detail = this.engine.setOverlays({ lowerThird: { enabled: true, text: text.trim() } });
        break;
      }
      case 'lowerThird.hide': detail = this.engine.setOverlays({ lowerThird: { enabled: false } }); break;
      case 'facebook.publish':
      case 'facebook.end': throw this.error(409, 'META_PUBLISHING_NOT_QUALIFIED');
      default: throw this.error(400, 'unsupported producer action');
    }

    const result = { commandId: command.commandId, action: command.action, state: 'succeeded', stateRevision: this.engine.stateRevision, detail };
    this.completed.set(command.commandId, { completedAt: this.now(), result, digest });
    return result;
  }

  error(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }
}

module.exports = { ProducerCommands };
