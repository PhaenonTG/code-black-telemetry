import { describe, expect, it } from "vitest";
import { handlePrivateProducerControl, type ProducerControlEnv } from "./private-producer-control";
const user = "operator-test";
const env: ProducerControlEnv = { VITE_SUPABASE_URL: "https://auth.example.test", VITE_SUPABASE_PUBLISHABLE_KEY: "public-test-key", OPS_PRIVATE_PRODUCER_BASE_URL: "http://127.0.0.1:4188", OPS_PRIVATE_PRODUCER_TOKEN: "x".repeat(48), OPS_PRIVATE_PRODUCER_CONTROLS_ENABLED: "true", OPS_PRIVATE_PRODUCER_OPERATOR_IDS: user };
function mock() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: user });
    if (url.includes("/rest/v1/profiles?")) return Response.json([{ active: true, role: "OPERATOR" }]);
    return Response.json({ status: { engine: "obs" } });
  }) as typeof fetch;
  return { calls, fetcher };
}
const req = (path: string, method = "GET", body?: unknown, token = "browser-session") => new Request(`https://ops-private.codeblackwx.com/api/producer/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, "X-Producer-UserId": "spoofed" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
describe("private Producer parity", () => {
  it("is opt-in and never falls back to the public Worker", async () => {
    const m = mock(); expect(await handlePrivateProducerControl(req("status"), { ...env, OPS_PRIVATE_PRODUCER_CONTROLS_ENABLED: "false" }, m.fetcher)).toBeNull(); expect(m.calls).toHaveLength(0);
    expect((await handlePrivateProducerControl(req("status"), { ...env, OPS_PRIVATE_PRODUCER_BASE_URL: "https://ops.codeblackwx.com" }, m.fetcher))?.status).toBe(503);
    expect(m.calls.every(c => !c.url.includes("ops.codeblackwx.com"))).toBe(true);
  });
  it("verifies active profile, derives identity and replaces browser credentials", async () => {
    const m = mock(); const r = await handlePrivateProducerControl(req("status"), env, m.fetcher);
    expect(await r?.json()).toMatchObject({ controlAccess: { allowed: true, userId: user } });
    const h = new Headers(m.calls.at(-1)?.init?.headers); expect(h.get("Authorization")).toBe(`Bearer ${env.OPS_PRIVATE_PRODUCER_TOKEN}`); expect(h.get("X-Producer-UserId")).toBe(user);
  });
  it("denies unapproved producers and legacy publishing without forwarding", async () => {
    const m = mock(); expect((await handlePrivateProducerControl(req("commands", "POST", { action: "obs.overlay.set" }), { ...env, OPS_PRIVATE_PRODUCER_OPERATOR_IDS: "someone-else" }, m.fetcher))?.status).toBe(403);
    expect((await handlePrivateProducerControl(req("facebook/publish", "POST", {}), env, m.fetcher))?.status).toBe(404);
    expect((await handlePrivateProducerControl(req("commands", "POST", { action: "facebook.output.start" }), env, m.fetcher))?.status).toBe(400);
    expect(m.calls.some(c => c.url.startsWith("http://127.0.0.1"))).toBe(false);
  });
  it("authenticates workstation heartbeat and does not trust spoofed actor headers", async () => {
    const m = mock(); expect((await handlePrivateProducerControl(req("workstation/heartbeat", "POST", {}), env, m.fetcher))?.status).toBe(401);
    expect(m.calls).toHaveLength(0);
    expect((await handlePrivateProducerControl(req("workstation/heartbeat", "POST", {}, env.OPS_PRIVATE_PRODUCER_TOKEN), env, m.fetcher))?.status).toBe(200);
    expect(new Headers(m.calls[0].init?.headers).has("X-Producer-UserId")).toBe(false);
  });
});
