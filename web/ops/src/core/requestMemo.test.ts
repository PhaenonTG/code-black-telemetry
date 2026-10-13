import { describe, expect, it, vi } from "vitest"
import { RequestMemo } from "./requestMemo"

describe("RequestMemo", () => {
  it("shares concurrent and recent reads for the same resource", async () => {
    const memo = new RequestMemo()
    const load = vi.fn(async () => ({ status: "ready" }))
    const [first, second] = await Promise.all([memo.get("runs", 10_000, load, 100), memo.get("runs", 10_000, load, 100)])
    expect(first).toEqual(second)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("retries failed and expired reads", async () => {
    const memo = new RequestMemo()
    const failed = vi.fn(async () => { throw new Error("429") })
    await expect(memo.get("alerts", 10_000, failed, 100)).rejects.toThrow("429")
    const retry = vi.fn(async () => "ready")
    await expect(memo.get("alerts", 10_000, retry, 101)).resolves.toBe("ready")
    await expect(memo.get("alerts", 10_000, retry, 20_102)).resolves.toBe("ready")
    expect(retry).toHaveBeenCalledTimes(2)
  })
})
