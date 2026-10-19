# Code Black Core Gateway Worker (VPC transport)

**Status: deployed.** The private VPC Service and OPS Pages service binding are live.
Fabric's bounded `/api/fabric/v1/stream` feed uses this route; the Worker remains non-public.

## What this is

A small, standalone Cloudflare Worker whose only job is to transport already-authenticated,
already-allowlisted Core REST requests from the OPS Pages project to Core, through a future
[Workers VPC Service](https://developers.cloudflare.com/workers-vpc/) binding, instead of the
public Access-protected tunnel hostname (`core-gateway.codeblackwx.com`) retained for rollback.

It exists as a **separate Worker**, not inside `web/ops/`, because Workers VPC bindings
(`vpc_services` / `vpc_networks`) are not currently supported binding types for Cloudflare
Pages Functions / Pages Advanced Mode projects (only plain standalone Workers) — see
`docs/system/code-black-core-gateway.md` in the main repo for the fuller investigation this
scaffold is a response to.

## Target architecture

```
Browser
  -> ops.codeblackwx.com
  -> OPS Pages gateway (web/ops/worker/entry.ts, web/ops/functions/lib/coreGateway.ts)
     - Supabase bearer-token auth (/auth/v1/user)
     - profiles/RLS authorization
     - browser-facing allowlist (unchanged)
  -> Cloudflare Service Binding (CORE_GATEWAY_WORKER)      <- internal, never public
  -> this Worker (workers/core-gateway)
     - independent defense-in-depth allowlist
     - Storm Intel query param validation
  -> Cloudflare Workers VPC Service binding (CORE_VPC)
  -> existing codeblack-core-gateway Tunnel
  -> http://127.0.0.1:8000 (Core, on host codeblack-core)
```

## Trust boundary

This Worker is **not publicly reachable** (`workers_dev: false`, no `routes`, no custom
domain in `wrangler.jsonc`). The only thing that can call it is the OPS Pages project's own
Worker, over an internal Cloudflare Service Binding, which never leaves Cloudflare's network.

Because of that, **Supabase authentication and profile authorization are deliberately not
duplicated here** — they remain entirely on the Pages side. This Worker re-validates the
*route* independently (see `src/allowlist.ts`) as defense in depth, but trusts that the caller
is the Pages gateway, because nothing else can reach it.

## What this Worker will never contain

- Cloudflare Access client ID/secret or service token
- Cloudflare API token
- Supabase service-role secret
- Core's Tailscale IP or any other private network detail
- the public tunnel hostname
- any credential at all

The whole point of the VPC path is that it needs none of these — the VPC Service binding
authenticates at the Cloudflare network layer, not via a header this Worker or Core would
otherwise have to check.

## Files

- `src/allowlist.ts` — pure, framework-free allowlist + Storm Intel query validation +
  fixed-origin URL builder. No open proxy: the Core origin (`http://127.0.0.1:8000`) is a
  hardcoded constant, never derived from the incoming request.
- `src/index.ts` — the Worker entry (`fetch` handler). Method check → route resolution →
  query validation → VPC fetch, with every failure mode mapped to a generic, non-leaking JSON
  error.
- `src/*.test.ts` — Vitest unit tests for both of the above, run entirely in Node (no Workers
  runtime, no network, no Cloudflare account needed).
- `wrangler.jsonc` — deployment config with the private `CORE_VPC` binding and no public route.

## Current state of the VPC binding

The deployed `CORE_VPC` binding points to the `codeblack-core-api` VPC Service, which reaches
Core over the existing Cloudflare Tunnel. `env.CORE_VPC` remains optional in code only so a
misconfigured deployment fails closed with `502 VPC_NOT_CONFIGURED`.

## Pages-side integration

The OPS Pages Worker authenticates every `/api/core/*` request with Supabase and the active
OPS profile before using its `CORE_GATEWAY_WORKER` service binding. REST can fall back to the
Access-protected tunnel if the binding is removed; the Fabric feed deliberately cannot.
Its `/api/fabric/v1/stream` route forwards a bounded NDJSON body without buffering. Core
closes it after about 44 seconds, forcing authorization to be checked on reconnect.

Do not expose the raw Fabric feed to an unauthenticated livestream overlay. Define a separate
public-safe data contract before making any overlay fields public.
