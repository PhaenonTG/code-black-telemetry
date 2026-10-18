# R4: implemented private parity transport — isolated, not deployed

Parent: reviewed R3 bedab74926aa143ba0cab2e98808c2cadfc90bfb. This revision implements the previously missing connection without changing the existing Core, live Fabric, Producer, private OPS service or radar worker. Core role-policy proposal remains byte-identical and unapplied while the owner decides it.

## Concrete components and path

`OPS Pages PRIVATE_PARITY_ORIGIN → new internal codeblack-private-parity-adapter Worker → PARITY_VPC service → new dedicated loopback Node origin → existing radar 127.0.0.1:8787 / approved sanitized snapshot file`

The Pages candidate already emits the binding request. This revision supplies the other executable components:

- `workers/private-parity-adapter/src/index.ts`: standalone Worker facade; fixed Service target, exact route/method/query checks, bearer presence/size check, no asserted actor headers, bounded concurrency/deadline/body handling and response validation/projection. It relies on the origin for actual Supabase session/profile/recognized-role verification, not the presence of a bearer alone. No public Worker route or workers.dev endpoint proposed.
- `migration/parityOrigin.ts`: dedicated Node HTTP origin plus directly testable handler. It mounts the reviewed staged gateway, which verifies the real user/profile/role before any radar or snapshot access. Only approved read routes exist; Core/Producer/Chase/workstation namespaces reject. HTTP Host/proxy headers never choose the upstream. Raw noncanonical paths, request bodies and upgrades reject; header/time/concurrency bounds apply.
- `migration/startParityOrigin.ts`: real Node 22+ launcher, explicitly configured port, always listening on 127.0.0.1. No default port, static site, auth/login endpoint, process supervisor or service installation. It selects existing Auth URL/publishable-key references and optional sanitized snapshot path; it does not create/log credentials or load environment files. SIGINT/SIGTERM handling applies only if that launcher is explicitly run.
- `shared/parityContract.ts`: pure shared route and response contract for both ends. Coordination uses the existing strict curated vocabulary/schema. Radar projects approved render/provenance fields and removes unknown fields/URLs/paths. Valid values are preserved, not recalculated. Unknown private error text, cookies and arbitrary response headers never pass through.
- `migration/buildParityRuntime.mjs`: executes real esbuild using the actual proposal's main entry; emits standalone Worker, Node module and Node launcher with hashes. The Worker build has no Node imports. No deployment/configuration command is provided.

`migration/coordinationSnapshot.ts` additionally opens with O_NONBLOCK when available, so Linux FIFO/nonregular-file rejection can occur without a blocking open. Existing size/schema/no-follow checks remain. Windows tests do not establish Linux permissions/no-follow/FIFO semantics; native selected-origin qualification remains unrun.

## Explicit contract

| Route | Contract |
| --- | --- |
| GET /api/v1/radar/frames | Exactly site=KSRX, product=REF/VEL/CC, tilt=1/2/1 respectively, limit=1; four unique keys only. Zero or one returned frame |
| GET /api/v1/radar/frame/<id>/metadata | Lowercase hex ID length 16–64, no query; returned frame ID must match |
| GET /api/v1/radar/tiles/<id>/<z>/<x>/<y>.png | No query; canonical decimal coordinates; z≤16; x,y<2^z; PNG media type/signature; ≤1 MiB |
| GET /api/coordination/v1/snapshot | Exact no-query path, strict approved snapshot v1 schema, ≤256 KiB |

Frames/metadata are ≤128 KiB, KSRX only, REF1/VEL2/CC1, bounded legend color stops with correct units, string ID, ISO timestamp with timezone, valid age/freshness. Known optional site/bounds/quality/source/chunk diagnostics are projected explicitly; upstream tile/image URLs and unknown fields are excluded. Genuine backend responses must still be checked against this schema before activation. PNG validation here is signature/size validation, not proof of real image decode or radar science.

Non-GET returns 405; unrelated/invalid routes 404; missing bearer 401. Real invalid/inactive/unknown-role denials come from the existing reviewed origin verifier/policy. Missing VPC returns 503. Redirects, HTML, malformed/oversized/mismatched responses become bounded JSON errors. FRAME_PENDING and approved error codes retain semantics; arbitrary origin errors are sanitized. Responses use private/no-store, Vary: Authorization and nosniff. No API response falls into SPA fallback.

Worker admission is eight per isolate, origin eight per process; these are not account-wide rate/spend limits. Origin deadline 11s, Worker 11.5s inside the existing Pages 12s envelope; the existing browser may cancel sooner. No new polling, retries, warmup commands or cache bypass is added. The fixed data-source auth behavior is retained, including its existing radar verifier; this can involve multiple auth/profile HTTP reads per radar request and must be included in cost/capacity measurement.

## Why a new narrow VPC Service, not repurposing Core

Existing Core VPC service 01a07ab2-e9b9-7072-8d86-bb514e27712c is configured for the Core API; it is not a generic port router. [Cloudflare's VPC API](https://developers.cloudflare.com/workers-vpc/api/) specifies that the registered Service host/port determine the destination; fetch's host is a Host/SNI value, not destination selection. Therefore a new fixed parity Service on the existing tunnel is proposed, preserving the existing Core service and its allowlist. No broad VPC Network binding, new public hostname or tunnel replacement is needed by this design.

This is an implemented design with offline evidence, not proof of current cloud/host feasibility. The virtual fixed fetch hostname is not a new DNS requirement.

## Exact production changes that require separate approval

| Component | Proposed change — none applied |
| --- | --- |
| New Node origin | Dedicated service/process and release directory under an explicitly chosen existing non-root identity, Node 22+, running the pinned origin-cli.mjs. Proposed port **8791**, loopback only, subject to explicit free-port/namespace check. PARITY_LISTEN_PORT must be explicit; no guessed default |
| Origin configuration | Existing custodian-managed VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY references only; approved OPS_PRIVATE_COORDINATION_SNAPSHOT regular-file path. No Producer secret/environment override. Radar base fixed http://127.0.0.1:8787 and site KSRX in launcher |
| New VPC Service | Proposed name codeblack-private-parity-origin; HTTP, 127.0.0.1:8791 in the actual existing connector namespace; existing tunnel **35a17aa9-2532-4583-98ca-00f5b7a20c85**. New service ID assigned only after approval. Do not edit/reuse the Core service ID |
| New adapter Worker | Proposed name codeblack-private-parity-adapter, workers_dev:false, no public routes; PARITY_VPC bound only to the approved new Service ID. Confirm proposed name availability, pin deployed version and exact configuration |
| OPS Pages | PRIVATE_PARITY_ORIGIN Service Binding → that exact adapter Worker production target. Existing CORE_GATEWAY_WORKER unchanged. R3's narrow radar/coordination API gate already exists in candidate source |
| Policy | Core authorization.patch **not applied**. This transport revision does not approve it, alter Supabase/RLS/accounts or change Producer permissions |

`wrangler.proposal.jsonc` is deliberately not a default deployment config and has an invalid/unresolved service-ID marker. It cannot be treated as production-ready configuration. No Worker/VPC resource/binding, tunnel mapping, service, port, environment variable or credential was created or changed.

Rollback after future approval: detach only the new Pages binding/restore pinned Pages code/config; keep all existing Core/Producer/radar/private OPS state. Remove new traffic before stopping/restoring only the dedicated new origin and adapter version. New resource deletion is not an implicit rollback step. Exact before-state/version/release and rollback authorization must be captured before any action.

## Evidence and precise remaining inputs

Tests use the emitted Pages artifact, emitted adapter and emitted Node origin, a real temporary 127.0.0.1 HTTP listener, synthetic VPC binding/Auth/radar and a synthetic approved snapshot. They cover all products/cuts, metadata/tiles, role denials, direct origin access, HTTP method/path/body limits, no private field/header leakage, redirects/HTML/oversize/schema rejection, concurrency, deadline/cancellation, late response cleanup, safe missing configuration, and unchanged Core/Producer paths. No production/browser/account requests were made. Actual VPC routing and genuine data are not claimed.

Implementation is not blocked on missing Core backend source: the new dedicated origin is complete and deliberately avoids modifying Core or r19. Before production qualification, obtain these **specific** custodian artifacts:

1. Read-only existing tunnel/connector host+namespace receipt, free-port check for proposed 8791, Node executable path/version, chosen non-root service identity and exact supervised launch/rollback metadata. No tunnel token or credential file.
2. Approved sanitized coordination.view.v1 JSON artifact plus final host path/ownership/publication method. The reader never consumes raw session stores or generates a real export itself.
3. Bounded sanitized localhost:8787 responses for REF1, VEL2, CC1 and one matching metadata response, including legend.kind/colorStops, plus a genuine PNG decode/viewport result. This specifically confirms the reviewed client schema rather than assuming an older backend shape.
4. Assigned new VPC Service ID and proposed adapter name availability/configuration/version receipt, then actual isolated VPC-to-origin/real-account qualification. No new grant is requested; existing authorized custodian capability must perform any later approved resource work.
5. Pending browser/dashboard account plan, usage/CPU/shared quota/media feasibility evidence. Reusing server/tunnel infrastructure is not a free/unlimited guarantee; no purchase/upgrade approved. No videos/Producer media are routed through this adapter.

The failed managed Linux qualification remains UNRUN and was not replaced. Native tests for this newly selected Node host component are specific to its file/listener/service behavior, not authorization to run the obsolete private switch operator. Existing RDP/dashboard work is not duplicated.

Next: independently review this frozen implementation and configuration proposal, obtain the named artifacts, finish the owner's separate policy decision and qualify the exact origin/bindings on an approved isolated target. No rollout is authorized.
