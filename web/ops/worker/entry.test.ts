import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./entry";

afterEach(() => vi.unstubAllGlobals());

const request = (token?: string) => new Request("https://ops.codeblackwx.com/api/core/api/fabric/v1/stream", {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});

describe("authenticated Fabric feed route", () => {
  it("rejects anonymous callers before touching Core", async () => {
    const coreFetch = vi.fn();
    const response = await worker.fetch(request(), {
      ASSETS: { fetch: vi.fn() },
      CORE_GATEWAY_WORKER: { fetch: coreFetch },
    }, {} as ExecutionContext);
    expect(response.status).toBe(401);
    expect(coreFetch).not.toHaveBeenCalled();
  });

  it("requires an active OPS profile before opening the feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
      url.includes("/auth/v1/user") ? JSON.stringify({ id: "user-1" }) : JSON.stringify([{ active: false }]),
      { headers: { "Content-Type": "application/json" } },
    )));
    const coreFetch = vi.fn();
    const response = await worker.fetch(request("token"), {
      ASSETS: { fetch: vi.fn() },
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-key",
      CORE_GATEWAY_WORKER: { fetch: coreFetch },
    }, {} as ExecutionContext);
    expect(response.status).toBe(403);
    expect(coreFetch).not.toHaveBeenCalled();
  });
});

describe("setup decisions", () => {
  const actor = "11111111-2222-3333-4444-555555555555";
  function setup(role: string) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("/auth/v1/user") ? { id: actor } : [{ active: true, role }]))));
    const coreFetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(JSON.stringify({ error: "SETUP_CONFLICT" }), { status: 409 }));
    return { coreFetch, env: { ASSETS: { fetch: vi.fn() }, VITE_SUPABASE_URL: "https://test.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test", CORE_GATEWAY_WORKER: { fetch: coreFetch } } };
  }
  const decisionRequest = () => new Request("https://ops.codeblackwx.com/api/core/api/forecast/v1/chase-setup-decision", {
    method: "POST", headers: { Authorization: "Bearer test", "X-Ops-Role": "OWNER", "X-Ops-User-Id": "forged" }, body: "{}",
  });
  it("rejects an OPERATOR even when the request forges owner headers", async () => {
    const { coreFetch, env } = setup("OPERATOR");
    expect((await worker.fetch(decisionRequest(), env, {} as ExecutionContext)).status).toBe(403);
    expect(coreFetch).not.toHaveBeenCalled();
  });
  it("uses only the verified profile and preserves a stale-revision conflict", async () => {
    const { coreFetch, env } = setup("ADMIN");
    const response = await worker.fetch(decisionRequest(), env, {} as ExecutionContext);
    expect(response.status).toBe(409);
    const headers = new Headers(coreFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-Ops-User-Id")).toBe(actor);
    expect(headers.get("X-Ops-Role")).toBe("ADMIN");
  });
});
