// Offline contract check of an EMITTED Worker. No source-name/comment inspection.
import assert from "node:assert/strict";

export const candidateRoutes = [
  "/api/coordination/v1/snapshot",
  "/api/v1/radar/frames?site=KSRX&product=REF&tilt=1&limit=1",
  "/api/v1/radar/frame/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/metadata",
  "/api/v1/radar/tiles/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/8/1/1.png",
];

export async function verifyWorkerDispatch(worker, { checkRetainedCorePolicy = false } = {}) {
  assert.equal(typeof worker?.fetch, "function", "Built artifact must export Worker.fetch");
  let assertions = 1, assets = 0, forwards = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  const context = { waitUntil() { throw Error("Unexpected background work in build fixture"); } };
  const env = { ASSETS: { fetch: async () => { assets++; return new Response("FIXTURE SPA FALLBACK"); } } };
  const request = (route, method = "GET", signed = true) => new Request("https://build.fixture.invalid" + route, {
    method, headers: signed ? { Authorization: "Bearer fixture", "X-Ops-Role": "OWNER", "X-Producer-Operator": "forged" } : {},
  });
  const results = [];
  for (const route of candidateRoutes) {
    const missing = await worker.fetch(request(route), env, context);
    equal(missing.status, 503);
    equal(await missing.json(), { error: "PARITY_ORIGIN_NOT_CONFIGURED" });
    equal(assets, 0);
    const anonymous = await worker.fetch(request(route, "GET", false), env, context);
    equal(anonymous.status, 401);
    equal(assets, 0);
    results.push({ route, unconfigured: 503, anonymous: 401, assetsFallback: false });
  }
  for (const route of candidateRoutes) equal((await worker.fetch(request(route, "POST"), env, context)).status, 405);
  const configured = { ...env, PRIVATE_PARITY_ORIGIN: { fetch: async incoming => {
    forwards++;
    equal(new URL(incoming.url).origin, "https://parity-internal.invalid");
    equal(incoming.headers.get("Authorization"), "Bearer fixture");
    equal(incoming.headers.get("X-Ops-Role"), null);
    equal(incoming.headers.get("X-Producer-Operator"), null);
    return Response.json({ fixtureDispatch: new URL(incoming.url).pathname });
  } } };
  for (const route of candidateRoutes) {
    const result = await worker.fetch(request(route), configured, context);
    equal(result.status, 200);
    equal(await result.json(), { fixtureDispatch: new URL(request(route).url).pathname });
  }
  equal(forwards, 4); equal(assets, 0);
  equal((await worker.fetch(request("/api/core/health", "GET", false), configured, context)).status, 401);
  equal(forwards, 4);
  equal((await worker.fetch(request("/api/producer/v1/facebook"), configured, context)).status, 200);
  equal(forwards, 4); equal(assets, 1); // Pages fallback proves non-capture, not Facebook functionality.
  equal((await worker.fetch(request("/ordinary-static-page"), configured, context)).status, 200);
  equal(assets, 2);
  if (checkRetainedCorePolicy) {
    const originalFetch = globalThis.fetch;
    let role = "UNKNOWN", coreCalls = 0;
    globalThis.fetch = async input => {
      const url = String(input);
      assert.ok(url.startsWith("https://auth.fixture.invalid/"), "No external build-test fetch");
      return Response.json(url.endsWith("/auth/v1/user") ? { id: "fixture-user" } : [{ active: true, role }]);
    };
    try {
      const coreEnv = { ...configured, VITE_SUPABASE_URL: "https://auth.fixture.invalid", VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public",
        CORE_GATEWAY_WORKER: { fetch: async () => { coreCalls++; return Response.json({ fixture: true }); } } };
      equal((await worker.fetch(request("/api/core/api/fabric/v1/units"), coreEnv, context)).status, 200);
      role = "OPERATOR";
      equal((await worker.fetch(new Request("https://build.fixture.invalid/api/core/api/weather-alert/v1/settings", {
        method: "PUT", headers: { Authorization: "Bearer fixture" }, body: "{}",
      }), coreEnv, context)).status, 200);
      equal(coreCalls, 2); // Deliberately demonstrates the Core authorization proposal is still unapplied.
    } finally { globalThis.fetch = originalFetch; }
  }
  return { assertions, routes: results, configuredDispatches: forwards, producerCaptured: false, retainedCorePolicyChecked: checkRetainedCorePolicy };
}
