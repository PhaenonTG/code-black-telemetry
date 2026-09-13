import { describe, expect, it, vi } from "vitest";
import { handleRequest, type Env } from "./index";

// Behavioral parity tests. Expected values below were captured against the LIVE deployed
// Worker (read-only curl + the bundled source pulled from the Cloudflare API during the
// 2026-09-13 recovery session) -- see CHASE_GATEWAY_RECOVERY.md. These are not aspirational;
// a failure here means this reconstruction has drifted from what production actually does.

function mockCoreVpc(handler: (url: string | URL, init?: RequestInit) => Response | Promise<Response>) {
  return { fetch: vi.fn(async (url: string | URL, init?: RequestInit) => handler(url, init)) };
}

function envWith(overrides: Partial<Env> = {}): Env {
  return { CORE_VPC: mockCoreVpc(() => new Response("{}", { status: 200 })), ...overrides };
}

describe("codeblack-chase-gateway", () => {
  it("503s every route when CORE_VPC binding is absent", async () => {
    const res = await handleRequest(new Request("https://x/api/chase/location/public"), {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "CORE_UNAVAILABLE" });
  });

  describe("GET /api/chase/location/public", () => {
    it("1. valid, fresh, sharing-on location -> 200 with rounded lat/lon", async () => {
      const core = mockCoreVpc(() =>
        new Response(
          JSON.stringify({
            unit_id: "cbwx-unit-tessa",
            location_sharing: true,
            stale: false,
            receiver_age_ms: 100,
            fix_age_ms: 200,
            lat: 36.4567,
            lon: -94.1234,
          }),
          { status: 200 },
        ),
      );
      const res = await handleRequest(
        new Request("https://x/api/chase/location/public?unit_id=cbwx-unit-tessa"),
        envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        unit_id: "cbwx-unit-tessa",
        location_sharing: true,
        stale: false,
        lat: 36.46,
        lon: -94.12,
      });
      // token is injected server-side, never derived from the caller's own headers
      const [, init] = core.fetch.mock.calls[0] as [unknown, RequestInit];
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    });

    it("2. stale fix -> 200, stale:true, no lat/lon", async () => {
      const core = mockCoreVpc(() =>
        new Response(
          JSON.stringify({
            unit_id: "cbwx-unit-tessa",
            location_sharing: true,
            stale: true,
            receiver_age_ms: 100,
            fix_age_ms: 200,
            lat: 36.4567,
            lon: -94.1234,
          }),
          { status: 200 },
        ),
      );
      const res = await handleRequest(
        new Request("https://x/api/chase/location/public"),
        envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.stale).toBe(true);
      expect(body).not.toHaveProperty("lat");
      expect(body).not.toHaveProperty("lon");
    });

    it("3. location_sharing disabled -> 200, location_sharing:false, no lat/lon", async () => {
      const core = mockCoreVpc(() =>
        new Response(
          JSON.stringify({
            unit_id: "cbwx-unit-tessa",
            location_sharing: false,
            stale: false,
            receiver_age_ms: 100,
            fix_age_ms: 200,
            lat: 36.4567,
            lon: -94.1234,
          }),
          { status: 200 },
        ),
      );
      const res = await handleRequest(
        new Request("https://x/api/chase/location/public"),
        envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.location_sharing).toBe(false);
      expect(body).not.toHaveProperty("lat");
    });

    it("4. unknown/non-public unit_id -> 404 UNIT_NOT_PUBLIC, never forwarded to Core", async () => {
      const core = mockCoreVpc(() => new Response("{}", { status: 200 }));
      const res = await handleRequest(
        new Request("https://x/api/chase/location/public?unit_id=cbwx-unit-striker"),
        envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "UNIT_NOT_PUBLIC" });
      expect(core.fetch).not.toHaveBeenCalled();
    });

    it("5. malformed/out-of-range fix -> stale:true, no lat/lon", async () => {
      const core = mockCoreVpc(() =>
        new Response(
          JSON.stringify({
            unit_id: "cbwx-unit-tessa",
            location_sharing: true,
            stale: false,
            receiver_age_ms: 100,
            fix_age_ms: 200,
            lat: 999,
            lon: -94.1234,
          }),
          { status: 200 },
        ),
      );
      const res = await handleRequest(
        new Request("https://x/api/chase/location/public"),
        envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.stale).toBe(true);
      expect(body).not.toHaveProperty("lat");
    });

    it("6. CORS: OPTIONS preflight -> 204 with GET,OPTIONS + wildcard origin", async () => {
      const res = await handleRequest(
        new Request("https://x/api/chase/location/public", { method: "OPTIONS" }),
        envWith({ CHASE_TOKEN: "secret" }),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    });

    it("6b. CORS headers present on a normal GET response too", async () => {
      const res = await handleRequest(
        new Request("https://x/api/chase/location/public?unit_id=cbwx-unit-striker"),
        envWith({ CHASE_TOKEN: "secret" }),
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("7. no-store on every public response", async () => {
      const res = await handleRequest(
        new Request("https://x/api/chase/location/public?unit_id=cbwx-unit-striker"),
        envWith({ CHASE_TOKEN: "secret" }),
      );
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("public route works with no Authorization header at all (deliberately unauthenticated)", async () => {
      const core = mockCoreVpc(() =>
        new Response(
          JSON.stringify({ unit_id: "cbwx-unit-tessa", location_sharing: false, stale: true }),
          { status: 200 },
        ),
      );
      const res = await handleRequest(
        new Request("https://x/api/chase/location/public"),
        envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
      );
      expect(res.status).toBe(200);
    });

    it("503s if CHASE_TOKEN secret itself is unset", async () => {
      const res = await handleRequest(
        new Request("https://x/api/chase/location/public"),
        envWith({ CHASE_TOKEN: undefined }),
      );
      expect(res.status).toBe(503);
    });

    it("non-GET/OPTIONS method -> 405", async () => {
      const res = await handleRequest(
        new Request("https://x/api/chase/location/public", { method: "DELETE" }),
        envWith({ CHASE_TOKEN: "secret" }),
      );
      expect(res.status).toBe(405);
    });
  });

  describe("8. POST /api/chase/location (ingest)", () => {
    it("requires Bearer CHASE_TOKEN -> 401 without it", async () => {
      const res = await handleRequest(
        new Request("https://x/api/chase/location", { method: "POST", body: "{}" }),
        envWith({ CHASE_TOKEN: "secret" }),
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
    });

    it("forwards an authorized POST body to Core unchanged", async () => {
      const core = mockCoreVpc(() => new Response(JSON.stringify({ accepted: true }), { status: 200 }));
      const res = await handleRequest(
        new Request("https://x/api/chase/location", {
          method: "POST",
          headers: { Authorization: "Bearer secret" },
          body: JSON.stringify({ unit_id: "cbwx-unit-tessa", lat: 1, lon: 2 }),
        }),
        envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
      );
      expect(res.status).toBe(200);
      expect(core.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8000/api/chase/location",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("413s an oversized body", async () => {
      const res = await handleRequest(
        new Request("https://x/api/chase/location", {
          method: "POST",
          headers: { Authorization: "Bearer secret", "Content-Length": String(17 * 1024) },
          body: "x".repeat(17 * 1024),
        }),
        envWith({ CHASE_TOKEN: "secret" }),
      );
      expect(res.status).toBe(413);
    });
  });

  describe("9. GET /api/chase/location/latest (private)", () => {
    it("requires Bearer CHASE_TOKEN -> 401 without it", async () => {
      const res = await handleRequest(
        new Request("https://x/api/chase/location/latest?unit_id=cbwx-unit-tessa"),
        envWith({ CHASE_TOKEN: "secret" }),
      );
      expect(res.status).toBe(401);
    });

    it("forwards unit_id (truncated to 80 chars) to Core when authorized", async () => {
      const core = mockCoreVpc(() => new Response("{}", { status: 200 }));
      const longId = "u".repeat(200);
      await handleRequest(
        new Request(`https://x/api/chase/location/latest?unit_id=${longId}`, {
          headers: { Authorization: "Bearer secret" },
        }),
        envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
      );
      const [target] = core.fetch.mock.calls[0] as [URL];
      expect(new URL(target).searchParams.get("unit_id")).toBe("u".repeat(80));
    });
  });

  it("unknown path under /api/chase/ with a disallowed method -> 405 before 404", async () => {
    const res = await handleRequest(
      new Request("https://x/api/chase/something-else", {
        method: "DELETE",
        headers: { Authorization: "Bearer secret" },
      }),
      envWith({ CHASE_TOKEN: "secret" }),
    );
    expect(res.status).toBe(405);
  });

  it("unknown /api/chase/ GET path -> 404", async () => {
    const res = await handleRequest(
      new Request("https://x/api/chase/nope", { headers: { Authorization: "Bearer secret" } }),
      envWith({ CHASE_TOKEN: "secret" }),
    );
    expect(res.status).toBe(404);
  });

  it("maps a CORE_VPC.fetch() throw to 502 CORE_TRANSPORT_UNAVAILABLE", async () => {
    const core = mockCoreVpc(() => {
      throw new Error("connect ECONNREFUSED");
    });
    const res = await handleRequest(
      new Request("https://x/api/chase/location/latest", { headers: { Authorization: "Bearer secret" } }),
      envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "CORE_TRANSPORT_UNAVAILABLE" });
  });

  it("maps a CORE_VPC.fetch() throw on the public route to 502 CORE_TRANSPORT_UNAVAILABLE", async () => {
    const core = mockCoreVpc(() => {
      throw new Error("connect ECONNREFUSED");
    });
    const res = await handleRequest(
      new Request("https://x/api/chase/location/public"),
      envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "CORE_TRANSPORT_UNAVAILABLE" });
  });
});
