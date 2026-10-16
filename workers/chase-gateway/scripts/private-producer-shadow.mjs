import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { open, readFile, rename, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const readRoutes = new Set(["/api/producer/v1/status", "/api/producer/v1/capabilities", "/api/producer/v1/preview/program.jpg"]);
const writeRoutes = new Set(["/api/producer/v1/workstation/status", "/api/producer/v1/workstation/capabilities", "/api/producer/v1/workstation/preview/program.jpg"]);
const mediaRead = /^\/api\/producer\/v1\/preview\/hls\/(?:index\.m3u8|program-[0-9a-f]{32}-[0-9]{1,16}\.ts)$/;
const mediaWrite = /^\/api\/producer\/v1\/workstation\/preview\/hls\/(?:index\.m3u8|program-[0-9a-f]{32}-[0-9]{1,16}\.ts)$/;
const transientKey = key => key === "program-frame" || key.startsWith("program-hls-");

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(body));
}

function matchesToken(actual, expected) {
  if (!expected || expected.length < 32 || !actual?.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(actual.slice(7)).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(given, wanted);
}

export async function createShadowStorage(path) {
  const file = resolve(path);
  let durable = {};
  try {
    if ((await stat(file)).size > 2_000_000) throw new Error("Private Producer state too large");
    const document = JSON.parse(await readFile(file, "utf8"));
    if (document?.version !== 1 || !document.values || typeof document.values !== "object" || Array.isArray(document.values))
      throw new Error("Invalid Private Producer state");
    durable = document.values;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const transient = new Map();
  let revision = 0;
  return {
    async get(key) {
      const value = transientKey(key) ? transient.get(key) : durable[key];
      return value === undefined ? undefined : structuredClone(value);
    },
    async put(key, value) {
      if (transientKey(key)) { transient.set(key, structuredClone(value)); return; }
      const next = { ...durable, [key]: structuredClone(value) };
      const bytes = Buffer.from(JSON.stringify({ version: 1, values: next }));
      if (bytes.length > 2_000_000) throw new Error("Private Producer state too large");
      const temp = `${file}.${process.pid}.${++revision}.tmp`;
      const handle = await open(temp, "wx", 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temp, file);
      durable = next;
    },
  };
}

export function createPrivateProducerShadow({ token, storage, bridge, controls = false }) {
  if (!token || token.length < 32) throw new Error("Private Producer shadow token must contain at least 32 characters");
  let queue = Promise.resolve();
  return createServer((incoming, response) => {
    const handle = async () => {
      let path;
      if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) {
        json(response, 400, { error: "INVALID_PATH" }); return;
      }
      try { path = new URL(incoming.url, "http://localhost").pathname; }
      catch { json(response, 400, { error: "INVALID_PATH" }); return; }
      if (path === "/health" && incoming.method === "GET") {
        json(response, 200, { service: "private-producer-shadow", status: "ready", controls: controls ? "qualified-adapter" : "disabled" }); return;
      }
      if (!matchesToken(incoming.headers.authorization, token)) { json(response, 401, { error: "AUTH_REQUIRED" }); return; }
      const controlRead = controls && ["/api/producer/v1/workstation/commands", "/api/producer/v1/launcher"].includes(path);
      const commandRead = controls && /^\/api\/producer\/v1\/commands\/[0-9a-f-]{36}$/.test(path);
      const controlWrite = controls && ["/api/producer/v1/workstation/heartbeat", "/api/producer/v1/workstation/ack", "/api/producer/v1/workstation/launcher/poll", "/api/producer/v1/commands", "/api/producer/v1/control-lease", "/api/producer/v1/launcher/prepare"].includes(path);
      const canRead = incoming.method === "GET" && (readRoutes.has(path) || mediaRead.test(path) || controlRead || commandRead);
      const canWrite = incoming.method === "POST" && (writeRoutes.has(path) || mediaWrite.test(path) || controlWrite);
      const canDelete = controls && incoming.method === "DELETE" && path === "/api/producer/v1/control-lease";
      if (!canRead && !canWrite && !canDelete) { json(response, 503, { error: "SHADOW_READ_ONLY" }); return; }
      const maxBytes = path.endsWith("program.jpg") ? 2 * 1024 * 1024 : path.endsWith(".ts") ? 512 * 1024 : 64 * 1024;
      let body;
      if (canWrite) {
        const chunks = [];
        let size = 0;
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > maxBytes) { json(response, 413, { error: "REQUEST_TOO_LARGE" }); return; }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
      const headers = new Headers();
      for (const name of ["Content-Type", "X-Producer-Frame-At", "X-Producer-Composition", "X-Producer-UserId", "X-Producer-Operator"]) {
        const value = incoming.headers[name.toLowerCase()];
        if (value) headers.set(name, value);
      }
      const request = new Request(`http://localhost${incoming.url}`, { method: incoming.method, headers, ...(canWrite ? { body } : {}) });
      const upstream = await bridge(request, storage);
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      if (!upstream.body) { response.end(); return; }
      Readable.fromWeb(upstream.body).on("error", () => response.destroy()).pipe(response);
    };
    const current = queue.then(handle).catch(() => {
      if (!response.headersSent) json(response, 503, { error: "PRIVATE_PRODUCER_UNAVAILABLE", outcome: "unknown" }); else response.destroy();
    });
    queue = current;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.OPS_PRIVATE_PRODUCER_PORT);
  const token = process.env.OPS_PRIVATE_PRODUCER_TOKEN;
  const statePath = process.env.OPS_PRIVATE_PRODUCER_STATE;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !statePath) throw new Error("Private Producer shadow config invalid");
  const { handleProducerStateRequest } = await import("../dist-private/producer-bridge.mjs");
  const storage = await createShadowStorage(statePath);
  createPrivateProducerShadow({ token, storage, bridge: handleProducerStateRequest, controls: process.env.OPS_PRIVATE_PRODUCER_CONTROLS_ENABLED === "true" }).listen(port, "127.0.0.1", () => {
    console.log(`Private Producer shadow listening on 127.0.0.1:${port}`);
  });
}
