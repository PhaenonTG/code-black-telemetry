// Was a hardcoded Twitch embed (`player.twitch.tv/?channel=codeblackwx`) -- OBS's primary stream
// output moved to Facebook Live only a while back (Twitch removed entirely from the OBS config),
// so this tab loaded a channel nobody streams to anymore: looked broken every time it was opened.
// No public Facebook Page/video URL is known to this codebase to embed instead (the social-gateway
// worker only holds a private Page ID, not a public share link), so rather than guess one or embed
// another stale destination, this shows an honest "not configured" state until a real embeddable
// source is wired up. See CHANGELOG/memory for the open "embed Facebook Live on the website" and
// "pull the MediaMTX feed directly + composite the overlay in-browser" follow-up ideas.
export function LivePage() {
  return (
    <div className="live-page live-page--unavailable">
      <div className="live-page__message">
        <strong>LIVE STREAM NOT CONFIGURED</strong>
        <span>No embeddable stream source is wired up for this build yet.</span>
      </div>
    </div>
  );
}
