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
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null)

  useEffect(() => {
    if (auth.status !== "authorized") return
    const requested = new URLSearchParams(window.location.search).get("return_to")
    const destination = requested === AI_CONSOLE_URL ? requested : AI_CONSOLE_URL
    const url = `${destination}#access_token=${encodeURIComponent(auth.session.access_token)}`
    setHandoffUrl(url)
    setMessage("Opening secure AI console…")
    const fallback = window.setTimeout(() => {
      setMessage("The console did not open automatically. Use the button below to retry.")
    }, 2500)
    try {
      window.location.assign(url)
    } catch {
      setMessage("Unable to start the AI-console handoff. Return to OPS and try again.")
    }
    return () => window.clearTimeout(fallback)
  }, [auth])

  return <div className="page-empty" role="status">
    <p>{message}</p>
    {handoffUrl && <button type="button" className="page-action-link" onClick={() => window.location.assign(handoffUrl)}>OPEN FULL AEGIS CONSOLE</button>}
  </div>
}
