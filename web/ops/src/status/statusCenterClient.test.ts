// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { currentAccessToken } from "../core/client"
import type { OpsCoreConfig } from "../core/config"
import { fetchStatusCenter, fetchRadarControlSettings, saveRadarControlSettings, STATUS_GET_TIMEOUT_MS, STATUS_SAVE_TIMEOUT_MS } from "./statusCenterClient"
import { OpsCoreClientError } from "../core/client"

vi.mock("../core/client", async (importActual) => ({
  ...await importActual<typeof import("../core/client")>(),
  currentAccessToken: vi.fn(),
}))

const config: OpsCoreConfig = { mode: "LIVE_CORE", coreBaseUrl: "https://core.invalid", coreWsUrl: "", unitId: "test", stormIntelPollSeconds: 30 }
const settings = { primary_prewarm_enabled: true, primary_interval_seconds: 600 as const }
const payload = { dry_run: true, no_messages_sent: true, no_config_changed: true }
const token = vi.mocked(currentAccessToken)
const fetchMock = vi.fn<typeof fetch>()
const pending = () => new Promise<never>(() => {})

beforeEach(() => {
  vi.useFakeTimers()
  token.mockReset().mockResolvedValue("test-token")
  fetchMock.mockReset().mockResolvedValue(Response.json(payload))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it("keeps production deadlines at 12 s for reads and 20 s for writes", () => {
  expect(STATUS_GET_TIMEOUT_MS).toBe(12_000)
  expect(STATUS_SAVE_TIMEOUT_MS).toBe(20_000)
})

describe.each([
  ["status GET", (signal?: AbortSignal, timeoutMs = 25) => fetchStatusCenter(config, { signal, timeoutMs })],
  ["settings GET", (signal?: AbortSignal, timeoutMs = 25) => fetchRadarControlSettings(config, { signal, timeoutMs })],
  ["settings PUT", (signal?: AbortSignal, timeoutMs = 25) => saveRadarControlSettings(config, settings, { signal, timeoutMs })],
] as const)("%s deadline", (_name, request) => {
  it.each(["fetch", "token", "json"])("bounds a never-resolving %s", async (stage) => {
    if (stage === "token") token.mockImplementation(pending)
    if (stage === "fetch") fetchMock.mockImplementation(pending)
    if (stage === "json") fetchMock.mockResolvedValue({ ok: true, headers: new Headers(), json: pending } as unknown as Response)
    const result = request()
    const rejected = expect(result).rejects.toThrow("Status Center did not respond within 0.025 s")
    await vi.advanceTimersByTimeAsync(25)
    await rejected
    await expect(result).rejects.toBeInstanceOf(OpsCoreClientError)
    if (stage === "token") expect(fetchMock).not.toHaveBeenCalled()
    else expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("resolves normal JSON and cleans the timer", async () => {
    await expect(request()).resolves.toEqual(payload)
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Accept: "application/json", Authorization: "Bearer test-token" })
    expect(fetchMock.mock.calls[0][1]?.cache).toBe("no-store")
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(["fetch", "token", "json", "before request"])("rejects caller abort during %s", async (stage) => {
    if (stage === "token") token.mockImplementation(pending)
    if (stage === "fetch") fetchMock.mockImplementation(pending)
    if (stage === "json") fetchMock.mockResolvedValue({ ok: true, headers: new Headers(), json: pending } as unknown as Response)
    const controller = new AbortController()
    if (stage === "before request") controller.abort()
    const rejected = expect(request(controller.signal)).rejects.toMatchObject({ name: "AbortError" })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejected
    expect(controller.signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not start fetch if the token arrives after the deadline", async () => {
    let resolveToken!: (value: string) => void
    token.mockImplementation(() => new Promise(resolve => { resolveToken = resolve }))
    const rejected = expect(request()).rejects.toThrow("did not respond within")
    await vi.advanceTimersByTimeAsync(25)
    await rejected
    resolveToken("late-token")
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
