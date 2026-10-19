# Credential and External Submission Hardening

This pass moves operational secrets behind one shared credential boundary and tightens the
external Spotter Network report submission path. It does not add new Spotter Network features.

## Secret Inventory

| Credential | Previous location | Current location | Notes |
| --- | --- | --- | --- |
| Spotter Network password | `codeblack.spotterAccount` Preferences payload | `spotter-network.password` secure credential key | Account metadata remains in Preferences; password is not redisplayed. |
| Pi/BLE command token | `codeblack.bleCommandToken` Preferences value | `vehicle-node.command-token` secure credential key | In-memory value is loaded for existing BLE/HTTP command paths. |
| Live Overlay station token | `codeblack.liveOverlayTelemetrySettings.stationToken` Preferences payload | `live-overlay.station-token` secure credential key | Endpoint, enabled state, station ID, and station name remain non-secret settings. |

## Storage Boundary

Shared code uses `src/services/secureCredentials.ts` for `setCredential`, `getCredential`,
`getCredentialStatus`, `deleteCredential`, and `hasCredential`.

The credential keys are allowlisted in `src/services/credentialSecurity.ts`. Unknown keys are
rejected so arbitrary app state cannot drift into the secret store.

### Android

Android uses the custom Capacitor plugin `CodeBlackSecureCredentials`, backed by:

- Android Keystore AES key alias `CodeBlackOpsCredentialKey`
- AES/GCM/NoPadding encryption
- app-private encrypted credential envelopes in `CodeBlackSecureCredentials` SharedPreferences

Raw secrets are no longer stored in Capacitor Preferences. Existing legacy values are migrated
only after a secure write/read verification succeeds. If verification fails, the legacy value is
left in place for a later retry rather than silently deleting the only copy.

`CodeBlackSecureCredentials.xml` is excluded from Android cloud backup and device-transfer
backup rules. The encrypted credential envelopes depend on an app-install/device-scoped Keystore
key and should not be restored without that key.

### iPhone / iPad

The iOS app target now includes `CodeBlackSecureCredentialsPlugin.swift`, a Capacitor adapter
backed by Keychain generic-password items. It uses
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: credentials are unavailable before the first
device unlock after boot and are not synchronized through iCloud Keychain.

Because this pass was performed on Windows, native Xcode compile/runtime validation remains
pending on macOS with an iPhone/iPad. The shared app no longer treats ordinary Preferences as
secure on iOS.

### Web / Development

Web preview uses a memory-only development fallback. It is intentionally not persistent and is
labeled as such in Settings.

## Migration

Migration is scoped to known legacy secret keys only:

- `codeblack.spotterAccount.password`
- `codeblack.bleCommandToken`
- `codeblack.liveOverlayTelemetrySettings.stationToken`

Non-secret settings remain in normal Preferences.

## Logging and Diagnostics

Normal UI and diagnostics report whether credentials are configured, missing, unavailable,
corrupt/needs reauthentication, or read-error. They do not print raw passwords, bearer tokens,
authorization headers, or command tokens. Spotter, BLE, and overlay credential saves now write and
verify secure storage before committing in-memory/account state.

## Spotter Network Submission Boundary

Spotter Network external submission remains a user-initiated action from the Report page. These
actions do not submit externally:

- MARK
- Start Chase
- End Chase
- Chaser Net report/domain actions
- Live Overlay Telemetry
- local report/feed reads

The report path validates coordinates, hazard selection, narrative length, hail size, and wind
speed before sending.

## Duplicate and Timeout Handling

The app keeps a bounded local submission ledger. A report with the same account, hazards,
description, and rounded location cannot be submitted twice from this device after confirmed
success.

Known local duplicates are returned as `ALREADY_SUBMITTED`, not generic `FAILED`, so retry logic
does not confuse a local duplicate block with a network/server failure.

If a request times out after the report may have reached Spotter Network, the same report is marked
`UNKNOWN` and blocked from blind automatic retry. The user must review/change intent before trying
again.

## Deferred

- iOS Keychain compile/runtime validation on macOS/Xcode
- Windows Credential Manager adapter
- provider-approved Spotter Network production integration review
- production Core credential provisioning workflow

