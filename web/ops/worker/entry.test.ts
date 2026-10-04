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
