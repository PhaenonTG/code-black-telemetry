import { describe, expect, it, vi } from "vitest";
import { handleKandriveRequest } from "./kandriveRelay";

describe("KanDrive relay", () => {
  it("rejects arbitrary methods and queries", async () => {
    expect((await handleKandriveRequest(new Request("https://ops.example/api/kandrive/graphql"))).status).toBe(405);
    expect((await handleKandriveRequest(new Request("https://ops.example/api/kandrive/graphql", { method: "POST", body: JSON.stringify({ query: "query Secrets { users }", variables: {} }) }))).status).toBe(400);
  });
  // A bare substring check (the previous validation) would have let this through: the forbidden
  // "Secrets" operation is real, "mapFeaturesQuery" only appears inside a trailing comment.
  it("rejects a smuggled operation with mapFeaturesQuery only in a comment", async () => {
    const query = "query Secrets { users } # mapFeaturesQuery(input:";
    expect((await handleKandriveRequest(new Request("https://ops.example/api/kandrive/graphql", { method: "POST", body: JSON.stringify({ query, variables: {} }) }))).status).toBe(400);
  });
  it("rejects an anonymous query even if it calls mapFeaturesQuery -- only the real named operation is allowed", async () => {
    const query = "query { mapFeaturesQuery(input: {}) { mapFeatures { title } } }";
    expect((await handleKandriveRequest(new Request("https://ops.example/api/kandrive/graphql", { method: "POST", body: JSON.stringify({ query, variables: {} }) }))).status).toBe(400);
  });
  it("relays only the real MapFeatures operation shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { mapFeaturesQuery: { mapFeatures: [] } } }), { status: 200 })));
    const query = "query MapFeatures($input: MapFeaturesArgs!) { mapFeaturesQuery(input: $input) { mapFeatures { title } } }";
    const response = await handleKandriveRequest(new Request("https://ops.example/api/kandrive/graphql", { method: "POST", body: JSON.stringify({ query, variables: {} }) }));
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
