> Current transport implementation: [PARITY-ADAPTER-R4.md](PARITY-ADAPTER-R4.md). Earlier revision notes below are historical. Core role policy remains unapplied.

> Historical R1/R2 notes below. [REVISION3.md](REVISION3.md) controls the current build-path correction and verification scope.

# Public OPS integration — isolated review source

Base: `96cd70339b4f1a63286ff726e906749c7cf11afe`; branch `feat/public-ops-private-parity-20261018`. No deployment, production replacement, auth/credential configuration, DNS, tunnel, network or permission change was performed.

## Staged behavior

`/vehicle-weather` is lazy loaded inside the existing AuthGate and uses the current CoreOpsContext and shared chaser selection. Fabric receipt metadata follows accepted units; the existing NDJSON stream, 10-second watchdog, reconnect and REST suppression remain. Missing selected vehicles never silently switch. The HUD reads the clock at each render, preventing newly received samples from appearing ahead of a stale render clock.

`routePolicy.ts` and `publicPrivateGateway.ts` are INACTIVE proposals, not imported by the production Worker. They require active recognized OWNER/ADMIN/OPERATOR roles, extra Producer operator permission for writes, restricted paths/methods, bounded auth and stripped identity headers. They delegate to preserved r19 Producer/radar adapters; Core/Fabric remains on the existing public pipeline. Workstation/device ingress is rejected. Exact query, budget, action and lease checks remain required.

`r19-runtime/` and `radar-r3/` preserve ten frozen candidate files outside public assets, with hashes in PRESERVED-ARTIFACTS.json. Existing Producer controls, Pages gateway, Core Worker and reconnect source match the base after line-ending normalization. Production radar V2 hash `7c31f1d9948872944b70e26cb4c9c7c6ec142744857baa13324e134590fff81f` is preserved.

## Deployment and rollback inventory

| Component | Verified current identifier | Previous candidate / limitation |
| --- | --- | --- |
| Pages codeblack-ops | d18fe4bf-a2f4-476d-83e4-a304fbcee3f9; master source 96cd70339b4f1a63286ff726e906749c7cf11afe | f943596d-2285-4496-9c7f-052c91f693f0; source f7b63e2f5075248f82f761973aa35090d61acf6e |
| Entry JS | /assets/index-BQTkC3Wp.js; SHA256 a2dc79bb96f46c3008feff7ba1c4cfdfae3582f1de087e3da918e20c80dc6567 | Same hash on public custom domain and current Pages deployment |
| Core Worker deployment | fff6c1ad-68cd-4622-98e2-a4acd3a5b052; version f0092101-a37d-49e4-a4ab-3a80e8e33872 at 100% | Previous deployment 33bcf518-0b6b-4259-92c6-6c3e4a73af65; version 2f84f01f-7450-4a20-a7e9-9d3e4d1bb90d |
| Pages service | CORE_GATEWAY_WORKER → codeblack-core-gateway-worker, production | Binding metadata only |
| Core VPC | CORE_VPC → 01a07ab2-e9b9-7072-8d86-bb514e27712c | codeblack-core-api, http, 127.0.0.1; tunnel 35a17aa9-2532-4583-98ca-00f5b7a20c85; current port not captured |
| Producer domain routing | Anonymous public /api/producer/v1/status returns 401 JSON | Current Pages deployment returns 200 HTML at same path: separate domain/zone route remains unidentified |

These are rollback inventory references, not tested restoration procedures. No rollback was executed. Secret values were not collected; evidence retains binding targets and variable names only.

## Verification and boundaries

- 368 assertions over 46 route/method cases passed using the actual public verifier with mocked Supabase, the proposed role policy, the inactive runtime adapter with fake upstreams, receipt races and preserved file hashes.
- Full public OPS strict TypeScript and Vite client build passed with existing installed dependencies. No install or production environment configuration was used. Existing large-chunk warning remains.
- 18 vehicle model tests passed.
- 12 mobile browser fixture checks passed using the actual route wrapper and mocked current CoreOpsContext: selection isolation, missing selection, explicit clear, immediate freshness, automatic stale state, reduced motion, no overflow, no console errors and zero external requests.
- These are explicitly labelled DEMO FIXTURES, not real authenticated OWNER/ADMIN/OPERATOR browser evidence. No real control lease, command or device mutation was attempted.
- Existing public verifier gap: an active unknown role is accepted with role=null. The inactive proposed policy rejects it. Production is unchanged; this packet does not claim a production fix.
- Linux/operator qualification remains pending/unverified; no terminal pass evidence is included.

## Exact next coordination step

Obtain the custom-domain Producer route inventory from its existing custodian: Worker name, active version, source revision, routes and rollback reference. Obtain account plan, analytics, shared quota and billing headroom through a supported authorized UI/API for account d9a20387567b68f364828ce6525d4ef4. The installed Wrangler command set did not expose an analytics/billing read route; this is missing supported access, not a verified permission denial. No free deployment guarantee is established.

Review route-role-fixture-matrix.json against real roles and the Producer operator permission source. Then perform authorized signed-in browser parity on a separately approved isolated target before any hostname/auth/routing cutover, preserving the current public live feed and Producer. Check Linux qualification separately.

First compare the existing server with a supported published tunnel against Workers. Workers are not assumed necessary or free; no purchase is authorized. Server capacity, media delivery/terms suitability, app auth enforcement and full parity remain feasibility gates. Earlier migration/cost plans remain context; this inventory supersedes their earlier missing identifiers.
