'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { ProgramMediaUploader } = require('./program-monitor');

function endpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'ops.codeblackwx.com' || url.pathname.replace(/\/$/, '') !== '/api/producer/v1' || url.search || url.hash) {
    throw new Error('Producer bridge must use the fixed OPS HTTPS endpoint.');
  }
  return url.href.replace(/\/$/, '');
}

function readCredential(root) {
  const file = path.join(root, 'runtime', 'producer-bridge.credentials.json');
  const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
  const token = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'read-facebook-key.ps1'), '-Path', file],
    { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(token)) throw new Error('Producer bridge credential is invalid.');
  return token;
}

class ProducerBridgeClient {
  constructor(engine, root, config, dependencies = {}) {
    this.engine = engine;
    this.root = root;
    this.base = endpoint(config.endpoint);
    this.fetch = dependencies.fetch || globalThis.fetch;
    this.load = dependencies.load || (() => readCredential(root));
    this.intervalMs = Math.max(1000, Number(config.intervalMs) || 2000);
    this.timer = null;
    this.running = false;
    this.state = 'OFFLINE';
    this.lastSuccessAt = null;
    this.lastError = null;
    this.lastFrameMtime = 0;
    this.mediaEnabled = config.programMonitorEnabled === true;
    this.mediaTimer = null;
    this.media = new ProgramMediaUploader(root, () => this.engine.status(), (route, init) => this.request(route, init));
  }

  async request(route, init = {}) {
    const token = this.load();
    const response = await this.fetch(`${this.base}${route}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` }, signal: init.signal || AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`bridge ${route} returned HTTP ${response.status}`);
    return response;
  }

  safeStatus() {
    const status = this.engine.status();
    return {
      stateRevision: status.stateRevision,
      state: status.state,
      stateReason: status.stateReason,
      source_state: status.source_state,
      transport_state: status.transport_state,
      recording: { requested: status.recording.requested, writeToDisk: status.recording.writeToDisk },
      previews: status.previews,
      audio: status.audio,
      metrics: status.metrics,
      broadcast: status.broadcast,
      overlays: status.overlays,
      observedAt: new Date().toISOString(),
    };
  }

  async pushJson(route, body) {
    await this.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  async pushFrame() {
    const status = this.engine.status();
    if (status.source_state !== 'SOURCE_LIVE' || status.previews.program.state !== 'ACTIVE') return;
    const file = path.join(this.root, 'runtime', 'previews', 'program', 'latest.jpg');
    let info;
    try { info = fs.statSync(file); } catch { return; }
    if (info.mtimeMs <= this.lastFrameMtime || Date.now() - info.mtimeMs > 5000 || info.size > 2 * 1024 * 1024) return;
    const bytes = fs.readFileSync(file);
    await this.request('/workstation/preview/program.jpg', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.length), 'X-Producer-Frame-At': info.mtime.toISOString() }, body: bytes });
    this.lastFrameMtime = info.mtimeMs;
  }

  async executeCommands() {
    const response = await this.request('/workstation/commands');
    const document = await response.json();
    for (const command of Array.isArray(document.commands) ? document.commands : []) {
      let state = 'succeeded'; let result;
      try { result = this.engine.producerCommands.execute(command); }
      catch (error) { state = 'failed'; result = { error: String(error.message || error), statusCode: error.statusCode || 400 }; }
      await this.pushJson('/workstation/ack', { commandId: command.commandId, state, result });
    }
  }

  async syncFacebookDestination() {
    const response = await this.request('/workstation/facebook-destination');
    const destination = await response.json();
    this.engine.facebookOutput.setManagedDestination(destination);
  }

  async cycle() {
    if (this.running) return;
    this.running = true;
    try {
      await this.pushJson('/workstation/status', this.safeStatus());
      await this.pushJson('/workstation/capabilities', this.engine.producerCommands.capabilities());
      await this.pushFrame();
      try { await this.syncFacebookDestination(); } catch { /* Destination service can roll independently. Stop commands must still be consumed. */ }
      await this.executeCommands();
      this.state = 'ONLINE'; this.lastSuccessAt = new Date().toISOString(); this.lastError = null;
    } catch (error) {
      this.state = 'OFFLINE'; this.lastError = String(error.message || error).slice(0, 240);
    } finally { this.running = false; }
  }

  start() {
    if (!this.timer) { this.cycle(); this.timer = setInterval(() => this.cycle(), this.intervalMs); }
    if (this.mediaEnabled && !this.mediaTimer) { this.media.cycle(); this.mediaTimer = setInterval(() => this.media.cycle(), 1000); }
  }
  stop() { if (this.timer) clearInterval(this.timer); if (this.mediaTimer) clearInterval(this.mediaTimer); this.timer = null; this.mediaTimer = null; }
  status() { return { configured: true, state: this.state, lastSuccessAt: this.lastSuccessAt, lastError: this.lastError, programMonitor: { enabled: this.mediaEnabled, ...this.media.status() } }; }
}

module.exports = { ProducerBridgeClient, endpoint };
