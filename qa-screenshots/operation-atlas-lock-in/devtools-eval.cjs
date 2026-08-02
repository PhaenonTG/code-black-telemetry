const port = process.argv[2] || '9229';
const expression = process.argv.slice(3).join(' ');
async function main() {
  const pages = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl) || pages.find((p) => p.webSocketDebuggerUrl);
  if (!page) throw new Error('No debuggable WebView page found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DevTools timeout')), 10000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
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
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
