import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
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
  const controller = new AbortController();
  const cleanup = () => {
    request.removeListener("aborted", abort);
    response.removeListener("close", abort);
    response.removeListener("finish", cleanup);
  };
  const abort = () => { controller.abort(); cleanup(); };
  request.once("aborted", abort);
  response.once("close", abort);
  response.once("finish", cleanup);
  let body;
  if (request.method === "POST" || request.method === "PUT") {
    const chunks = [];
    let size = 0;
    const path = request.url?.split("?", 1)[0] ?? "";
    const workstation = path.startsWith("/api/producer/v1/workstation/");
    const maxBytes = request.method === "PUT" ? 64 * 1024 :
      workstation && path.endsWith("/preview/program.jpg") ? 2 * 1024 * 1024 :
      workstation && path.endsWith(".ts") ? 512 * 1024 :
      workstation ? 64 * 1024 :
      path.startsWith("/api/kandrive/graphql") ? 24_000 : 4096;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) { json(response, 413, { error: "REQUEST_TOO_LARGE" }); return; }
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }
  const scheme = request.socket.encrypted ? "https" : "http";
  const origin = `${scheme}://${request.headers.host || "127.0.0.1"}${request.url}`;
  const webRequest = new Request(origin, {
    method: request.method,
    headers: request.headers,
    signal: controller.signal,
    ...(body === undefined ? {} : { body }),
  });
  const upstream = await gateway(webRequest);
  if (response.destroyed) { await upstream.body?.cancel(); return; }
  response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
  if (!upstream.body) { response.end(); return; }
  const stream = Readable.fromWeb(upstream.body);
  response.on("close", () => stream.destroy());
  stream.on("error", () => response.destroy()).pipe(response);
}

export function createPrivateOpsServer({ distDir = defaultDist, apiGateway, tls, allowedHostname } = {}) {
  const root = resolve(distDir);
  const handle = async (request, response) => {
    if (allowedHostname) {
      let hostname;
      try { hostname = new URL(`http://${request.headers.host}`).hostname.toLowerCase(); }
      catch { json(response, 400, { error: "INVALID_HOST" }); return; }
      if (hostname !== allowedHostname.toLowerCase()) { json(response, 421, { error: "INVALID_HOST" }); return; }
    }
    if (request.url?.startsWith("/api/v1/radar/") || request.url?.startsWith("/api/core/") || request.url?.startsWith("/api/producer/v1/") || request.url?.startsWith("/overlay-core/") ||
        request.url?.startsWith("/api/camera-health") || request.url?.startsWith("/api/ardot-camera-stream") ||
        request.url?.startsWith("/api/kandrive/") || request.url?.startsWith("/api/modot/") ||
        request.url?.startsWith("/api/odot/") || request.url?.startsWith("/api/tdot/")) {
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
  };
  return tls ? createSecureServer(tls, handle) : createServer(handle);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rawPort = process.env.OPS_PRIVATE_PORT;
  const port = Number(rawPort);
  const tlsCert = process.env.OPS_PRIVATE_TLS_CERT;
  const tlsKey = process.env.OPS_PRIVATE_TLS_KEY;
  if (Boolean(tlsCert) !== Boolean(tlsKey)) throw new Error("Both private TLS paths are required");
  if (!Number.isInteger(port) || port < (tlsCert ? 1 : 1024) || port > 65535) {
    throw new Error("OPS_PRIVATE_PORT is invalid");
  }
  const bindHost = process.env.OPS_PRIVATE_BIND_HOST || "127.0.0.1";
  const allowedHostname = process.env.OPS_PRIVATE_HOSTNAME;
  if (!isIP(bindHost) || ["0.0.0.0", "::"].includes(bindHost)) throw new Error("OPS_PRIVATE_BIND_HOST must be a specific IP");
  if (bindHost !== "127.0.0.1" && bindHost !== "::1" && !tlsCert)
    throw new Error("A non-loopback private listener requires TLS");
  if (bindHost !== "127.0.0.1" && bindHost !== "::1" && !allowedHostname)
    throw new Error("A non-loopback private listener requires OPS_PRIVATE_HOSTNAME");
  if (allowedHostname && !/^[a-z0-9.-]+$/i.test(allowedHostname)) throw new Error("OPS_PRIVATE_HOSTNAME is invalid");
  const tls = tlsCert ? { cert: await readFile(tlsCert), key: await readFile(tlsKey) } : undefined;
  const distDir = process.env.OPS_PRIVATE_DIST || defaultDist;
  let apiGateway;
  if (process.env.OPS_PRIVATE_RADAR_BASE_URL || process.env.OPS_PRIVATE_CORE_BASE_URL || process.env.OPS_PRIVATE_PRODUCER_BASE_URL) {
    const { handlePrivateApiRequest } = await import("../dist-private/core-gateway.mjs");
    const env = {
      OPS_PRIVATE_RADAR_BASE_URL: process.env.OPS_PRIVATE_RADAR_BASE_URL,
      OPS_PRIVATE_RADAR_SITE: process.env.OPS_PRIVATE_RADAR_SITE,
      OPS_PRIVATE_CORE_BASE_URL: process.env.OPS_PRIVATE_CORE_BASE_URL,
      OPS_PRIVATE_WRITE_SECRET: process.env.OPS_PRIVATE_WRITE_SECRET || process.env.CODEBLACK_OPS_WRITE_SECRET,
      OPS_PRIVATE_PRODUCER_BASE_URL: process.env.OPS_PRIVATE_PRODUCER_BASE_URL,
      OPS_PRIVATE_PRODUCER_TOKEN: process.env.OPS_PRIVATE_PRODUCER_TOKEN,
      OPS_PRIVATE_PRODUCER_CONTROLS_ENABLED: process.env.OPS_PRIVATE_PRODUCER_CONTROLS_ENABLED,
      OPS_PRIVATE_PRODUCER_OPERATOR_IDS: process.env.OPS_PRIVATE_PRODUCER_OPERATOR_IDS,
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      MAPBOX_PUBLIC_TOKEN: process.env.MAPBOX_PUBLIC_TOKEN,
      ODOT_WZDX_ACCESS_TOKEN: process.env.ODOT_WZDX_ACCESS_TOKEN,
    };
    apiGateway = request => handlePrivateApiRequest(request, env);
  }
  createPrivateOpsServer({ distDir, apiGateway, tls, allowedHostname }).listen(port, bindHost, () => {
    console.log(`Private Ops candidate listening on ${bindHost}:${port}`);
  });
}
