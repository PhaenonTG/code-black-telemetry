import { createParityOrigin } from "./parityOrigin"
const port = Number(process.env.PARITY_LISTEN_PORT)
// Uses existing service-managed public Auth settings only. Never prints or creates credentials.
const env = Object.fromEntries(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "OPS_PRIVATE_COORDINATION_SNAPSHOT", "OPS_PRIVATE_RADAR_SITES", "OPS_PRIVATE_RADAR_SITE"].map(key => [key, process.env[key]]))
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) throw Error("Existing OPS Auth settings required")
const origin = createParityOrigin({ env: { ...env, OPS_PRIVATE_RADAR_BASE_URL: "http://127.0.0.1:8787" } })
origin.listen(port)
const stop = () => { origin.server.close(); origin.server.closeIdleConnections() }
process.once("SIGTERM", stop); process.once("SIGINT", stop)
