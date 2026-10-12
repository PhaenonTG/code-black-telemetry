import { afterEach, describe, expect, it, vi } from "vitest";
import gateway from "../../worker/entry";
import { handleRequest } from "../../../../workers/core-gateway/src/index";

const path = "/api/ai/v1/target-analysis";
const request = (body: string, route = path, method = "POST", auth = true) => new Request(`https://ops.example/api/core${route}?provider=paid`, { method, headers: auth ? { Authorization: "Bearer qa", "Content-Type": "application/json" } : {}, ...(method === "GET" ? {} : { body }) });
function fixture(active = true) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => String(input).includes("/auth/v1/user") ? Response.json({ id: "qa" }) : Response.json([{ active }])));
  const upstream = vi.fn(async (_url: string | URL, _init?: RequestInit) => Response.json({ status: "available", context: { latitude: 36.38, longitude: -94.1 } }));
  const transport = vi.fn((input: string | URL, init?: RequestInit) => handleRequest(new Request(input, init), { CORE_VPC: { fetch: upstream } }));
  return { upstream, transport, env: { VITE_SUPABASE_URL: "https://qa.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "qa", CORE_GATEWAY_WORKER: { fetch: transport }, ASSETS: { fetch: vi.fn(async () => new Response("app")) } } };
}
afterEach(() => vi.unstubAllGlobals());
describe("Production Advanced Mode Aegis gateway", () => {
  it("carries exact selected-point JSON through both gateways to Core", async () => {
    const { env, upstream } = fixture();
    const result = await gateway.fetch(request('{"latitude":36.38,"longitude":-94.1}'), env, {} as never);
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(upstream).toHaveBeenCalledWith(`http://127.0.0.1:8000${path}`, expect.objectContaining({ method: "POST", body: '{"latitude":36.38,"longitude":-94.1}' }));
    expect(await result.json()).toMatchObject({ status: "available" });
  });
  it("normalizes the bodyless local refresh to an empty JSON object", async () => {
    const { env, upstream } = fixture();
    expect((await gateway.fetch(request("", "/api/ai/v1/assessment/refresh"), env, {} as never)).status).toBe(200);
    expect(upstream).toHaveBeenCalledWith("http://127.0.0.1:8000/api/ai/v1/assessment/refresh", expect.objectContaining({ body: "{}" }));
  });
  it.each(['{}', 'broken', 'null', '[]', '{"latitude":91,"longitude":0}', '{"latitude":0,"longitude":0,"model":"paid"}', ' '.repeat(513)])("rejects invalid local review input before the private transport", async (body) => {
    const { env, upstream, transport } = fixture();
    expect((await gateway.fetch(request(body), env, {} as never)).status).toBe(body.length > 512 ? 413 : 400);
    expect(transport).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
  it("keeps anonymous/inactive users, paid endpoints, and wrong methods closed", async () => {
    const { env, upstream } = fixture(false);
    expect((await gateway.fetch(request("{}", path, "POST", false), env, {} as never)).status).toBe(401);
    expect((await gateway.fetch(request("{}"), env, {} as never)).status).toBe(403);
    fixture();
    expect((await gateway.fetch(request("{}", "/api/ai/v1/paid-review"), env, {} as never)).status).toBe(404);
    expect((await gateway.fetch(request("{}", "/health"), env, {} as never)).status).toBe(405);
    expect((await gateway.fetch(request("", path, "GET"), env, {} as never)).status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });
});
