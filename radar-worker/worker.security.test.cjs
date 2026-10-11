"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const worker = require("./worker.cjs");

test("radar state cannot be changed through a public POST", async () => {
  worker.server.listen(0, "127.0.0.1");
  await once(worker.server, "listening");
  try {
    const base = `http://127.0.0.1:${worker.server.address().port}/api/v1/radar`;
    for (const path of ["selection", "storm-motion"]) {
      const response = await fetch(`${base}/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      assert.equal(response.status, 405);
    }
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally {
    await new Promise((resolve) => worker.server.close(resolve));
  }
});

test("SRV motion is bounded per request and separates frame cache identities", () => {
  const at = (query) => worker.motionForUrl(new URL(`https://radar.example/frames?${query}`));
  assert.deepEqual(at("directionDegrees=0&speedKnots=0"), { directionDegrees: 0, speedKnots: 0, source: "REQUEST" });
  assert.deepEqual(at("directionDegrees=359&speedKnots=80"), { directionDegrees: 359, speedKnots: 80, source: "REQUEST" });
  for (const query of ["directionDegrees=360&speedKnots=20", "directionDegrees=12&speedKnots=81", "directionDegrees=NaN&speedKnots=20", "directionDegrees=12"]) {
    assert.equal(at(query), null);
  }
  assert.notEqual(worker.frameId("KSRX", "SRV", 1, "scan", "0:0"), worker.frameId("KSRX", "SRV", 1, "scan", "180:30"));
});
