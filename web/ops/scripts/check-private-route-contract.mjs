#!/usr/bin/env node

const rawOrigin = process.argv[2];
if (!rawOrigin) {
  console.error("Usage: node scripts/check-private-route-contract.mjs https://private-ops-host");
  process.exit(2);
}

let origin;
try {
  origin = new URL(rawOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/")
    throw new Error("invalid origin");
} catch {
  console.error("Expected an HTTPS origin ending in /");
  process.exit(2);
}

const checks = [
  ["/health", 200, "application/json"],
  ["/producer", 200, "text/html"],
  ["/api/core/api/fabric/v1/health", 401, "application/json"],
  ["/api/producer/v1/status", 401, "application/json"],
  ["/api/chase/v1/config", 503, "application/json"],
  ["/overlay-core/unsupported", 404, "application/json"],
  ["/missing-private-asset.js", 404, "application/json"],
];

let failed = false;
for (const [path, status, type] of checks) {
  try {
    const response = await fetch(new URL(path, origin), {
      headers: { Accept: "text/html" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const actualType = response.headers.get("content-type")?.split(";", 1)[0] ?? "missing";
    const pass = response.status === status && actualType === type;
    console.log(`${pass ? "PASS" : "FAIL"} ${path} ${response.status} ${actualType}`);
    failed ||= !pass;
    await response.body?.cancel();
  } catch (error) {
    console.log(`FAIL ${path} ${error instanceof Error ? error.name : "REQUEST_ERROR"}`);
    failed = true;
  }
}

process.exitCode = failed ? 1 : 0;
