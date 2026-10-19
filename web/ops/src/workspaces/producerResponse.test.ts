import { describe, expect, it } from "vitest";
import { readProducerResponse } from "./producerResponse";

describe("Producer API responses", () => {
  it("returns valid JSON", async () => {
    await expect(readProducerResponse<{ state: string }>(new Response('{"state":"ONLINE"}', { status: 200 }))).resolves.toEqual({ state: "ONLINE" });
  });

  it("keeps structured errors and hides proxy HTML", async () => {
    await expect(readProducerResponse(new Response('{"error":"Lease unavailable","code":190}', { status: 409 }))).rejects.toThrow("Lease unavailable (Meta 190)");
    await expect(readProducerResponse(new Response("<html>gateway failure</html>", { status: 502 }))).rejects.toThrow("Producer service returned HTTP 502");
  });
});
