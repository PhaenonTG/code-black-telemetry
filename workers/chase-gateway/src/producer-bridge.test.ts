import { describe, expect, it } from "vitest";
import { handleProducerStateRequest, type BridgeStorage } from "./producer-bridge";

class MemoryStorage implements BridgeStorage {
  values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

describe("Producer bridge state", () => {
  it("reports offline until the workstation pushes status, then reports online", async () => {
    const storage = new MemoryStorage();
    let response = await handleProducerStateRequest(new Request("https://x/api/producer/v1/status"), storage);
    expect(await response.json()).toMatchObject({ bridge: "OFFLINE", producer: null, status: null });
    await handleProducerStateRequest(new Request("https://x/api/producer/v1/workstation/status", { method: "POST", body: JSON.stringify({ source_state: "SOURCE_LIVE", stateRevision: 4 }) }), storage);
    response = await handleProducerStateRequest(new Request("https://x/api/producer/v1/status"), storage);
    expect(await response.json()).toMatchObject({
      bridge: "ONLINE",
      producer: { source_state: "SOURCE_LIVE", stateRevision: 4 },
      status: { source_state: "SOURCE_LIVE", stateRevision: 4 },
    });
  });

  it("never serves a preview unless both the frame and source state are current", async () => {
    const storage = new MemoryStorage();
    const frame = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    await handleProducerStateRequest(new Request("https://x/api/producer/v1/workstation/preview/program.jpg", { method: "POST", headers: { "Content-Type": "image/jpeg", "X-Producer-Frame-At": "2026-10-13T17:00:00Z" }, body: frame }), storage);
    let response = await handleProducerStateRequest(new Request("https://x/api/producer/v1/preview/program.jpg"), storage);
    expect(response.status).toBe(404);
    await handleProducerStateRequest(new Request("https://x/api/producer/v1/workstation/status", { method: "POST", body: JSON.stringify({ source_state: "SOURCE_LIVE" }) }), storage);
    response = await handleProducerStateRequest(new Request("https://x/api/producer/v1/preview/program.jpg"), storage);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("queues idempotent allowlisted commands and records workstation acknowledgement", async () => {
    const storage = new MemoryStorage();
    const command = { commandId: "2bd3ed52-786b-4ead-a77a-a6438fd9b772", action: "preview.start", expectedStateRevision: 3 };
    const request = () => new Request("https://x/api/producer/v1/commands", { method: "POST", headers: { "X-Producer-Operator": "Glenn" }, body: JSON.stringify(command) });
    expect((await handleProducerStateRequest(request(), storage)).status).toBe(202);
    expect((await handleProducerStateRequest(request(), storage)).status).toBe(200);
    const poll = await handleProducerStateRequest(new Request("https://x/api/producer/v1/workstation/commands"), storage);
    expect((await poll.json()) as unknown).toMatchObject({ commands: [{ commandId: command.commandId, state: "queued" }] });
    const ack = await handleProducerStateRequest(new Request("https://x/api/producer/v1/workstation/ack", { method: "POST", body: JSON.stringify({ commandId: command.commandId, state: "succeeded" }) }), storage);
    expect(await ack.json()).toMatchObject({ state: "succeeded" });
  });

  it("rejects unallowlisted commands", async () => {
    const storage = new MemoryStorage();
    const response = await handleProducerStateRequest(new Request("https://x/api/producer/v1/commands", { method: "POST", body: JSON.stringify({ commandId: "5c15afee-159e-41c4-b8bf-0aa90eb7e850", action: "facebook.publish", expectedStateRevision: 0 }) }), storage);
    expect(response.status).toBe(400);
  });
});
