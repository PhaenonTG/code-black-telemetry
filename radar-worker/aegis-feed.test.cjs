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
