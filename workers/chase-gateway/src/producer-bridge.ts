const STATUS_KEY = "status";
const CAPABILITIES_KEY = "capabilities";
const FRAME_KEY = "program-frame";
const COMMANDS_KEY = "commands";
const MAX_COMMANDS = 100;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const COMMAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "preview.start", "preview.stop", "facebook.output.start", "facebook.output.stop",
  "archive.camera.start", "archive.camera.stop", "lowerThird.set", "lowerThird.hide",
]);

export interface BridgeStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

type StoredDocument = { receivedAt: string; body: Record<string, unknown> };
type StoredFrame = { receivedAt: string; frameAt: string; bytes: ArrayBuffer };
type StoredCommand = {
  commandId: string; action: string; expectedStateRevision: number; payload?: Record<string, unknown>;
  operator: string; createdAt: string; state: "queued" | "succeeded" | "failed" | "timed_out";
  result?: unknown; completedAt?: string;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function jsonBody(request: Request, limit = MAX_JSON_BYTES): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > limit) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function bridgeState(document: StoredDocument | undefined): "ONLINE" | "OFFLINE" {
  return document && Date.now() - Date.parse(document.receivedAt) <= 10_000 ? "ONLINE" : "OFFLINE";
}

export async function handleProducerStateRequest(request: Request, storage: BridgeStorage): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/producer/v1/workstation/status" && request.method === "POST") {
    const body = await jsonBody(request);
    if (!body) return json(400, { error: "INVALID_STATUS" });
    const value: StoredDocument = { receivedAt: new Date().toISOString(), body };
    await storage.put(STATUS_KEY, value);
    return json(202, { accepted: true });
  }
  if (path === "/api/producer/v1/workstation/capabilities" && request.method === "POST") {
    const body = await jsonBody(request);
    if (!body) return json(400, { error: "INVALID_CAPABILITIES" });
    await storage.put(CAPABILITIES_KEY, { receivedAt: new Date().toISOString(), body } satisfies StoredDocument);
    return json(202, { accepted: true });
  }
  if (path === "/api/producer/v1/workstation/preview/program.jpg" && request.method === "POST") {
    const size = Number(request.headers.get("Content-Length") || 0);
    if (size > MAX_FRAME_BYTES || request.headers.get("Content-Type") !== "image/jpeg") return json(413, { error: "INVALID_FRAME" });
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_FRAME_BYTES) return json(413, { error: "INVALID_FRAME" });
    await storage.put(FRAME_KEY, { receivedAt: new Date().toISOString(), frameAt: request.headers.get("X-Producer-Frame-At") || new Date().toISOString(), bytes } satisfies StoredFrame);
    return json(202, { accepted: true });
  }

  if (path === "/api/producer/v1/status" && request.method === "GET") {
    const value = await storage.get<StoredDocument>(STATUS_KEY);
    const producer = value?.body ?? null;
    return json(200, {
      bridge: bridgeState(value),
      observedAt: value?.receivedAt ?? null,
      producer,
      // Compatibility alias consumed by the OPS Producer workspace.
      status: producer,
    });
  }
  if (path === "/api/producer/v1/capabilities" && request.method === "GET") {
    const value = await storage.get<StoredDocument>(CAPABILITIES_KEY);
    return json(200, { bridge: bridgeState(value), observedAt: value?.receivedAt ?? null, capabilities: value?.body ?? null });
  }
  if (path === "/api/producer/v1/preview/program.jpg" && request.method === "GET") {
    const [status, frame] = await Promise.all([storage.get<StoredDocument>(STATUS_KEY), storage.get<StoredFrame>(FRAME_KEY)]);
    const sourceLive = status?.body.source_state === "SOURCE_LIVE";
    const current = frame && Date.now() - Date.parse(frame.receivedAt) <= 5_000;
    if (!sourceLive || !current || !frame) return json(404, { error: "PREVIEW_NOT_CURRENT" });
    return new Response(frame.bytes, { status: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Producer-Frame-At": frame.frameAt, "X-Content-Type-Options": "nosniff" } });
  }

  if (path === "/api/producer/v1/commands" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    const commandId = body?.commandId;
    const action = body?.action;
    const expected = body?.expectedStateRevision;
    if (typeof commandId !== "string" || !COMMAND_ID.test(commandId) || typeof action !== "string" || !ACTIONS.has(action) || !Number.isSafeInteger(expected)) return json(400, { error: "INVALID_COMMAND" });
    if (action === "lowerThird.set" && (typeof (body?.payload as Record<string, unknown> | undefined)?.text !== "string" || String((body?.payload as Record<string, unknown>).text).length > 120)) return json(400, { error: "INVALID_PAYLOAD" });
    const commands = await storage.get<StoredCommand[]>(COMMANDS_KEY) ?? [];
    const prior = commands.find((item) => item.commandId === commandId);
    if (prior) return json(200, prior);
    const command: StoredCommand = { commandId, action, expectedStateRevision: expected as number, ...(body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? { payload: body.payload as Record<string, unknown> } : {}), operator: request.headers.get("X-Producer-Operator") || "unknown", createdAt: new Date().toISOString(), state: "queued" };
    commands.push(command);
    await storage.put(COMMANDS_KEY, commands.slice(-MAX_COMMANDS));
    return json(202, command);
  }
  if (path === "/api/producer/v1/workstation/commands" && request.method === "GET") {
    const commands = await storage.get<StoredCommand[]>(COMMANDS_KEY) ?? [];
    return json(200, { commands: commands.filter((item) => item.state === "queued").slice(0, 20) });
  }
  if (path === "/api/producer/v1/workstation/ack" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    if (typeof body?.commandId !== "string" || !COMMAND_ID.test(body.commandId) || !["succeeded", "failed", "timed_out"].includes(String(body.state))) return json(400, { error: "INVALID_ACK" });
    const commands = await storage.get<StoredCommand[]>(COMMANDS_KEY) ?? [];
    const command = commands.find((item) => item.commandId === body.commandId);
    if (!command) return json(404, { error: "COMMAND_NOT_FOUND" });
    command.state = body.state as StoredCommand["state"];
    command.result = body.result;
    command.completedAt = new Date().toISOString();
    await storage.put(COMMANDS_KEY, commands);
    return json(200, command);
  }
  const commandMatch = /^\/api\/producer\/v1\/commands\/([0-9a-f-]+)$/.exec(path);
  if (commandMatch && request.method === "GET") {
    const commands = await storage.get<StoredCommand[]>(COMMANDS_KEY) ?? [];
    const command = commands.find((item) => item.commandId === commandMatch[1]);
    return command ? json(200, command) : json(404, { error: "COMMAND_NOT_FOUND" });
  }
  return json(404, { error: "NOT_FOUND" });
}

export class ProducerBridge implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}
  fetch(request: Request): Promise<Response> { return handleProducerStateRequest(request, this.state.storage); }
}
