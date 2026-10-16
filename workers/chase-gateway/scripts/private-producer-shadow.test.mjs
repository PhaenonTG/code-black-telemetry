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

test("opt-in private command queue persists, acknowledges and rejects replay conflicts", async () => {
  const state = await createShadowStorage(join(directory, "controls.json"));
  const active = createPrivateProducerShadow({ token, storage: state, bridge: handleProducerStateRequest, controls: true });
  await new Promise(resolve => active.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${active.address().port}`;
  const send = (path, body, method = "POST") => fetch(base + "/api/producer/v1/" + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Producer-UserId": "approved-operator" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    assert.equal((await send("workstation/heartbeat", { status: { engine: "obs", stateRevision: 1 }, capabilities: {} })).status, 200);
    await send("control-lease", {});
    const command = { commandId: "067169a4-52c0-4d08-8d7f-638e93ee8451", expectedStateRevision: 1, action: "preview.start" };
    assert.equal((await send("commands", command)).status, 202);
    const restored = await createShadowStorage(join(directory, "controls.json"));
    assert.equal((await restored.get("commands"))[0].commandId, command.commandId);
    assert.equal((await send("commands", { ...command, action: "preview.stop" })).status, 409);
    const queued = await (await send("workstation/heartbeat", { status: { engine: "obs", stateRevision: 1 }, capabilities: {} })).json();
    assert.equal(queued.commands[0].commandId, command.commandId);
    assert.equal((await send("workstation/ack", { commandId: command.commandId, state: "succeeded", result: {} })).status, 200);
    assert.equal((await (await send("workstation/commands", undefined, "GET")).json()).commands.length, 0);
    assert.equal((await send("facebook/publish", {})).status, 503);
  } finally { await new Promise(resolve => active.close(resolve)); }
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

test("HLS segment and manifest follow the private read path", async () => {
  const now = new Date().toISOString();
  const name = `program-${"a".repeat(32)}-1.ts`;
  const media = Buffer.alloc(188);
  media[0] = 0x47;
  const live = { source_state: "SOURCE_LIVE", previews: { program: { state: "ACTIVE" } }, metrics: { last_video_timestamp: now } };
  assert.equal((await call("/api/producer/v1/workstation/status", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(live),
  })).status, 202);
  const put = (file, body, contentType) => call(`/api/producer/v1/workstation/preview/hls/${file}`, {
    method: "POST", headers: { "Content-Type": contentType, "X-Producer-Frame-At": now }, body,
  });
  assert.equal((await put(name, media, "video/mp2t")).status, 202);
  const manifest = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1.000000,\n#EXT-X-PROGRAM-DATE-TIME:${now}\n${name}\n`;
  assert.equal((await put("index.m3u8", manifest, "application/vnd.apple.mpegurl")).status, 202);
  const playlist = await call("/api/producer/v1/preview/hls/index.m3u8");
  assert.equal(playlist.status, 200);
  assert.match(await playlist.text(), new RegExp(`/api/producer/v1/preview/hls/${name}`));
  const segment = await call(`/api/producer/v1/preview/hls/${name}`);
  assert.equal(segment.status, 200);
  assert.deepEqual(Buffer.from(await segment.arrayBuffer()), media);
});
