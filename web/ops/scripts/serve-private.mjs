import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/")
    || pathname === "/overlay-core" || pathname.startsWith("/overlay-core/");
}

function inside(root, target) {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function sendCoreResponse(request, response, gateway) {
  let body;
  if (request.method === "POST" || request.method === "PUT") {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 4096) { json(response, 413, { error: "REQUEST_TOO_LARGE" }); return; }
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }
  const origin = `http://127.0.0.1${request.url}`;
  const webRequest = new Request(origin, {
    method: request.method,
    headers: request.headers,
    ...(body === undefined ? {} : { body }),
  });
  const upstream = await gateway(webRequest);
  response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
  if (!upstream.body) { response.end(); return; }
  const stream = Readable.fromWeb(upstream.body);
  response.on("close", () => stream.destroy());
  stream.on("error", () => response.destroy()).pipe(response);
}

export function createPrivateOpsServer({ distDir = defaultDist, apiGateway } = {}) {
  const root = resolve(distDir);
  return createServer(async (request, response) => {
    if (request.url?.startsWith("/api/core/") || request.url?.startsWith("/overlay-core/")) {
      if (!apiGateway) { json(response, 503, { error: "PRIVATE_ROUTE_NOT_MIGRATED" }); return; }
      try { await sendCoreResponse(request, response, apiGateway); }
      catch { if (!response.headersSent) json(response, 502, { error: "CORE_UNAVAILABLE" }); else response.destroy(); }
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      json(response, 405, { error: "METHOD_NOT_ALLOWED" });
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
    catch { json(response, 400, { error: "INVALID_PATH" }); return; }
    if (pathname.includes("\0") || pathname.includes("\\")) {
      json(response, 400, { error: "INVALID_PATH" });
      return;
    }
    if (pathname === "/health") {
      json(response, 200, { service: "private-ops-candidate", status: "ready" });
      return;
    }
    if (isApiPath(pathname)) {
      json(response, 503, { error: "PRIVATE_ROUTE_NOT_MIGRATED" });
      return;
    }

    const target = resolve(root, `.${pathname}`);
    if (!inside(root, target)) { json(response, 400, { error: "INVALID_PATH" }); return; }
    let file = target;
    let info;
    try { info = await stat(file); } catch { /* SPA route or missing asset */ }
    if (info?.isDirectory()) {
      file = join(file, "index.html");
      try { info = await stat(file); } catch { info = undefined; }
    }
    if (!info?.isFile()) {
      const wantsHtml = (request.headers.accept ?? "").includes("text/html");
      if (extname(pathname) || !wantsHtml) { json(response, 404, { error: "NOT_FOUND" }); return; }
      file = join(root, "index.html");
      try { info = await stat(file); } catch { info = undefined; }
      if (!info?.isFile()) { json(response, 503, { error: "OPS_BUILD_MISSING" }); return; }
    }
    if (!inside(root, file)) { json(response, 400, { error: "INVALID_PATH" }); return; }
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    });
    if (request.method === "HEAD") { response.end(); return; }
    createReadStream(file).on("error", () => response.destroy()).pipe(response);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rawPort = process.env.OPS_PRIVATE_PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("OPS_PRIVATE_PORT must be an unprivileged TCP port");
  }
  const distDir = process.env.OPS_PRIVATE_DIST || defaultDist;
  let apiGateway;
  if (process.env.OPS_PRIVATE_CORE_BASE_URL) {
    const { handlePrivateApiRequest } = await import("../dist-private/core-gateway.mjs");
    const env = {
      OPS_PRIVATE_CORE_BASE_URL: process.env.OPS_PRIVATE_CORE_BASE_URL,
      OPS_PRIVATE_WRITE_SECRET: process.env.OPS_PRIVATE_WRITE_SECRET,
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      MAPBOX_PUBLIC_TOKEN: process.env.MAPBOX_PUBLIC_TOKEN,
    };
    apiGateway = request => handlePrivateApiRequest(request, env);
  }
  createPrivateOpsServer({ distDir, apiGateway }).listen(port, "127.0.0.1", () => {
    console.log(`Private Ops candidate listening on 127.0.0.1:${port}`);
  });
}
