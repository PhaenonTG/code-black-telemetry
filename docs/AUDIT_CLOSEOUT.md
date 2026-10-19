# Code Black OPS Audit Closeout

Date: 2026-08-23

Baseline reviewed: `34a0597 — Merge native walkthrough hardening`

Decision: **AUDIT REMEDIATION COMPLETE FOR CURRENTLY TESTABLE SCOPE**

This closeout reconciles the original full-app audit against the current repository. It is an
engineering audit-readiness decision for the current shared app and accepted Android/S24 path. It
does not certify App Store, Play Store, all-OEM Android, iOS runtime, Windows runtime, or real
Pi/ESP field-node acceptance.

## Remediation Timeline

| Commit | Scope |
| --- | --- |
| `a8f376f` | Original full-app evaluation and MARK/ESCAPE map-only correction. |
| `ad74627` | Credential and Spotter submission hardening accepted into master. |
| `30451f7` | Rendered route/control walkthrough automation accepted into master. |
| `abb8154` | Credential hardening completion and iOS Keychain source adapter accepted into master. |
| `97e9a58` | Telemetry/weather data integrity accepted into master. |
| `3b4f1c1` | System/Operations diagnostics remediation accepted into master. |
| `34a0597` | Native S24 walkthrough hardening accepted into master. |

## Closed P0 Items

| Finding | Status | Evidence |
| --- | --- | --- |
| Spotter Network, Pi/BLE, and Live Overlay credentials must not live in ordinary Preferences/plain storage | Closed for current Android/testable scope | Shared secure credential boundary, Android Keystore-backed storage, backup exclusions, migration/error visibility, save-order tests, and redacted diagnostics. |
| MARK/ESCAPE appeared outside Locate/map | Closed | Source and rendered/S24 tests assert Locate/map-only placement. |
| External Spotter Network submission boundary needed hardening | Closed as engineering boundary | Explicit submit intent, duplicate guard, `ALREADY_SUBMITTED`, `UNKNOWN` timeout semantics, no auto-submit from MARK/Chase/Chaser Net/overlay. |
| Native Chase notification cleanup concern | Closed | Active-notification checks distinguish live records from Samsung/Android notification archive history; S24 harness validates normal End Chase and force-stop recovery. |

## Closed P1 Items

| Finding | Status | Evidence |
| --- | --- | --- |
| Rendered route/control walkthrough automation missing | Closed | `npm run test:walkthrough` covers routes, controls, responsive viewports, console errors, deferred honesty, and MARK/ESCAPE scope. |
| System/Operations diagnostics were vague | Closed | Operational taxonomy separates transport, observation freshness, disabled/offline, provider unavailable, and outside-coverage states. |
| Telemetry default-zero display risk | Closed for software integrity | Nullable measurement model and tests distinguish valid zero from missing/unavailable data. |
| Weather freshness polish | Closed for current scope | Source timestamps, freshness states, last-known handling, and fallback clearing are documented and tested. |

## Blocked Validation

| Item | Status | Required to revisit |
| --- | --- | --- |
| Real Pi/ESP telemetry packet, malformed packet, and reconnect validation | Blocked | Physical vehicle Pi/ESP hardware connected and safe to exercise. |
| iOS Keychain native runtime validation | Blocked | macOS/Xcode plus iPhone/iPad runtime validation. Current source implementation uses Keychain with `AfterFirstUnlockThisDeviceOnly`; runtime pass is not claimed. |
| Windows secure credential runtime validation | Blocked/deferred | Real Windows native host/adapter path using Windows Credential Manager or equivalent. |

## Deferred Product Expansion

- OK/KS/MO road and public-camera provider expansion.
- Chaser Net production backend/auth/realtime.
- ESCAPE routing engine and full navigation.
- Mobile mesonet production ingest and probes.
- GOES, GLM, HRRR, RAP, soundings, and native Level II radar restoration.
- Windows packaging, CarPlay, and Android Auto.

These are roadmap items, not current audit defects, as long as the app labels unavailable,
deferred, and outside-coverage states honestly.

## External Decisions

Spotter Network production/public use still requires provider-policy, terms, and human approval
review. Current code enforces explicit user intent and safe duplicate handling, but provider-policy
approval cannot be completed by repository changes alone.

## Current Validation Coverage

| Area | Coverage |
| --- | --- |
| Domain/unit tests | Strong for credentials, submission policy, connection states, telemetry/weather integrity, provider normalization, operational status, and shared Chase logic. |
| Rendered web walkthrough | Strong for first-class routes, major controls, map-only MARK/ESCAPE, deferred-state honesty, status examples, and responsive layouts. |
| Physical S24 walkthrough | Strong for accepted SM-S921U / Android 16 path, including route walk, Android Back, Chase service/notification, active-notification cleanup, force-stop recovery, and logcat health. |
| Android native | Accepted on the current S24 path; broader OEM/tablet acceptance requires additional device runs. |
| iOS native | Source/sync only; native runtime validation blocked. |
| Windows native | Architecture boundary only; native credential runtime blocked/deferred. |
| Pi/ESP hardware | Software integrity tested with deterministic fixtures; real hardware field validation blocked. |

## Reopen Conditions

Reopen audit remediation if any of these occur:

- A sensitive credential is stored or logged outside the secure credential boundary.
- MARK or ESCAPE appears outside the Locate/map surface.
- Chase End leaves an active service or active foreground notification on the accepted Android path.
- Missing/stale Weather or Telemetry data renders as live zero/default values.
- Operations/System status conflates transport connectivity with observation freshness.
- External Spotter submission can occur without explicit user action or can duplicate after a known
  successful local submission.
- New platform runtime validation exposes a real iOS, Windows, or Pi/ESP defect rather than an
  expected blocked-validation gap.

## Next Planning Gate

Code Black OPS may proceed to **Visual/UI Improvement planning** after this closeout, provided that
planning does not relabel blocked hardware/platform validation or future product expansion as
closed runtime acceptance.
