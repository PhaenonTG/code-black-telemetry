# Code Black Core Gateway

Status: Cloudflare-side gateway implemented, tested, and safe to deploy. The Core-side private
transport it depends on does **not** exist yet -- this is a deliberate stop, not an oversight. See
"Safety gate: what is NOT done" below before assuming this makes Core data live in production.

## Problem

`ops.codeblackwx.com` (Cloudflare Pages) needs to read a small set of CodeBlack-Core endpoints
(health, Fabric state, Storm Intel point queries) for authenticated OPS users, without exposing
Core's API publicly. Core's API binds to `127.0.0.1:8000` on CodeBlack-Core only, reachable today
solely via Tailscale + SSH tunnel for local development. That must not change -- Core port 8000
stays loopback-only, permanently.

## Chosen architecture

```
Browser (authenticated Supabase session)
  -> https://ops.codeblackwx.com/api/core/<allowlisted-route>   (same origin, no CORS needed)
  -> Cloudflare Pages Function  (web/ops/functions/api/core/[[path]].ts)
       - verifies the Supabase session server-side (delegates to Supabase, no JWT secret held here)
       - enforces public.profiles.active, same boundary the app itself already enforces
       - resolves the path against a hardcoded allowlist (5 routes, see below)
       - forwards to CORE_GATEWAY_UPSTREAM_BASE (server-side env var, never sent to the browser)
  -> [NOT YET BUILT] Core-side private transport (Cloudflare Tunnel recommended -- see Safety Gate)
  -> CodeBlack-Core loopback API (127.0.0.1:8000)
```

This reuses the existing Cloudflare Pages Functions pattern already present in this repository
(`functions/api/modot/[[path]].ts`, `functions/api/odot/[[path]].ts` in the root app) rather than
inventing a new hosting mechanism, and reuses the existing Supabase Auth / `public.profiles`
authorization boundary rather than inventing a second auth system.

### Why not other candidates

- **A second backend/API service**: rejected outright -- the brief explicitly forbids a second
  authoritative backend, and Core is already the single source of truth for Fabric/Storm Intel.
- **Locally-verified Supabase JWT (HS256 secret or JWKS)**: possible, but requires holding and
  rotating a JWT secret (or caching/rotating JWKS) in the gateway, and a locally-cached "valid"
  verdict cannot see revocation until it expires. Delegating to `GET /auth/v1/user` costs one extra
  round trip per request but needs zero new secrets and is correct on every request, including
  right after a session is revoked. Chosen for correctness over the small latency cost.
- **Cloudflare Access in front of the gateway route**: would re-introduce the exact "trust the
  edge completely" model that was deliberately superseded by in-app Supabase auth (see
  `web/ops/docs/ARCHITECTURE.md`, "History: Cloudflare Access (superseded)"). Not reused here.

## Route allowlist

Exactly five routes exist. There is no wildcard, no passthrough, and no caller-controlled upstream
host or path -- the allowlist is a hardcoded object in `web/ops/functions/lib/coreGateway.ts`, and
adding a route is a reviewed source change, not a runtime configuration option.

| OPS-facing path | Upstream Core path | Query params forwarded |
|---|---|---|
| `/api/core/health` | `/health` | none |
| `/api/core/fabric/health` | `/api/fabric/v1/health` | none |
| `/api/core/fabric/units` | `/api/fabric/v1/units` | none |
| `/api/core/storm-intel/health` | `/api/storm-intel/v1/health` | none |
| `/api/core/storm-intel/point` | `/api/storm-intel/v1/point` | `latitude`, `longitude` only |

Explicitly absent, by construction (not filtered at runtime -- simply never in the allowlist):
ingest/write endpoints, command endpoints, OTA, MQTT, filesystem access, admin endpoints, SSH,
arbitrary `/api/core/*` passthrough. Any path not in the table above returns `404
ROUTE_NOT_ALLOWED`. Any method other than `GET` returns `405 METHOD_NOT_ALLOWED` on every route,
including the allowlisted ones.

## Authentication and authorization

1. Browser must send `Authorization: Bearer <supabase-access-token>` (the same session token
   `supabase.auth.getSession()` already holds -- no new client-side auth code needed for this to
   work, though `src/core/client.ts` needs one addition: attach that header to its `fetch` calls,
   see "Client wiring" below).
2. The gateway calls `GET {VITE_SUPABASE_URL}/auth/v1/user` with that bearer token and the existing
   publishable key. Non-200 -> `401 AUTH_INVALID`.
3. The gateway then calls `GET {VITE_SUPABASE_URL}/rest/v1/profiles?select=active&user_id=eq.<uid>`
   with the *same user bearer token* (not a service_role key) -- this runs under the existing RLS
   policy (`profiles_select_own`), so it can only ever read the caller's own row. Missing row or
   `active != true` -> `403 UNAUTHORIZED`.
4. Only on success does the gateway forward the request to Core.

No `service_role` key, admin token, or Core credential is ever sent to or held in the browser. The
only "secret" the browser sends is the user's own normal Supabase session token, which it already
holds for every other authenticated request the app makes.

## Secrets / configuration (names only)

Client-visible (`VITE_`-prefixed, already documented in `web/ops/docs/ARCHITECTURE.md`, unchanged
by this pass):

```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_CODEBLACK_CORE_BASE_URL       # set to /api/core in production
```

Server-side only (Cloudflare Pages Function environment, never inlined into the browser bundle):

```
CORE_GATEWAY_UPSTREAM_BASE              # NOT SET yet -- see "Stage 2: Core-side tunnel"
CORE_GATEWAY_CF_ACCESS_CLIENT_ID        # recommended; NOT SET yet
CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET    # recommended; NOT SET yet
CORE_GATEWAY_SHARED_SECRET              # fallback if Access is not used; NOT SET yet
```

The Function also reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` directly (Cloudflare
Pages exposes all configured project environment variables to Functions regardless of the `VITE_`
prefix; that prefix only controls what Vite inlines into the *client bundle* at build time) --
no duplicate Supabase configuration was introduced.

## Bounded behavior

- Per-request upstream timeout: 8 seconds (`AbortController`), mapped to `504 CORE_TIMEOUT`.
- Upstream response size capped at 2,000,000 bytes (checked via `Content-Length` when present, and
  again on the actual decoded body) -- a compromised or misbehaving upstream cannot exhaust the
  Function's memory.
- Upstream response is always parsed as JSON; anything else (including empty bodies with a non-2xx
  status already handled first) returns `502 CORE_MALFORMED_RESPONSE` -- the caller never sees a
  raw non-JSON body or an upstream stack trace.
- CORS: not needed for the primary path (the gateway is served from the same origin the browser
  already loaded, `ops.codeblackwx.com` or `codeblack-ops.pages.dev`, each independently
  same-origin to its own Functions deployment). No `Access-Control-Allow-Origin` header is set, so
  a script on any other origin cannot read a response even if it guessed a valid session token.
- Rate limiting: not enforced in Function code (Cloudflare Workers/Pages Functions have no reliable
  shared in-memory state across invocations to build a correct counter from). Documented here as a
  **required follow-up dashboard configuration**: add a Cloudflare Rate Limiting Rule scoped to
  `ops.codeblackwx.com/api/core/*` before treating this as hardened against abuse from an already
  -authenticated, misbehaving, or compromised client. This is a deployment-console step outside
  this repository and was not performed in this pass.

## WebSocket / live Fabric state

**Not implemented this pass.** `src/core/CoreOpsProvider.tsx` already no-ops its WebSocket effect
whenever `coreWsUrl` is empty (`if (!coreConfigured(config) || !config.coreWsUrl) return;`),
leaving `fabric.wsState = "disabled"` -- a real, already-modeled state, not a hack. Production can
ship with Fabric REST-only (health + units, polled) with zero frontend changes, which is what this
pass does.

Designed-but-not-built path for later: a short-lived, single-use ticket handshake --
`POST /api/core/auth/ws-ticket` (authenticated, same auth check as above) returns a signed ticket
with a short TTL; the browser opens `wss://ops.codeblackwx.com/api/core/fabric/ws?ticket=...`; the
gateway validates the ticket (WebSocket upgrade requests cannot carry a normal `Authorization`
header) and pairs the two sockets. Deferred because it depends on the same not-yet-built Core-side
transport also supporting a WebSocket upgrade through it, and adds real additional
complexity/attack surface that deserves its own reviewed pass once the REST path is proven live in
production.

## Stage 2: Core-side tunnel -- installed, not yet activated

Approved and installed in Stage 2 (2026-09-06): the official `cloudflared` package (v2026.8.3,
official `.deb` from `github.com/cloudflare/cloudflared` releases, amd64) is now installed on
CodeBlack-Core. Verified before and after installation: Core API healthy on `127.0.0.1:8000` only
(no `0.0.0.0` listener), Tailscale `BackendState: Running`, `ssh.service` active, both
`codeblack-mqtt-broker.service` and `codeblack-mqtt-bridge.service` active, 0 failed systemd units.
Installing the package alone starts no service and opens no port -- `cloudflared` is inert on disk
until a tunnel is created and installed as a systemd service with a token, which is the remaining
step below.

`CORE_GATEWAY_UPSTREAM_BASE` remains intentionally unset in Cloudflare Pages. Until it is, every
allowlisted route correctly and honestly returns `502 CORE_UNAVAILABLE` -- verified by the test
suite, same "report unavailable, never simulate" principle as `web/ops/docs/ARCHITECTURE.md`.

### Remaining steps (Cloudflare account/dashboard -- cannot be done from this session)

These require your own Cloudflare login and were not attempted here, consistent with never asking
for account credentials, API tokens, or secrets to be pasted into chat:

1. **Cloudflare Zero Trust dashboard -> Networks -> Tunnels -> Create a tunnel** (connector type
   "Cloudflared"). Name it something like `codeblack-core-gateway`. The dashboard gives a one-line
   install command containing a tunnel token, e.g.:
   ```
   sudo cloudflared service install <TOKEN>
   ```
   Run that command directly on CodeBlack-Core yourself (or paste me only the resulting command
   with the token still in place and I will run it via SSH without echoing it back -- your choice).
   This installs and starts `cloudflared` as a systemd service (`cloudflared.service`), pointed at
   Cloudflare's control plane; ingress rules are then configured in the dashboard, not in a local
   file.
2. In the same tunnel's **Public Hostname** tab, add exactly one hostname (e.g.
   `core-gateway.codeblackwx.com` or a non-guessable subdomain of your choosing) with:
   - Service: `HTTP` -> `127.0.0.1:8000`
   - Nothing else -- no catch-all rule, no additional public hostnames on this tunnel.
3. **Protect that hostname with Cloudflare Access** (recommended over a plain shared secret):
   Zero Trust -> Access -> Applications -> Add an application -> Self-hosted, pointed at the same
   hostname, with a policy requiring a **Service Token** (Access -> Service Auth -> Service Tokens
   -> Create Service Token). This gives a Client ID and Client Secret. Access validates these at
   Cloudflare's edge *before* the request ever reaches the tunnel or Core -- Core needs zero new
   code either way.
4. In the **Cloudflare Pages project (`codeblack-ops`) -> Settings -> Environment variables
   (Production)**, set:
   ```
   CORE_GATEWAY_UPSTREAM_BASE = https://<the tunnel hostname from step 2>
   CORE_GATEWAY_CF_ACCESS_CLIENT_ID = <Client ID from step 3>
   CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET = <Client Secret from step 3>
   VITE_CODEBLACK_CORE_BASE_URL = /api/core
   VITE_OPS_DATA_MODE = LIVE_CORE
   ```
   (If Access is skipped in favor of a plain shared secret instead, set `CORE_GATEWAY_SHARED_SECRET`
   there instead of the two `CF_ACCESS_*` vars -- the gateway code already supports both, preferring
   Access when both are present.)
5. Redeploy (or trigger a new Pages deployment) so the Function picks up the new environment
   variables -- Pages Functions read env vars at request time from the deployment's configuration,
   so a redeploy after changing them is the safe way to guarantee they're live.

Rollback at any point is non-destructive: `sudo systemctl stop cloudflared && sudo systemctl
disable cloudflared` removes the tunnel entirely with zero effect on SSH, Tailscale, the Core API
process, or MQTT (none of those are touched by cloudflared); unsetting
`CORE_GATEWAY_UPSTREAM_BASE` in Cloudflare Pages instantly reverts the gateway to its current
honest `CORE_UNAVAILABLE` state with no redeploy required for that half.

Once steps 1-5 above are complete, the next pass should run the full production validation in
`docs/system/code-black-ops-web.md` before this doc is updated to "Core data live."

## Client wiring: done (Stage 2)

`src/core/client.ts` now attaches `Authorization: Bearer <access_token>` to every Core request.
`currentAccessToken()` reads `supabase.auth.getSession()` fresh on every call (no caching), so it
transparently reflects "no session," "expired session with failed refresh" (both resolve to
`session: null`, correctly falling through to the gateway's `401 AUTH_REQUIRED`), and "session
just refreshed" (supabase-js's own auto-refresh updates what `getSession()` returns, picked up on
the very next request with no extra code). `buildCoreRequestHeaders()` omits the `Authorization`
header entirely when there is no token, rather than sending an empty/fake bearer value. Both are
exported and unit tested in `web/ops/src/core/authHeader.test.ts` (7 tests) with a mocked Supabase
client -- no live Supabase dependency in the test suite. This has no visible effect against the
local dev SSH-tunnel path (Core's own API has no auth check today) and will only start mattering
once the production gateway has a real upstream.

## Testing

`web/ops/functions/lib/coreGateway.ts` is pure (only `fetch`/`Response`/`URL`/`AbortController`,
all standard) and unit tested directly with Vitest in
`web/ops/functions/lib/coreGateway.test.ts` (17 tests): unauthorized request, invalid/expired
token, valid auth + active profile, valid auth + inactive/missing profile, allowlisted route
resolution, rejected non-allowlisted routes (including path-traversal and MQTT/admin/SSH-shaped
attempts), open-proxy prevention (a caller-supplied `host`/`admin` query param is proven to never
reach the outgoing request), Cloudflare Access Service Token headers sent when configured (and
correctly preferred over the plain shared-secret fallback), Core-unconfigured, Core timeout, Core
network failure, malformed upstream JSON, non-2xx upstream mapped without leaking upstream error
detail, and a successful Storm Intel point proxy. No live Core or live Supabase dependency in the
test suite.
