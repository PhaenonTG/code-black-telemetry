'use strict';
const fs = require('fs');
const path = require('path');
const SEGMENT = /^program-[0-9a-f]{32}-[0-9]{1,16}\.ts$/;

function programSegments(text) {
  if (text.length > 8192 || !text.startsWith('#EXTM3U\n') || text.includes('#EXT-X-ENDLIST')) return null;
  const names = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  return names.length > 0 && names.length <= 8 && names.every(name => SEGMENT.test(name)) && new Set(names).size === names.length ? names : null;
}

class ProgramMediaUploader {
  constructor(root, status, request) {
    this.directory = path.join(root, 'runtime', 'previews', 'program');
    this.getStatus = status; this.request = request; this.running = false;
    this.uploaded = new Set(); this.manifestMtime = 0;
    this.state = 'WAITING_FOR_SOURCE'; this.lastError = null; this.lastSuccessAt = null; this.compositionId = null;
  }
  async cycle() {
    if (this.running) return;
    this.running = true;
    try {
      const status = this.getStatus();
      if (status.composition?.id && status.previews?.program?.compositionId !== status.composition.id) { this.state = 'WAITING_FOR_COMPOSITION'; return; }
      const age = Date.now() - Date.parse(status.metrics?.last_video_timestamp);
      if (status.source_state !== 'SOURCE_LIVE' || status.previews?.program?.state !== 'ACTIVE' || !Number.isFinite(age) || age < -2000 || age > 5000) { this.state = 'WAITING_FOR_SOURCE'; return; }
      const file = path.join(this.directory, 'index.m3u8');
      let info;
      try { info = fs.statSync(file); } catch { this.state = 'WAITING_FOR_MEDIA'; return; }
      if (Date.now() - info.mtimeMs > 5000 || info.size > 8192) { this.state = 'WAITING_FOR_MEDIA'; return; }
      if (info.mtimeMs === this.manifestMtime) return;
      const text = fs.readFileSync(file, 'utf8'); const names = programSegments(text);
      if (!names) { this.state = 'WAITING_FOR_MEDIA'; return; }
      const preview = status.previews.program;
      if (preview.generation && names.some(name => !name.startsWith(`program-${preview.generation}-`))) { this.state = 'WAITING_FOR_MEDIA'; return; }
      await Promise.all(names.filter(name => !this.uploaded.has(name)).map(async name => {
        const segment = path.join(this.directory, name); const stat = fs.statSync(segment);
        if (stat.size <= 0 || stat.size > 512 * 1024 || Date.now() - stat.mtimeMs > 15000) throw new Error('PROGRAM media is outside the bounded live window.');
        const bytes = fs.readFileSync(segment);
        await this.request(`/workstation/preview/hls/${name}`, { method: 'POST', headers: { 'Content-Type': 'video/mp2t', 'Content-Length': String(bytes.length), 'X-Producer-Frame-At': stat.mtime.toISOString() }, body: bytes, signal: AbortSignal.timeout(2500) });
        this.uploaded.add(name);
      }));
      await this.request('/workstation/preview/hls/index.m3u8', { method: 'POST', headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'X-Producer-Frame-At': info.mtime.toISOString(), ...(preview.compositionId ? { 'X-Producer-Composition': preview.compositionId } : {}) }, body: text, signal: AbortSignal.timeout(2500) });
      this.uploaded = new Set(names); this.manifestMtime = info.mtimeMs;
      this.state = 'CURRENT'; this.lastError = null; this.lastSuccessAt = new Date().toISOString();
      this.compositionId = preview.compositionId || null;
    } catch { this.state = 'UNAVAILABLE'; this.lastError = 'PROGRAM monitor upload failed; command bridge remains independent.'; }
    finally { this.running = false; }
  }
  status() { return { state: this.state, lastSuccessAt: this.lastSuccessAt, lastError: this.lastError, compositionId: this.compositionId }; }
}
module.exports = { ProgramMediaUploader, programSegments };
