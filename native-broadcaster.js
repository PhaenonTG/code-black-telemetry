'use strict';

// Code Black Native Broadcaster production engine.
// This service is intentionally separate from OBS and owns its Facebook output path.

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { enableMilestone2 } = require('./milestone2');
const { FacebookOutput } = require('./facebook-output');
const { html: producerHtml } = require('./producer-ui');
const { ProducerCommands } = require('./producer-commands');
const { ProducerBridgeClient } = require('./producer-bridge');

const ROOT = __dirname;
const CONFIG_PATH = process.env.CODEBLACK_NATIVE_CONFIG || path.join(ROOT, 'config.json');
const RUNTIME = path.join(ROOT, 'runtime');
const LOG_DIR = path.join(ROOT, 'logs');
const OUTPUT_LOCK = path.join(RUNTIME, 'production-output.lock');

const STATES = Object.freeze({
  STOPPED: 'STOPPED', STARTING: 'STARTING', STANDBY: 'STANDBY',
  SOURCE_CONNECTING: 'SOURCE_CONNECTING', SOURCE_LIVE: 'SOURCE_LIVE',
  SOURCE_STALE: 'SOURCE_STALE', SOURCE_LOST: 'SOURCE_LOST',
  OUTPUT_STARTING: 'OUTPUT_STARTING', BROADCASTING: 'BROADCASTING',
  RECONNECTING: 'RECONNECTING', ERROR: 'ERROR'
});

function ensureDirectory(dir) { fs.mkdirSync(dir, { recursive: true }); }
function iso() { return new Date().toISOString(); }
function safeError(value) {
  return String(value || '').replace(/(?:srt|rtmps?):\/\/[^\s'"\\]+/gi, '[stream endpoint redacted]');
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function resolveFfmpeg() {
  if (process.env.CODEBLACK_FFMPEG && fs.existsSync(process.env.CODEBLACK_FFMPEG)) return process.env.CODEBLACK_FFMPEG;
  const packages = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(packages)) {
    const packageDir = fs.readdirSync(packages).find((item) => item.startsWith('Gyan.FFmpeg_'));
    if (packageDir) {
      const candidates = [];
      const visit = (dir, depth) => {
        if (depth > 3) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isFile() && entry.name.toLowerCase() === 'ffmpeg.exe') candidates.push(full);
          if (entry.isDirectory()) visit(full, depth + 1);
        }
      };
      visit(path.join(packages, packageDir), 0);
      if (candidates.length) return candidates[0];
    }
  }
  return 'ffmpeg.exe';
}

class JsonLogger {
  constructor() {
    ensureDirectory(LOG_DIR);
    this.file = path.join(LOG_DIR, `native-broadcaster-${new Date().toISOString().slice(0, 10)}.jsonl`);
  }
  write(event, fields = {}) {
    const line = JSON.stringify({ timestamp: iso(), event, ...fields }, (_key, value) =>
      typeof value === 'string' ? safeError(value) : value);
    fs.appendFileSync(this.file, `${line}\n`, 'utf8');
  }
}

class Broadcaster {
  constructor(config) {
    this.config = config;
    this.ffmpeg = resolveFfmpeg();
    this.logger = new JsonLogger();
    this.state = STATES.STOPPED;
    this.stateReason = 'not started';
    this.stateAt = iso();
    this.process = null;
    this.processKind = null;
    this.recordingRequested = false;
    this.stopping = false;
    this.retryCount = 0;
    this.lastFrameAt = null;
    this.lastProgress = {};
    this.lastSourceFrame = 0;
    this.lastError = null;
    this.activeRecording = null;
    this.transition(STATES.STARTING, 'initializing native broadcaster');
    this.transition(STATES.STANDBY, 'ready; recording output is off');
  }

  transition(next, reason) {
    const previous = this.state;
    this.state = next;
    this.stateReason = reason;
    this.stateAt = iso();
    this.logger.write('state_transition', { previous, next, reason });
  }

  recordingDir() {
    const dir = path.resolve(ROOT, this.config.recording.directory);
    ensureDirectory(dir);
    return dir;
  }

  recordingFile(kind) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (this.session) return path.join(this.recordingDir(), `${stamp.slice(0, 10).replace(/-/g, '')}_${stamp.slice(11, 17).replace(/-/g, '')}_${this.session.vehicle}_${this.session.session_id}_${kind}.mkv`);
    return path.join(this.recordingDir(), `${stamp}-${kind}.mkv`);
  }

  encoderArgs() {
    const e = this.config.encoder;
    return [
      '-c:v', e.codec, '-preset', e.preset, '-tune', e.tune, '-rc', 'cbr',
      '-b:v', `${e.bitrateKbps}k`, '-maxrate', `${e.bitrateKbps}k`, '-bufsize', `${e.bitrateKbps * 2}k`,
      '-g', String(this.config.source.fps * e.keyframeSeconds), '-keyint_min', String(this.config.source.fps * e.keyframeSeconds),
      '-forced-idr', '1', '-profile:v', e.profile, '-rc-lookahead', e.lookahead ? '20' : '0',
      '-spatial-aq', e.spatialAq ? '1' : '0', '-bf', String(e.bFrames),
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'
    ];
  }

  programFilter() {
    const { width, height, fps } = this.config.source;
    // CLEAN is a camera-only branch. PROGRAM is independently composed from the same decoded source.
    return `[0:v]fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p,split=2[clean][program_base];[program_base]drawbox=x=24:y=24:w=340:h=72:color=black@0.62:t=fill,drawbox=x=24:y=24:w=10:h=72:color=0xD60000@1:t=fill,drawtext=fontfile=C\\\\:/Windows/Fonts/arial.ttf:text='CODE BLACK  LIVE':fontcolor=white:fontsize=28:x=52:y=45[program]`;
  }

  sourceArgs(output = null) {
    const endpoint = this.config.source.endpoint;
    return [
      '-hide_banner', '-nostdin', '-loglevel', 'warning', '-progress', 'pipe:1', '-nostats',
      '-fflags', '+genpts+discardcorrupt', '-rw_timeout', '5000000', '-thread_queue_size', '1024', '-i', endpoint,
      '-filter_complex', this.programFilter(),
      // The first output proves the separate CLEAN branch without adding a second hardware encoder session.
      '-map', '[clean]', '-map', '0:a?', '-f', 'null', 'NUL',
      '-map', '[program]', '-map', '0:a?', ...this.encoderArgs(),
      ...(output
        ? ['-flush_packets', '1', '-cluster_time_limit', '1000', '-f', 'matroska', output]
        : ['-f', 'null', 'NUL'])
    ];
  }

  fallbackArgs(output = null) {
    const { width, height, fps } = this.config.source;
    const seconds = this.config.reconnect.fallbackSeconds;
    const filter = `drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill,drawbox=x=24:y=24:w=470:h=72:color=black@0.7:t=fill,drawbox=x=24:y=24:w=10:h=72:color=0xD60000@1:t=fill,drawtext=fontfile=C\\\\:/Windows/Fonts/arial.ttf:text='SOURCE OFFLINE - RECONNECTING':fontcolor=white:fontsize=27:x=52:y=47`;
    return [
      '-hide_banner', '-nostdin', '-loglevel', 'warning', '-progress', 'pipe:1', '-nostats',
      '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}`,
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(seconds),
      '-filter:v', filter, '-map', '0:v', '-map', '1:a', ...this.encoderArgs(),
      '-shortest', ...(output
        ? ['-flush_packets', '1', '-cluster_time_limit', '1000', '-f', 'matroska', output]
        : ['-f', 'null', 'NUL'])
    ];
  }

  launch(kind) {
    if (this.process || !this.recordingRequested) return;
    const output = this.config.recording.writeToDisk === false ? null : this.recordingFile(kind);
    this.processKind = kind;
    this.activeRecording = output;
    this.lastProgress = {};
    this.lastSourceFrame = 0;
    this.lastFrameAt = null;
    this.transition(kind === 'source' ? STATES.SOURCE_CONNECTING : STATES.SOURCE_LOST,
      kind === 'source' ? 'connecting to approved CORE source' : 'writing safe offline fallback while reconnecting');
    const args = kind === 'source' ? this.sourceArgs(output) : this.fallbackArgs(output);
    this.logger.write('ffmpeg_start', { kind, output: output ? path.basename(output) : 'discard', executable: this.ffmpeg, args: args.filter((arg) => !String(arg).startsWith('srt://')) });
    try {
      this.process = childProcess.spawn(this.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      this.lastError = safeError(error.message);
      this.transition(STATES.ERROR, 'unable to start FFmpeg');
      this.logger.write('ffmpeg_spawn_error', { error: error.message });
      return;
    }
    let stderrBuffer = '';
    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', (chunk) => this.consumeProgress(chunk));
    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', (chunk) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop();
      for (const line of lines) {
        if (/error|failed|nvenc|invalid|could not/i.test(line)) this.logger.write('ffmpeg_diagnostic', { kind, message: line });
      }
    });
    this.process.on('error', (error) => {
      this.lastError = safeError(error.message);
      this.logger.write('ffmpeg_process_error', { kind, error: error.message });
    });
    this.process.on('exit', (code, signal) => this.onExit(kind, code, signal));
  }

  consumeProgress(chunk) {
    for (const line of chunk.split(/\r?\n/)) {
      const match = /^([^=]+)=(.*)$/.exec(line);
      if (!match) continue;
      this.lastProgress[match[1]] = match[2];
      if (match[1] === 'frame' && Number(match[2]) > this.lastSourceFrame && this.processKind === 'source') {
        this.lastSourceFrame = Number(match[2]);
        this.lastFrameAt = iso();
        if (this.onFreshVideo) this.onFreshVideo();
        if (this.state === STATES.SOURCE_CONNECTING || this.state === STATES.RECONNECTING || this.state === STATES.SOURCE_STALE) {
          this.retryCount = 0;
          this.lastError = null;
          this.transition(STATES.SOURCE_LIVE, 'CORE source video and audio pipeline producing frames');
          this.logger.write('source_live', { frame: match[2] });
        }
      }
    }
  }

  onExit(kind, code, signal) {
    const expected = this.stopping;
    this.logger.write('ffmpeg_exit', { kind, code, signal, expected });
    this.process = null;
    this.processKind = null;
    if (!this.recordingRequested || expected) {
      this.stopping = false;
      this.activeRecording = null;
      this.transition(STATES.STANDBY, 'recording output stopped');
      return;
    }
    if (kind === 'source') {
      this.retryCount += 1;
      this.lastError = `source process ended (code ${code === null ? 'none' : code})`;
      this.transition(STATES.SOURCE_LOST, 'source process ended; no fresh media is available');
      this.transition(STATES.RECONNECTING, 'source interrupted; entering safe fallback then retrying CORE');
      this.logger.write('source_interrupted', { retryCount: this.retryCount, code, signal });
      this.launch('fallback');
      return;
    }
    const backoff = Math.min(this.config.reconnect.maxBackoffSeconds, this.config.reconnect.fallbackSeconds * Math.max(1, this.retryCount));
    this.transition(STATES.RECONNECTING, `retrying CORE source in ${backoff}s`);
    setTimeout(() => this.launch('source'), backoff * 1000);
  }

  startRecording() {
    if (this.recordingRequested) return { changed: false, message: 'recording already requested' };
    this.recordingRequested = true;
    this.transition(STATES.OUTPUT_STARTING, this.config.recording.writeToDisk === false ? 'PROGRAM preview requested' : 'local PROGRAM recording requested');
    this.launch('source');
    return { changed: true, message: this.config.recording.writeToDisk === false ? 'PROGRAM preview started; automatic archive is disabled' : 'local PROGRAM recording started' };
  }

  stopRecording() {
    if (!this.recordingRequested) return { changed: false, message: 'recording already stopped' };
    this.recordingRequested = false;
    if (this.process) {
      this.stopping = true;
      this.process.kill('SIGINT');
    } else {
      this.transition(STATES.STANDBY, 'recording output stopped');
    }
    return { changed: true, message: 'local PROGRAM recording stop requested' };
  }

  selectProgramSource(value) {
    if (value !== 'nick') throw new Error('only the approved CORE source "nick" is available in V1');
    return { source: 'nick', message: 'approved CORE source selected' };
  }

  broadcastStart() {
    // Qualification build deliberately has no destination configuration and never acquires the output lock.
    if (!this.config.productionBroadcastEnabled) {
      const error = new Error('production broadcast is disabled during Native Broadcaster qualification');
      error.statusCode = 409;
      throw error;
    }
    if (fs.existsSync(OUTPUT_LOCK)) {
      const error = new Error('production output is owned by another broadcaster');
      error.statusCode = 409;
      throw error;
    }
    fs.writeFileSync(OUTPUT_LOCK, JSON.stringify({ owner: 'native-broadcaster', acquiredAt: iso() }), { flag: 'wx' });
    this.transition(STATES.OUTPUT_STARTING, 'authorized production output starting');
    return { message: 'output lock acquired' };
  }

  broadcastStop() {
    if (fs.existsSync(OUTPUT_LOCK)) fs.unlinkSync(OUTPUT_LOCK);
    if (this.state === STATES.BROADCASTING || this.state === STATES.OUTPUT_STARTING) this.transition(STATES.STANDBY, 'production output stopped');
    return { message: 'production output lock released' };
  }

  status() {
    return {
      service: this.config.serviceName, state: this.state, stateReason: this.stateReason, stateAt: this.stateAt,
      source: { name: this.config.source.name, configured: true, lastFrameAt: this.lastFrameAt, retryCount: this.retryCount },
      clean: { state: this.recordingRequested ? 'ACTIVE' : 'STANDBY', overlays: false },
      program: { state: this.recordingRequested ? 'ACTIVE' : 'STANDBY', overlays: ['live_bug'] },
      recording: { requested: this.recordingRequested, writeToDisk: this.config.recording.writeToDisk !== false, activeFile: this.activeRecording ? path.basename(this.activeRecording) : null, container: 'matroska' },
      encoder: { ...this.config.encoder, configured: true, progress: this.lastProgress },
      broadcast: { enabled: this.config.productionBroadcastEnabled, state: 'OFF', lockPresent: fs.existsSync(OUTPUT_LOCK) },
      obs: { accessed: false, configured: false }, lastError: this.lastError
    };
  }
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let text = '';
    request.on('data', (chunk) => { text += chunk; if (text.length > 65536) reject(new Error('request too large')); });
    request.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch { reject(new Error('invalid JSON')); } });
  });
}
function respond(response, code, payload) {
  response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(`${JSON.stringify(payload)}\n`);
}
function startApi(engine) {
  const server = http.createServer(async (request, response) => {
    try {
      // The producer stays loopback-only. Reject browser writes from other sites, including
      // DNS rebinding requests; no production controls are exposed through OPS or a tunnel.
      const expectedHost = `127.0.0.1:${engine.config.listen.port}`;
      if (request.headers.host !== expectedHost && request.headers.host !== `localhost:${engine.config.listen.port}`) return respond(response, 403, { error: 'local producer host required' });
      const origin = request.headers.origin;
      if (request.method !== 'GET' && origin && origin !== `http://${expectedHost}` && origin !== `http://localhost:${engine.config.listen.port}`) return respond(response, 403, { error: 'local producer origin required' });
      const route = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && route === '/status') return respond(response, 200, engine.status());
      if (request.method === 'GET' && route === '/sources') return respond(response, 200, { sources: [{ name: 'nick', approved: true, state: engine.status().state }] });
      if (request.method === 'GET' && route === '/outputs') return respond(response, 200, { production: engine.status().broadcast, private: engine.privateOutput.status(), clean: engine.cleanSink.status() });
      if (request.method === 'GET' && route === '/audio') return respond(response, 200, engine.audioProbe.status());
      if (request.method === 'GET' && route === '/metrics') return respond(response, 200, engine.getMetrics());
      if (request.method === 'GET' && route === '/overlays') return respond(response, 200, engine.overlays);
      if (request.method === 'GET' && route === '/capabilities') return respond(response, 200, engine.producerCommands.capabilities());
      if (request.method === 'GET' && route === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return response.end(producerHtml()); }
      if (request.method === 'GET' && route === '/events') { response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); response.write(': connected\n\n'); engine.events.add(response); request.on('close', () => engine.events.delete(response)); return; }
      const preview = /^\/preview\/(clean|program)\/(index\.m3u8|latest\.jpg|(?:index)?\d+\.ts)$/.exec(route);
      if (request.method === 'GET' && preview) { const file = path.join(ROOT, 'runtime', 'previews', preview[1], preview[2]); if (!fs.existsSync(file)) return respond(response, 404, { error: 'preview not available' }); response.writeHead(200, { 'content-type': preview[2].endsWith('.jpg') ? 'image/jpeg' : preview[2].endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'cache-control': 'no-store' }); return fs.createReadStream(file).pipe(response); }
      const body = await parseBody(request);
      let result;
      if (request.method === 'POST' && route === '/program/source') result = engine.selectProgramSource(body.source);
      else if (request.method === 'POST' && route === '/commands') result = engine.producerCommands.execute(body);
      else if (request.method === 'POST' && route === '/overlays') result = engine.setOverlays(body);
      else if (request.method === 'POST' && route === '/record/start') result = engine.startRecording();
      else if (request.method === 'POST' && route === '/record/stop') result = engine.stopRecording();
      else if (request.method === 'POST' && route === '/record/clean/start') result = engine.cleanSink.start();
      else if (request.method === 'POST' && route === '/record/clean/stop') result = engine.cleanSink.stop();
      else if (request.method === 'POST' && route === '/outputs/private/start') result = engine.privateOutput.start();
      else if (request.method === 'POST' && route === '/outputs/private/stop') result = engine.privateOutput.stop();
      else if (request.method === 'POST' && route === '/ownership/test/acquire') result = engine.acquireTestOwnership();
      else if (request.method === 'POST' && route === '/ownership/test/release') result = engine.releaseTestOwnership();
      else if (request.method === 'POST' && route === '/ownership/test/holder/start') result = engine.startLockHolder();
      else if (request.method === 'POST' && route === '/ownership/test/holder/crash') result = engine.crashLockHolder();
      else if (request.method === 'POST' && route === '/broadcast/start') result = engine.broadcastStart();
      else if (request.method === 'POST' && route === '/broadcast/stop') result = engine.broadcastStop();
      else return respond(response, 404, { error: 'not found' });
      return respond(response, 200, result);
    } catch (error) {
      return respond(response, error.statusCode || 400, { error: safeError(error.message) });
    }
  });
  server.listen(engine.config.listen.port, engine.config.listen.host, () => {
    engine.logger.write('api_listening', { host: engine.config.listen.host, port: engine.config.listen.port });
    process.stdout.write(`Native Broadcaster API listening on http://${engine.config.listen.host}:${engine.config.listen.port}\n`);
  });
  return server;
}

function main() {
  ensureDirectory(RUNTIME);
  const config = readJson(CONFIG_PATH);
  const engine = new Broadcaster(config);
  enableMilestone2(engine, ROOT);
  engine.facebookOutput = new FacebookOutput(engine, ROOT);
  engine.producerCommands = new ProducerCommands(engine);
  engine.broadcastStart = () => engine.facebookOutput.start();
  engine.broadcastStop = () => engine.facebookOutput.stop();
  const setOverlays = engine.setOverlays.bind(engine);
  engine.setOverlays = (value) => { const result = setOverlays(value); engine.facebookOutput.refreshOverlays(); return result; };
  const stopRecording = engine.stopRecording.bind(engine);
  engine.stopRecording = () => { engine.facebookOutput.stop(); return stopRecording(); };
  const status = engine.status.bind(engine);
  engine.status = () => ({ ...status(), broadcast: engine.facebookOutput.status(), bridge: engine.producerBridge ? engine.producerBridge.status() : { configured: false, state: 'OFFLINE' } });
  if (engine.config.bridge?.enabled) {
    engine.producerBridge = new ProducerBridgeClient(engine, ROOT, engine.config.bridge);
    engine.producerBridge.start();
  }
  const api = startApi(engine);
  const shutdown = () => {
    engine.facebookOutput.stop();
    engine.privateOutput.stop();
    engine.cleanSink.stop();
    if (engine.producerBridge) engine.producerBridge.stop();
    clearInterval(engine.healthTimer);
    engine.stopRecording();
    api.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
if (require.main === module) main();
module.exports = { STATES, Broadcaster, safeError, startApi };
