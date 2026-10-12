import { describe, expect, it, vi } from "vitest";
import { handleAegisConsoleRequest } from "./aegisConsoleRelay";

describe("AEGIS console relay", () => {
  it("keeps the browser on OPS while forwarding only to Core's fixed console route", async () => {
    const upstream = vi.fn(async () => new Response("<html>AEGIS</html>", { headers: { "Content-Type": "text/html" } }));
    const response = await handleAegisConsoleRequest(
      new Request("https://ops.codeblackwx.com/ai/static/app.js?v=1", { headers: { Cookie: "aegis_session=ok" } }),
      { CORE_GATEWAY_UPSTREAM_BASE: "https://core.example/" }, upstream,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("AEGIS");
    expect(String(upstream.mock.calls[0]?.[0])).toBe("https://core.example/api/ops/v1/aegis-console/static/app.js?v=1");
    expect(upstream.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("rejects a traversal path instead of turning into a general Core proxy", async () => {
    const upstream = vi.fn();
    const response = await handleAegisConsoleRequest(
      new Request("https://ops.codeblackwx.com/ai/%2e%2e/health"),
      { CORE_GATEWAY_UPSTREAM_BASE: "https://core.example/" }, upstream,
    );
    // The URL parser normalizes the traversal before the handler sees it,
    // leaving the protected prefix entirely. Either way it is not proxied.
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});
