import { describe, expect, it, vi } from "vitest";
import { handleKandriveRequest } from "./kandriveRelay";

describe("KanDrive relay", () => {
  it("rejects arbitrary methods and queries", async () => {
    expect((await handleKandriveRequest(new Request("https://ops.example/api/kandrive/graphql"))).status).toBe(405);
    expect((await handleKandriveRequest(new Request("https://ops.example/api/kandrive/graphql", { method: "POST", body: JSON.stringify({ query: "query Secrets { users }", variables: {} }) }))).status).toBe(400);
  });
  it("relays only the map feature contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { mapFeaturesQuery: { mapFeatures: [] } } }), { status: 200 })));
    const response = await handleKandriveRequest(new Request("https://ops.example/api/kandrive/graphql", { method: "POST", body: JSON.stringify({ query: "query { mapFeaturesQuery(input: {}) { mapFeatures { title } } }", variables: {} }) }));
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
