import { afterEach, expect, it, vi } from "vitest"

afterEach(() => { vi.useRealTimers(); vi.resetModules() })

it("pauses all Producer background reads after Cloudflare returns HTML 429, then retries", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-14T20:00:00Z"))
  const { producerReadAllowed } = await import("./producerRateLimit")
  const { readProducerResponse } = await import("./producerResponse")
  expect(producerReadAllowed()).toBe(true)
  await expect(readProducerResponse(new Response("<html>rate limited</html>", {
    status: 429, headers: { "Content-Type": "text/html", "Retry-After": "45" },
  }))).rejects.toThrow("Background checks paused")
  expect(producerReadAllowed()).toBe(false)
  vi.advanceTimersByTime(44_000)
  expect(producerReadAllowed()).toBe(false)
  vi.advanceTimersByTime(1_000)
  expect(producerReadAllowed()).toBe(true)
})
