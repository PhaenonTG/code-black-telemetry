import assert from "node:assert/strict";
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
