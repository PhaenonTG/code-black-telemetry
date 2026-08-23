# Code Black OPS App Evaluation

Date: 2026-08-23

Branch: `work/final-audit-reconciliation`

Baseline: `34a0597 — Merge native walkthrough hardening`

This evaluation is a product-readiness inventory of the current Code Black OPS field app. It is
intentionally critical: contract-only systems are not counted as production-ready, fixture or
coverage-limited data is called out, and deferred systems remain deferred.

## Final Audit Closure Decision

**Decision:** AUDIT REMEDIATION COMPLETE FOR CURRENTLY TESTABLE SCOPE.

The original P0/P1 audit findings have been reconciled against current master. No remaining
actionable P0 code defect is open for the currently testable Android/shared-app scope. Remaining
items are either blocked validation, external provider/policy decisions, or future product
expansion.

This is an engineering audit-readiness decision, not an App Store, Play Store, public safety, or
all-platform production certification.

## Closed Audit Items

| ID | Finding | Original priority | Current status | Evidence |
| --- | --- | --- | --- | --- |
| P0-01 | Secure credential storage and backup policy for Spotter Network password, Pi/BLE command token, and Live Overlay station token | P0 | Closed for Android/current testable scope | Shared credential boundary, Android Keystore-backed adapter, encrypted credential backup exclusions, write-before-state ordering, redacted read/migration diagnostics, and secure-token tests are present. |
| P0-02 | MARK and ESCAPE appeared outside the map context | P0 | Closed | MARK no longer renders as a user-facing control. ESCAPE renders only inside the Map surface and is guarded by rendered and S24 walkthrough assertions. |
| P0-03 | External Spotter Network submission boundary needed review | P0 | Closed as engineering boundary | Submission requires explicit user action, duplicate local submissions use `ALREADY_SUBMITTED`, ambiguous timeout is not treated as safe retry, and MARK/Chase/Chaser Net/overlay paths do not auto-submit. Provider-policy approval remains external. |
| P0-04 | Native Android Chase notification cleanup concern | P0 blocker during remediation | Closed | S24 root-cause work distinguishes active notifications from Samsung/Android archive records. The native harness checks active notification/service state and force-stop recovery. |
| P1-01 | Rendered full-control walkthrough automation missing | P1 | Closed | Playwright walkthrough covers first-class routes, Home customization, major controls, console errors, responsive viewports, MARK UI absence, Map-only ESCAPE scope, deferred honesty, Settings, layers, report, and shared Chase UI. |
| P1-02 | System/Operations status was too vague | P1 | Closed | Shared operational taxonomy separates transport health, data freshness, disabled/offline, outside coverage, and provider unavailable states. |
| P1-03 | Telemetry default-zero display risk | P1 | Closed for software integrity | Nullable measurement model, valid-zero tests, stale/missing states, and rendered checks prevent missing data from rendering as live zero. |
| P1-04 | Weather freshness polish | P1 | Closed for current scope | Weather values now preserve timestamps/source/freshness and clear stale fallback when GPS/location is unavailable. |

## Blocked Validation Items

| ID | Item | Status | Required to revisit |
| --- | --- | --- | --- |
| BLK-01 | Real Pi/ESP telemetry packet and disconnect/reconnect field validation | Blocked | Connected Pi/ESP vehicle hardware and safe field-node test window. |
| BLK-02 | iOS Keychain native runtime validation | Blocked | macOS/Xcode plus iPhone/iPad runtime validation. Source implementation and Capacitor sync are present; runtime acceptance is not claimed. |
| BLK-03 | Windows secure credential runtime validation | Blocked/deferred | A real Windows native host/adapter path using Windows Credential Manager or equivalent. |

## Deferred / Future Product Work

- OK/KS/MO road and camera provider expansion is a product expansion, not a defect, while the UI
  honestly reports Arkansas-only v0.1 coverage and `OUTSIDE COVERAGE`.
- Chaser Net production backend, ESCAPE routing, mobile mesonet production ingest, probes, GOES,
  GLM, HRRR, RAP, soundings, native Level II radar restoration, Windows packaging, CarPlay, and
  Android Auto remain deferred roadmap work.
- iPhone/iPad runtime acceptance remains platform-release work until native device validation is
  available.

## External Decisions

- Spotter Network production/public use still needs provider-policy, terms, and human approval
  review. No engineering vulnerability is currently identified in the explicit-submission boundary,
  but this decision cannot be closed by code alone.

## Executive Findings

- The active phone app shell now exposes five primary dock destinations: Home, Map, Weather,
  Alerts, and More. Operations, Report, Layers, and Settings remain reachable under More. System
  diagnostics are embedded in Operations/Settings rather than exposed as a separate primary route.
  AI, Fleet, and full System pages are not currently first-class reachable routes.
- MARK is no longer rendered as a visible normal-UI control, but the internal MARK service pathway
  remains preserved for future approved workflows. ESCAPE is now visually inside the Map surface and
  preserves its context/deferred-routing behavior.
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
- Credential storage and external Spotter Network submission P0 findings now have a completion
  remediation pass: Android secure credential storage, backup exclusion, write-before-state
  ordering, redacted read/migration diagnostics, explicit submission intent, duplicate guards, and
  unknown-timeout handling exist. iOS Keychain source adapter is implemented; native Xcode/device
  runtime validation remains pending. Windows Credential Manager remains pending.
- The rendered-control automation gap now has a first remediation pass: Playwright coverage checks
  first-class routes, Home configuration, major controls, MARK UI absence, Map-only ESCAPE placement, deferred-state honesty, console
  errors, and phone/tablet/desktop layout structure. Physical S24 native Chase acceptance remains a
  separate device workflow.
- Weather/Telemetry integrity now distinguishes valid physical zero from missing or unavailable
  sensor data. Pi power/system fields are nullable, partial packets no longer inherit old values as
  fresh, and stale external weather fallback clears when GPS/location is lost.
- System/Operations diagnostics now use a shared operational taxonomy. Pi transport, telemetry
  freshness, sensor-service state, disabled overlay state, provider error, and outside-coverage
  states are represented separately.
- Native Chase startup reconciliation now persists a stored-active/no-running-service state as
  inactive and cancels the chase notification; the S24 walkthrough covers force-stop while active
  through relaunch reconciliation.
- The largest remaining readiness risks are iOS/Windows credential runtime validation, real Pi/ESP
  field-node validation, broad provider coverage gaps, and Android automation portability beyond
  the accepted S24/Android 16 path.

## Route Inventory

| Surface | Reachable | Classification | Notes |
| --- | --- | --- | --- |
| Home / Field Overview | Yes | Working / needs polish | Primary phone landing page with modular Chase, radar, weather, alerts, system, and location cards. Module visibility/order/size persists in normal non-secret settings. |
| Weather | Yes | Working / needs polish | Detailed weather page; some data is provider/hardware dependent and must keep age/status visible. |
| Operations | Yes | Working / needs polish | Holds Core/Pi/streaming/status diagnostics and actions. Pi transport and telemetry freshness are now shown separately; some commands require BLE token and live vehicle node. |
| Map | Yes | Working / needs polish | Primary map/radar surface with mosaic radar, own vehicle, trail, road/camera providers, Spotter Network pins, and in-map ESCAPE. `/locate` remains a compatibility alias. |
| Alerts | Yes | Partial | NWS/SPC products are displayed where available; should keep official alert styling separate from OPS notices and Chaser Net reports. |
| Report | Yes | Partial / security-sensitive | Spotter Network report submission path exists but requires credentials and external service availability. Not a Chaser Net production report flow. |
| Settings | Yes | Working / needs polish | Large but functional; many controls persist and are consumed. Some hardware/network controls depend on external configuration. |
| Layers | Yes, through More | Working / needs polish | Layer readiness is mostly honest; provider-backed road/camera layers coexist with disabled/deferred probes and Chaser Net. Rows now use standardized glyphs/source/status summaries. |
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
| Broken | Historical MARK/ESCAPE global availability is closed. MARK visible UI is now absent by product decision; ESCAPE is Map-only. |
| Partial | Spotter Network report submission, Pi/BLE command controls, streaming controls, road/camera provider coverage, Chaser Net panels. |
| Placeholder/deferred | Probes, production Chaser Net backend/realtime, ESCAPE routing, AI route, Fleet route, GOES/GLM/HRRR/RAP/soundings, CarPlay, Android Auto, Windows packaging. |
| Misleading risk | Hardware-dependent systems still require real Pi/ESP field validation; Spotter Network credentials may look like a normal production login/storage flow. |

## System Readiness

| System | Status | Evidence / Limits |
| --- | --- | --- |
| Core app shell | Working / needs polish | Seven-page dock shell and swipe navigation are implemented. Route model is custom, not router-based. |
| Navigation | Working / needs polish | Dock/page dots and Android Back handling exist. Back closes expanded map and modals first. `/system` alias to Operations should be made explicit. |
| Dashboard | Working / needs polish | Useful field data composition; key weather/telemetry values now distinguish live, stale, and unavailable states, but the cockpit remains dense. |
| Settings | Working / needs polish | Functional and persisted controls exist. Security-sensitive controls now mask saved secrets and use the shared credential boundary where supported. |
| Themes/display | Ready / working | Dark, Light, Night, System and display/keep-awake abstractions exist. |
| Chase Mode | Ready on Android; platform foundation elsewhere | Physical S24 lifecycle was reaccepted from a clean reboot state. Start/End cycles leave no active `ChaseTrackingService` and no active notification key after End Chase. Current QA uses active service/notification/map usability rather than visible MARK as lifecycle proof. Force-stop-while-active reconciliation now clears stored active state and active notification if native tracking cannot be restored. Samsung notification archive records may remain in `dumpsys` history and should not be treated as active leaks. iOS remains future native adapter work. |
| GPS/location state | Working / needs polish | Shared normalized states exist and rendered tests preserve missing heading versus valid stationary speed. |
| MARK | Internal capability preserved; visible UI removed | Immediate capture, duplicate guard, session association, and bounded persistence exist behind the service pathway. Normal user-facing MARK control is intentionally not rendered. |
| ESCAPE | Foundation only | Context/readiness path exists inside the Map surface; production routing is not active and must remain honestly labeled. |
| Mosaic radar | Working / needs polish | Active radar experience. Static `LIVE` wording was removed where tile freshness is not directly known. Mapbox/token/network availability still affects runtime. |
| Road Conditions | Partial live v0.1 | Provider-backed with Arkansas DOT IDrive coverage only. Uses viewport filtering, provenance, validation, cache, stale fallback, and outside-coverage state. |
| Public Cameras | Partial live v0.1 | Arkansas DOT IDrive public cameras only. Static PNG snapshots load on detail, not for every marker; protected HLS feed URLs are not advertised as playable streams when direct clients receive provider denial. Outside-coverage is distinct from provider failure. |
| Spotter Network layer | Partial / external dependency | Public/authenticated Spotter Network feeds are external and non-commercial-use constrained. Not Code Black Chaser Net. |
| Reports layer/feed | Partial | NWS/Spotter reports are distinct from Chaser Net production reports. External submission requires caution. |
| Probes | Foundation only | Layer model/visual language exists, production ingest absent. |
| Weather | Working / needs polish | Current conditions distinguish vehicle, last-known, external fallback, simulator, and unavailable states. Missing values render unavailable rather than default zero; forecast/model systems remain deferred. |
| Telemetry | Working / needs polish | BLE/HTTP/last-known hybrid exists. Power/system fields are nullable, partial packets preserve missing fields, valid zeros are covered by tests, and operations diagnostics separate transport from stale data. Real Pi/ESP payload validation remains pending. |
| Core/Pi connectivity | Working / needs polish | Shared connection model, endpoint normalization, testing, backoff, freshness, and diagnostics exist. Real Core/Pi services are external. Transport connectivity no longer implies telemetry is live. |
| Live overlay telemetry | Foundation / partial | Shared client publisher, authenticated Core contract, latest-state store, Settings status, secure station-token boundary, and explicit disabled/not-configured/offline labels exist. Production Core deployment and realtime overlay push remain pending. |
| Alerts | Partial | Official NWS/SPC surfaces exist. Needs continued separation from OPS notices and Chaser Net observations. |
| AI | Not started / deferred | No primary route found. Project One/radar reasoning not implemented. |
| Chaser Net | Foundation only | Contracts, in-memory service, applications/review, privacy, roles, audit, and UI status exist. Production backend/auth/realtime absent. |
| Storage/persistence | Working / needs platform validation | Settings, sessions, breadcrumbs, MARK, endpoints, provider cache, and Spotter state persist. Spotter/Pi/overlay secrets use Android Keystore-backed storage with backup exclusion. iOS Keychain adapter source exists but needs Mac/device validation. Windows native secure-store adapter remains pending. |
| Error handling | Partial | Error boundary exists and provider/service fallbacks exist. Operational diagnostics now use safer categories for coverage, disabled state, stale data, and provider availability; deeper native/provider error UX remains future work. |
| Performance | Working / needs monitoring | Map layers use memoization/cache/deduping; polling exists for telemetry/providers and should be watched on mobile battery. |

## Platform Readiness

| Platform | Status | Notes |
| --- | --- | --- |
| Android phone/tablet | Working / accepted core | Native Chase Tracking, mosaic radar, Map-only ESCAPE, MARK UI absence, and cleanup have physical S24/rendered acceptance. |
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
  password, Pi/BLE command token, and Live Overlay station token migrate to the shared credential
  store. Android runtime path is Keystore-backed and excludes encrypted credential envelopes from
  backup. iOS Keychain source is present but runtime validation is still pending.

## Security and Privacy Concerns

1. iOS Keychain adapter needs native Xcode/device runtime validation, and Windows Credential
   Manager adapter remains unimplemented before broader cross-platform distribution.
2. Spotter Network external submission is now explicitly user-triggered, validated, and locally
   guarded against duplicate/unknown-timeout resubmission, but provider-policy review remains
   required before production/public use.
3. Android encrypted credential envelopes are excluded from backup; non-secret app-data backup
   policy still deserves a separate product decision.
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
| Connection states | Strong for endpoint normalization, classification, and transport-versus-data freshness semantics. |
| Road/camera providers | Strong for normalization, validation, freshness, coverage, and provider failure. |
| Chaser Net contracts | Strong for domain/privacy/backend-contract logic; production backend absent. |
| Navigation / rendered controls | Working / needs expansion | `npm run test:walkthrough` renders first-class routes across phone portrait, tablet landscape, and desktop; checks MARK/ESCAPE map-only placement, layer popovers, Settings/report states, shared Chase UI, console errors, and basic overflow. `npm run test:walkthrough:s24` now adds native S24 route/control, Android Back, Chase service, active notification, force-stop recovery, screenshot/hierarchy, and logcat evidence. |
| Weather/telemetry integrity | Working / needs field-node validation | Domain and rendered tests cover missing vs valid-zero, stale/missing measurement semantics, nullable Pi power/system values, and external fallback clearing when GPS is unavailable. |
| System/Operations diagnostics | Working / needs field-node validation | Domain and rendered tests cover connected transport with stale telemetry, disabled overlay state, outside provider coverage, Settings diagnostics, and Operations summary wording. |
| Responsive UI | Partial; device QA has covered Android phone and some landscape paths, iPad physical QA pending. |

## Priority Matrix

### P0 - Broken / Core Reliability

No remaining actionable P0 code defect is open for the currently testable scope.

| Item | Current classification | Notes |
| --- | --- | --- |
| iOS Keychain runtime validation | Blocked validation | Source adapter exists and syncs; native runtime acceptance requires macOS/Xcode/iPhone or iPad. |
| Windows secure credential runtime validation | Blocked/deferred platform validation | Shared boundary exists; native Windows adapter/host path is not yet a current app runtime. |
| Keep MARK/ESCAPE map-only | Closed | Source, rendered walkthrough, and S24 walkthrough guard the map-only rule. |
| External Spotter Network provider-policy review | External decision | Engineering boundary is closed; provider terms/permission review remains a product/legal decision. |

Resolved during root-cause QA: the suspected persistent Chase foreground notification was a
Samsung/Android notification archive record, not an active notification. The active service and
active notification teardown passed repeat S24 acceptance without native code changes.

### P1 - Needed for Field Usability

| Item | Size | Why it matters | Prerequisite |
| --- | --- | --- | --- |
| Android walkthrough portability beyond accepted S24 | Small | Productive follow-up, but not an open audit defect. Other Android OEMs/tablets need run evidence before being called accepted. | Current ADB/WebView/UIAutomator harness. |
| Real Pi/ESP telemetry payload validation | Medium | Blocked field validation. Confirms the hardened parser against actual field-node BLE/HTTP packets, reconnects, and malformed packets. | Access to the vehicle Pi/ESP stack. |
| Weather/telemetry UI detail polish | Small | Optional polish. Per-field age/QC detail could make partial packets even clearer without cluttering the main cockpit view. | Current nullable measurement model. |
| Expand road/camera providers to OK/KS/MO | Medium | Product expansion. Current Arkansas-only coverage is acceptable when represented honestly as coverage-limited. | Existing provider registry. |

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

1. **Native Device Walkthrough Automation Hardening** - expand the S24 helper into a more robust UIAutomator/DevTools hybrid for route walking, screenshots, Back behavior, and Chase service evidence.
2. **iOS Keychain Runtime + Windows Credential Adapter Validation** - verify Keychain on Mac/iPhone/iPad and implement the Windows Credential Manager adapter behind the shared credential interface.
3. **Real Pi/ESP Telemetry Field Validation** - run the hardened parser against the live vehicle node, disconnect/reconnect sensors, and capture malformed-packet behavior before mobile mesonet production work.
4. **Road/Camera Regional Expansion** - add Oklahoma, Kansas, and Missouri provider adapters behind the existing registry, with coverage and attribution documented per provider.
5. **Spotter Network Provider-Policy Review** - confirm terms, credentials, and allowed external-submission behavior before treating Spotter submission as production-ready.

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
