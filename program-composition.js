'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function validateOverlayPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw new Error('Overlay settings must be a non-empty object.');
  for (const [key, item] of Object.entries(value)) {
    if (['callsign', 'vehicle'].includes(key)) {
      if (typeof item !== 'string' || !item.trim() || item.length > 24 || /[\x00-\x1f\x7f]/.test(item)) throw new Error('Source labels must be 1–24 printable characters.');
    } else if (['bug', 'live', 'lowerThird', 'sourceName'].includes(key)) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !Object.keys(item).length) throw new Error('Invalid overlay setting.');
      for (const [field, next] of Object.entries(item)) {
        if (field === 'enabled' && typeof next === 'boolean') continue;
        if (field === 'text' && ['bug', 'lowerThird'].includes(key) && typeof next === 'string' && next.length <= (key === 'bug' ? 24 : 120) && !/[\x00-\x1f\x7f]/.test(next)) continue;
        throw new Error('Unsupported overlay setting.');
      }
    } else throw new Error('Unsupported overlay field.');
  }
  return value;
}

function canvasBase({ width, height, fps }) {
  if (![width, height, fps].every(Number.isSafeInteger) || width < 320 || width > 3840 || height < 180 || height > 2160 || fps < 1 || fps > 60) throw new Error('Invalid PROGRAM format.');
  return `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`;
}
function programCanvas(profile, overlay) { return `${canvasBase(profile)},${overlay}`; }
function compositionId(overlays, sourceState, profile) { return crypto.createHash('sha256').update(JSON.stringify({ overlays, sourceState, width: profile.width, height: profile.height, fps: profile.fps })).digest('hex').slice(0, 24); }
function overlayFilter(root, overlays, sourceState) {
  const directory = path.join(root, 'runtime', 'overlay-text'); fs.mkdirSync(directory, { recursive: true });
  const font = 'fontfile=C\\\\:/Windows/Fonts/arial.ttf';
  const text = (name, value) => {
    const file = path.join(directory, name + '.txt');
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== value) fs.writeFileSync(file, value, 'utf8');
    const escaped = file.replace(/\\/g, '/').replace(/:/g, '\\:');
    return `drawtext=${font}:textfile='${escaped}':expansion=none`;
  };
  const pieces = [];
  if (overlays.bug.enabled) pieces.push(`${text('bug', overlays.bug.text)}:fontcolor=white:fontsize=24:x=38:y=35:box=1:boxcolor=black@0.65:boxborderw=16`);
  if (overlays.live.enabled && sourceState === 'SOURCE_LIVE') pieces.push(`drawbox=x=iw-130:y=20:w=95:h=55:color=0xD60000@1:t=fill,drawtext=${font}:text='LIVE':fontcolor=white:fontsize=22:x=w-112:y=36`);
  if (overlays.lowerThird.enabled && overlays.lowerThird.text) {
    const wrapped = (overlays.lowerThird.text.match(/.{1,65}/gu) || []).join('\n');
    pieces.push(`drawbox=x=28:y=ih-150:w=iw-56:h=112:color=black@0.72:t=fill,${text('lower-third', wrapped)}:fontcolor=white:fontsize=32:line_spacing=6:x=55:y=h-130`);
  }
  if (overlays.sourceName.enabled) pieces.push(`${text('source-name', `${overlays.callsign} / ${overlays.vehicle}`)}:fontcolor=white@0.85:fontsize=18:x=w-text_w-28:y=h-30`);
  if (sourceState === 'SOURCE_STALE') pieces.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0xD08A00@0.20:t=fill,drawtext=${font}:text='SIGNAL DELAYED - SOURCE STALE':fontcolor=white:fontsize=28:x=50:y=h-88`);
  if (sourceState === 'SOURCE_LOST') pieces.push(`drawbox=x=0:y=0:w=iw:h=ih:color=black@0.65:t=fill,drawtext=${font}:text='SOURCE LOST':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2`);
  return pieces.join(',') || 'null';
}
module.exports = { validateOverlayPatch, canvasBase, programCanvas, compositionId, overlayFilter };
