'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const crypto = require('crypto');

function redact(value) {
  return String(value || '').replace(/(?:srt|rtmps?):\/\/[^\s'"\\]+/gi, '[stream endpoint redacted]');
}

function facebookTarget(server, key) {
  const url = new URL(server);
  if (url.protocol !== 'rtmps:' || url.hostname !== 'live-api-s.facebook.com' ||
      (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/rtmp/') throw new Error('Facebook destination must be the secure Facebook RTMPS server.');
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{10,1024}$/.test(key)) throw new Error('Facebook stream key is missing or invalid.');
  return url.href + key;
}

function readCredential(root) {
  // Windows DPAPI binds this credential to the current Windows user and machine. Neither the
  // status API nor logs contain the stream key. The PowerShell command itself has no secret.
  const file = path.join(root, 'runtime', 'facebook.credentials.json');
  const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
  const key = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'read-facebook-key.ps1'), '-Path', file],
    { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
  return facebookTarget(metadata.server, key);
}

class FacebookOutput {
  constructor(engine, root, dependencies = {}) {
    this.engine = engine;
    this.root = root;
    this.spawn = dependencies.spawn || childProcess.spawn;
    this.load = dependencies.load || (() => readCredential(root));
    this.credentialFile = path.join(root, 'runtime', 'facebook.credentials.json');
    this.lockFile = path.join(root, 'runtime', 'production-output.lock');
    this.process = null;
    this.requested = false;
    this.timer = null;
    this.watchdog = null;
    this.ownerId = crypto.randomUUID();
    this.state = 'OFF';
    this.lastError = null;
    this.lastSuccessAt = null;
    this.startedAt = null;
    this.retries = 0;
    this.progress = {};
    this.buffer = '';
    this.lastFrame = 0;
    this.lastFrameMs = 0;
  }

  acquire() {
    // Only recover a dead process's lock. Never unlink an active owner's lock, even if it is
    // another instance of this service. Atomic creation prevents two start requests racing.
    if (fs.existsSync(this.lockFile)) {
      const lock = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
      let active = true;
      try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') active = false; }
      if (active) throw new Error('Production output is already owned by another broadcaster.');
      fs.unlinkSync(this.lockFile);
    }
    fs.writeFileSync(this.lockFile, JSON.stringify({ pid: process.pid, ownerId: this.ownerId, owner: 'NATIVE_FACEBOOK', acquiredAt: new Date().toISOString() }), { flag: 'wx' });
  }

  release() {
    try {
      const lock = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
      if (lock.ownerId === this.ownerId && lock.pid === process.pid) fs.unlinkSync(this.lockFile);
    } catch {}
  }

  start() {
    if (this.requested) return { changed: false, message: 'Facebook output already requested' };
    if (!this.engine.config.productionBroadcastEnabled) throw new Error('Facebook output is disabled in configuration.');
    // Validate/decrypt before locking or touching an encoder. Errors never include secret data.
    try { this.load(); } catch { throw new Error('Facebook credential needs setup. Run configure-facebook.ps1.'); }
    const obs = childProcess.spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq obs64.exe', '/NH'], { windowsHide: true, encoding: 'utf8' });
    if (/obs64\.exe/i.test(obs.stdout || '')) throw new Error('Close OBS before starting Native Facebook output so two encoders cannot use the same stream key.');
    if (this.engine.sourceState !== 'SOURCE_LIVE') throw new Error('Start the source preview/recording and wait for fresh Nick video before starting Facebook.');
    const audio = this.engine.audioProbe.status();
    const videoAge = this.engine.videoAgeMs();
    const audioAge = Date.now() - Date.parse(audio.lastAudioAt);
    if (!this.engine.recordingRequested || videoAge === null || videoAge > 5000 || !Number.isFinite(audioAge) || audioAge > 5000 || audio.process !== 'RUNNING' || !audio.available || audio.silence || audio.clipping) throw new Error('Fresh PROGRAM video and healthy audio are required before Facebook output can start.');
    this.acquire();
    this.requested = true;
    this.retries = 0;
    this.startedAt = new Date().toISOString();
    this.lastError = null;
    this.launch();
    return { changed: true, message: 'Facebook output starting; confirm the preview in Facebook Live Producer.' };
  }

  args(target) {
    const { width, height, fps } = this.engine.config.source;
    const filter = `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p,${this.engine.overlayFilter()}`;
    return ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-progress', 'pipe:1', '-nostats',
      '-rw_timeout', '8000000', '-fflags', '+genpts+discardcorrupt', '-i', this.engine.config.source.endpoint,
      '-vf', filter, '-map', '0:v:0', '-map', '0:a?', ...this.engine.encoderArgs(),
      '-flvflags', 'no_duration_filesize', '-f', 'flv', target];
  }

  launch() {
    if (!this.requested || this.process) return;
    if (this.engine.sourceState !== 'SOURCE_LIVE') {
      this.state = 'WAITING_FOR_SOURCE';
      this.timer = setTimeout(() => this.launch(), 2000);
      return;
    }
    let target;
    try { target = this.load(); } catch { this.fail('Facebook credential cannot be decrypted by this Windows user.'); return; }
    this.state = 'CONNECTING';
    this.buffer = '';
    this.progress = {};
    this.lastFrame = 0;
    this.lastFrameMs = Date.now();
    const proc = this.spawn(this.engine.ffmpeg, this.args(target), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (data) => this.consume(data));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (data) => {
      if (/error|failed|refused|broken|invalid/i.test(data)) {
        this.lastError = redact(data).trim().slice(-500);
        this.engine.logger.write('facebook_output_error', { message: this.lastError });
      }
    });
    proc.on('error', () => { this.lastError = 'Facebook encoder could not start.'; });
    proc.on('close', (code) => {
      if (this.process !== proc) return;
      this.process = null;
      clearInterval(this.watchdog);
      if (!this.requested) { this.state = 'OFF'; this.release(); return; }
      this.retries++;
      if (this.retries > 8) { this.fail('Facebook output stopped after repeated connection failures. Check the stream key and network.'); return; }
      this.state = 'RECONNECTING';
      this.lastError ||= `Facebook output disconnected (exit ${code}).`;
      this.timer = setTimeout(() => this.launch(), Math.min(30000, 2000 * 2 ** Math.min(this.retries, 4)));
    });
    this.watchdog = setInterval(() => {
      if (this.requested && Date.now() - this.lastFrameMs > 15000) {
        this.state = 'RECONNECTING';
        this.lastError = 'Facebook output stopped producing frames.';
        proc.kill('SIGTERM');
      }
    }, 1000);
    this.engine.logger.write('facebook_output_started', { destination: 'Facebook RTMPS', pid: proc.pid });
  }

  consume(data) {
    this.buffer += String(data);
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop();
    for (const line of lines) {
      const match = /^([^=]+)=(.*)$/.exec(line);
      if (!match) continue;
      this.progress[match[1]] = match[2];
      if (match[1] === 'frame' && Number(match[2]) > this.lastFrame) {
        this.lastFrame = Number(match[2]);
        this.lastFrameMs = Date.now();
        this.lastSuccessAt = new Date().toISOString();
        this.state = 'SENDING';
        this.lastError = null;
      }
    }
  }

  refreshOverlays() {
    if (this.process && this.requested) {
      this.state = 'RECONNECTING';
      this.process.kill('SIGINT');
    }
  }

  fail(message) {
    this.requested = false;
    this.state = 'ERROR';
    this.lastError = message;
    clearTimeout(this.timer);
    clearInterval(this.watchdog);
    this.release();
  }

  stop() {
    this.requested = false;
    clearTimeout(this.timer);
    clearInterval(this.watchdog);
    this.state = this.process ? 'STOPPING' : 'OFF';
    if (this.process) {
      const proc = this.process;
      proc.kill('SIGINT');
      const killTimer = setTimeout(() => { if (this.process === proc) proc.kill('SIGKILL'); }, 5000);
      killTimer.unref();
    } else this.release();
    return { changed: true, message: 'Facebook output stop requested' };
  }

  status() {
    return { enabled: this.engine.config.productionBroadcastEnabled === true,
      configured: fs.existsSync(this.credentialFile), state: this.state, requested: this.requested,
      destination: 'Facebook · Storm Chaser Nick Mounce', startedAt: this.startedAt,
      lastSuccessAt: this.lastSuccessAt, lastError: this.lastError, reconnectCount: this.retries,
      frames: this.lastFrame, bitrate: this.progress.bitrate || null,
      pageLiveConfirmed: false, lockPresent: fs.existsSync(this.lockFile) };
  }
}

module.exports = { FacebookOutput, facebookTarget, redact, readCredential };
