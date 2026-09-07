# Code Black Core Gateway Worker (VPC transport)

**Status: scaffold only. Not deployed. No Cloudflare VPC Service exists yet.**

## What this is

A small, standalone Cloudflare Worker whose only job is to transport already-authenticated,
already-allowlisted Core REST requests from the OPS Pages project to Core, through a future
[Workers VPC Service](https://developers.cloudflare.com/workers-vpc/) binding, instead of the
public Access-protected tunnel hostname (`core-gateway.codeblackwx.com`) the Pages gateway uses
today.

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
  -> Cloudflare Workers VPC Service binding (CORE_VPC)      <- NOT YET CREATED
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
- `wrangler.jsonc` — deployment config. `vpc_services` is commented out; see below.

## Current state of the VPC binding

`env.CORE_VPC` is typed as **optional**. No real Cloudflare VPC Service has been created, and
`wrangler.jsonc` has no `vpc_services` entry (a placeholder/fake `service_id` was deliberately
not invented). Until a real VPC Service exists and is wired in:

- The Worker still builds, typechecks, and passes all tests.
- At runtime, `env.CORE_VPC` would be `undefined`, and every request gets a safe
  `502 { error: "VPC_NOT_CONFIGURED" }` rather than crashing.

## Pages-side integration (prepared, not activated)

`web/ops/functions/lib/coreGateway.ts` has a new **optional** `CORE_GATEWAY_WORKER` field on
`GatewayEnv` and a new `forwardToCoreViaServiceBinding()` path inside `forwardToCore()`. It is
only used when `env.CORE_GATEWAY_WORKER` is bound. In production today, no such binding
exists, so `forwardToCore()` behaves **exactly** as before — the existing public
Access-protected tunnel path remains the active, proven transport. This is intentional:
rollback stays trivial (nothing to roll back — the old path was never touched) until the VPC
path is created and verified end-to-end.

## Next phase: Cloudflare resources to create (NOT done by this scaffold)

In order, once this code is reviewed:

1. **Create a Workers VPC Service** (dashboard: Workers & Pages → VPC, or
   `wrangler vpc service create`) — type `http`, pointing at the existing
   `codeblack-core-gateway` tunnel, host `127.0.0.1`, port `8000`. Requires the
   **Connectivity Directory Admin** role.
2. **Uncomment and fill in `vpc_services` in `wrangler.jsonc`** with the real `service_id` from
   step 1, binding name `CORE_VPC`.
3. **Deploy this Worker** (`wrangler deploy`) — still not publicly reachable after this step.
4. **Create a Service Binding** on the OPS Pages project (Settings → Bindings → Add → Service
   binding) named `CORE_GATEWAY_WORKER`, pointing at this Worker. Dashboard-configurable, no
   `wrangler.jsonc` needed on the Pages project side (avoids the Text-env-var-wiping issue
   documented in `docs/system/code-black-core-gateway.md`).
5. **Redeploy the OPS Pages project** so the binding takes effect.
6. Verify Core/Fabric/Storm Intel return real data end-to-end through the new path before
   considering removing the public `core-gateway.codeblackwx.com` hostname and its Access
   application (keep both until proven).

None of the above has been done. `READY_TO_DEPLOY = NO`.
