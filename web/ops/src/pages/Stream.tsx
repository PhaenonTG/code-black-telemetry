import { useState } from "react"
import { Link } from "react-router-dom"
import { PageHeader } from "../components/PageHeader"

const TWITCH_CHANNEL = "codeblackwx";

// Same embed as the public site's Live page -- Twitch requires the embedding page's own hostname
// in `parent`, read at render time rather than hardcoded so this works on ops.codeblackwx.com, its
// *.pages.dev preview domain, and local dev without needing an update here for each.
export default function Stream() {
  const [loaded, setLoaded] = useState(false);
  const parent = typeof window !== "undefined" ? window.location.hostname : "ops.codeblackwx.com";
  const src = `https://player.twitch.tv/?channel=${TWITCH_CHANNEL}&parent=${parent}&muted=true`;
  return (
    <div className="page page-stream">
      <PageHeader title="LIVE STREAM" kicker="CHASE OPERATIONS · PROGRAM FEED" description="Monitor the public Code Black broadcast while keeping field tools one click away." />
      <nav className="section-tabs" aria-label="Chase Operations sections">
        <Link to="/chase">FLEET</Link><span className="active">STREAMS</span>
      </nav>
      <section className="stream-stage">
        <div className="stream-stage__label"><i /> LIVE PROGRAM · TWITCH</div>
        {loaded ? <iframe title="Code Black WX live stream" src={src} allow="autoplay; fullscreen" allowFullScreen /> : (
          <div className="stream-stage__standby">
            <strong>PROGRAM FEED READY</strong>
            <p>Load the player when you need the public broadcast. It starts muted to protect the operations room.</p>
            <button type="button" className="page-action-link" onClick={() => setLoaded(true)}>LOAD PROGRAM FEED</button>
          </div>
        )}
      </section>
      <a className="page-action-link" href={`https://www.twitch.tv/${TWITCH_CHANNEL}`} target="_blank" rel="noreferrer">OPEN ON TWITCH</a>
    </div>
  );
}
