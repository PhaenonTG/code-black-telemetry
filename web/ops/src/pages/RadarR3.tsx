import { useCallback, useMemo } from "react"
import { useAuth } from "../auth/AuthProvider"
import { PrivateRadarPilot } from "../radarR3/RadarR3Pilot"

export default function RadarR3() {
  const auth = useAuth()
  const current = auth.status === "authorized" ? auth.session : null
  const session = useMemo(() => current?.expires_at ? {
    userId: current.user.id, accessToken: current.access_token, expiresAtMs: current.expires_at * 1000,
  } : null, [current?.user.id, current?.access_token, current?.expires_at])
  const onFrame = useCallback(() => {}, [])
  return <section aria-label="Radar R3 candidate">
    <h1>RADAR R3 CANDIDATE</h1>
    <p>Single-site review candidate. Existing Radar Lab remains available. An unavailable backend is shown explicitly.</p>
    <PrivateRadarPilot active session={session} onFrame={onFrame} />
  </section>
}
