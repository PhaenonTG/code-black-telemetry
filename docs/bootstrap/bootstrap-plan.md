# Bootstrap Plan

Bootstrap must be modular. Do not create one giant script that tries to configure every platform and device.

## Proposed Structure

```text
scripts/
  bootstrap/
    shared/
    windows/
    linux/
    raspberrypi/
    macos/
```

## Modules

- prerequisites
- node
- networking
- radar
- telemetry
- streaming
- tailscale
- mediamtx
- ffmpeg
- android
- ios
- qa
- diagnostics

## Future Commands

```text
codeblack bootstrap charger
codeblack bootstrap core
codeblack bootstrap producer

codeblack status
codeblack doctor
codeblack update
codeblack validate
```

## Profiles

Bootstrap commands should read `config/system/profiles.yaml` and resolve the relevant node/service manifests.

Examples:

- `charger`: Raspberry Pi OS prerequisites, service users, telemetry bridge, BLE bridge, streaming stack, Tailscale, logging, health endpoints.
- `core`: central ingest/control/archive services, auth, TLS, database/storage, stream relay.
- `producer`: Windows OBS/diagnostics/build tooling, development dependencies, browser QA tools.

## Rules

- Every module must be idempotent where practical.
- Every destructive step must require explicit confirmation.
- No secrets in source control.
- Dry-run mode required before live orchestration.
- Logging must avoid credentials.
- Platform-specific implementation stays under its platform folder.
- Shared schema/validation stays under `shared/`.
- Unknown Pi/Core service names must be discovered before writing executable bootstrap steps.

## First Implementation Slice

1. Add schema validation for `config/system/*.yaml`.
2. Add a read-only `codeblack status` command that prints manifests.
3. Add `codeblack doctor --offline` that evaluates only static manifests.
4. Add live checks one node at a time after authentication and node contracts exist.
