import { describe, expect, it } from "vitest";
import {
  forwardToCore,
  normalizeRouteKey,
  resolveAllowlistRoute,
  verifyOpsAuth,
  type GatewayEnv,
} from "./coreGateway";

const ENV: GatewayEnv = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("route allowlist", () => {
  it("resolves every documented OPS route", () => {
    expect(resolveAllowlistRoute("health")).toEqual({ upstreamPath: "/health", allowedQueryParams: [] });
    expect(resolveAllowlistRoute("fabric/health")).toEqual({ upstreamPath: "/api/fabric/v1/health", allowedQueryParams: [] });
    expect(resolveAllowlistRoute("fabric/units")).toEqual({ upstreamPath: "/api/fabric/v1/units", allowedQueryParams: [] });
    expect(resolveAllowlistRoute("storm-intel/point")).toEqual({
      upstreamPath: "/api/storm-intel/v1/point",
      allowedQueryParams: ["latitude", "longitude"],
    });
  });

  it("rejects any non-allowlisted path -- no passthrough", () => {
    expect(resolveAllowlistRoute("fabric/command")).toBeNull();
    expect(resolveAllowlistRoute("admin")).toBeNull();
    expect(resolveAllowlistRoute("ssh")).toBeNull();
    expect(resolveAllowlistRoute("../etc/passwd")).toBeNull();
    expect(resolveAllowlistRoute("mqtt")).toBeNull();
    expect(resolveAllowlistRoute("")).toBeNull();
  });

  it("normalizes path segments from Cloudflare's [[path]] param shape", () => {
    expect(normalizeRouteKey(["fabric", "health"])).toBe("fabric/health");
    expect(normalizeRouteKey("health")).toBe("health");
    expect(normalizeRouteKey(undefined)).toBe("");
  });
});

describe("verifyOpsAuth", () => {
  it("rejects a request with no Authorization header", async () => {
    const result = await verifyOpsAuth(null, ENV);
    expect(result).toEqual({ ok: false, status: 401, reason: "AUTH_REQUIRED" });
  });

  it("rejects a non-Bearer Authorization header", async () => {
    const result = await verifyOpsAuth("Basic abc123", ENV);
    expect(result).toEqual({ ok: false, status: 401, reason: "AUTH_REQUIRED" });
  });

  it("rejects an invalid/expired token (Supabase returns non-200)", async () => {
    const fetchImpl = (async () => jsonResponse(401, { error: "invalid token" })) as typeof fetch;
    const result = await verifyOpsAuth("Bearer expired-token", ENV, fetchImpl);
    expect(result).toEqual({ ok: false, status: 401, reason: "AUTH_INVALID" });
  });

  it("accepts a valid token for a user with an active profile", async () => {
    let call = 0;
    const fetchImpl = (async (url: string) => {
      call += 1;
      if (call === 1) {
        expect(url).toContain("/auth/v1/user");
        return jsonResponse(200, { id: "user-1" });
      }
      expect(url).toContain("/rest/v1/profiles");
      expect(url).toContain("user_id=eq.user-1");
      return jsonResponse(200, [{ active: true }]);
    }) as typeof fetch;
    const result = await verifyOpsAuth("Bearer good-token", ENV, fetchImpl);
    expect(result).toEqual({ ok: true, userId: "user-1" });
  });

  it("rejects a valid Supabase user with no profile row (unauthorized, not just unauthenticated)", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return jsonResponse(200, { id: "user-2" });
      return jsonResponse(200, []);
    }) as typeof fetch;
    const result = await verifyOpsAuth("Bearer good-token-no-profile", ENV, fetchImpl);
    expect(result).toEqual({ ok: false, status: 403, reason: "UNAUTHORIZED" });
  });

  it("rejects a valid Supabase user with an inactive profile", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return jsonResponse(200, { id: "user-3" });
      return jsonResponse(200, [{ active: false }]);
    }) as typeof fetch;
    const result = await verifyOpsAuth("Bearer good-token-inactive", ENV, fetchImpl);
    expect(result).toEqual({ ok: false, status: 403, reason: "UNAUTHORIZED" });
  });

  it("reports GATEWAY_MISCONFIGURED when Supabase env vars are absent, never leaking a stack", async () => {
    const result = await verifyOpsAuth("Bearer anything", {});
    expect(result).toEqual({ ok: false, status: 500, reason: "GATEWAY_MISCONFIGURED" });
  });
});

describe("forwardToCore (open-proxy prevention + bounded behavior)", () => {
  const route = { upstreamPath: "/api/storm-intel/v1/point", allowedQueryParams: ["latitude", "longitude"] };

  it("reports CORE_UNAVAILABLE when no upstream is configured, rather than guessing", async () => {
    const result = await forwardToCore(route, new URL("https://ops.codeblackwx.com/api/core/storm-intel/point"), {});
    expect(result).toEqual({ status: 502, reason: "CORE_UNAVAILABLE" });
  });

  it("forwards only the allowlisted query params to the configured upstream host -- never a caller-supplied host", async () => {
    let requestedUrl = "";
    const fetchImpl = (async (url: string) => {
      requestedUrl = url;
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;
    const incoming = new URL(
      "https://ops.codeblackwx.com/api/core/storm-intel/point?latitude=36.5&longitude=-93.7&host=evil.example.com&admin=1",
    );
    await forwardToCore(route, incoming, { CORE_GATEWAY_UPSTREAM_BASE: "https://core-gateway.internal.example" }, fetchImpl);
    expect(requestedUrl.startsWith("https://core-gateway.internal.example/api/storm-intel/v1/point")).toBe(true);
    expect(requestedUrl).toContain("latitude=36.5");
    expect(requestedUrl).toContain("longitude=-93.7");
    expect(requestedUrl).not.toContain("evil.example.com");
    expect(requestedUrl).not.toContain("admin=1");
  });

  it("sends Cloudflare Access Service Token headers to the upstream when configured", async () => {
    let sentHeaders: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sentHeaders = (init?.headers as Record<string, string>) ?? {};
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;
    await forwardToCore(route, new URL("https://ops.codeblackwx.com/api/core/storm-intel/point"), {
      CORE_GATEWAY_UPSTREAM_BASE: "https://core-gateway.internal.example",
      CORE_GATEWAY_CF_ACCESS_CLIENT_ID: "access-client-id",
      CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET: "access-client-secret",
    }, fetchImpl);
    expect(sentHeaders["CF-Access-Client-Id"]).toBe("access-client-id");
    expect(sentHeaders["CF-Access-Client-Secret"]).toBe("access-client-secret");
    expect(sentHeaders["X-Core-Gateway-Secret"]).toBeUndefined();
  });

  it("falls back to the shared-secret header only when Access Service Token credentials are absent", async () => {
    let sentHeaders: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sentHeaders = (init?.headers as Record<string, string>) ?? {};
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;
    await forwardToCore(route, new URL("https://ops.codeblackwx.com/api/core/storm-intel/point"), {
      CORE_GATEWAY_UPSTREAM_BASE: "https://core-gateway.internal.example",
      CORE_GATEWAY_SHARED_SECRET: "plain-shared-secret",
    }, fetchImpl);
    expect(sentHeaders["X-Core-Gateway-Secret"]).toBe("plain-shared-secret");
    expect(sentHeaders["CF-Access-Client-Id"]).toBeUndefined();
  });

  it("maps a fetch/abort failure to CORE_TIMEOUT", async () => {
    const fetchImpl = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch;
    const result = await forwardToCore(route, new URL("https://ops.codeblackwx.com/api/core/storm-intel/point"), {
      CORE_GATEWAY_UPSTREAM_BASE: "https://core-gateway.internal.example",
    }, fetchImpl);
    expect(result).toEqual({ status: 504, reason: "CORE_TIMEOUT" });
  });

  it("maps a network failure to CORE_UNAVAILABLE", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const result = await forwardToCore(route, new URL("https://ops.codeblackwx.com/api/core/storm-intel/point"), {
      CORE_GATEWAY_UPSTREAM_BASE: "https://core-gateway.internal.example",
    }, fetchImpl);
    expect(result).toEqual({ status: 504, reason: "CORE_UNAVAILABLE" });
  });

  it("maps malformed (non-JSON) upstream responses to CORE_MALFORMED_RESPONSE", async () => {
    const fetchImpl = (async () => new Response("<html>not json</html>", { status: 200 })) as typeof fetch;
    const result = await forwardToCore(route, new URL("https://ops.codeblackwx.com/api/core/storm-intel/point"), {
      CORE_GATEWAY_UPSTREAM_BASE: "https://core-gateway.internal.example",
    }, fetchImpl);
    expect(result).toEqual({ status: 502, reason: "CORE_MALFORMED_RESPONSE" });
  });

  it("maps a non-2xx upstream status to CORE_UNAVAILABLE without leaking upstream error detail", async () => {
    const fetchImpl = (async () => jsonResponse(500, { detail: "internal core error with sensitive path info" })) as typeof fetch;
    const result = await forwardToCore(route, new URL("https://ops.codeblackwx.com/api/core/storm-intel/point"), {
      CORE_GATEWAY_UPSTREAM_BASE: "https://core-gateway.internal.example",
    }, fetchImpl);
    expect(result).toEqual({ status: 502, reason: "CORE_UNAVAILABLE" });
  });

  it("returns the upstream JSON body on success (Storm Intel proxy success)", async () => {
    const payload = { requested: { lat: 36.5, lon: -93.7 }, resolved: { lat: 36.51, lon: -93.69 }, dataClass: "MODEL_ANALYSIS" };
    const fetchImpl = (async () => jsonResponse(200, payload)) as typeof fetch;
    const result = await forwardToCore(route, new URL("https://ops.codeblackwx.com/api/core/storm-intel/point?latitude=36.5&longitude=-93.7"), {
      CORE_GATEWAY_UPSTREAM_BASE: "https://core-gateway.internal.example",
    }, fetchImpl);
    expect(result).toEqual({ status: 200, body: payload });
  });
});
