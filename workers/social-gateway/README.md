# social-gateway

Public relay that resolves the current Facebook Live viewer count for `classic-v2.html`'s brand
box (`#viewerCount`). Deployed the same way as `radar-relay` — a standalone public Worker under
`ops.codeblackwx.com`.

## Status

**Not deployed, not verified against real Facebook credentials or a real live broadcast.** Every
other data source `classic-v2.html` uses this session was tested against the real live endpoint
before being called done; this one wasn't, because it needs credentials only the Page owner has.
The Graph API shape here (`live_videos` → `live_views`) matches Facebook's documented API, but
confirm it against a real Page + an actual live broadcast before trusting the number on stream.

## Deploy

```bash
cd workers/social-gateway
npx wrangler deploy
npx wrangler secret put FACEBOOK_PAGE_ID
npx wrangler secret put FACEBOOK_PAGE_ACCESS_TOKEN
```

- `FACEBOOK_PAGE_ID`: the numeric Page ID (Page Settings → About, or `graph.facebook.com/<vanity-name>`).
- `FACEBOOK_PAGE_ACCESS_TOKEN`: a Page Access Token for that Page, with `pages_read_engagement`
  and `pages_show_list` permission. Generate one via a Facebook App in
  [Meta for Developers](https://developers.facebook.com/) → Graph API Explorer, or your existing
  long-lived token flow if one is already set up for this Page.

## Contract

`GET https://ops.codeblackwx.com/overlay-core/facebook-viewers` → `{ "count": <number> }`, CORS
open. Returns `{ "count": 0 }` when nothing is currently live (a real, valid state — not an
error). Returns a `502`/`503` on any failure; the overlay leaves the viewer-count line blank
rather than showing a stale or fabricated number.

`GET https://ops.codeblackwx.com/overlay-core/facebook-live-state` →
`{ "live": <boolean>, "title": <string|null>, "url": <string|null> }`. CodeBlack-Edge uses this
minimal public state to detect a single offline-to-live transition and enqueue the Discord notice.
It returns the same `502`/`503` failure behavior if the provider is unavailable or has not been
configured.
