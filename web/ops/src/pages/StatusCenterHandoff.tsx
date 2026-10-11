import { useEffect, useState } from "react"
import { useAuth } from "../auth/AuthProvider"
import { statusCenterHandoffUrl } from "../status/statusCenterHandoff"

// Match the existing AEGIS private-console handoff: the token remains entirely
// client-side until Status Center validates it against Supabase.
export default function StatusCenterHandoff() {
  const auth = useAuth()
  const [message, setMessage] = useState("Opening private Status Center…")

  useEffect(() => {
    if (auth.status !== "authorized") return
    try {
      window.location.replace(statusCenterHandoffUrl(auth.session.access_token))
    } catch {
      setMessage("Unable to open Status Center. Return to OPS and try again.")
    }
  }, [auth])

  return <div className="page-empty">{message}</div>
}
