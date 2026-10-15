import assert from "node:assert/strict";
import { get } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createPrivateOpsServer } from "./serve-private.mjs";

let root;
let server;
let origin;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "ops-private-test-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<title>Ops pilot</title>");
  await writeFile(join(root, "assets", "app.js"), "export const ready = true;");
  server = createPrivateOpsServer({ distDir: root });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

test("serves the built site and client-side routes", async () => {
  const document = await fetch(`${origin}/producer`, { headers: { Accept: "text/html" } });
  assert.equal(document.status, 200);
  assert.equal(await document.text(), "<title>Ops pilot</title>");
  const asset = await fetch(`${origin}/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type"), /text\/javascript/);
});

test("unmigrated APIs never fall through to the HTML app", async () => {
  for (const path of ["/api/core/api/fabric/v1/health", "/api/producer/v1/status", "/api/chase/v1/config", "/overlay-core/api/storm-intel/v1/point"]) {
    const response = await fetch(origin + path, { headers: { Accept: "text/html" } });
    assert.equal(response.status, 503, path);
    assert.match(response.headers.get("content-type"), /application\/json/);
  }
});

test("health, missing assets and unsafe paths are bounded", async () => {
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  assert.equal((await fetch(`${origin}/missing.js`)).status, 404);
  assert.equal((await fetch(`${origin}/%00secret`)).status, 400);
});

test("configured Core gateway receives API requests without SPA fallback", async () => {
  const privateServer = createPrivateOpsServer({ distDir: root, apiGateway: async request => {
    assert.equal(new URL(request.url).pathname, "/api/core/api/forecast/v1/chase-setup-review");
    assert.equal(request.method, "POST");
    assert.equal(await request.text(), '{"setup_id":"sample"}');
    return Response.json({ accepted: true });
  } });
  await new Promise(resolve => privateServer.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${privateServer.address().port}/api/core/api/forecast/v1/chase-setup-review`;
    const result = await fetch(url, { method: "POST", body: '{"setup_id":"sample"}' });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { accepted: true });
  } finally {
    await new Promise(resolve => privateServer.close(resolve));
  }
});

test("configured Producer gateway receives reads and refuses commands without SPA fallback", async () => {
  const privateServer = createPrivateOpsServer({ distDir: root, apiGateway: async request => {
    if (new URL(request.url).pathname === "/api/producer/v1/status") return Response.json({ bridge: "ONLINE" });
    return Response.json({ error: "SHADOW_READ_ONLY" }, { status: 503 });
  } });
  await new Promise(resolve => privateServer.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${privateServer.address().port}/api/producer/v1`;
    const status = await fetch(`${base}/status`, { headers: { Accept: "text/html" } });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { bridge: "ONLINE" });
    const command = await fetch(`${base}/commands`, { method: "POST", body: "{}" });
    assert.equal(command.status, 503);
    assert.match(command.headers.get("content-type"), /application\/json/);
  } finally {
    await new Promise(resolve => privateServer.close(resolve));
  }
});

test("private workstation media uses its own bounded upload limit", async () => {
  const privateServer = createPrivateOpsServer({ distDir: root, apiGateway: async request => {
    assert.equal(new URL(request.url).pathname, "/api/producer/v1/workstation/preview/program.jpg");
    assert.equal((await request.arrayBuffer()).byteLength, 512 * 1024);
    return Response.json({ accepted: true });
  } });
  await new Promise(resolve => privateServer.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${privateServer.address().port}/api/producer/v1/workstation/preview/program.jpg`;
    assert.equal((await fetch(url, { method: "POST", body: new Uint8Array(512 * 1024) })).status, 200);
    assert.equal((await fetch(url, { method: "POST", body: new Uint8Array(2 * 1024 * 1024 + 1) })).status, 413);
  } finally {
    await new Promise(resolve => privateServer.close(resolve));
  }
});

test("private Core PUT accepts settings larger than the POST limit and bounds the body", async () => {
  const privateServer = createPrivateOpsServer({ distDir: root, apiGateway: async request => {
    assert.equal(request.method, "PUT");
    assert.equal((await request.text()).length, 5000);
    return Response.json({ accepted: true });
  } });
  await new Promise(resolve => privateServer.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${privateServer.address().port}/api/core/api/weather-alert/v1/settings`;
    assert.equal((await fetch(url, { method: "PUT", body: "x".repeat(5000) })).status, 200);
    assert.equal((await fetch(url, { method: "PUT", body: "x".repeat(64 * 1024 + 1) })).status, 413);
  } finally {
    await new Promise(resolve => privateServer.close(resolve));
  }
});

test("private hostname rejects an unexpected Host header", async () => {
  const privateServer = createPrivateOpsServer({ distDir: root, allowedHostname: "ops-private.example.test" });
  await new Promise(resolve => privateServer.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${privateServer.address().port}/health`;
    assert.equal((await fetch(url)).status, 421);
    const status = await new Promise((resolve, reject) => {
      get(url, { headers: { Host: "ops-private.example.test" } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    assert.equal(status, 200);
  } finally {
    await new Promise(resolve => privateServer.close(resolve));
  }
});
