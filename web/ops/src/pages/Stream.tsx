import { Link } from "react-router-dom"
import { PageHeader } from "../components/PageHeader"

// Was a click-to-load Twitch embed (`player.twitch.tv/?channel=codeblackwx`) -- OBS's primary
// stream output moved to Facebook Live only a while back (Twitch removed entirely from the OBS
// config), so "LOAD PROGRAM FEED" loaded a channel nobody streams to anymore. No public Facebook
// Page/video URL is known to this codebase to embed instead (the social-gateway worker only holds
// a private Page ID, not a public share link), so rather than guess one or point at another stale
// destination, this shows an honest "not configured" state until a real embeddable source is
// wired up. See CHANGELOG/memory for the open "embed Facebook Live on the website" and "pull the
// MediaMTX feed directly + composite the overlay in-browser" follow-up ideas.
export default function Stream() {
  return (
    <div className="page page-stream">
      <PageHeader title="LIVE STREAM" kicker="CHASE OPERATIONS · PROGRAM FEED" description="Monitor the public Code Black broadcast while keeping field tools one click away." />
      <nav className="section-tabs" aria-label="Chase Operations sections">
        <Link to="/chase">FLEET</Link><span className="active">STREAMS</span>
      </nav>
      <section className="stream-stage">
        <div className="stream-stage__label"><i /> PROGRAM FEED · NOT CONFIGURED</div>
        <div className="stream-stage__standby">
          <strong>NO EMBEDDABLE SOURCE WIRED UP</strong>
          <p>The public broadcast currently streams to Facebook Live only. This page has no embed source configured for that yet.</p>
        </div>
      </section>
    </div>
  );
}
