import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } },
}));

import { consumeFabricStream } from "./client";

const config = {
  mode: "LIVE_CORE" as const,
  coreBaseUrl: "/api/core",
  coreWsUrl: "",
  unitId: "cbwx-unit-striker",
  stormIntelPollSeconds: 30,
};

afterEach(() => vi.unstubAllGlobals());

describe("Fabric HTTP feed", () => {
  it("parses snapshots split across network chunks with authenticated headers", async () => {
    const sentHeaders: Headers[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sentHeaders.push(new Headers(init.headers));
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"event_type":"fabric.snap'));
          controller.enqueue(new TextEncoder().encode('shot","payload":{"schema":"codeblack.fabric.unit-state","units":[]}}\n'));
          controller.close();
        },
      }), { headers: { "Content-Type": "application/x-ndjson" } });
    }));
    const events: string[] = [];
    await consumeFabricStream(config, new AbortController().signal, (event) => events.push(event.eventType));
    expect(events).toEqual(["fabric.snapshot"]);
    expect(sentHeaders[0]?.get("Authorization")).toBe("Bearer test-token");
    expect(sentHeaders[0]?.get("Accept")).toBe("application/x-ndjson");
  });
});
