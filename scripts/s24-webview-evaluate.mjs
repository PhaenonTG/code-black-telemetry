import { execFileSync } from "node:child_process";

const [, , serial, packageName, expression] = process.argv;

if (!serial || !packageName || !expression) {
  console.error("Usage: node scripts/s24-webview-evaluate.mjs <serial> <package> <expression>");
  process.exit(2);
}

function adb(args) {
  return execFileSync("adb", ["-s", serial, ...args], { encoding: "utf8" }).trim();
}

const deadline = Date.now() + 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let pid = "";
while (Date.now() < deadline && !pid) {
  pid = adb(["shell", "pidof", packageName]).split(/\s+/)[0] ?? "";
  if (!pid) await sleep(500);
}
if (!pid) {
  throw new Error(`Could not find running PID for ${packageName} within 30s`);
}

adb(["forward", "tcp:9222", `localabstract:webview_devtools_remote_${pid}`]);

let targets = [];
while (Date.now() < deadline) {
  targets = await fetch("http://127.0.0.1:9222/json").then((response) => response.json()).catch(() => []);
  if (targets.some((item) => item.webSocketDebuggerUrl)) break;
  await sleep(500);
}
const target = targets.find((item) => item.webSocketDebuggerUrl && item.type === "page") ?? targets.find((item) => item.webSocketDebuggerUrl);
if (!target) {
  throw new Error("No WebView DevTools target with a websocket debugger URL was found within 30s.");
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
  const details = result.exceptionDetails;
  const description =
    details.exception?.description ||
    details.exception?.value ||
    details.text ||
    "WebView expression failed.";
  throw new Error(description);
}

const value = result.result?.value;
if (typeof value === "string") console.log(value);
else console.log(JSON.stringify(value ?? null));
