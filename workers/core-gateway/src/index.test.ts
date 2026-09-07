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
