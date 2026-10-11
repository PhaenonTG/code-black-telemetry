// Read-only Core-local Fabric companion feed. Delivery is independently gated
// from scan collection; a file-only canary cannot leak experimental alerts.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const DATA = process.env.CODEBLACK_AEGIS_RADAR_DATA || "/srv/codeblack/data/radar-worker/aegis-warning";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function readEvents(dir, after = 0, limit = 100) {
  const file = path.join(dir, "alerts.jsonl");
  let data;
  try { data = fs.readFileSync(file, "utf8"); } catch { return []; }
  // Bound the read size and reject a too-large journal until it is archived.
  if (Buffer.byteLength(data) > 8 * 1024 * 1024) throw new Error("alert journal needs rotation");
  return data.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter((event) => Number.isInteger(event.sequence) && event.sequence > after)
    .slice(0, limit);
}
function respond(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Content-Length": Buffer.byteLength(json) });
  res.end(json);
}
function handler(dir = DATA) {
  return (req, res) => {
    if (req.method !== "GET") return respond(res, 405, { error: "method_not_allowed" });
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/health") return respond(res, 200, { status: "ok", service: "aegis-radar-feed" });
    const cfg = readJson(path.join(dir, "config.json"), {});
    const status = readJson(path.join(dir, "status.json"), { state: "not_run" });
    if (url.pathname === "/api/fabric/v1/aegis-status") return respond(res, 200, {
      schema: "codeblack.fabric.aegis-status.v1", delivery_enabled: cfg.delivery_enabled === true,
      screen: status });
    if (url.pathname !== "/api/fabric/v1/aegis-alerts") return respond(res, 404, { error: "not_found" });
    const after = Number(url.searchParams.get("after") || 0);
    const limit = Number(url.searchParams.get("limit") || 100);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      return respond(res, 400, { error: "invalid_cursor_or_limit" });
    if (cfg.delivery_enabled !== true) return respond(res, 200, {
      schema: "codeblack.fabric.aegis-alert-feed.v1", state: "shadow", items: [], next_cursor: after });
    try {
      const items = readEvents(dir, after, limit);
      return respond(res, 200, { schema: "codeblack.fabric.aegis-alert-feed.v1", state: "live", items,
        next_cursor: items.at(-1)?.sequence || after });
    } catch { return respond(res, 503, { error: "journal_unavailable" }); }
  };
}

if (require.main === module) {
  const port = Number(process.env.CODEBLACK_AEGIS_FEED_PORT || 8789);
  http.createServer(handler()).listen(port, "127.0.0.1", () =>
    console.log(`Aegis radar feed on 127.0.0.1:${port}`));
}
module.exports = { readEvents, handler };
