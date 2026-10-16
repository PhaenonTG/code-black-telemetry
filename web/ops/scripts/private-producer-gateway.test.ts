import { describe, expect, it, vi } from "vitest";
import { handlePrivateProducerRead, handlePrivateProducerWrite, type PrivateProducerEnv } from "./private-producer-gateway";

const userId = "4b10eb9e-af64-4077-a659-2fe4adf69b12";
const token = "private-service-token-with-at-least-32-characters";
const env: PrivateProducerEnv = {
  VITE_SUPABASE_URL: "https://auth.example.test",
  VITE_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
  OPS_PRIVATE_PRODUCER_BASE_URL: "http://127.0.0.1:4188",
  OPS_PRIVATE_PRODUCER_TOKEN: token,
};

function mockFetch(upstream: Response = Response.json({ status: { source_state: "ready" } })) {
  const calls: Array<{ url: string; headers: Headers; method?: string }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers), method: init?.method });
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: userId });
    if (url.includes("/rest/v1/profiles?")) return Response.json([{ active: true, role: "OPERATOR" }]);
    return upstream;
  }) as typeof fetch;
  return { fetcher, calls };
}

const request = (path: string, method = "GET", authorized = true) => new Request(`http://localhost${path}`, {
  method, headers: authorized ? { Authorization: "Bearer browser-session" } : undefined,
});

describe("private Producer workstation shadow ingest", () => {
  const write = (path: string, body: BodyInit, authorization = `Bearer ${token}`, contentType = "application/json") =>
    new Request(`http://localhost/api/producer/v1/workstation/${path}`, {
      method: "POST", headers: { Authorization: authorization, "Content-Type": contentType }, body,
    });

  it("accepts only the scoped token and shadow paths", async () => {
    const mock = mockFetch(Response.json({ accepted: true }));
    expect((await handlePrivateProducerWrite(write("status", "{}" , "Bearer wrong-token"), env, mock.fetcher)).status).toBe(401);
    expect((await handlePrivateProducerWrite(write("commands", "{}"), env, mock.fetcher)).status).toBe(503);
    expect((await handlePrivateProducerWrite(write("status", "{}", `Bearer ${token}`, "text/plain"), env, mock.fetcher)).status).toBe(415);
    expect(mock.calls).toHaveLength(0);
    const result = await handlePrivateProducerWrite(write("status", '{"bridge":"ready"}'), env, mock.fetcher);
    expect(result.status).toBe(200);
    expect(mock.calls[0].url).toBe("http://127.0.0.1:4188/api/producer/v1/workstation/status");
    expect(mock.calls[0].headers.get("Authorization")).toBe(`Bearer ${token}`);
    expect(mock.calls[0].method).toBe("POST");
  });

  it("bounds media and refuses non-loopback upstreams", async () => {
    const mock = mockFetch(Response.json({ accepted: true }));
    expect((await handlePrivateProducerWrite(write("preview/program.jpg", new Uint8Array(2 * 1024 * 1024 + 1), `Bearer ${token}`, "image/jpeg"), env, mock.fetcher)).status).toBe(413);
    expect(mock.calls).toHaveLength(0);
    expect((await handlePrivateProducerWrite(write("preview/program.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), `Bearer ${token}`, "image/jpeg"), { ...env, OPS_PRIVATE_PRODUCER_BASE_URL: "https://example.com" }, mock.fetcher)).status).toBe(502);
    const segment = `preview/hls/program-${"a".repeat(32)}-123.ts`;
    expect((await handlePrivateProducerWrite(write(segment, new Uint8Array([1, 2]), `Bearer ${token}`, "video/mp2t"), env, mock.fetcher)).status).toBe(200);
  });
});

describe("private Producer operator relay", () => {
  it("warms a cold authenticated manifest without changing auth or composition headers", async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      const fetcher = (async (input) => {
        const url = String(input);
        if (url.endsWith("/auth/v1/user")) return Response.json({ id: userId });
        if (url.includes("/rest/v1/profiles?")) return Response.json([{ active: true, role: "OPERATOR" }]);
        reads++;
        return reads === 1 ? Response.json({ error: "PROGRAM_MEDIA_NOT_CURRENT" }, { status: 404 }) : new Response("#EXTM3U\n", { headers: { "Content-Type": "application/vnd.apple.mpegurl", "X-Producer-Composition": "a".repeat(24) } });
      }) as typeof fetch;
      const pending = handlePrivateProducerRead(request("/api/producer/v1/preview/hls/index.m3u8"), env, fetcher);
      await vi.advanceTimersByTimeAsync(250);
      const response = await pending;
      expect(response.status).toBe(200); expect(reads).toBe(2);
      expect(response.headers.get("X-Producer-Composition")).toBe("a".repeat(24));
    } finally { vi.useRealTimers(); }
  });

  it("bounds missing-media warmup and never retries segment errors", async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      const fetcher = (async (input) => {
        const url = String(input);
        if (url.endsWith("/auth/v1/user")) return Response.json({ id: userId });
        if (url.includes("/rest/v1/profiles?")) return Response.json([{ active: true, role: "OPERATOR" }]);
        reads++; return Response.json({ error: "PROGRAM_MEDIA_NOT_CURRENT" }, { status: 404 });
      }) as typeof fetch;
      const pending = handlePrivateProducerRead(request("/api/producer/v1/preview/hls/index.m3u8"), env, fetcher);
      await vi.advanceTimersByTimeAsync(4000);
      expect((await pending).status).toBe(404); expect(reads).toBe(17);
      reads = 0;
      expect((await handlePrivateProducerRead(request(`/api/producer/v1/preview/hls/program-${"a".repeat(32)}-1.ts`), env, fetcher)).status).toBe(404);
      expect(reads).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it("requires a valid operator session before reaching the private service", async () => {
    const mock = mockFetch();
    expect((await handlePrivateProducerRead(request("/api/producer/v1/status", "GET", false), env, mock.fetcher)).status).toBe(401);
    expect(mock.calls).toHaveLength(0);
  });

  it("blocks commands and workstation ingestion before any network request", async () => {
    const mock = mockFetch();
    for (const path of ["/api/producer/v1/commands", "/api/producer/v1/workstation/status", "/api/producer/v1/facebook/start", "/api/producer/v1/preview/hls/key.bin"]) {
      expect((await handlePrivateProducerRead(request(path), env, mock.fetcher)).status).toBe(503);
    }
    expect((await handlePrivateProducerRead(request("/api/producer/v1/status", "POST"), env, mock.fetcher)).status).toBe(503);
    expect(mock.calls).toHaveLength(0);
  });

  it("uses only the fixed loopback target and service token and disables browser controls", async () => {
    const mock = mockFetch();
    const result = await handlePrivateProducerRead(request("/api/producer/v1/status?ignored=secret"), env, mock.fetcher);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: { source_state: "ready" }, controlAccess: { allowed: false, userId }, controlLease: null });
    expect(mock.calls.at(-1)?.url).toBe("http://127.0.0.1:4188/api/producer/v1/status");
    expect(mock.calls.at(-1)?.headers.get("Authorization")).toBe(`Bearer ${token}`);
    expect((await handlePrivateProducerRead(request("/api/producer/v1/status"), { ...env, OPS_PRIVATE_PRODUCER_BASE_URL: "https://evil.test" }, mock.fetcher)).status).toBe(502);
  });

  it("relays bounded preview media and strips the browser cache buster", async () => {
    const frame = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const mock = mockFetch(new Response(frame, { headers: { "Content-Type": "image/jpeg", "X-Producer-Frame-At": "2026-10-14T00:00:00Z" } }));
    const result = await handlePrivateProducerRead(request("/api/producer/v1/preview/program.jpg?t=42"), env, mock.fetcher);
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe("image/jpeg");
    expect(result.headers.get("X-Producer-Frame-At")).toBe("2026-10-14T00:00:00Z");
    expect(mock.calls.at(-1)?.url).toBe("http://127.0.0.1:4188/api/producer/v1/preview/program.jpg");
    const tooBig = mockFetch(new Response(new Uint8Array(512 * 1024 + 1), { headers: { "Content-Type": "video/mp2t" } }));
    const segment = `/api/producer/v1/preview/hls/program-${"a".repeat(32)}-123.ts`;
    expect((await handlePrivateProducerRead(request(segment), env, tooBig.fetcher)).status).toBe(502);
  });

  it("rejects unexpected media types and relays the allowed HLS manifest", async () => {
    const wrong = mockFetch(new Response("<html/>", { headers: { "Content-Type": "text/html" } }));
    expect((await handlePrivateProducerRead(request("/api/producer/v1/preview/hls/index.m3u8"), env, wrong.fetcher)).status).toBe(502);
    const good = mockFetch(new Response("#EXTM3U\n", { headers: { "Content-Type": "application/vnd.apple.mpegurl" } }));
    const result = await handlePrivateProducerRead(request("/api/producer/v1/preview/hls/index.m3u8"), env, good.fetcher);
    expect(result.status).toBe(200);
    expect(await result.text()).toBe("#EXTM3U\n");
  });
});
