import { afterEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => getSessionMock(...args) } },
}));

const { buildCoreRequestHeaders, currentAccessToken } = await import("./client");

afterEach(() => {
  getSessionMock.mockReset();
});

describe("buildCoreRequestHeaders", () => {
  it("attaches a bearer token when one is present", () => {
    expect(buildCoreRequestHeaders("token-abc")).toEqual({
      Accept: "application/json",
      Authorization: "Bearer token-abc",
    });
  });

  it("omits Authorization entirely when there is no token -- never sends a fake/empty bearer", () => {
    const headers = buildCoreRequestHeaders(null);
    expect(headers).toEqual({ Accept: "application/json" });
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("currentAccessToken (Supabase session wiring)", () => {
  it("returns the current session's access token", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "session-token-1" } } });
    await expect(currentAccessToken()).resolves.toBe("session-token-1");
  });

  it("returns null when there is no session (signed out)", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    await expect(currentAccessToken()).resolves.toBeNull();
  });

  it("returns null when a session exists but carries no access token", async () => {
    getSessionMock.mockResolvedValue({ data: { session: {} } });
    await expect(currentAccessToken()).resolves.toBeNull();
  });

  it("reflects a refreshed token on the next call without any caching -- always reads current state", async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: { access_token: "old-token" } } });
    await expect(currentAccessToken()).resolves.toBe("old-token");

    getSessionMock.mockResolvedValueOnce({ data: { session: { access_token: "refreshed-token" } } });
    await expect(currentAccessToken()).resolves.toBe("refreshed-token");

    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });

  it("expired session with failed refresh (Supabase resolves session: null) falls through the same as signed-out", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    const token = await currentAccessToken();
    expect(token).toBeNull();
    expect(buildCoreRequestHeaders(token)).toEqual({ Accept: "application/json" });
  });
});
