const TWITCH_CHANNEL = "codeblackwx";

// Twitch's embed player requires the embedding page's own hostname in `parent` -- there's no
// wildcard. Reading window.location.hostname at render time (rather than hardcoding every known
// deployment: codeblackwx.com, the *.pages.dev preview domain, localhost for local dev) means this
// works on whichever host is actually serving the page without needing a matching update here
// every time a new preview/deployment domain shows up.
export function LivePage() {
  const parent = typeof window !== "undefined" ? window.location.hostname : "codeblackwx.com";
  const src = `https://player.twitch.tv/?channel=${TWITCH_CHANNEL}&parent=${parent}&muted=false`;
  return (
    <div className="live-page">
      <iframe
        title="Code Black WX live stream"
        src={src}
        allowFullScreen
        style={{ width: "100%", height: "100%", border: "none" }}
      />
    </div>
  );
}
