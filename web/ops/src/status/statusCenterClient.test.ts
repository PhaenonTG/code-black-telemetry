import { afterEach, expect, it, vi } from "vitest"
import { readOpsCoreConfig } from "../core/config"
const mocks = vi.hoisted(() => ({ session: vi.fn() }))
vi.mock("../lib/supabase", () => ({ supabase: { auth: { getSession: mocks.session } } }))
import { fetchStatusCenter } from "./statusCenterClient"
const config = readOpsCoreConfig({ VITE_CODEBLACK_CORE_BASE_URL: "/api/core" })
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it("cancels a telemetry request even while the session provider is stalled", async () => {
  mocks.session.mockImplementation(() => new Promise(() => {}))
  const fetcher = vi.fn()
  vi.stubGlobal("fetch", fetcher)
  const controller = new AbortController()
  const request = fetchStatusCenter(config, controller.signal)
  controller.abort()
  await expect(request).rejects.toMatchObject({ name: "AbortError" })
  expect(fetcher).not.toHaveBeenCalled()
})
it("gets a fresh session on recovery and preserves fetch cancellation", async () => {
  mocks.session.mockResolvedValue({ data: { session: { access_token: "recovered-session" } } })
  const fetcher = vi.fn().mockResolvedValue(Response.json({ generated_at: "2026-10-16T01:00:00Z" }))
  vi.stubGlobal("fetch", fetcher)
  const controller = new AbortController()
  await expect(fetchStatusCenter(config, controller.signal)).resolves.toHaveProperty("generated_at")
  expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal)
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer recovered-session")
})
