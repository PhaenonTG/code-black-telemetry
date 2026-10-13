'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { hlsArgs } = require('../milestone2');
const { programSegments } = require('../program-monitor');

test('real FFmpeg PROGRAM HLS decodes as H264 plus stereo AAC', { skip: !process.env.CODEBLACK_TEST_FFMPEG, timeout: 20000 }, async () => {
  const ffmpeg = process.env.CODEBLACK_TEST_FFMPEG;
  const root = process.env.PROGRAM_MONITOR_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'codeblack-monitor-codec-'));
  fs.mkdirSync(root, { recursive: true });
  const input = path.join(root, 'synthetic-source.mp4');
  childProcess.execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', input], { windowsHide: true, timeout: 10000 });
  const directory = path.join(root, 'hls');
  const args = hlsArgs(ffmpeg, input, directory, true, 'null');
  args.splice(args.indexOf('-i'), 0, '-re', '-stream_loop', '-1');
  const encoder = childProcess.spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostic = ''; encoder.stderr.on('data', data => { diagnostic += data; });
  try {
    const deadline = Date.now() + 8000; let manifest; let names;
    do {
      await new Promise(resolve => setTimeout(resolve, 100));
      try { manifest = fs.readFileSync(path.join(directory, 'index.m3u8'), 'utf8'); names = programSegments(manifest); } catch {}
    } while ((!names || names.length < 2) && Date.now() < deadline);
    assert.ok(names?.length >= 2, diagnostic);
    const segment = path.join(directory, names.at(-1));
    const ffprobe = path.join(path.dirname(ffmpeg), 'ffprobe.exe');
    const metadata = JSON.parse(childProcess.execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,channels,sample_rate,width,height', '-of', 'json', segment], { windowsHide: true, timeout: 5000, encoding: 'utf8' }));
    assert.ok(metadata.streams.some(stream => stream.codec_name === 'h264' && stream.width === 640 && stream.height === 360));
    assert.ok(metadata.streams.some(stream => stream.codec_name === 'aac' && stream.channels === 2 && stream.sample_rate === '48000'));
    childProcess.execFileSync(ffmpeg, ['-v', 'error', '-i', segment, '-t', '1', '-f', 'null', 'NUL'], { windowsHide: true, timeout: 5000 });
    fs.writeFileSync(path.join(root, 'captured-live.m3u8'), manifest);
    fs.copyFileSync(segment, path.join(root, 'captured-program.ts'));
    fs.writeFileSync(path.join(root, 'codec-evidence.json'), JSON.stringify(metadata, null, 2));
  } finally { encoder.kill('SIGTERM'); }
});
