# Chase-aware radar control

This is the bounded control-plane design for Code Black's own radar worker. It is intentionally separate from the current public request parameters and does not export vehicle coordinates.

## Current implementation

- `chaseSelection.cjs` ranks the in-repository NEXRAD catalog from fresh, explicit Fabric unit locations.
- `chaseControl.cjs` accepts only `lead-chase-platform` and `chase-platform` Fabric units, rejects stale, invalid, and inactive locations, and produces a coordinate-free status object.
- `chaseScheduler.cjs` defaults to `OBSERVER`. In `ACTIVE` mode it prewarms REF tilt 1 for at most two unique primary sites, then at most one secondary site only after every primary prewarm completes successfully.
- Scheduler tests use injected prewarm callbacks only. They never start the HTTP worker, bind a port, fetch Level II data, or write to production.

## Production baseline

The deployed CBWX-031 worker is not the old `radar-worker/worker.cjs` checkout. Its tested source identity is the isolated local artifact at `C:\Users\glenn\AppData\Local\Temp\cbwx-031-radar-worker`, branch `fix/cbwx-031-health-responsiveness`, commit `ccbca68`.

That artifact contains the off-thread Level-II decode and render-yield safeguards verified for CBWX-031. Any deployment must integrate this control-plane change onto that exact baseline (or a provenance-equivalent reviewed successor), not replace it with the older checkout.

## Required live dependency

The control worker may read only the Core-local Fabric units snapshot:

`GET http://127.0.0.1:8000/api/fabric/v1/units`

No browser, OPS gateway, map state, or inferred location is an acceptable fallback. As of the source documentation reviewed on 2026-10-10, Fabric Phase 2 is not deployed to live Core hardware. Until a live read-only snapshot is validated, mode remains `OBSERVER`; `ACTIVE` must not be enabled.

## Status and control boundary

The Status Center consumes a loopback-only future endpoint:

`GET /api/v1/radar/control/status`

Its response may contain selection site IDs, distances, freshness ages, queue state, error codes, and capability states. It must not contain raw Fabric payloads, unit coordinates, authorization headers, or configuration secrets.

The Status Center stays read-only. A future private Tailscale configuration page must be a separate write service with an explicit authorization design, durable audited configuration, and a deployment approval. It must not reuse the read-only Status Center endpoint or expose controls through the public/OPS gateway.

## Deployment gates

1. Validate the Core-local Fabric units snapshot has fresh explicit locations for STRIKER and TESSA.
2. Transplant the reviewed modules into the CBWX-031 worker baseline and add the sanitized status endpoint.
3. Test on loopback with fixture snapshots and stubbed prewarm operations; no live archive fetches during unit tests.
4. Review a bounded worker mode/configuration design and the private control-page authorization model.
5. Obtain explicit deployment approval before any Core file, systemd, Tailscale Serve, or production configuration change.
6. During an approved canary, retain the existing KSGF behavior, verify health responses remain below four seconds, and verify the independent N0Q composite feed stays fresh.
