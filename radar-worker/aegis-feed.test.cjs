const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { handler } = require("./aegis-feed.cjs");

test("feed stays empty in shadow and replays ordered events only after delivery gate", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-feed-test-"));
  const server = http.createServer(handler(dir));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ delivery_enabled: false }));
    fs.writeFileSync(path.join(dir, "alerts.jsonl"), [{ id: "a", sequence: 1 }, { id: "b", sequence: 2 }]
      .map(JSON.stringify).join("\n") + "\n");
    let result = await (await fetch(`${base}/api/fabric/v1/aegis-alerts`)).json();
    assert.equal(result.state, "shadow"); assert.deepEqual(result.items, []);
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ delivery_enabled: true }));
    result = await (await fetch(`${base}/api/fabric/v1/aegis-alerts?after=1`)).json();
    assert.equal(result.state, "live"); assert.deepEqual(result.items.map((x) => x.id), ["b"]);
    assert.equal(result.next_cursor, 2);
    assert.equal((await fetch(`${base}/api/fabric/v1/aegis-alerts?after=-1`)).status, 400);
    assert.equal((await fetch(`${base}/api/fabric/v1/aegis-alerts`, { method: "POST" })).status, 405);
  } finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("policy status and replay endpoints are read-only and bounded", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-feed-policy-test-"));
  const server = http.createServer(handler(dir));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ evidence_cutoff: 85, delivery_enabled: false }));
    const status = await (await fetch(`${base}/api/fabric/v1/aegis-policy`)).json();
    assert.equal(status.activation_locked, true);
    const response = await fetch(`${base}/api/fabric/v1/aegis-policy/replay`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "scenario", scenario: {
        warning: "Tornado Warning", candidateAvailable: true, evidenceScore: 92,
        evidenceCutoff: 85, scanAgeMinutes: 4, deliveryEnabled: true,
      } }) });
    assert.equal(response.status, 200);
    const replay = await response.json();
    assert.equal(replay.decision, "WOULD_ROUTE");
    assert.equal(replay.no_messages_sent, true);
    assert.equal((await fetch(`${base}/api/fabric/v1/aegis-policy`, { method: "POST" })).status, 405);
    assert.equal(fs.existsSync(path.join(dir, "alerts.jsonl")), false);
  } finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});
