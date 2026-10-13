'use strict';

// Milestone 2 capabilities are deliberately layered around the qualified transport engine.
// No OBS path, profile, credential, or Facebook configuration is read or modified here.

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function processStartUtc(pid) {
  try { return childProcess.execFileSync('powershell.exe', ['-NoProfile','-Command',`(Get-Process -Id ${Number(pid)}).StartTime.ToUniversalTime().ToString('o')`], { windowsHide:true, encoding:'utf8' }).trim(); } catch { return null; }
}

function iso() { return new Date().toISOString(); }
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
function base(root) { return path.join(root, 'runtime', 'previews'); }
function hlsArgs(ffmpeg, endpoint, directory, program, filter) {
  ensure(directory);
  const vf = program ? `scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black,${filter}` :
    'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black';
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'warning', '-y', '-rw_timeout', '5000000', '-fflags', '+genpts+discardcorrupt', '-i', endpoint,
    '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-b:v', '700k', '-maxrate', '700k', '-bufsize', '1400k', '-g', '30',
    '-f', 'hls', '-hls_time', '1', '-hls_list_size', '4', '-hls_flags', 'delete_segments+append_list', path.join(directory, 'index.m3u8')
  ];
}

class PreviewManager {
  constructor(engine, root) { this.engine = engine; this.root = root; this.processes = new Map(); this.restartTimers = new Map(); this.snapshotTimers = new Map(); }
  start() { this.startOne('clean'); this.startOne('program'); this.startSnapshots('clean'); this.startSnapshots('program'); }
  startSnapshots(kind) { if (this.snapshotTimers.has(kind)) return; this.snapshotTimers.set(kind, setInterval(() => this.snapshot(kind), 1500)); }
  snapshot(kind) { if (kind === 'program' && this.engine.sourceState !== 'SOURCE_LIVE') { this.statePlate(); return; } const dir = path.join(base(this.root), kind); const segment = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.ts')).map((e) => path.join(dir,e.name)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0]; if (!segment) return; const tmp=path.join(dir,`snapshot-${process.pid}.jpg`); const target=path.join(dir,'latest.jpg'); childProcess.execFile(this.engine.ffmpeg,['-y','-v','error','-i',segment,'-frames:v','1','-q:v','3',tmp],{windowsHide:true},()=>{ if(!fs.existsSync(tmp))return; try{fs.renameSync(tmp,target);}catch{try{fs.copyFileSync(tmp,target);fs.unlinkSync(tmp);}catch{}} }); }
  statePlate() { const dir=path.join(base(this.root),'program'); ensure(dir); const tmp=path.join(dir,`state-${process.pid}.jpg`); const target=path.join(dir,'latest.jpg'); childProcess.execFile(this.engine.ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=black:s=640x360:r=1','-vf',this.engine.overlayFilter(),'-frames:v','1','-q:v','3',tmp],{windowsHide:true},()=>{if(!fs.existsSync(tmp))return;try{fs.renameSync(tmp,target);}catch{try{fs.copyFileSync(tmp,target);fs.unlinkSync(tmp);}catch{}}}); }
  startOne(kind) {
    if (this.processes.has(kind) || !this.engine.recordingRequested) return;
    const dir = path.join(base(this.root), kind);
    const args = hlsArgs(this.engine.ffmpeg, this.engine.config.source.endpoint, dir, kind === 'program', this.engine.overlayFilter());
    const proc = childProcess.spawn(this.engine.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    this.processes.set(kind, proc);
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (data) => { if (/error|failed/i.test(data)) this.engine.logger.write('preview_diagnostic', { kind, message: data }); });
    proc.on('exit', (code) => {
      this.processes.delete(kind);
      this.engine.emit('output.error', { output: `${kind}_preview`, code });
      if (this.engine.recordingRequested) this.restartTimers.set(kind, setTimeout(() => this.startOne(kind), 2000));
    });
  }
  restartProgram() { this.stopOne('program'); if (this.engine.recordingRequested) setTimeout(() => { this.startOne('program'); this.startSnapshots('program'); }, 500); }
  stopOne(kind) { const proc = this.processes.get(kind); if (proc) proc.kill('SIGINT'); this.processes.delete(kind); const timer = this.restartTimers.get(kind); if (timer) clearTimeout(timer); const snapshotTimer=this.snapshotTimers.get(kind);if(snapshotTimer)clearInterval(snapshotTimer);this.snapshotTimers.delete(kind); }
  stop() { this.stopOne('clean'); this.stopOne('program'); }
  status() { const out = {}; for (const name of ['clean', 'program']) { const dir = path.join(base(this.root), name); out[name] = { state: this.processes.has(name) ? 'ACTIVE' : 'STANDBY', hls: `/preview/${name}/index.m3u8`, snapshot: `/preview/${name}/latest.jpg`, available: fs.existsSync(path.join(dir, 'latest.jpg')) }; } return out; }
}

class AudioProbe {
  constructor(engine) { this.engine = engine; this.process = null; this.data = { leftPeakDb: null, rightPeakDb: null, rmsDb: null, silence: true, clipping: false, lastAudioAt: null, available: false }; }
  start() {
    if (this.process || !this.engine.recordingRequested) return;
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-rw_timeout', '5000000', '-i', this.engine.config.source.endpoint, '-vn', '-af', 'astats=metadata=1:reset=1,ametadata=print:direct=1', '-f', 'null', 'NUL'];
    this.process = childProcess.spawn(this.engine.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', (chunk) => this.consume(chunk));
    this.process.on('exit', () => { this.process = null; if (this.engine.recordingRequested) setTimeout(() => this.start(), 2000); });
  }
  consume(chunk) {
    const text = String(chunk);
    const peaks = [...text.matchAll(/lavfi\.astats\.(\d+)\.Peak_level=([-\d.]+|-inf)/g)];
    const rms = /lavfi\.astats\.Overall\.RMS_level=([-\d.]+|-inf)/.exec(text);
    const silentEvidence = /lavfi\.astats\..*(Peak_level|RMS_level)=-inf/i.test(text);
    if (!peaks.length && !rms && !silentEvidence) return;
    const values = peaks.map((m) => m[2] === '-inf' ? -100 : Number(m[2]));
    if (silentEvidence && !values.length) values.push(-100, -100);
    if (values[0] !== undefined) this.data.leftPeakDb = values[0];
    if (values[1] !== undefined) this.data.rightPeakDb = values[1];
    if (rms) this.data.rmsDb = rms[1] === '-inf' ? -100 : Number(rms[1]);
    const candidates = [...values, this.data.rmsDb].filter(Number.isFinite);
    const max = candidates.length ? Math.max(...candidates) : -100;
    const priorSilence = this.data.silence;
    this.data.silence = max < -60;
    this.data.clipping = max >= -1;
    this.data.lastAudioAt = iso(); this.data.available = true;
    if (this.data.silence && !priorSilence) this.engine.emit('audio.silence', this.status());
    if (this.data.clipping) this.engine.emit('audio.clipping', this.status());
  }
  stop() { if (this.process) this.process.kill('SIGINT'); this.process = null; }
  status() { return { ...this.data, process: this.process ? 'RUNNING' : 'STOPPED' }; }
}

class PrivateOutput {
  constructor(engine) { this.engine = engine; this.process = null; this.requested = false; this.state = 'STOPPED'; this.startedAt = null; this.lastSuccessAt = null; this.lastError = null; this.reconnectCount = 0; this.progress = {}; }
  start(retry = false) {
    if (this.process) return { changed: false, message: 'private output already active' };
    if (!retry) this.engine.acquireTestOwnership();
    this.requested = true; this.state = 'STARTING'; this.startedAt ||= iso(); this.lastError = null;
    const target = 'rtmp://127.0.0.1:19350/test/native-program';
    const { width, height, fps } = this.engine.config.source;
    const graph = `[0:v]fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p[program_base];[program_base]${this.engine.overlayFilter()}[program]`;
    const args = ['-hide_banner','-nostdin','-loglevel','warning','-progress','pipe:1','-nostats','-rw_timeout','5000000','-i',this.engine.config.source.endpoint,'-filter_complex',graph,'-map','[program]','-map','0:a?',...this.engine.encoderArgs(),'-f','flv',target];
    this.process = childProcess.spawn(this.engine.ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
    this.process.stdout.setEncoding('utf8'); this.process.stdout.on('data',(data)=>this.consume(data));
    this.process.stderr.setEncoding('utf8'); this.process.stderr.on('data',(data)=>{if(/error|failed|refused|broken/i.test(data)){this.lastError=String(data).trim().slice(-300);this.engine.emit('output.error',{output:'private',reason:this.lastError});}});
    this.process.on('exit',(code)=>{ this.process=null; if(!this.requested){this.state='STOPPED';return;} this.state='RECONNECTING';this.reconnectCount++;this.lastError ||= `output process ended (${code})`;this.engine.emit('output.error',{output:'private',code});setTimeout(()=>this.start(true),2000);});
    return { changed: true, message: 'private output start requested' };
  }
  consume(data) { for(const line of String(data).split(/\r?\n/)){const m=/^([^=]+)=(.*)$/.exec(line);if(!m)continue;this.progress[m[1]]=m[2];if(m[1]==='frame'&&Number(m[2])>0){this.state='LIVE';this.lastSuccessAt=iso();}} }
  stop() { this.requested=false; if(this.process)this.process.kill('SIGINT'); this.process=null; this.state='STOPPED'; this.engine.releaseTestOwnership(); return {changed:true,message:'private output stopped'}; }
  status() { return { private_state:this.state, output_started_at:this.startedAt, output_last_success_at:this.lastSuccessAt, output_last_error:this.lastError, output_reconnect_count:this.reconnectCount, output_bitrate:this.progress.bitrate||null, output_frames:this.progress.frame||null, output_dropped_frames:null, destination_type:'RTMP', destination_name:'local-private-relay/test/native-program' }; }
}

class CleanSink {
  constructor(engine, root) { this.engine=engine;this.root=root;this.process=null;this.file=null; }
  start() { if(this.process)return {changed:false,message:'CLEAN sink already active'}; const dir=path.join(this.root,'recordings','clean');ensure(dir);const id=this.engine.session?.session_id||crypto.randomUUID();this.file=path.join(dir,`${new Date().toISOString().replace(/[:.]/g,'-')}_TESSA_${id}_clean.mkv`);const args=['-hide_banner','-nostdin','-loglevel','warning','-rw_timeout','5000000','-i',this.engine.config.source.endpoint,'-map','0:v:0','-map','0:a?','-c','copy','-f','matroska',this.file];this.process=childProcess.spawn(this.engine.ffmpeg,args,{windowsHide:true,stdio:'ignore'});this.process.on('exit',()=>this.process=null);return {changed:true,file:path.basename(this.file)}; }
  stop() {if(this.process)this.process.kill('SIGINT');this.process=null;return {changed:true,message:'CLEAN sink stopped'};}
  status(){return {state:this.process?'ACTIVE':'STOPPED',file:this.file?path.basename(this.file):null};}
}

function html() { return `<!doctype html><meta charset="utf-8"><title>Code Black Native Producer</title><style>body{background:#101215;color:#e8e8e8;font:14px system-ui;margin:18px}.off{color:#ff554f;font-weight:800}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}img{width:100%;background:#000}.card{border:1px solid #444;padding:10px}button{margin:4px}pre{white-space:pre-wrap}</style><h1>Code Black Native Producer</h1><div class="off">PUBLIC OUTPUT: OFF</div><div class="grid"><section class="card"><h2>CLEAN</h2><img id="clean"><pre id="cleanStatus"></pre></section><section class="card"><h2>PROGRAM</h2><img id="program"><pre id="programStatus"></pre></section></div><section class="card"><button onclick="post('/record/start')">Record start</button><button onclick="post('/record/stop')">Record stop</button><button onclick="post('/record/clean/start')">CLEAN sink start</button><button onclick="post('/outputs/private/start')">Private test output start</button><button onclick="post('/outputs/private/stop')">Private test output stop</button><button onclick="post('/overlays',{lowerThird:{enabled:true,text:'TEST LOWER THIRD'}})">Lower third test</button><button onclick="post('/overlays',{lowerThird:{enabled:false}})">Lower third off</button><pre id="status"></pre></section><script>async function post(p,b={}){await fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)})}async function refresh(){let s=await (await fetch('/status')).json();let p=s.previews;clean.src=p.clean.snapshot+'?t='+Date.now();program.src=p.program.snapshot+'?t='+Date.now();cleanStatus.textContent=JSON.stringify(p.clean,null,2);programStatus.textContent=JSON.stringify(p.program,null,2);status.textContent=JSON.stringify(s,null,2)}setInterval(refresh,1000);refresh();new EventSource('/events').onmessage=refresh;</script>`; }

function enableMilestone2(engine, root) {
  // Transport activity and picture freshness are intentionally separate dimensions.
  engine.transportState = 'DISCONNECTED';
  engine.sourceState = 'WAITING_FOR_SOURCE';
  engine.lastFreshVideoAt = null;
  engine.overlays = { bug: { enabled: true, text: 'CODE BLACK' }, live: { enabled: true, text: 'LIVE' }, lowerThird: { enabled: false, text: '' }, sourceName: { enabled: true }, connection: { enabled: true }, clock: { enabled: false }, vehicle: 'TESSA', callsign: 'NICK' };
  engine.session = null;
  engine.stateRevision = 0;
  engine.events = new Set();
  engine.emit = (type, data = {}) => { if (/^(state\.changed|recording\.|overlay\.changed|output\.|source\.)/.test(type)) engine.stateRevision++; const event = JSON.stringify({ type, at: iso(), stateRevision: engine.stateRevision, data }); for (const res of engine.events) res.write(`data: ${event}\n\n`); engine.logger.write('event', { type, stateRevision: engine.stateRevision, ...data }); };
  const transition = engine.transition.bind(engine);
  engine.setSourceState = (next, reason) => {
    const previous = engine.sourceState;
    if (previous === next) return;
    engine.sourceState = next;
    if (engine.session) engine.session.source_state = next;
    engine.emit('state.changed', { previous, next, reason, transport_state: engine.transportState, dimension: 'media' });
    engine.emit(next === 'SOURCE_LIVE' ? 'source.live' : next === 'SOURCE_STALE' ? 'source.stale' : 'source.lost', { reason, video_age_ms: engine.videoAgeMs() });
    if (next === 'SOURCE_STALE' || next === 'SOURCE_LOST') engine.previews.statePlate();
    if (engine.recordingRequested) engine.previews.restartProgram();
  };
  engine.transition = (next, reason) => {
    const previous = engine.state; transition(next, reason);
    const transport = next === 'SOURCE_LIVE' ? 'CONNECTED' : next === 'SOURCE_CONNECTING' ? 'DEGRADED' : next === 'RECONNECTING' ? 'RECONNECTING' : next === 'SOURCE_LOST' ? 'DISCONNECTED' : next === 'ERROR' ? 'ERROR' : engine.transportState;
    if (transport !== engine.transportState) { const old = engine.transportState; engine.transportState = transport; engine.emit(`transport.${transport.toLowerCase()}`, { previous: old, next: transport, reason }); }
    if (engine.session && next === 'ERROR') engine.session.errors.push({ at: iso(), reason });
    engine.emit('state.changed', { previous, next, reason, transport_state: engine.transportState, source_state: engine.sourceState, dimension: 'transport' });
  };
  engine.videoAgeMs = () => engine.lastFreshVideoAt ? Math.max(0, Date.now() - Date.parse(engine.lastFreshVideoAt)) : null;
  engine.onFreshVideo = () => { engine.lastFreshVideoAt = iso(); if (engine.sourceState !== 'SOURCE_LIVE') engine.setSourceState('SOURCE_LIVE', 'fresh video frame received'); };
  engine.overlayFilter = () => {
    const o = engine.overlays; const font = 'fontfile=C\\\\:/Windows/Fonts/arial.ttf'; const pieces = [];
    if (o.bug.enabled) pieces.push(`drawbox=x=20:y=20:w=250:h=55:color=black@0.65:t=fill,drawtext=${font}:text='${o.bug.text.replace(/'/g, '')}':fontcolor=white:fontsize=24:x=38:y=35`);
    if (o.live.enabled && engine.sourceState === 'SOURCE_LIVE') pieces.push(`drawbox=x=275:y=20:w=95:h=55:color=0xD60000@1:t=fill,drawtext=${font}:text='${o.live.text.replace(/'/g, '')}':fontcolor=white:fontsize=22:x=293:y=36`);
    if (o.lowerThird.enabled && o.lowerThird.text) pieces.push(`drawbox=x=28:y=h-130:w=900:h=85:color=black@0.72:t=fill,drawtext=${font}:text='${o.lowerThird.text.replace(/'/g, '')}':fontcolor=white:fontsize=32:x=55:y=h-100`);
    if (o.sourceName.enabled) pieces.push(`drawtext=${font}:text='${o.callsign.replace(/'/g, '')} / ${o.vehicle.replace(/'/g, '')}':fontcolor=white@0.85:fontsize=18:x=w-220:y=h-40`);
    if (engine.sourceState === 'SOURCE_STALE') pieces.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0xD08A00@0.20:t=fill,drawbox=x=25:y=h-115:w=640:h=74:color=0xA86E00@0.88:t=fill,drawtext=${font}:text='SIGNAL DELAYED - SOURCE STALE':fontcolor=white:fontsize=28:x=50:y=h-88`);
    if (engine.sourceState === 'SOURCE_LOST') pieces.push(`drawbox=x=0:y=0:w=iw:h=ih:color=black@0.65:t=fill,drawtext=${font}:text='SOURCE LOST':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2`);
    return pieces.join(',') || 'null';
  };
  engine.programFilter = () => {
    const { width, height, fps } = engine.config.source;
    return `[0:v]fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p,split=2[clean][program_base];[program_base]${engine.overlayFilter()}[program]`;
  };
  engine.previews = new PreviewManager(engine, root); engine.audioProbe = new AudioProbe(engine);
  engine.privateOutput = new PrivateOutput(engine); engine.cleanSink = new CleanSink(engine, root);
  const start = engine.startRecording.bind(engine); engine.startRecording = () => { const result = start(); if (result.changed) { engine.session = { session_id: crypto.randomUUID(), created_at: iso(), source: 'nick', vehicle: engine.overlays.vehicle, callsign: engine.overlays.callsign, source_state: engine.state, recording_state: engine.config.recording.writeToDisk === false ? 'DISABLED' : 'STARTING', output_state: 'OFF', started_at: iso(), ended_at: null, reconnect_count: 0, errors: [] }; engine.previews.start(); engine.audioProbe.start(); engine.emit('recording.started', { session_id: engine.session.session_id, write_to_disk: engine.config.recording.writeToDisk !== false }); } return result; };
  const stop = engine.stopRecording.bind(engine); engine.stopRecording = () => { const result = stop(); if (result.changed) { engine.previews.stop(); engine.audioProbe.stop(); engine.sourceState = 'WAITING_FOR_SOURCE'; engine.transportState = 'DISCONNECTED'; engine.lastFreshVideoAt = null; if (engine.session) { engine.session.recording_state = 'STOPPED'; engine.session.source_state = 'WAITING_FOR_SOURCE'; engine.session.ended_at = iso(); } engine.emit('recording.stopped'); } return result; };
  engine.setOverlays = (value) => { if (!value || typeof value !== 'object') throw new Error('overlay payload must be an object'); const allowed = ['bug', 'live', 'lowerThird', 'sourceName', 'connection', 'clock', 'vehicle', 'callsign']; for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`unsupported overlay field: ${key}`); if (value.lowerThird && typeof value.lowerThird.text === 'string' && value.lowerThird.text.length > 120) throw new Error('lower third text exceeds 120 characters'); for (const key of allowed) if (value[key] !== undefined) { if (typeof engine.overlays[key] === 'object' && typeof value[key] === 'object') Object.assign(engine.overlays[key], value[key]); else engine.overlays[key] = value[key]; } engine.previews.restartProgram(); engine.emit('overlay.changed', { overlays: engine.overlays }); return engine.overlays; };
  engine.getMetrics = () => { const audioAt = engine.audioProbe.status().lastAudioAt; const age = engine.videoAgeMs(); return { video_fps: engine.lastProgress.fps || null, encode_fps: engine.lastProgress.fps || null, output_bitrate: engine.lastProgress.bitrate || null, dropped_frames: null, source_bitrate: null, last_video_timestamp: engine.lastFreshVideoAt, video_age_ms: age, source_age_seconds: age === null ? null : age / 1000, last_audio_timestamp: audioAt, audio_age_ms: audioAt ? Math.max(0, Date.now()-Date.parse(audioAt)) : null, av_delta_ms: null, reconnect_count: engine.retryCount, unavailable: ['dropped_frames', 'source_bitrate', 'av_delta_ms'] }; };
  engine.healthTimer = setInterval(() => { if (!engine.recordingRequested || !engine.lastFreshVideoAt) return; const age = engine.videoAgeMs(); const health = engine.config.sourceHealth; if (age >= health.lostAfterMs) engine.setSourceState('SOURCE_LOST', `no fresh video for ${Math.round(age)}ms`); else if (age >= health.staleAfterMs) engine.setSourceState('SOURCE_STALE', `no fresh video for ${Math.round(age)}ms`); }, 250);
  engine.ownershipPath = path.join(root, 'runtime', 'output-ownership.json');
  engine.ownership = () => { try { const value = JSON.parse(fs.readFileSync(engine.ownershipPath, 'utf8')); if (value.pid) { const actualStart = processStartUtc(value.pid); if (!actualStart || (value.process_started_at && actualStart !== value.process_started_at)) { fs.unlinkSync(engine.ownershipPath); return { owner: 'NONE', stale_recovered: true }; } } return value; } catch { return { owner: 'NONE' }; } };
  engine.acquireTestOwnership = () => { const current = engine.ownership(); if (current.owner !== 'NONE' && current.pid !== process.pid) { const e = new Error(`ownership conflict: ${current.owner}`); e.statusCode = 409; throw e; } const value = { owner: 'NATIVE', scope: 'PRIVATE_TEST', pid: process.pid, process_started_at: processStartUtc(process.pid), owner_id: crypto.randomUUID(), acquired_at: iso() }; fs.writeFileSync(engine.ownershipPath, JSON.stringify(value)); return value; };
  engine.releaseTestOwnership = () => { try { fs.unlinkSync(engine.ownershipPath); } catch {} return { owner: 'NONE' }; };
  engine.lockHolder = null;
  engine.startLockHolder = () => { if (engine.lockHolder) throw new Error('test lock holder already running'); engine.releaseTestOwnership(); const helper=path.join(root,'test','lock-holder.js'); engine.lockHolder=childProcess.spawn(process.execPath,[helper,engine.ownershipPath],{windowsHide:true,stdio:'ignore'}); return { pid:engine.lockHolder.pid }; };
  engine.crashLockHolder = () => { if (!engine.lockHolder) throw new Error('test lock holder is not running'); engine.lockHolder.kill('SIGKILL'); engine.lockHolder=null; return { crashed:true }; };
  const priorStatus = engine.status.bind(engine); engine.status = () => ({ ...priorStatus(), stateRevision: engine.stateRevision, transport_state: engine.transportState, source_state: engine.sourceState, previews: engine.previews.status(), overlays: engine.overlays, audio: engine.audioProbe.status(), metrics: engine.getMetrics(), session: engine.session, ownership: engine.ownership(), privateOutput: engine.privateOutput.status(), cleanSink: engine.cleanSink.status() });
  return { html };
}

module.exports = { enableMilestone2, html };
