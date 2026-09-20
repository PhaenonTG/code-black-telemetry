import { useEffect, useState } from "react"
import { useAuth } from "../auth/AuthProvider"

// An OPS browser session is localStorage-scoped to ops.codeblackwx.com and cannot
// be read by the private Tailscale console origin. This is the deliberate, narrow
// bridge: an authorized OPS session supplies its ordinary short-lived access token
// in a URL fragment (which browsers never transmit in HTTP requests), then the AI
// router validates it server-side with the same Supabase project on every API call.
const AI_CONSOLE_URL = "https://phaenon3.tail1d0673.ts.net/ai"

export default function AiHandoff() {
  const auth = useAuth()
  const [message, setMessage] = useState("Preparing secure AI-console handoff…")

  useEffect(() => {
    if (auth.status !== "authorized") return
    const requested = new URLSearchParams(window.location.search).get("return_to")
    const destination = requested === AI_CONSOLE_URL ? requested : AI_CONSOLE_URL
    try {
      window.location.replace(`${destination}#access_token=${encodeURIComponent(auth.session.access_token)}`)
    } catch {
      setMessage("Unable to start the AI-console handoff. Return to OPS and try again.")
    }
  }, [auth])

  return <div className="page-empty">{message}</div>
}
