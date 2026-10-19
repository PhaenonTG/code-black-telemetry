import { describe, expect, it } from "vitest"
import { classifyLoginFailure } from "./loginFailure"

describe("login failure messages", () => {
  it("distinguishes rejected credentials from provider outages", () => {
    expect(classifyLoginFailure({ status: 400, code: "invalid_credentials" })).toBe("invalid")
    expect(classifyLoginFailure({ name: "AuthRetryableFetchError" })).toBe("network-error")
    expect(classifyLoginFailure({ status: 503 })).toBe("network-error")
    expect(classifyLoginFailure({ status: 0 })).toBe("network-error")
  })
  it("asks the user to wait when authentication is rate limited", () => {
    expect(classifyLoginFailure({ status: 429 })).toBe("rate-limited")
  })
})
