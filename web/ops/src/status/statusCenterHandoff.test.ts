import { describe, expect, it } from "vitest"
import { STATUS_CENTER_LOGIN_URL, statusCenterHandoffUrl } from "./statusCenterHandoff"

describe("Status Center OPS handoff", () => {
  it("keeps the short-lived access token in a fragment, never a request query", () => {
    const target = statusCenterHandoffUrl("token with / and ?")
    expect(target).toBe(`${STATUS_CENTER_LOGIN_URL}#access_token=token%20with%20%2F%20and%20%3F`)
    expect(new URL(target).search).toBe("")
  })
})
