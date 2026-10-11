import assert from "node:assert/strict";
import test from "node:test";

import monitor from "./index.js";

test("manual check fails closed without a configured key", async () => {
  const response = await monitor.fetch(new Request("https://monitor.example/"), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("manual check accepts only GET and a header credential", async () => {
  const env = { MONITOR_CHECK_KEY: "test-only-key" };
  const post = await monitor.fetch(new Request("https://monitor.example/", { method: "POST" }), env);
  assert.equal(post.status, 405);

  const query = await monitor.fetch(new Request("https://monitor.example/?key=test-only-key"), env);
  assert.equal(query.status, 401);

  const valid = await monitor.fetch(new Request("https://monitor.example/", {
    headers: { "x-monitor-check-key": "test-only-key" },
  }), env);
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).skipped, true);
});
