import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "./index.js";

function env(handler = async () => new Response("{}", { status: 200 })) {
  return { RADAR_VPC: { fetch: handler } };
}

test("rejects paths outside the radar API prefix", async () => {
  const response = await handleRequest(new Request("https://ops.codeblackwx.com/api/other"), env());
  assert.equal(response.status, 404);
});

test("forwards GET requests to the fixed radar-worker origin, preserving path and query", async () => {
  let received;
  const response = await handleRequest(
    new Request("https://ops.codeblackwx.com/api/v1/radar/frames?site=KTLX&product=REF"),
    env(async (url, init) => {
      received = { url: String(url), init };
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(received.url, "http://127.0.0.1:8787/api/v1/radar/frames?site=KTLX&product=REF");
  assert.equal(received.init.method, "GET");
});

test("forwards POST body and content-type for selection/storm-motion routes", async () => {
  let received;
  const response = await handleRequest(
    new Request("https://ops.codeblackwx.com/api/v1/radar/selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "KTLX" }),
    }),
    env(async (url, init) => {
      received = { url: String(url), init };
      return new Response("{}", { status: 200 });
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(received.init.method, "POST");
  assert.equal(received.init.body, JSON.stringify({ site: "KTLX" }));
});

test("adds CORS headers to every response, including error paths", async () => {
  const ok = await handleRequest(
    new Request("https://ops.codeblackwx.com/api/v1/radar/health"),
    env(async () => new Response("{}", { status: 200 })),
  );
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "*");

  const unavailable = await handleRequest(
    new Request("https://ops.codeblackwx.com/api/v1/radar/health"),
    { RADAR_VPC: undefined },
  );
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("Access-Control-Allow-Origin"), "*");
});

test("passes through binary tile bodies unmodified", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const response = await handleRequest(
    new Request("https://ops.codeblackwx.com/api/v1/radar/tiles/frame1/4/3/6.png"),
    env(async () => new Response(bytes, { status: 200, headers: { "Content-Type": "image/png" } })),
  );
  const body = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...body], [...bytes]);
  assert.equal(response.headers.get("Content-Type"), "image/png");
});
