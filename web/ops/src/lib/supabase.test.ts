import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe("OPS authentication configuration", () => {
  it("does not crash module loading when settings are missing", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "")
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "")
    const { supabase } = await import("./supabase")
    expect(supabase).toBeNull()
  })
  it("does not crash module loading when the URL is invalid", async () => {
    vi.resetModules()
    vi.stubEnv("VITE_SUPABASE_URL", "invalid-url")
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-only-public-key")
    const { supabase } = await import("./supabase")
    expect(supabase).toBeNull()
  })
})
