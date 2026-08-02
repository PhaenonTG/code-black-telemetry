const fs = require('fs');
const port = process.argv[2] || '9229';
const outPath = process.argv[3];
const expression = `(() => {
  const readJson = (key) => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (error) { return { error: String(error) }; } };
  const canvases = Array.from(document.querySelectorAll('canvas')).map((canvas) => {
    const rect = canvas.getBoundingClientRect();
    let glInfo = null;
    try {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (gl) glInfo = { drawingBufferWidth: gl.drawingBufferWidth, drawingBufferHeight: gl.drawingBufferHeight };
    } catch (error) { glInfo = { error: String(error) }; }
    return { className: String(canvas.className || ''), width: canvas.width, height: canvas.height, rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, glInfo };
  });
  return {
    href: location.href,
    title: document.title,
    dpr: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    atlas: readJson('codeblack.atlas.diagnostics'),
    map: readJson('codeblack.map.diagnostics'),
    engine: localStorage.getItem('codeblack.map.engine'),
    expandedActive: !!document.querySelector('.radar-expanded'),
    legacyMapMounted: !!document.querySelector('.tile-grid'),
    atlasMapMounted: !!document.querySelector('.atlas-map'),
    canvasCount: canvases.length,
    canvases,
    mapboxMaps: document.querySelectorAll('.mapboxgl-map').length,
    screenshotBytesRetained: 0,
    timestamp: Date.now()
  };
})()`;
async function main() {
  const pages = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl) || pages.find((p) => p.webSocketDebuggerUrl);
  if (!page) throw new Error('No debuggable WebView page found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DevTools timeout')), 10000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: false } }));
    ws.onerror = (event) => reject(new Error(String(event.message || event.type || 'WebSocket error')));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result?.result?.value ?? message.result);
      ws.close();
    };
  });
  const text = JSON.stringify(result, null, 2);
  if (outPath) fs.writeFileSync(outPath, text);
  else console.log(text);
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
