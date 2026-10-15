import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { handleProducerStateRequest } from "../dist-private/producer-bridge.mjs";
import { createPrivateProducerShadow, createShadowStorage } from "./private-producer-shadow.mjs";

const token = "shadow-pilot-token-0123456789abcdef";
let directory;
let storage;
let server;
let origin;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "producer-shadow-"));
  storage = await createShadowStorage(join(directory, "state.json"));
  server = createPrivateProducerShadow({ token, storage, bridge: handleProducerStateRequest });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

const call = (path, init = {}) => fetch(origin + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });

test("shadow requires its private token and disables all controls", async () => {
  assert.equal((await fetch(origin + "/api/producer/v1/status")).status, 401);
  assert.equal((await call("/api/producer/v1/status")).status, 200);
  assert.equal((await call("/api/producer/v1/commands", { method: "POST", body: "{}" })).status, 503);
  assert.equal((await call("/api/producer/v1/workstation/commands")).status, 503);
  assert.equal((await call("/api/producer/v1/control-lease", { method: "POST", body: "{}" })).status, 503);
  assert.equal((await call("/api/producer/v1/facebook")).status, 503);
});

test("status ingest retains original bridge semantics and persists across restart", async () => {
  const status = { source_state: "SOURCE_LIVE", stateRevision: 7 };
  const saved = await call("/api/producer/v1/workstation/status", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(status),
  });
  assert.equal(saved.status, 202);
  const response = await call("/api/producer/v1/status");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).status, status);
  const restored = await createShadowStorage(join(directory, "state.json"));
  assert.deepEqual((await restored.get("status")).body, status);
});

test("preview media stays transient and bounded", async () => {
  const frame = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const saved = await call("/api/producer/v1/workstation/preview/program.jpg", {
    method: "POST", headers: { "Content-Type": "image/jpeg" }, body: frame,
  });
  assert.equal(saved.status, 202);
  const preview = await call("/api/producer/v1/preview/program.jpg");
  assert.equal(preview.status, 200);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), frame);
  const restored = await createShadowStorage(join(directory, "state.json"));
  assert.equal(await restored.get("program-frame"), undefined);
  const tooLarge = await call("/api/producer/v1/workstation/preview/program.jpg", {
    method: "POST", headers: { "Content-Type": "image/jpeg" }, body: Buffer.alloc(2 * 1024 * 1024 + 1),
  });
  assert.equal(tooLarge.status, 413);
});
