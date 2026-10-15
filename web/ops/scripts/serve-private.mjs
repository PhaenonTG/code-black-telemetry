import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
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

export function createPrivateOpsServer({ distDir = defaultDist } = {}) {
  const root = resolve(distDir);
  return createServer(async (request, response) => {
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
  createPrivateOpsServer({ distDir }).listen(port, "127.0.0.1", () => {
    console.log(`Private Ops candidate listening on 127.0.0.1:${port}`);
  });
}
