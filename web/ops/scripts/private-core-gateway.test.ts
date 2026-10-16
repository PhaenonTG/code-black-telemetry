import { createHmac, createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePrivateApiRequest, handlePrivateCoreRequest, handlePrivateOverlayRequest, type PrivateCoreEnv } from "./private-core-gateway";

const userId = "4b10eb9e-af64-4077-a659-2fe4adf69b12";
const env: PrivateCoreEnv = {
  VITE_SUPABASE_URL: "https://auth.example.test",
  VITE_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
  OPS_PRIVATE_CORE_BASE_URL: "http://127.0.0.1:8000",
  OPS_PRIVATE_WRITE_SECRET: "local-test-secret",
};

function mockFetch(role = "ADMIN") {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: userId });
    if (url.includes("/rest/v1/profiles?")) return Response.json([{ active: true, role }]);
    return Response.json({ ok: true });
  };
  return { calls, fetcher: fetcher as typeof fetch };
}

describe("private Core gateway", () => {
  it("requires an OPS bearer token before reaching Core", async () => {
    const mock = mockFetch();
    const result = await handlePrivateCoreRequest(new Request("http://localhost/api/core/health"), env, mock.fetcher);
    expect(result.status).toBe(401);
    expect(mock.calls).toHaveLength(0);
  });

  it("allows only known Core routes and query keys on a loopback upstream", async () => {
    const mock = mockFetch();
    const req = new Request("http://localhost/api/core/api/storm-intel/v1/point?latitude=35&longitude=-97&ignored=x", {
      headers: { Authorization: "Bearer user-token" },
    });
    const result = await handlePrivateCoreRequest(req, env, mock.fetcher);
    expect(result.status).toBe(200);
    expect(mock.calls.at(-1)?.url).toBe("http://127.0.0.1:8000/api/storm-intel/v1/point?latitude=35&longitude=-97");
    const blocked = await handlePrivateCoreRequest(req, { ...env, OPS_PRIVATE_CORE_BASE_URL: "https://evil.test" }, mock.fetcher);
    expect(blocked.status).toBe(502);
  });

  it("signs draft writes with the verified actor and exact body", async () => {
    const mock = mockFetch();
    const body = '{"setup_id":"sample"}';
    const req = new Request("http://localhost/api/core/api/forecast/v1/chase-setup-review", {
      method: "POST", headers: { Authorization: "Bearer user-token" }, body,
    });
    const result = await handlePrivateCoreRequest(req, env, mock.fetcher);
    expect(result.status).toBe(200);
    const headers = new Headers(mock.calls.at(-1)?.init?.headers);
    const timestamp = headers.get("X-Ops-Timestamp")!;
    const message = ["POST", "/api/forecast/v1/chase-setup-review", timestamp, userId, "ADMIN", createHash("sha256").update(body).digest("hex")].join("\n");
    expect(headers.get("X-Ops-Signature")).toBe(createHmac("sha256", env.OPS_PRIVATE_WRITE_SECRET!).update(message).digest("hex"));
    expect(headers.get("Authorization")).toBeNull();
  });

  it("keeps decision writes blocked for operators and fails closed without a signing key", async () => {
    const req = new Request("http://localhost/api/core/api/forecast/v1/chase-setup-decision", {
      method: "POST", headers: { Authorization: "Bearer user-token" }, body: "{}",
    });
    const operator = mockFetch("OPERATOR");
    expect((await handlePrivateCoreRequest(req.clone(), env, operator.fetcher)).status).toBe(403);
    expect(operator.calls).toHaveLength(2);
    const admin = mockFetch();
    expect((await handlePrivateCoreRequest(req, { ...env, OPS_PRIVATE_WRITE_SECRET: undefined }, admin.fetcher)).status).toBe(502);
    expect(admin.calls).toHaveLength(2);
  });
});

describe("private overlay routes", () => {
  it("forwards only public Storm Intel paths and allowed coordinates", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json({ status: "available" });
    }) as typeof fetch;
    const result = await handlePrivateOverlayRequest(new Request("http://localhost/overlay-core/api/storm-intel/v1/point?latitude=35&longitude=-97&unit_id=secret"), env, fetcher);
    expect(result.status).toBe(200);
    expect(calls).toEqual(["http://127.0.0.1:8000/api/storm-intel/v1/point?latitude=35&longitude=-97"]);
    const blocked = await handlePrivateOverlayRequest(new Request("http://localhost/overlay-core/api/fabric/v1/units"), env, fetcher);
    expect(blocked.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it("serves only a configured public Mapbox token and handles preflight", async () => {
    const path = "http://localhost/overlay-core/mapbox-token";
    expect((await handlePrivateOverlayRequest(new Request(path), env)).status).toBe(503);
    const result = await handlePrivateOverlayRequest(new Request(path), { ...env, MAPBOX_PUBLIC_TOKEN: "pk.test" });
    expect(await result.json()).toEqual({ token: "pk.test" });
    expect((await handlePrivateOverlayRequest(new Request(path, { method: "OPTIONS" }), env)).status).toBe(204);
  });
});

describe("private camera routes", () => {
  it("keeps camera relays explicit and rejects unapproved upstream hosts", async () => {
    const health = await handlePrivateApiRequest(new Request("http://localhost/api/camera-health?url=https%3A%2F%2Fevil.test%2Fimage.jpg"), env);
    expect(health.status).toBe(400);
    const stream = await handlePrivateApiRequest(new Request("http://localhost/api/ardot-camera-stream"), env);
    expect(stream.status).toBe(400);
    const unknown = await handlePrivateApiRequest(new Request("http://localhost/api/unknown"), env);
    expect(unknown.status).toBe(404);
  });
});


describe("telemetry reliability boundaries", () => {
  afterEach(() => vi.useRealTimers());
  const request = (signal?: AbortSignal) => new Request("http://localhost/api/core/api/ops/status-center/v1/status", {
    headers: { Authorization: "Bearer concurrent-test-token" }, signal,
  });

  it("bounds a stalled auth provider before the browser deadline and fails closed", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetcher = ((_input, init) => { signal = init?.signal; return new Promise(() => {}); }) as typeof fetch;
    const pending = handlePrivateCoreRequest(request(), env, fetcher);
    await vi.advanceTimersByTimeAsync(6_000);
    const response = await pending;
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(signal?.aborted).toBe(true);
  });

  it("shares concurrent auth work but rechecks revoked access on the next request", async () => {
    let release!: (response: Response) => void;
    let active = true;
    let authCalls = 0;
    let profileCalls = 0;
    let coreCalls = 0;
    const fetcher = (async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) {
        authCalls += 1;
        return authCalls === 1 ? await new Promise<Response>((resolve) => { release = resolve; }) : Response.json({ id: userId });
      }
      if (url.includes("/rest/v1/profiles?")) { profileCalls += 1; return Response.json([{ active, role: "ADMIN" }]); }
      coreCalls += 1;
      return Response.json({ ok: true });
    }) as typeof fetch;
    const first = handlePrivateCoreRequest(request(), env, fetcher);
    const second = handlePrivateCoreRequest(request(), env, fetcher);
    expect(authCalls).toBe(1);
    release(Response.json({ id: userId }));
    expect((await Promise.all([first, second])).map((response) => response.status)).toEqual([200, 200]);
    expect(profileCalls).toBe(1);
    expect(coreCalls).toBe(2);
    active = false;
    expect((await handlePrivateCoreRequest(request(), env, fetcher)).status).toBe(403);
    expect(authCalls).toBe(2);
    expect(coreCalls).toBe(2);
  });

  it("bounds a stalled telemetry upstream and propagates browser cancellation", async () => {
    vi.useFakeTimers();
    let upstreamSignal: AbortSignal | null | undefined;
    const fetcher = (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: userId });
      if (url.includes("/rest/v1/profiles?")) return Response.json([{ active: true, role: "ADMIN" }]);
      upstreamSignal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    }) as typeof fetch;
    const pending = handlePrivateCoreRequest(request(), env, fetcher);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).status).toBe(504);
    expect(upstreamSignal?.aborted).toBe(true);
    const client = new AbortController();
    const cancelled = handlePrivateCoreRequest(request(client.signal), env, fetcher);
    await vi.advanceTimersByTimeAsync(0);
    client.abort();
    expect((await cancelled).status).toBe(504);
    expect(upstreamSignal?.aborted).toBe(true);
  });
});
