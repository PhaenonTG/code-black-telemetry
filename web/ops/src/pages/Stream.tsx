const TWITCH_CHANNEL = "codeblackwx";

// Same embed as the public site's Live page -- Twitch requires the embedding page's own hostname
// in `parent`, read at render time rather than hardcoded so this works on ops.codeblackwx.com, its
// *.pages.dev preview domain, and local dev without needing an update here for each.
export default function Stream() {
  const parent = typeof window !== "undefined" ? window.location.hostname : "ops.codeblackwx.com";
  const src = `https://player.twitch.tv/?channel=${TWITCH_CHANNEL}&parent=${parent}&muted=false`;
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <iframe
        title="Code Black WX live stream"
        src={src}
        allowFullScreen
        style={{ width: "100%", height: "100%", border: "none" }}
      />
    </div>
  );
}
