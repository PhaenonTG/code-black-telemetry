import { describe, expect, it, vi } from "vitest"
import { CORE_GATEWAY_ALLOWLIST } from "../../../web/ops/functions/lib/coreGateway"
import { ALLOWLIST } from "./allowlist"
import { handleRequest } from "./index"
const path = "/api/ai/v1/target-analysis"
const req = (body: string, route = path) => new Request(`https://internal${route}?provider=paid&admin=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
describe("Explicit local Aegis reviews", () => {
  it.each([path, "/api/ai/v1/assessment/refresh"])("aligns %s with Pages, never broadening methods", (route) => {
    expect(ALLOWLIST[route]).toEqual(CORE_GATEWAY_ALLOWLIST[route.slice(1)])
    expect(ALLOWLIST[route].methods).toEqual(["POST"])
  })
  it("forwards only a validated point body to the fixed private origin", async () => {
    const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response("{}"))
    expect((await handleRequest(req('{"latitude":36.38,"longitude":-94.1}'), { CORE_VPC: { fetch } })).status).toBe(200)
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:8000${path}`, expect.objectContaining({ method: "POST", body: '{"latitude":36.38,"longitude":-94.1}' }))
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("Content-Type")).toBe("application/json")
  })
  it.each(['{}', '{"latitude":null,"longitude":0}', '{"latitude":"0","longitude":0}', '{"latitude":91,"longitude":0}', '{"latitude":0,"longitude":-181}', '{"latitude":0,"longitude":0,"model":"paid"}', '[]', 'null', 'broken'])("rejects %s without contacting Core", async (body) => {
    const fetch = vi.fn()
    expect((await handleRequest(req(body), { CORE_VPC: { fetch } })).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
  it("bounds the body and rejects non-JSON requests", async () => {
    const fetch = vi.fn()
    const env = { CORE_VPC: { fetch } }
    expect((await handleRequest(req(' '.repeat(513)), env)).status).toBe(413)
    expect((await handleRequest(new Request(`https://internal${path}`, { method: "POST", body: "{}" }), env)).status).toBe(415)
    expect(fetch).not.toHaveBeenCalled()
  })
  it("accepts an empty refresh, rejects arbitrary commands and leaves paid routes closed", async () => {
    const fetch = vi.fn(async () => new Response("{}"))
    const env = { CORE_VPC: { fetch } }
    expect((await handleRequest(req("", "/api/ai/v1/assessment/refresh"), env)).status).toBe(200)
    expect((await handleRequest(req('{"force":true}', "/api/ai/v1/assessment/refresh"), env)).status).toBe(400)
    expect((await handleRequest(req("{}", "/api/ai/v1/paid-review"), env)).status).toBe(404)
  })
  it("allows a longer bounded model review but cancels it at ninety seconds", async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const fetch = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        signal = init?.signal ?? undefined
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
      }))
      const pending = handleRequest(req('{"latitude":0,"longitude":0}'), { CORE_VPC: { fetch } })
      await vi.advanceTimersByTimeAsync(8_001)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(81_999)
      expect((await pending).status).toBe(502)
      expect(signal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it("propagates caller cancellation and clears its timer", async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const fetch = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))))
      const pending = handleRequest(new Request("https://internal/health", { signal: controller.signal }), { CORE_VPC: { fetch } })
      controller.abort()
      expect((await pending).status).toBe(502)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
