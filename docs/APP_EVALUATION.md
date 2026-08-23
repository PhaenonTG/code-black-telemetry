# Code Black OPS App Evaluation

Date: 2026-08-22

Branch: `work/full-app-evaluation`

This evaluation is a product-readiness inventory of the current Code Black OPS field app. It is
intentionally critical: contract-only systems are not counted as production-ready, fixture or
coverage-limited data is called out, and deferred systems remain deferred.

## Executive Findings

- The active app shell exposes seven primary pages: Weather, Operations, Locate, Alerts, Report,
  Settings, and Layers. System diagnostics are embedded in Operations/Settings rather than exposed
  as a separate primary route. AI, Fleet, and full System pages are not currently first-class
  reachable routes.
- MARK and ESCAPE are now map-only controls. They appear only on the Locate/map page and preserve
  existing MARK capture and ESCAPE context/deferred-routing behavior.
- Mosaic radar remains the only active radar product. Native Level II REF/VEL/SRV/CC remains
  intentionally deferred.
- Native Android Chase Tracking remains the strongest accepted system. This pass does not change
  native tracking code.
- The S24 Chase notification cleanup blocker was rechecked from a clean post-reboot device state.
  `cmd notification list` and `cmd notification get` prove the Chase notification is removed from
  the active notification set after End Chase; broad `dumpsys notification --noredact` continues to
  show Samsung/Android `mArchive=Archive` history entries and those are not active notifications.
- Road Conditions and Public Cameras are provider-backed v0.1 layers, but concrete live coverage is
  Arkansas DOT IDrive only.
- Chaser Net has substantial contracts, application/review foundations, privacy models, and UI
  status handling, but production backend/auth/realtime deployment remains deferred.
- Live Overlay Telemetry now has an explicit, off-by-default latest-state path for CodeBlack-Core
  overlays. It is not Chaser Net and does not upload breadcrumb history.
- Credential storage and external Spotter Network submission P0 findings now have a first
  remediation pass: Android secure credential storage, legacy migration, redacted diagnostics,
  explicit submission intent, duplicate guards, and unknown-timeout handling exist. iOS Keychain
  and Windows Credential Manager runtime adapters remain pending.
- The largest remaining readiness risks are rendered-control automation, route/status clarity,
  iOS/Windows credential runtime validation, and broad provider coverage gaps.

## Route Inventory

| Surface | Reachable | Classification | Notes |
| --- | --- | --- | --- |
| Weather / Dashboard | Yes | Working / needs polish | Primary landing page; combines weather, radar preview, nearby, and operations context. Some data is provider/hardware dependent and must keep age/status visible. |
| Operations | Yes | Working / needs polish | Holds Core/Pi/streaming/status diagnostics and actions. Some commands require BLE token and live vehicle node. |
| Locate / Map | Yes | Working / needs polish | Primary map/radar surface with mosaic radar, own vehicle, trail, road/camera providers, Spotter Network pins, MARK, and ESCAPE. |
| Alerts | Yes | Partial | NWS/SPC products are displayed where available; should keep official alert styling separate from OPS notices and Chaser Net reports. |
| Report | Yes | Partial / security-sensitive | Spotter Network report submission path exists but requires credentials and external service availability. Not a Chaser Net production report flow. |
| Settings | Yes | Working / needs polish | Large but functional; many controls persist and are consumed. Some hardware/network controls depend on external configuration. |
| Layers | Yes | Working / needs polish | Layer readiness is mostly honest; provider-backed road/camera layers coexist with disabled/deferred probes and Chaser Net. |
| Expanded map/radar | Yes, modal/portal | Working / needs polish | Mosaic portal renders through shared map. Android Back closes it before route navigation. |
| System | Alias/foundation | Partial | `/system` maps into Operations. A clearer dedicated diagnostics route remains useful. |
| Chaser Net panel | Reachable from Settings/Layers context | Foundation only | Honest not-configured production backend state. |
| AI | Not primary reachable route | Not started / deferred | No first-class AI route was found in the active page model. |
| Fleet | Not primary reachable route | Foundation only | Team/spotter positions exist through map/settings foundations, not a complete fleet page. |

## Control Wiring Inventory

Source audit counted 151 concrete interactive controls across the app shell, map, and components:

- Settings: 46
- Report: 20
- Atlas map: 16
- Radar panels: 11
- Nearby panel: 11
- Chaser Net panel: 10
- App shell/navigation/actions: 10
- Layer configuration: 8
- Spotter onboarding: 7
- Pin style/color editors: 8
- Pi/streaming operations: 6
- Miscellaneous overlays/popups: 8

### Control Classifications

| Classification | Finding |
| --- | --- |
| Broken | MARK/ESCAPE were globally available on non-map pages. Fixed in this pass. |
| Partial | Spotter Network report submission, Pi/BLE command controls, streaming controls, road/camera provider coverage, Chaser Net panels. |
| Placeholder/deferred | Probes, production Chaser Net backend/realtime, ESCAPE routing, AI route, Fleet route, GOES/GLM/HRRR/RAP/soundings, CarPlay, Android Auto, Windows packaging. |
| Misleading risk | Any zero/default hardware telemetry can look live without freshness context; Spotter Network credentials may look like a normal production login/storage flow. |

## System Readiness

| System | Status | Evidence / Limits |
| --- | --- | --- |
| Core app shell | Working / needs polish | Seven-page dock shell and swipe navigation are implemented. Route model is custom, not router-based. |
| Navigation | Working / needs polish | Dock/page dots and Android Back handling exist. Back closes expanded map and modals first. `/system` alias to Operations should be made explicit. |
| Dashboard | Working / needs polish | Useful field data composition, but dense and mixed between live, stale, and unavailable provider states. |
| Settings | Working / needs polish | Functional and persisted controls exist. Security-sensitive controls now mask saved secrets and use the shared credential boundary where supported. |
| Themes/display | Ready / working | Dark, Light, Night, System and display/keep-awake abstractions exist. |
| Chase Mode | Ready on Android; platform foundation elsewhere | Physical S24 lifecycle was reaccepted from a clean reboot state. Three Start/MARK/End cycles left no active `ChaseTrackingService` and no active notification key after End Chase. Samsung notification archive records may remain in `dumpsys` history and should not be treated as active leaks. iOS remains future native adapter work. |
| GPS/location state | Working / needs polish | Shared normalized states exist; UI should keep stale/degraded wording consistent across all cards. |
| MARK | Ready after map-only fix | Immediate capture, duplicate guard, session association, and bounded persistence exist. Map-only placement is now guarded by test. |
| ESCAPE | Foundation only | Context/readiness path exists; production routing is not active and must remain honestly labeled. |
| Mosaic radar | Working / needs polish | Active radar experience. Mapbox/token/network availability still affects runtime. |
| Road Conditions | Partial live v0.1 | Provider-backed with Arkansas DOT IDrive coverage only. Uses viewport filtering, provenance, validation, cache, stale fallback. |
| Public Cameras | Partial live v0.1 | Arkansas DOT IDrive public cameras only. Images load on detail, not for every marker. |
| Spotter Network layer | Partial / external dependency | Public/authenticated Spotter Network feeds are external and non-commercial-use constrained. Not Code Black Chaser Net. |
| Reports layer/feed | Partial | NWS/Spotter reports are distinct from Chaser Net production reports. External submission requires caution. |
| Probes | Foundation only | Layer model/visual language exists, production ingest absent. |
| Weather | Working / needs polish | Hardware telemetry plus fallback/provider paths exist; forecast/model systems remain deferred. |
| Telemetry | Working / needs polish | BLE/HTTP/last-known hybrid exists. Hardware-source freshness must stay visible to avoid fake readings. |
| Core/Pi connectivity | Working / needs polish | Shared connection model, endpoint normalization, testing, backoff, freshness, and diagnostics exist. Real Core/Pi services are external. |
| Live overlay telemetry | Foundation / partial | Shared client publisher, authenticated Core contract, latest-state store, Settings status, and secure station-token boundary exist. Production Core deployment and realtime overlay push remain pending. |
| Alerts | Partial | Official NWS/SPC surfaces exist. Needs continued separation from OPS notices and Chaser Net observations. |
| AI | Not started / deferred | No primary route found. Project One/radar reasoning not implemented. |
| Chaser Net | Foundation only | Contracts, in-memory service, applications/review, privacy, roles, audit, and UI status exist. Production backend/auth/realtime absent. |
| Storage/persistence | Working / needs platform validation | Settings, sessions, breadcrumbs, MARK, endpoints, provider cache, and Spotter state persist. Spotter/Pi/overlay secrets moved behind a shared credential store on Android; iOS/Windows native secure-store adapters remain pending. |
| Error handling | Partial | Error boundary exists and provider/service fallbacks exist. More user-facing categorization is needed in several hardware/provider paths. |
| Performance | Working / needs monitoring | Map layers use memoization/cache/deduping; polling exists for telemetry/providers and should be watched on mobile battery. |

## Platform Readiness

| Platform | Status | Notes |
| --- | --- | --- |
| Android phone/tablet | Working / accepted core | Native Chase Tracking, MARK, mosaic radar, and cleanup have physical S24 acceptance. |
| iPhone | Foundation | Capacitor iOS host/sync and shared capability wording exist. Native Core Location/background tracking remains pending. |
| iPad | Foundation | Shared responsive cockpit direction exists. Physical iPad validation remains pending. |
| Windows | Foundation | Shared web app can serve as base; packaging, external GPS adapter, and desktop diagnostics remain deferred. |
| CarPlay / Android Auto | Deferred | Do not start until field app and navigation/ESCAPE foundations mature. |

## Persistence and Retention

- Chase breadcrumbs and MARK events are local app data, not Chaser Net publication.
- MARK events are bounded in `markEvents.ts`.
- Provider caches are bounded in memory and visibly stale when reused.
- Endpoint and display/settings state use shared preferences abstractions.
- Spotter Network account metadata and non-secret settings still use Preferences. Spotter Network
  password, Pi/BLE command token, and Live Overlay station token now migrate to the shared
  credential store on Android.

## Security and Privacy Concerns

1. iOS Keychain and Windows Credential Manager adapters still need native runtime validation before
   broader cross-platform distribution.
2. Spotter Network external submission is now explicitly user-triggered, validated, and locally
   guarded against duplicate/unknown-timeout resubmission, but provider-policy review remains
   required before production/public use.
3. Android backup still deserves a follow-up policy decision for non-secret app data and encrypted
   credential envelopes.
4. Chaser Net live sharing remains off/not configured; local Chase Mode must never enable network
   presence automatically.
5. Live Overlay Telemetry is explicit and off by default; it uses latest-state only and must not
   become a public tracker or hidden breadcrumb upload.
6. Road/camera providers validate URLs/text/coordinates and do not implement ALPR, private-camera
   discovery, or police-evasion features.

## Test Coverage Assessment

| Area | Coverage |
| --- | --- |
| Chase lifecycle / session ordering | Strong for shared domain; physical Android accepted previously. |
| Native Android notification cleanup | Strong for active-notification acceptance; QA should use active notification APIs such as `cmd notification list` / `cmd notification get`, not broad archive-inclusive `dumpsys` matches. |
| MARK | Partial; persistence/duplicate behavior exists and map-only placement is now source-guarded. |
| Connection states | Strong for endpoint normalization and classification. |
| Road/camera providers | Strong for normalization, validation, freshness, coverage, and provider failure. |
| Chaser Net contracts | Strong for domain/privacy/backend-contract logic; production backend absent. |
| Navigation / rendered controls | Partial; source-level audits exist, but broad automated route walkthrough tests are still needed. |
| Responsive UI | Partial; device QA has covered Android phone and some landscape paths, iPad physical QA pending. |

## Priority Matrix

### P0 - Broken / Core Reliability

| Item | Size | Why it matters | Prerequisite |
| --- | --- | --- | --- |
| iOS/Windows secure credential runtime adapters | Medium | Completes the cross-platform credential boundary beyond Android. | macOS/Xcode and Windows host validation. |
| Keep MARK/ESCAPE map-only | Small | Prevents accidental operational actions outside the map context. | Fixed; keep regression guard. |
| External Spotter Network provider-policy review | Medium | Avoids unsafe or unauthorized operational submissions and clarifies third-party terms. | Product policy and integration agreement review. |

Resolved during root-cause QA: the suspected persistent Chase foreground notification was a
Samsung/Android notification archive record, not an active notification. The active service and
active notification teardown passed repeat S24 acceptance without native code changes.

### P1 - Needed for Field Usability

| Item | Size | Why it matters | Prerequisite |
| --- | --- | --- | --- |
| Full rendered control walkthrough automation | Medium | Source audit is not enough for every route/control and every device posture. | Stable Playwright/ADB route harness. |
| Dedicated System diagnostics route or clearer Operations/System split | Medium | Field failures need a predictable place for status and diagnostics. | Current connection/provider diagnostic contracts. |
| Telemetry zero/default display audit | Small | Avoids mistaking unavailable hardware values for real readings. | Existing telemetry freshness state. |
| Weather/fallback freshness polish | Medium | Chasers need to know whether weather data is current, stale, or unavailable. | Existing fallback/provider timestamps. |
| Expand road/camera providers to OK/KS/MO | Medium | Current Arkansas-only coverage leaves core chase territory uncovered. | Existing provider registry. |

### P2 - Major Planned Capability

| Item | Size | Why it matters | Prerequisite |
| --- | --- | --- | --- |
| CodeBlack-Core provider proxy/cache | Large | Reduces client CORS/rate-limit exposure and improves offline/stale behavior. | Core API contract. |
| Chaser Net v0.2 production backend/admin workflow | Very Large | Moves screened network from contract foundation to real operations. | Credential/security pass and backend deployment decision. |
| Mobile Mesonet v0.1 | Large | Adds hardware-agnostic live weather node ingest and QC metadata. | Instrument schema and Core/Pi transport plan. |
| ESCAPE routing engine | Very Large | Turns context foundation into actual emergency egress support. | Routing provider, road hazards, safety policy. |
| AI/Project One operational assistant | Large | Requires trustworthy data/tool contracts before field use. | Weather/telemetry/radar/tool stabilization. |

### P3 - Future / Optional

| Item | Size | Why it matters | Prerequisite |
| --- | --- | --- | --- |
| GOES/GLM/HRRR/RAP/soundings | Very Large | Major weather-analysis capability beyond current mosaic radar. | Data ingestion and UI model strategy. |
| Windows packaging | Medium | Supports chase vehicle PC/ops desk use. | Desktop persistence and external GPS adapter decisions. |
| CarPlay / Android Auto | Very Large | Companion surfaces only after core field app and navigation mature. | Navigation and safety review. |
| Native Level II restoration | Large | Advanced radar product family remains deferred by product direction. | Decoder/UI product decision. |

## Recommended Next Five Passes

1. **Rendered Control Walkthrough Automation** - build a repeatable route/control QA harness for Android WebView and desktop web so future audits are evidence-based rather than source-only.
2. **System Diagnostics and Field Status Polish** - make System/Operations status clearer, reduce fake-green risk, and surface provider/Core/Pi/GPS freshness in one consistent model.
3. **iOS/Windows Secure Credential Adapter Validation** - complete native Keychain and Windows Credential Manager runtime paths behind the shared credential interface.
4. **Road/Camera Regional Expansion** - add Oklahoma, Kansas, and Missouri provider adapters behind the existing registry, with coverage and attribution documented per provider.
5. **Weather/Telemetry Freshness Stabilization** - harden current conditions, telemetry default/zero states, and stale hardware/provider behavior before new model/satellite products.

## Deferred Systems

The following remain intentionally deferred and should not be represented as complete:

- Chaser Net production backend/auth/realtime deployment
- Mobile mesonet production ingestion
- Probe production ingestion
- GOES, GLM, HRRR, RAP, soundings
- Production navigation and ESCAPE routing
- CarPlay and Android Auto
- Windows packaging
- Native Level II REF/VEL/SRV/CC product switching
