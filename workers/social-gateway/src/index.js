// Resolves the currently-live viewer count for the Code Black Facebook Page and returns it as
// plain public JSON, holding the real Page Access Token server-side -- classic-v2.html's
// updateViewerCount() calls GET /overlay-core/facebook-viewers and never sees the token.
//
// Two Graph API calls: find the Page's currently-live video, then read that video's live_views.
// A Page can only have one truly "live" video at a time, so the first LIVE result is the answer.
//
// Requires two secrets (set via `wrangler secret put <NAME>` in this directory):
//   FACEBOOK_PAGE_ID           the numeric Page ID (not the vanity username)
//   FACEBOOK_PAGE_ACCESS_TOKEN a Page Access Token with pages_read_engagement +
//                              pages_show_list permission. Facebook Page tokens generated from a
//                              long-lived User token do not expire on their own, but WILL be
//                              invalidated if the granting user's password changes or the app's
//                              permissions are revoked -- there is no automatic refresh here, so
//                              a dead token just makes this endpoint fail closed (see below),
//                              which is safe but silent; worth an uptime check if this matters.
//
// CORS: open (`Access-Control-Allow-Origin: *`) -- this is public viewer-count data, same trust
// level as the radar-relay/mapbox-token endpoints it sits alongside.

const GRAPH_FETCH_TIMEOUT_MS = 8_000;

async function graphFetch(url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRAPH_FETCH_TIMEOUT_MS);
  try {
    // Bearer header instead of ?access_token=<token> in the URL -- Graph API accepts both, but a
    // token embedded in the URL is the kind of thing that ends up copied into request-tracing
    // spans, access logs, or (if a future code path ever let a native fetch error bubble up
    // instead of the generic mapping below) an error message. A header is the safer default.
    return await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getLiveVideo(env) {
  const liveRes = await graphFetch(
    // Keep the returned shape deliberately small.  The state endpoint below is consumed by
    // CodeBlack-Edge to detect a broadcast transition; it is not a proxy for the full Graph API.
    `https://graph.facebook.com/v21.0/${env.FACEBOOK_PAGE_ID}/live_videos?fields=id,status,title,permalink_url`,
    env.FACEBOOK_PAGE_ACCESS_TOKEN,
  );
  if (!liveRes.ok) throw new Error(`live_videos ${liveRes.status}`);
  const liveData = await liveRes.json();
  return (liveData.data || []).find((video) => video.status === 'LIVE') || null;
}

export default {
  async fetch(request, env) {
    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    const { pathname } = new URL(request.url);
    if (pathname !== '/overlay-core/facebook-viewers' && pathname !== '/overlay-core/facebook-live-state') {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: corsHeaders });
    }
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: corsHeaders });
    }
    if (!env.FACEBOOK_PAGE_ID || !env.FACEBOOK_PAGE_ACCESS_TOKEN) {
      // Fails closed, not with a fabricated number -- the overlay leaves the line blank when
      // this 503s, exactly like every other feed in classic-v2.html on a missed poll.
      return new Response(JSON.stringify({ error: 'not configured' }), { status: 503, headers: corsHeaders });
    }
    try {
      const liveVideo = await getLiveVideo(env);
      if (pathname === '/overlay-core/facebook-live-state') {
        // This contains only public broadcast metadata.  The Page token remains server-side.
        return new Response(JSON.stringify({
          live: Boolean(liveVideo),
          title: liveVideo?.title || null,
          url: liveVideo?.permalink_url || null,
        }), { headers: corsHeaders });
      }
      if (!liveVideo) {
        // Nothing currently live is a real, valid state -- 0 viewers, not an error.
        return new Response(JSON.stringify({ count: 0 }), { headers: corsHeaders });
      }
      const viewsRes = await graphFetch(
        `https://graph.facebook.com/v21.0/${liveVideo.id}?fields=live_views`,
        env.FACEBOOK_PAGE_ACCESS_TOKEN,
      );
      if (!viewsRes.ok) throw new Error(`live_views ${viewsRes.status}`);
      const viewsData = await viewsRes.json();
      const count = Number(viewsData.live_views);
      if (!Number.isFinite(count)) throw new Error('live_views missing/non-numeric');
      return new Response(JSON.stringify({ count }), { headers: corsHeaders });
    } catch {
      // Never echo the raw caught error (String(err)) here -- a native fetch failure (timeout,
      // DNS, TLS) can include the request URL in its message, and while the token itself now only
      // ever travels in a header (never the URL), a fixed generic reason costs nothing and closes
      // off that entire class of accidental leak for good, matching core-gateway/radar-relay's
      // existing pattern of never returning raw upstream error detail to the public caller.
      return new Response(JSON.stringify({ error: 'provider unavailable' }), { status: 502, headers: corsHeaders });
    }
  },
};
