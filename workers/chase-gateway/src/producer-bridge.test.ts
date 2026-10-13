import { describe, expect, it } from "vitest";
import { handleProducerStateRequest, type BridgeStorage } from "./producer-bridge";

class MemoryStorage implements BridgeStorage {
  values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

describe("Producer bridge state", () => {
  it("shares Facebook polling and applies ten-minute rate-limit backoff", async () => {
    const storage = new MemoryStorage();
    const cache = (body: unknown) => handleProducerStateRequest(new Request("https://x/api/chase/v1/facebook/internal/comment-cache", { method: "POST", body: JSON.stringify(body) }), storage);
    expect((await cache({ operation: "reserve" })).status).toBe(202);
    expect((await cache({ operation: "reserve" })).status).toBe(200);
    await cache({ operation: "save", payload: { state: "rate_limited", comments: [] } });
    const response = await cache({ operation: "reserve" });
    expect(await response.json()).toMatchObject({ payload: { state: "rate_limited", pollAfterMs: 600000 } });
  });
  it("enforces exclusive control leases and still permits emergency stops", async () => {
    const storage = new MemoryStorage();
    const call = (path: string, body: unknown, user = "operator-a", method = "POST") => handleProducerStateRequest(new Request(`https://x/api/producer/v1/${path}`, { method, headers: { "X-Producer-UserId": user }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) }), storage);
    const command = { commandId: "067169a4-52c0-4d08-8d7f-638e93ee8451", expectedStateRevision: 3, action: "preview.start" };
    expect((await call("commands", command)).status).toBe(409);
    expect((await call("control-lease", {})).status).toBe(200);
    expect((await call("control-lease", {}, "operator-b")).status).toBe(409);
    await handleProducerStateRequest(new Request("https://x/api/producer/v1/workstation/status", { method: "POST", body: JSON.stringify({ stateRevision: 3 }) }), storage);
    expect((await call("commands", command)).status).toBe(202);
    expect((await call("commands", { ...command, action: "preview.stop" })).status).toBe(409);
    expect((await call("commands", { ...command, commandId: "338274ab-bf75-4f45-8b56-ed5b70d562b5", action: "facebook.output.stop", expectedStateRevision: 0 }, "operator-b")).status).toBe(202);
    expect((await call("commands", { ...command, commandId: "5e4d0620-b15d-411a-8e5c-33e0062243e5", action: "facebook.output.start", confirmed: true })).status).toBe(409);
  });

  it("expires queued commands before a disconnected workstation can execute them", async () => {
    const storage = new MemoryStorage();
    storage.values.set("commands", [{ commandId: "2bd3ed52-786b-4ead-a77a-a6438fd9b772", state: "queued", createdAt: new Date(Date.now() - 20000).toISOString() }]);
    const response = await handleProducerStateRequest(new Request("https://x/api/producer/v1/workstation/commands"), storage);
    expect(await response.json()).toEqual({ commands: [] });
    expect(await storage.get("commands")).toMatchObject([{ state: "timed_out" }]);
  });
  it("stores one-time Facebook OAuth sessions and an encrypted Page credential", async () => {
    const storage = new MemoryStorage();
    const ticket = "a".repeat(43);
    const userId = "304f8cd4-e0d6-4636-a3a5-e5569111b022";
    let response = await handleProducerStateRequest(new Request("https://x/api/chase/v1/facebook/internal/session", {
      method: "POST",
      body: JSON.stringify({ ticket, userId, createdAt: new Date().toISOString() }),
    }), storage);
    expect(response.status).toBe(202);
    response = await handleProducerStateRequest(new Request(`https://x/api/chase/v1/facebook/internal/session?ticket=${ticket}`), storage);
    expect(await response.json()).toMatchObject({ ticket, userId });

    response = await handleProducerStateRequest(new Request("https://x/api/chase/v1/facebook/internal/credential", {
      method: "POST",
      body: JSON.stringify({
        ticket,
        credential: {
          pageId: "650911364781023",
          label: "Storm Chaser Nick Mounce",
          ciphertext: "b".repeat(40),
          iv: "c".repeat(16),
          connectedAt: new Date().toISOString(),
          connectedBy: userId,
        },
      }),
    }), storage);
    expect(response.status).toBe(202);
    response = await handleProducerStateRequest(new Request("https://x/api/chase/v1/facebook/internal/credential"), storage);
    expect(await response.json()).toMatchObject({ pageId: "650911364781023", connectedBy: userId });
    response = await handleProducerStateRequest(new Request(`https://x/api/chase/v1/facebook/internal/session?ticket=${ticket}`), storage);
    expect(response.status).toBe(404);
  });

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
