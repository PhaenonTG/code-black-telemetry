# Parity revision 2 — source review, migration held

Parent: frozen `00d0621c8e2fda5655a335e641e042a57da3b691`; original public source `96cd70339b4f1a63286ff726e906749c7cf11afe`. Branch `feat/public-ops-parity-r2-20261018`. This responds to Task 4's PUBLIC-OPS-PARITY-INDEPENDENT-REVIEW.md. Original checkout/ZIP remain unchanged. No deployment, authorization activation, credential/grant/configuration, service, DNS or tunnel changes.

| Review finding | Resolution in this revision | Boundary |
| --- | --- | --- |
| Core policy did not cover retained entry | `authorization.patch` connects `publicRolePolicy.ts` to the actual Core entry before REST/NDJSON/mutations. Exact patch is exercised in a disposable copy. Unknown roles are rejected; OWNER/ADMIN-only settings/decisions/paid-review/replay policy proposed. | Patch UNAPPLIED. Retained public entry still has baseline behavior; policy approval required. |
| r19 Producer disables Facebook | Candidate origin imports radar only; every Producer path is outside its ownership. Existing public Producer frontend and separately routed Worker remain authoritative. | No replacement adapter or new full-Producer qualification is claimed. |
| Radar metadata rejected | Exact bounded frame metadata route added, retaining frozen gateway validation. | Synthetic upstream/socket-free tests only. |
| Coordination rejected/inactive | Actual origin wrapper dispatches authorized snapshot GET to a bounded validated file reader. `/coordination` is mounted under existing App/AuthGate/provider. | No raw log export, published real snapshot or production exposure. |
| R3 hardcoded private host/not mounted | `/radar-r3` uses current origin and existing AuthProvider session/expiry; preserves REF1/VEL2/CC1, tile-loaded promotion and metadata legends. Mobile/desktop navigation included. | Existing Radar Lab and V2 unchanged. Real session/backend qualification NOT_RUN. |

Ten original runtime/radar files remain byte-identical to PRESERVED-ARTIFACTS.json. Rebased browser copies are in web/ops/src/radarR3. Component filename RadarR3Pilot.tsx avoids the Windows PrivateRadarPilot.tsx/privateRadarPilot.mjs resolution collision. Coordination uses the current session helper signature and aborts a pending session wait on its deadline.

## Entry and approval boundary

`web/ops/worker/parityEntry.ts` is a functional candidate wrapping the retained public entry. Only radar/coordination pass to a fixed injected PRIVATE_PARITY_ORIGIN fetch transport; it forwards Authorization/Accept only, rejects non-GET, returns JSON 503 when unconfigured and has a bounded deadline. The origin-side stagedPrivateGateway independently checks session/profile/role before radar/file access. No browser-selected upstream is accepted.

`functional-wiring.patch` selects that entry in both build paths and adds the new API prefixes to Pages `_routes.json`. It is applied only to this isolated revision, separately from **unapplied** `authorization.patch`. Neither captures Producer. Production transport implementation/binding and hosting design remain unselected/unconfigured; the fixture injects the real origin handler locally. The functional patch passes reverse-check; the authorization patch passes apply-check. No auto-apply hook exists.

The retained minified serving Worker bundle matches the frozen original byte-for-byte. The retained and functional candidate bundles do not contain the unapplied Core role helper. The retained Core entry is unchanged. Only this revision selects the functional wrapper and extends the candidate route gate; no deployed build/configuration changes. The actual Core patch is tested only in a disposable source tree.

## Existing Producer ownership

Configuration: ops.codeblackwx.com/api/producer/* plus adjacent /api/chase/* → codeblack-chase-gateway. Provider current production deployment **4ae18276-de32-4daf-9290-0ce09fe214fa**, version **1d43ecc2-8c12-4e28-a72d-9ab2bb308d3e** (79), 100%. ETag 0aaffb4a02a7de5bb48d37ddb6c0409e9d4d42aa4eebd40b9c69b165371480b6. Preserve ASSETS, Chase OTA 22 and ProducerBridge Durable Object.

Previous candidate: deployment 203fd0cd-613c-4b42-b044-e22f7cd90c2e → version 722cce95-c335-4565-9c90-e674bbee332d; restoration/source/assets compatibility untested. Current zone route IDs/precedence and current-version source/assets mapping remain unknown. Existing OAuth reports zone/route scopes; no missing route-read grant is established. The prior producer-routing-followup evidence packet gives exact dashboard/source-manifest reads needed; no credential extraction or new grant is justified.

## Verification and limits

- 415 regression assertions over 35 Core route/method policy cases: actual patched-entry chain in disposable source, candidate Pages→origin→fake upstream/local synthetic snapshot, metadata/query/method/role/forged-header rejection, Producer non-capture and frozen hashes.
- Full frontend strict TypeScript/client build pass; strict origin gateway/policy/snapshot TypeScript passes; neutral Worker bundle builds. Broader Worker checking with available Cloudflare definitions has seven identical existing diagnostics for baseline and candidate in publicHurricane/publicMapboxToken. No new candidate diagnostics; that broader strict check is not PASS.
- Actual App→AuthProvider→AuthGate→CoreOpsProvider→R3/coordination browser fixture passes. Boundaries are synthetic SDK/profile/server auth, Core/radar data and a Mapbox double. A real synthetic PNG is requested/decoded; REF/VEL/CC cuts, refresh, stale recovery, mobile overflow and expiry/unknown/inactive/anonymous gates are checked. Zero external requests, business mutations or page errors. Browser plugin unavailable; existing Playwright uses a temporary loopback fixture with no real profile/session.
- 18 vehicle model tests pass. HUD results remain HUD evidence, never full feature parity.

**Full migration remains HOLD:** scoped role-policy approval; approved origin transport/exposure configuration; real authenticated role/browser/backend evidence; genuine sanitized Fabric per-device sample/replay; retained Producer backend semantics where relevant; zone/source/assets provenance; account plan/usage/headroom/media feasibility; native Linux/operator qualification if required by the chosen design. No purchase/free-service guarantee.

Windows frontend/build/browser/fixtures do not depend on the pending Linux environment. UID/GID, no-follow/flock/fsync/modes, systemd, limits and rollback semantics require native Linux separately.

Next: review this new freeze and exact unapplied patches, obtain missing existing dashboard/source evidence, then approve an isolated real-auth target and policy before activation. Production and prior review artifact remain protected.
