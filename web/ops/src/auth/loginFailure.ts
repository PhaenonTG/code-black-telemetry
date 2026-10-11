export type LoginFailure = "invalid" | "network-error" | "rate-limited"

export function classifyLoginFailure(error: { name?: string; status?: number; code?: string }): LoginFailure {
  if (error.status === 429) return "rate-limited"
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status != null && error.status >= 500)) return "network-error"
  return "invalid"
}
