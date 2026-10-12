import { describe, expect, it } from "vitest"
import { CORE_GATEWAY_ALLOWLIST } from "../../../web/ops/functions/lib/coreGateway"
import { ALLOWLIST, buildCoreUrl, validateQueryParams } from "./allowlist"
import { handleRequest } from "./index"

const paths = ["/api/fabric/v1/aegis-observation-plan", "/api/ai/v1/assessment", "/api/forecast/v1/chase-setups", "/api/forecast/v1/chase-setup"]
const id = "setup-20261013-6ac2379883"

describe("Ops desk read transport contract", () => {
  it.each(paths)("keeps %s GET-only and aligned with the authenticated Pages gateway", (path) => {
    const pages = CORE_GATEWAY_ALLOWLIST[path.slice(1)]
    expect(ALLOWLIST[path]).toEqual({ ...pages, methods: pages.methods ?? ["GET"] })
    expect(ALLOWLIST[path].methods).toEqual(["GET"])
  })
  it.each(paths)("forwards %s to Core without opening write or execution routes", async (path) => {
    let target = ""
    const suffix = path.endsWith("/chase-setup") ? `?setup_id=${id}&admin=1` : "?admin=1"
    const env = { CORE_VPC: { fetch: async (url: string | URL) => { target = String(url); return new Response(JSON.stringify({ status: "ready" })) } } }
    const response = await handleRequest(new Request(`https://internal${path}${suffix}`), env)
    expect(response.status).toBe(200)
    expect(target).toBe(`http://127.0.0.1:8000${path}${path.endsWith("/chase-setup") ? `?setup_id=${id}` : ""}`)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await handleRequest(new Request(`https://internal${path}${suffix}`, { method }), env)).status).toBe(405)
    }
    expect((await handleRequest(new Request("https://internal/api/ai/v1/assessment/refresh", { method: "GET" }), env)).status).toBe(405)
  })
  it("validates setup IDs and drops unallowlisted parameters", () => {
    const route = ALLOWLIST["/api/forecast/v1/chase-setup"]
    for (const query of ["", "?setup_id=../../admin", `?setup_id=${id}&setup_id=${id}`, "?setup_id=setup-invalid"]) {
      expect(validateQueryParams(route, new URL(`https://internal${route.upstreamPath}${query}`))).toEqual({ ok: false, reason: "INVALID_SETUP_ID" })
    }
    const url = new URL(`https://internal${route.upstreamPath}?setup_id=${id}&host=elsewhere&debug=true`)
    expect(validateQueryParams(route, url)).toEqual({ ok: true })
    expect(buildCoreUrl(route, url)).toBe(`http://127.0.0.1:8000${route.upstreamPath}?setup_id=${id}`)
  })
})
