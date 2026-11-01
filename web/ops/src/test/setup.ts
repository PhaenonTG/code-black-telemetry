import { vi } from "vitest"

// These are deliberately inert test values, never production credentials.
// The application receives real public Supabase values from its deployment
// environment; tests only need a syntactically valid configuration while
// mocking authentication and transport behavior.
vi.stubEnv("VITE_SUPABASE_URL", "https://ops-unit-test.supabase.co")
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "unit-test-public-key")
