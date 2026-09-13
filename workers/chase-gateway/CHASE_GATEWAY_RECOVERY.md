# codeblack-chase-gateway source recovery provenance

2026-09-13. Read-only forensic recovery session, reconstruction only -- **not deployed.**

## What this is

`codeblack-chase-gateway` is a live, standalone Cloudflare Worker (id
`c2838cf2b05347e6a5a3e304dcb9da6b`) that owns `ops.codeblackwx.com/api/chase/*` -- it takes
precedence over the `codeblack-ops` Pages project on that path prefix. It forwards to Core
(`codeblack-core-api.service`, `ChaseLocationStore`) over a Workers VPC Service binding.
`classic-v2.html` / `classic.html`'s live GPS tracking depends on its
`GET /api/chase/location/public` route.

## Why this is a reconstruction, not the original

Searched (read-only, 2026-09-13):
- This repo (`Code Black Telemetry`), both `feature/ops-web-v1` (local) and `origin/master`:
  no `codeblack-chase-gateway`, no matching route/binding, anywhere. `workers/core-gateway/`
  is a different, unrelated Worker (`codeblack-core-gateway-worker` -- the general
  `/api/core/*` transport for the OPS Pages gateway, no chase-specific code at all).
- Core (`/srv/codeblack`, `/tmp`, `/home/codeblack`, `/opt`, `/var/tmp`): no `wrangler.toml/
  json/jsonc` referencing this Worker, no JS/TS source tree, no deploy scripts.
- Laptop user directories (Documents/Desktop/Downloads): no match.

`wrangler deployments list --name codeblack-chase-gateway` confirms the Worker is real and
was deployed by direct `wrangler` upload (not git-connected) -- consistent with source that
was never committed anywhere, same pattern as the Core-side `chase_location.py` recovery
(see `../../CHASE_LOCATION_RECOVERY.md` under `services/core-api/` in the recovery branch).

## What was recovered instead

The **deployed bundle itself**, pulled directly from the Cloudflare API
(`workers_get_worker_code`, scriptName `codeblack-chase-gateway`) during this session. It is
esbuild output (helper-renamed, single-file, no original module boundaries) -- reproduced
verbatim in this recovery session's notes before being rewritten here.

`src/index.ts` in this directory is that bundle **rewritten into readable, idiomatic
TypeScript** matching this repo's existing `workers/core-gateway` conventions -- same
structure, same route-handling shape -- but every response status code, header, rounding
rule, and edge case was preserved exactly as observed in the bundle and in live `curl`
traces against the production endpoint, not redesigned. See the header comment in
`src/index.ts` for the full route list.

## Recovery classification

**D -- build artifact only**, reconstructed to readable source. This is NOT the original
hand-authored file; it is a faithful behavioral reproduction. Treat any future change here
as changing a *reimplementation*, and re-verify against a fresh pull of the live bundle
before trusting a diff.

## Config

`wrangler.jsonc` in this directory documents the inferred config *shape* only -- the real
Cloudflare route binding and the real `vpc_services[0].service_id` were not recovered (no
config file found anywhere). **Do not `wrangler deploy` this without first confirming both
against the Cloudflare dashboard** -- deploying blind risks detaching the real production
route from the real Worker.

## Verification performed this session

- `src/index.test.ts` -- parity tests exercising the 9 scenarios requested for this
  recovery pass (valid/stale/sharing-off/unknown-unit/malformed-fix/CORS/no-store/POST
  ingest/private-latest), each asserting the exact status code and body shape captured from
  a live `curl` against the real production endpoint or documented in the recovered bundle.
- Not yet run in this pass: `npm install` + `vitest run` + `tsc --noEmit` (this directory is
  new; needs its own `npm install` before the scripts work -- see the sibling
  `workers/core-gateway` for the exact same one-time setup this repo already uses).

## Status

Reconstructed source only. **Not deployed.** The live `codeblack-chase-gateway` Worker is
untouched.
