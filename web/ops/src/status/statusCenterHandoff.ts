// OPS owns the Supabase browser session. The private Status Center does not get a
// second login form: its server verifies this short-lived token with the same
// Supabase active-profile boundary. A URL fragment is never sent in HTTP requests.
export const STATUS_CENTER_LOGIN_URL = "https://codeblack-core.tail1d0673.ts.net/status/login"

export function statusCenterHandoffUrl(accessToken: string): string {
  return `${STATUS_CENTER_LOGIN_URL}#access_token=${encodeURIComponent(accessToken)}`
}
