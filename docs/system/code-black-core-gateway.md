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
CORE_GATEWAY_UPSTREAM_BASE     # NOT SET in production yet -- see Safety Gate
CORE_GATEWAY_SHARED_SECRET     # optional defense-in-depth header to the Core-side transport, NOT SET yet
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

## Safety gate: what is NOT done

`CORE_GATEWAY_UPSTREAM_BASE` is intentionally unset. Until it is, every allowlisted route
correctly and honestly returns `502 CORE_UNAVAILABLE` -- this was verified by the test suite and
is the same "report unavailable, never simulate" principle already established in
`web/ops/docs/ARCHITECTURE.md`.

The reason it is unset: Cloudflare Pages Functions run on Cloudflare's Workers network, which has
no route to a private Tailscale address (`100.96.77.89`) or to `127.0.0.1` on a machine it isn't
running on. The only way to bridge Cloudflare's edge to Core's loopback-bound API without exposing
a public port on Core is an **outbound-initiated** tunnel -- Core (or a jump host with loopback
access to Core) must dial out to Cloudflare, not the other way around.

**Recommended Core-side component: Cloudflare Tunnel (`cloudflared`).** It is purpose-built for
exactly this (outbound-only, no inbound port opened, no firewall change), is free at Cloudflare's
base tier, and would be configured to forward only `127.0.0.1:8000` -- nothing else -- through a
tunnel to a non-public, non-indexed hostname, additionally protected by
`CORE_GATEWAY_SHARED_SECRET` as a header check before Core's API ever sees the request.

**This was not installed or configured in this pass**, per the explicit instruction: *"If the
chosen architecture requires installing/configuring a significant new Core-side daemon or changing
production networking: STOP after the audit/architecture proposal and report exactly what would be
changed."* Installing `cloudflared` is exactly that. What it would require, if approved separately:

- Install the `cloudflared` package on CodeBlack-Core (or a host with loopback access to it).
- Authenticate it to the Cloudflare account/zone (one-time `cloudflared tunnel login`).
- Create one named tunnel forwarding a single ingress rule -- `<chosen-hostname> -> 127.0.0.1:8000`
  -- and nothing else (no catch-all, no additional services).
- Run it as a systemd service: least-privilege user, `Restart=on-failure`, no secrets logged.
- Set `CORE_GATEWAY_UPSTREAM_BASE` and `CORE_GATEWAY_SHARED_SECRET` in the Cloudflare Pages project
  once the tunnel hostname exists, then redeploy (or just update env vars -- no code change needed).
- Rollback is trivial and non-destructive either direction: `systemctl stop cloudflared` (or
  `disable` it) removes the tunnel entirely with zero effect on SSH, Tailscale, the Core API
  process, or MQTT, since none of those are touched by installing it; unsetting
  `CORE_GATEWAY_UPSTREAM_BASE` on the Cloudflare side instantly reverts the gateway to its current
  honest `CORE_UNAVAILABLE` state with no redeploy required for that half.

This change was **not made**. It requires a separate, explicit decision before any Core-side
installation happens.

## Client wiring still needed (small, additive, not yet done)

`src/core/client.ts`'s `fetchJson` does not currently attach an `Authorization` header. For the
gateway's auth check to succeed in production, one addition is needed: read the current Supabase
session (`supabase.auth.getSession()`) and attach `Authorization: Bearer <access_token>` to the
four REST calls in `client.ts`. This is a small, low-risk frontend change, deliberately **not**
made in this pass because it has no effect until `CORE_GATEWAY_UPSTREAM_BASE` exists on the Core
side -- shipping it now would be inert code with no way to verify it end-to-end. Tracked here so it
is not forgotten when the Core-side tunnel decision is made.

## Testing

`web/ops/functions/lib/coreGateway.ts` is pure (only `fetch`/`Response`/`URL`/`AbortController`,
all standard) and unit tested directly with Vitest in
`web/ops/functions/lib/coreGateway.test.ts` (15 tests): unauthorized request, invalid/expired
token, valid auth + active profile, valid auth + inactive/missing profile, allowlisted route
resolution, rejected non-allowlisted routes (including path-traversal and MQTT/admin/SSH-shaped
attempts), open-proxy prevention (a caller-supplied `host`/`admin` query param is proven to never
reach the outgoing request), Core-unconfigured, Core timeout, Core network failure, malformed
upstream JSON, non-2xx upstream mapped without leaking upstream error detail, and a
successful Storm Intel point proxy. No live Core or live Supabase dependency in the test suite.
