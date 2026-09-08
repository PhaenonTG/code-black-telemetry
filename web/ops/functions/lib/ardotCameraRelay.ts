// Relay for ARDOT IDrive's Referer-gated camera HLS streams. Plain importable module, not a
// functions/api/*.ts folder-convention Function -- see the comment atop worker/entry.ts (Stage 3):
// this project's Cloudflare Pages Advanced Mode build never actually routes to folder-convention
// Functions, so this needs to be wired directly into worker/entry.ts's own fetch handler, same as
// the Core gateway in coreGateway.ts.
//
// The stream isn't actually CORS-blocked -- confirmed live: every hop (the initial
// actis.idrivearkansas.com redirect, and the Wowza CDN host it 302s to) returns
// `Access-Control-Allow-Origin: *` once the request carries `Referer: https://www.idrivearkansas.com/`.
// It 403s without it. Browsers refuse to let JS set a custom Referer header on fetch/XHR, so no
// client-side request can ever satisfy this -- only a server-to-server relay can, same reason
// MoDOT/ODOT get their own proxies in this repo.
//
// The redirect chain also crosses hosts (actis.idrivearkansas.com -> a per-camera
// `<id>.r.worldssl.net` Wowza host), and each level's .m3u8 references the next one with a
// relative URL. A dumb 1:1 path mirror can't work here since the upstream host itself changes
// mid-chain -- this rewrites every URI line in a fetched manifest into an absolute call back
// through this same relay (?url=<absolute upstream URL>) instead, so the browser/hls.js always
// asks this relay for the next hop regardless of which upstream host it actually lives on.
const REFERER = "https://www.idrivearkansas.com/";
const ALLOWED_HOSTS = [/(^|\.)idrivearkansas\.com$/i, /(^|\.)worldssl\.net$/i];
const MAX_REDIRECTS = 4;

export const ARDOT_RELAY_PREFIX = "/api/ardot-camera-stream";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function isAllowedUpstream(url: URL): boolean {
  return url.protocol === "https:" && ALLOWED_HOSTS.some((pattern) => pattern.test(url.hostname));
}

function rewriteManifest(text: string, manifestUrl: URL, relayOrigin: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      let absolute: URL;
      try {
        absolute = new URL(trimmed, manifestUrl);
      } catch {
        return line;
      }
      return `${relayOrigin}${ARDOT_RELAY_PREFIX}?url=${encodeURIComponent(absolute.toString())}`;
    })
    .join("\n");
}

async function relay(targetUrl: URL, relayOrigin: string, redirectsLeft: number): Promise<Response> {
  if (!isAllowedUpstream(targetUrl)) {
    return new Response("Upstream host not allowed", { status: 400, headers: CORS_HEADERS });
  }
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), { headers: { Referer: REFERER }, redirect: "manual" });
  } catch {
    return new Response("Upstream request failed", { status: 502, headers: CORS_HEADERS });
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("Location");
    if (!location || redirectsLeft <= 0) {
      return new Response("Redirect could not be followed", { status: 502, headers: CORS_HEADERS });
    }
    return relay(new URL(location, targetUrl), relayOrigin, redirectsLeft - 1);
  }

  const contentType = upstream.headers.get("Content-Type") ?? "";
  const looksLikeManifest = contentType.includes("mpegurl") || /\.m3u8(?:$|\?)/i.test(targetUrl.pathname);
  if (looksLikeManifest) {
    const text = await upstream.text();
    return new Response(rewriteManifest(text, targetUrl, relayOrigin), {
      status: upstream.status,
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store", ...CORS_HEADERS },
    });
  }

  // Binary passthrough for .ts segments -- no rewriting needed, these don't reference anything else.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": contentType || "video/mp2t", "Cache-Control": "public, max-age=8", ...CORS_HEADERS },
  });
}

export async function handleArdotCameraStream(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }
  const incoming = new URL(request.url);
  const target = incoming.searchParams.get("url");
  if (!target) return new Response("Missing url parameter", { status: 400, headers: CORS_HEADERS });
  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Invalid url parameter", { status: 400, headers: CORS_HEADERS });
  }
  return relay(targetUrl, incoming.origin, MAX_REDIRECTS);
}
