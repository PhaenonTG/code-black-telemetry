import { describe, expect, it } from "vitest"
import { assertProductionEnv } from "../scripts/productionEnv"
const env = { VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", VITE_OPS_DATA_MODE: "LIVE_CORE", VITE_CODEBLACK_CORE_BASE_URL: "/api/core", VITE_MAPBOX_ACCESS_TOKEN: "pk.test" }
describe("production release configuration", () => {
  it("requires existing public auth, authenticated Core route and map configuration", () => {
    expect(() => assertProductionEnv(env)).not.toThrow()
    for (const key of Object.keys(env)) expect(() => assertProductionEnv({ ...env, [key]: "" })).toThrow()
  })
  it("refuses client secrets, simulation and unauthenticated/private Core endpoints", () => {
    expect(() => assertProductionEnv({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_not_public" })).toThrow()
    expect(() => assertProductionEnv({ ...env, VITE_OPS_DATA_MODE: "SIMULATION" })).toThrow()
    expect(() => assertProductionEnv({ ...env, VITE_CODEBLACK_CORE_BASE_URL: "http://127.0.0.1:8000" })).toThrow()
    expect(() => assertProductionEnv({ ...env, VITE_MAPBOX_ACCESS_TOKEN: "sk.secret" })).toThrow()
  })
})
