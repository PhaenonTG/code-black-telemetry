import { describe, expect, it, vi } from "vitest";
import { handleRequest, type Env } from "./index";

function assetsOf(files: Record<string, string | Uint8Array>): NonNullable<Env["ASSETS"]> {
  return {
    fetch: async (input: RequestInfo | URL) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(raw).pathname;
      const body = files[path];
      if (body == null) return new Response("missing", { status: 404 });
      return new Response(body);
    },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

  describe("9. pre-auth V1 config and telemetry boundary", () => {
    it("requires the existing Chase bearer token before returning config", async () => {
      const res = await handleRequest(new Request("https://x/api/chase/v1/config"), envWith({ CHASE_TOKEN: "secret" }));
      expect(res.status).toBe(401);
    });

    it("forwards authorized config only to its fixed Core route with no-store", async () => {
      const core = mockCoreVpc(() => new Response(JSON.stringify({ schema: "codeblack.chase.config" }), { status: 200 }));
      const res = await handleRequest(
        new Request("https://x/api/chase/v1/config", { headers: { Authorization: "Bearer secret" } }),
        envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(core.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8000/api/chase/v1/config",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret" }) }),
      );
    });

    it("forwards authorized telemetry to the existing fixed Core ingest route", async () => {
      const core = mockCoreVpc(() => new Response(JSON.stringify({ accepted: true }), { status: 200 }));
      const res = await handleRequest(
        new Request("https://x/api/chase/v1/telemetry", {
          method: "POST",
          headers: { Authorization: "Bearer secret" },
          body: JSON.stringify({ unit_id: "cbwx-unit-tessa" }),
        }),
        envWith({ CORE_VPC: core, CHASE_TOKEN: "secret" }),
      );
      expect(res.status).toBe(200);
      expect(core.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8000/api/chase/location",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "X-CodeBlack-Chase-Source": "public-v1" }),
        }),
      );
    });

    it("accepts an active OPS Supabase session and keeps the Core token private", async () => {
      const authFetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: "operator-1" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([{ active: true }]), { status: 200 }));
      vi.stubGlobal("fetch", authFetch);
      try {
        const core = mockCoreVpc(() => new Response("{}", { status: 200 }));
        const res = await handleRequest(
          new Request("https://x/api/chase/v1/config", { headers: { Authorization: "Bearer user-jwt" } }),
          envWith({
            CORE_VPC: core,
            CHASE_TOKEN: "private-core-token",
            SUPABASE_URL: "https://project.supabase.co",
            SUPABASE_PUBLISHABLE_KEY: "publishable-key",
          }),
        );
        expect(res.status).toBe(200);
        expect(authFetch).toHaveBeenCalledTimes(2);
        expect(core.fetch).toHaveBeenCalledWith(
          "http://127.0.0.1:8000/api/chase/v1/config",
          expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer private-core-token" }) }),
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("9b. GET /api/chase/v1/comments", () => {
    const commentEnv = (): Env => envWith({
      CHASE_TOKEN: "secret",
      FACEBOOK_PAGE_ID: "650911364781023",
      FACEBOOK_PAGE_ACCESS_TOKEN: "facebook-secret",
    });

    it("requires existing Chase authorization and never calls Graph first", async () => {
      const graphFetch = vi.fn();
      vi.stubGlobal("fetch", graphFetch);
      try {
        const res = await handleRequest(new Request("https://x/api/chase/v1/comments"), commentEnv());
        expect(res.status).toBe(401);
        expect(graphFetch).not.toHaveBeenCalled();
      } finally { vi.unstubAllGlobals(); }
    });

    it("returns an empty healthy feed when the Page has no live video", async () => {
      const graphFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      vi.stubGlobal("fetch", graphFetch);
      try {
        const res = await handleRequest(new Request("https://x/api/chase/v1/comments", { headers: { Authorization: "Bearer secret" } }), commentEnv());
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ state: "ok", cursor: "", pollAfterMs: 2000, comments: [] });
        const requested = new URL(graphFetch.mock.calls[0][0] as URL);
        expect(requested.pathname).toBe("/v26.0/650911364781023/live_videos");
        expect(requested.searchParams.get("access_token")).toBeNull();
        expect(graphFetch.mock.calls[0][1]).toEqual({ headers: { Authorization: "Bearer facebook-secret" } });
      } finally { vi.unstubAllGlobals(); }
    });

    it("normalizes only safe comment fields and advances the relay cursor", async () => {
      const graphFetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "live-1" }] }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{
          id: "comment-1", from: { name: "Nick" }, message: "Watching", created_time: "2026-09-23T20:00:05Z", extra: "never-returned",
        }] }), { status: 200 }));
      vi.stubGlobal("fetch", graphFetch);
      try {
        const res = await handleRequest(new Request("https://x/api/chase/v1/comments?after=1758657600", { headers: { Authorization: "Bearer secret" } }), commentEnv());
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ state: "ok", cursor: "1790193605", pollAfterMs: 2000, comments: [{ id: "comment-1", author: "Nick", message: "Watching", createdAt: "2026-09-23T20:00:05.000Z" }] });
        const requested = new URL(graphFetch.mock.calls[1][0] as URL);
        expect(requested.searchParams.get("since")).toBe("1758657600");
        expect(requested.searchParams.get("fields")).toBe("id,from{name},message,created_time");
      } finally { vi.unstubAllGlobals(); }
    });

    it("is safe while unconfigured and does not request Graph", async () => {
      const graphFetch = vi.fn();
      vi.stubGlobal("fetch", graphFetch);
      try {
        const res = await handleRequest(
          new Request("https://x/api/chase/v1/comments", { headers: { Authorization: "Bearer secret" } }),
          envWith({ CHASE_TOKEN: "secret" }),
        );
        expect(await res.json()).toEqual({ state: "not_configured", cursor: "", pollAfterMs: 2000, comments: [] });
        expect(graphFetch).not.toHaveBeenCalled();
      } finally { vi.unstubAllGlobals(); }
    });
  });

  describe("10. GET /api/chase/location/latest (private)", () => {
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

  it("serves a signed Chase update without Core or a bearer token", async () => {
    const apk = new TextEncoder().encode("chase-apk");
    const sha = await sha256Hex(apk);
    const manifest = JSON.stringify({
      schema: "codeblack.chase.update",
      schemaVersion: "1.0.0",
      channel: "recovery",
      versionName: "0.1.2",
      versionCode: 7,
      apkUrl: "https://ops.codeblackwx.com/api/chase/v1/releases/chase-recovery-7.apk",
      sha256: sha,
      signerSha256: "ab".repeat(32),
      releaseNotes: "Field update",
      publishedAt: "2026-09-21T17:00:00Z",
      minimumSupportedVersionCode: 5,
      required: false,
    });
    const env = { ASSETS: assetsOf({ "/update.json": manifest, "/chase-recovery-7.apk": apk }) };
    const listed = await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/v1/update"), env);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ versionCode: 7, sha256: sha });
    const downloaded = await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/v1/releases/chase-recovery-7.apk"), env);
    expect(downloaded.status).toBe(200);
    expect(new TextDecoder().decode(await downloaded.arrayBuffer())).toBe("chase-apk");
  });

  it("rejects a Chase release whose bytes do not match the manifest", async () => {
    const manifest = JSON.stringify({
      schema: "codeblack.chase.update",
      schemaVersion: "1.0.0",
      channel: "recovery",
      versionName: "0.1.2",
      versionCode: 7,
      apkUrl: "https://ops.codeblackwx.com/api/chase/v1/releases/chase-recovery-7.apk",
      sha256: "11".repeat(32),
      signerSha256: "ab".repeat(32),
      releaseNotes: "Field update",
      publishedAt: "2026-09-21T17:00:00Z",
      minimumSupportedVersionCode: 5,
      required: false,
    });
    const env = { ASSETS: assetsOf({ "/update.json": manifest, "/chase-recovery-7.apk": "tampered" }) };
    const res = await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/v1/releases/chase-recovery-7.apk"), env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "CHECKSUM_MISMATCH" });
  });

  it("serves a checksum-verified archived release without making it the update target", async () => {
    const apk = new TextEncoder().encode("previous-chase-apk");
    const sha = await sha256Hex(apk);
    const archive = JSON.stringify({
      schema: "codeblack.chase.release-archive",
      schemaVersion: "1.0.0",
      releases: [{ versionCode: 8, fileName: "chase-recovery-8.apk", sha256: sha, signerSha256: "ab".repeat(32) }],
    });
    const env = { ASSETS: assetsOf({ "/release-archive.json": archive, "/chase-recovery-8.apk": apk }) };
    const listed = await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/v1/releases/archive"), env);
    expect(listed.status).toBe(200);
    const downloaded = await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/v1/releases/archive/chase-recovery-8.apk"), env);
    expect(downloaded.status).toBe(200);
    expect(new TextDecoder().decode(await downloaded.arrayBuffer())).toBe("previous-chase-apk");
  });

  it("does not publish an update when no release asset exists", async () => {
    const res = await handleRequest(new Request("https://ops.codeblackwx.com/api/chase/v1/update"), {});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NO_UPDATE_PUBLISHED" });
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
