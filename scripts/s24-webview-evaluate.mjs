import { execFileSync } from "node:child_process";

const [, , serial, packageName, expression] = process.argv;

if (!serial || !packageName || !expression) {
  console.error("Usage: node scripts/s24-webview-evaluate.mjs <serial> <package> <expression>");
  process.exit(2);
}

function adb(args) {
  return execFileSync("adb", ["-s", serial, ...args], { encoding: "utf8" }).trim();
}

const pid = adb(["shell", "pidof", packageName]).split(/\s+/)[0];
if (!pid) {
  throw new Error(`Could not find running PID for ${packageName}`);
}

adb(["forward", "tcp:9222", `localabstract:webview_devtools_remote_${pid}`]);

const targets = await fetch("http://127.0.0.1:9222/json").then((response) => response.json());
const target = targets.find((item) => item.webSocketDebuggerUrl && item.type === "page") ?? targets.find((item) => item.webSocketDebuggerUrl);
if (!target) {
  throw new Error("No WebView DevTools target with a websocket debugger URL was found.");
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
  else resolve(message.result);
});

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

function send(method, params) {
  const id = nextId++;
  const payload = { id, method, params };
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  ws.send(JSON.stringify(payload));
  return promise;
}

const result = await send("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
});

ws.close();

if (result.exceptionDetails) {
  throw new Error(result.exceptionDetails.text || "WebView expression failed.");
}

const value = result.result?.value;
if (typeof value === "string") console.log(value);
else console.log(JSON.stringify(value ?? null));
