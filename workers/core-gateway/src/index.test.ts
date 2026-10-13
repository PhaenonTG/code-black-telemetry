import { describe, expect, it } from "vitest";
import { handleRequest, type Env, type VpcServiceBinding } from "./index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeVpc(impl: VpcServiceBinding["fetch"]): VpcServiceBinding {
  return { fetch: impl };
}

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://internal${path}`, init);
}

describe("handleRequest -- allowlisted routes forward correctly", () => {
  it("signs verified OPS actors and the exact decision body, failing closed without role or secret", async () => {
    const path = "/api/forecast/v1/chase-setup-decision";
    const body = '{"revision":7}';
    const actor = "11111111-2222-3333-4444-555555555555";
    let sent: RequestInit | undefined;
    const env: Env = { OPS_WRITE_SECRET: "test-secret", CORE_VPC: fakeVpc(async (_url, init) => {
      sent = init; return jsonResponse(200, { saved: true });
    }) };
    const response = await handleRequest(req(path, { method: "POST", body,
      headers: { "X-Ops-User-Id": actor, "X-Ops-Role": "ADMIN", "X-Ops-Signature": "forged" } }), env);
    expect(response.status).toBe(200);
    const headers = new Headers(sent?.headers);
    expect(headers.get("X-Ops-User-Id")).toBe(actor);
    expect(headers.get("X-Ops-Role")).toBe("ADMIN");
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(body));
    const hex = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
    const key = await crypto.subtle.importKey("raw", encoder.encode("test-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signature = Uint8Array.from(headers.get("X-Ops-Signature")!.match(/../g)!, hex => parseInt(hex, 16));
    expect(await crypto.subtle.verify("HMAC", key, signature,
      encoder.encode(["POST", path, headers.get("X-Ops-Timestamp"), actor, "ADMIN", hex].join("\n")))).toBe(true);
    for (const role of ["OPERATOR", "forged"]) {
      expect((await handleRequest(req(path, { method: "POST", body,
        headers: { "X-Ops-User-Id": actor, "X-Ops-Role": role } }), env)).status).toBe(403);
    }
    expect((await handleRequest(req(path, { method: "POST", body }), env)).status).toBe(403);
    expect((await handleRequest(req(path, { method: "POST", body,
      headers: { "X-Ops-User-Id": actor, "X-Ops-Role": "OWNER" } }), { ...env, OPS_WRITE_SECRET: undefined })).status).toBe(403);
  });
  it("forwards only bounded Aegis replay POST bodies to Core", async () => {
    let sentUrl = "";
    let sentBody = "";
    const env: Env = { CORE_VPC: fakeVpc(async (url, init) => {
      sentUrl = String(url); sentBody = String(init?.body); return jsonResponse(200, { dry_run: true });
    }) };
    const body = JSON.stringify({ mode: "recorded", evidenceCutoff: 85, limit: 10 });
    const response = await handleRequest(req("/api/fabric/v1/aegis-policy/replay", {
      method: "POST", body, headers: { "Content-Type": "application/json" },
    }), env);
    expect(response.status).toBe(200);
    expect(sentUrl).toBe("http://127.0.0.1:8000/api/fabric/v1/aegis-policy/replay");
    expect(sentBody).toBe(body);
    const oversized = await handleRequest(req("/api/fabric/v1/aegis-policy/replay", { method: "POST", body: "x".repeat(4097) }), env);
    expect(oversized.status).toBe(413);
    const forbidden = await handleRequest(req("/api/fabric/v1/aegis-policy", { method: "POST", body }), env);
    expect(forbidden.status).toBe(405);
  });
  it("GET /health forwards to the fixed Core origin", async () => {
    let calledUrl = "";
    const env: Env = { CORE_VPC: fakeVpc(async (url) => { calledUrl = String(url); return jsonResponse(200, { ok: true }); }) };
    const res = await handleRequest(req("/health"), env);
    expect(res.status).toBe(200);
    expect(calledUrl).toBe("http://127.0.0.1:8000/health");
  });

  it("GET /api/fabric/v1/health forwards correctly", async () => {
    let calledUrl = "";
    const env: Env = { CORE_VPC: fakeVpc(async (url) => { calledUrl = String(url); return jsonResponse(200, {}); }) };
    const res = await handleRequest(req("/api/fabric/v1/health"), env);
    expect(res.status).toBe(200);
    expect(calledUrl).toBe("http://127.0.0.1:8000/api/fabric/v1/health");
  });

  it("GET /api/fabric/v1/units forwards correctly", async () => {
    let calledUrl = "";
    const env: Env = { CORE_VPC: fakeVpc(async (url) => { calledUrl = String(url); return jsonResponse(200, []); }) };
    const res = await handleRequest(req("/api/fabric/v1/units"), env);
    expect(res.status).toBe(200);
    expect(calledUrl).toBe("http://127.0.0.1:8000/api/fabric/v1/units");
  });

  it("GET /api/fabric/v1/stream forwards the body without buffering", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{\"event_type\":\"fabric.snapshot\"}\n")); } });
    let accept = "";
    const env: Env = { CORE_VPC: fakeVpc(async (_url, init) => {
      accept = new Headers(init?.headers).get("Accept") ?? "";
      return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
    }) };
    const res = await handleRequest(req("/api/fabric/v1/stream"), env);
    expect(res.body).toBe(body);
    expect(accept).toBe("application/x-ndjson");
    await res.body?.cancel();
  });

  it("GET /api/storm-intel/v1/health forwards correctly", async () => {
    let calledUrl = "";
    const env: Env = { CORE_VPC: fakeVpc(async (url) => { calledUrl = String(url); return jsonResponse(200, {}); }) };
    const res = await handleRequest(req("/api/storm-intel/v1/health"), env);
    expect(res.status).toBe(200);
    expect(calledUrl).toBe("http://127.0.0.1:8000/api/storm-intel/v1/health");
  });

  it("GET /api/storm-intel/v1/point forwards valid latitude/longitude", async () => {
    let calledUrl = "";
    const env: Env = { CORE_VPC: fakeVpc(async (url) => { calledUrl = String(url); return jsonResponse(200, { dataClass: "MODEL_ANALYSIS" }); }) };
    const res = await handleRequest(req("/api/storm-intel/v1/point?latitude=36.5&longitude=-93.7"), env);
    expect(res.status).toBe(200);
    expect(calledUrl).toBe("http://127.0.0.1:8000/api/storm-intel/v1/point?latitude=36.5&longitude=-93.7");
  });
});

describe("handleRequest -- Storm Intel query validation", () => {
  it("rejects missing latitude", async () => {
    const env: Env = { CORE_VPC: fakeVpc(async () => jsonResponse(200, {})) };
    const res = await handleRequest(req("/api/storm-intel/v1/point?longitude=-93.7"), env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_LATITUDE" });
  });

  it("rejects invalid longitude", async () => {
    const env: Env = { CORE_VPC: fakeVpc(async () => jsonResponse(200, {})) };
    const res = await handleRequest(req("/api/storm-intel/v1/point?latitude=36.5&longitude=not-a-number"), env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_LONGITUDE" });
  });
});

describe("handleRequest -- rejects everything not explicitly allowlisted", () => {
  it("rejects an arbitrary Core path", async () => {
    const env: Env = { CORE_VPC: fakeVpc(async () => jsonResponse(200, {})) };
    const res = await handleRequest(req("/admin"), env);
    expect(res.status).toBe(404);
  });

  it("rejects POST", async () => {
    const env: Env = { CORE_VPC: fakeVpc(async () => jsonResponse(200, {})) };
    const res = await handleRequest(req("/health", { method: "POST" }), env);
    expect(res.status).toBe(405);
  });

  it("rejects PUT", async () => {
    const env: Env = { CORE_VPC: fakeVpc(async () => jsonResponse(200, {})) };
    const res = await handleRequest(req("/health", { method: "PUT" }), env);
    expect(res.status).toBe(405);
  });

  it("rejects PATCH", async () => {
    const env: Env = { CORE_VPC: fakeVpc(async () => jsonResponse(200, {})) };
    const res = await handleRequest(req("/health", { method: "PATCH" }), env);
    expect(res.status).toBe(405);
  });

  it("rejects DELETE", async () => {
    const env: Env = { CORE_VPC: fakeVpc(async () => jsonResponse(200, {})) };
    const res = await handleRequest(req("/health", { method: "DELETE" }), env);
    expect(res.status).toBe(405);
  });
});

describe("handleRequest -- cannot become an open proxy", () => {
  it("ignores an attacker-supplied host/URL and always targets the fixed Core origin", async () => {
    let calledUrl = "";
    const env: Env = { CORE_VPC: fakeVpc(async (url) => { calledUrl = String(url); return jsonResponse(200, {}); }) };
    await handleRequest(req("/api/storm-intel/v1/point?latitude=36.5&longitude=-93.7&host=evil.example.com"), env);
    expect(calledUrl.startsWith("http://127.0.0.1:8000")).toBe(true);
    expect(calledUrl).not.toContain("evil.example.com");
  });

  it("does not forward non-allowlisted query params", async () => {
    let calledUrl = "";
    const env: Env = { CORE_VPC: fakeVpc(async (url) => { calledUrl = String(url); return jsonResponse(200, {}); }) };
    await handleRequest(req("/api/storm-intel/v1/point?latitude=36.5&longitude=-93.7&admin=1"), env);
    expect(calledUrl).not.toContain("admin");
  });
});

describe("handleRequest -- Access headers are never sent on the VPC path", () => {
  it("does not add CF-Access-Client-Id or CF-Access-Client-Secret headers", async () => {
    let sentHeaders: Headers | undefined;
    const env: Env = {
      CORE_VPC: fakeVpc(async (_url, init) => {
        sentHeaders = new Headers(init?.headers);
        return jsonResponse(200, {});
      }),
    };
    await handleRequest(req("/health"), env);
    expect(sentHeaders?.has("CF-Access-Client-Id")).toBe(false);
    expect(sentHeaders?.has("CF-Access-Client-Secret")).toBe(false);
  });
});

describe("handleRequest -- safe failure mapping", () => {
  it("returns 502 VPC_NOT_CONFIGURED when no CORE_VPC binding is present, without throwing", async () => {
    const res = await handleRequest(req("/health"), {});
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "VPC_NOT_CONFIGURED" });
  });

  it("maps a VPC fetch failure to a generic error without leaking internal details", async () => {
    const env: Env = {
      CORE_VPC: fakeVpc(async () => {
        throw new Error("connect ECONNREFUSED 10.0.4.17:8000 -- internal network detail");
      }),
    };
    const res = await handleRequest(req("/health"), env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "CORE_TRANSPORT_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toContain("10.0.4.17");
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });
});
