# Future Public-Site Integrations

Written for the `codeblackwx.com` public site. Nothing here is implemented yet — this is a
placement/scope document for future passes.

## Candidate public integrations

- **Sanitized public chase state from CodeBlack-Core.** A read-only, delayed, or manually-flagged
  subset of chase status (active/standby, general target region, stream availability) — never
  exact live GPS, never raw telemetry.
- **Public fleet location sharing.** Opt-in, coarse (city/region, not street-level), and only for
  units the team explicitly marks shareable.
- **Public stream state.** Whether an authorized public stream is currently live, and which
  provider (YouTube/Facebook/Rumble/Twitch/HLS) — sourced from the provider's own public API/
  webhook, not from internal ingest infrastructure.
- **NWS warnings.** Public NWS/NOAA products only, same as any public weather site would use.
- **Public radar.** A standard public radar tile provider — not the OPS app's private
  Mapbox/telemetry-driven map stack (Step 27 of the originating spec explicitly asked to avoid
  importing that stack into the public site).
- **Road conditions / traffic cameras.** Only from providers whose data is already public
  (state DOT feeds), never anything gated behind OPS credentials.
- **Live Chasers, where authorized.** Only chasers who've explicitly opted their position into
  public display.
- **Chase archive / recap.** Past-chase summaries, media, and outcomes — safe to publish once
  a chase is over and reviewed.
- **Social feed embed.** Read-only embed of public social posts (X/Instagram/Facebook), no
  write access from this site.

## Must remain private by default

- Exact live GPS/telemetry for any unit, at any time, unless a specific unit/person has opted
  into public sharing for that session.
- Stream ingest URLs, keys, or credentials of any kind.
- Internal hardware/service health (Pi status, sensor state, connectivity diagnostics).
- Admin/control surfaces of any kind — this site is read-only by design.
- Chaser Net member data (roster, private reports, internal coordination).
- Anything that would let a member of the public infer a real-time exact vehicle location.

## Suggested architecture shape

`codeblackwx.com` (this package) stays a static, build-time site with no runtime auth. If/when
sanitized public data is wired in, it should come from a small, purpose-built public API (or a
public-safe subset endpoint on CodeBlack-Core) — never a direct client-side connection into any
OPS-internal service, and never by reusing an OPS credential scoped for internal use.

`ops.codeblackwx.com` is a separate, authenticated product. It's expected to eventually share
some design tokens, icons, and status-semantics conventions with this site (so the two feel like
one brand), but it should not share a runtime, a deploy pipeline, or public/private state
handling with this package.
