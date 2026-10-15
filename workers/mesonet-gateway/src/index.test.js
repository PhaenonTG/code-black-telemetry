import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "./index.js";

test("device ingest keeps the role bearer and Core path", async () => {
  const calls = [];
  const env = { CORE_VPC: { fetch: async (...args) => {
    calls.push(args);
    return Response.json({ accepted: true });
  } } };
  const response = await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/mesonet/ingest", {
    method: "POST", headers: { Authorization: "Bearer device-only" }, body: "{}",
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-CodeBlack-Mesonet-Gateway"), "dedicated-v1");
  assert.equal(calls[0][0], "http://127.0.0.1:8000/api/mesonet/v1/ingest");
  assert.equal(new Headers(calls[0][1].headers).get("Authorization"), "Bearer device-only");
});

test("OTA accepts only role images and forwards the bearer", async () => {
  const calls = [];
  const env = { CORE_VPC: { fetch: async (...args) => {
    calls.push(args);
    return new Response("signed image");
  } } };
  const response = await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/mesonet/ota/image/striker-weather/0.1.5", {
    headers: { Authorization: "Bearer role-only" },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(calls[0][0], "http://127.0.0.1:8000/api/mesonet/v1/ota/image/striker-weather/0.1.5");
  assert.equal(new Headers(calls[0][1].headers).get("Authorization"), "Bearer role-only");
  assert.equal((await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/mesonet/ota/image/striker-weather/latest"), env)).status, 404);
});

test("method and payload limits reject before Core", async () => {
  let called = false;
  const env = { CORE_VPC: { fetch: async () => { called = true; return new Response(); } } };
  assert.equal((await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/mesonet/ingest"), env)).status, 405);
  assert.equal((await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/mesonet/ingest", { method: "POST", body: "{}" }), env)).status, 401);
  assert.equal((await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/mesonet/ingest", {
    method: "POST", headers: { Authorization: "Bearer x" }, body: "x".repeat(4097),
  }), env)).status, 413);
  assert.equal(called, false);
});

test("public projection excludes private fields and uncalibrated wind", async () => {
  const env = { MESONET_READ_TOKEN: "read-only", CORE_VPC: { fetch: async () => Response.json({
    weather: { readings: { temperature_c: 23, humidity_pct: 50, latitude: 36 } },
    wind: { readings: { wind_mps: 7 }, calibration_verified: false }, token: "secret",
  }) } };
  const response = await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/mesonet/public"), env);
  const value = await response.json();
  assert.equal(response.status, 200);
  assert.equal(value.temperature_c, 23);
  assert.equal(value.wind_mps, null);
  assert.equal(JSON.stringify(value).includes("secret"), false);
  assert.equal("latitude" in value, false);
});
