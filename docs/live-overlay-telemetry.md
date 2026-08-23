# Live Overlay Telemetry v0.1

Live Overlay Telemetry is an ephemeral latest-state feed from Code Black OPS to CodeBlack-Core for
OBS/browser overlays. It is separate from local Chase Tracking and separate from Chaser Net
presence.

## Boundaries

- Local Chase Tracking still owns local session state, breadcrumbs, MARK, and native/background
  tracking.
- Live Overlay Telemetry publishes only the current chase vehicle state needed by an overlay.
- Chaser Net presence remains a separate privacy-controlled network feature and is never enabled by
  this setting.
- No breadcrumb history is uploaded or replayed by this feature.

## Client Settings

The app exposes `Share Live Overlay Telemetry` in Settings. It defaults to off.

Required configuration:

- CodeBlack-Core endpoint
- station ID, defaulting centrally to `CBWX-001`
- station token

If enabled without those values, the UI reports `NOT CONFIGURED`. The station token is a v0.1
configuration secret stored with the same device preference mechanism as existing Pi command
tokens. Production deployments should move it behind platform secure storage:

- iOS Keychain
- Android Keystore
- Windows Credential Manager

## Payload

`POST /api/telemetry/live/location`

```json
{
  "stationId": "CBWX-001",
  "sessionId": "chase-20260822180000-test",
  "timestamp": 1787421600000,
  "latitude": 36.18,
  "longitude": -94.12,
  "accuracyM": 8,
  "speedMps": 14,
  "headingDeg": 224,
  "altitudeM": 390,
  "source": "CODEBLACK_OPS"
}
```

Optional fields are omitted when unavailable. The client reads from the shared location tracking
status and does not call Android native tracking services directly.

## Publishing Policy

The publisher is active only when all are true:

- overlay sharing is enabled
- endpoint, station ID, and station token are configured
- Chase Mode is active
- a current shared location observation exists

Cadence is centralized:

- minimum interval: 2.5 seconds
- maximum interval: 5 seconds
- movement trigger: 10 meters
- heading trigger: 15 degrees
- packet age cutoff: 30 seconds

Newest state wins. The client does not queue histories, backfill missed locations, or replay stale
packets after reconnect. If offline movement occurs, the overlay jumps to the newest current
position when connectivity returns.

## Core Contract

The repository now includes a fetch-style Core handler contract in
`src/services/liveOverlayTelemetryCore.ts` that CodeBlack-Core can mount:

- `POST /api/telemetry/live/location` for authenticated ingest
- `GET /api/telemetry/live/{stationId}` for latest-state overlay reads

The latest-state store is station keyed and multi-station ready. It rejects:

- unauthenticated requests
- unknown stations
- invalid coordinates
- malformed or oversized payloads
- stale/future timestamps
- NaN or infinite numeric values
- older packets overwriting newer station state

## Freshness

Server freshness is based on telemetry timestamps:

- `live`: 0-10 seconds
- `aging`: 10-30 seconds
- `stale`: 30-90 seconds
- `offline`: older than 90 seconds or no state

The server retains only latest state per station for v0.1. Persistent location history remains
deferred and must not be created accidentally by this overlay path.

## Overlay Read Path

`GET /api/telemetry/live/{stationId}` returns a sanitized latest-state snapshot:

- station ID/name
- session ID
- location
- speed/heading/accuracy when supplied
- telemetry age
- freshness state

No tokens, auth headers, unrelated telemetry, or breadcrumb history are returned. WebSocket/SSE
delivery is not implemented in this repository because no Core realtime server is present here.
OBS/browser overlays can use bounded polling of the read endpoint until Core adds realtime push.

## Failure Behavior

Overlay publish failures are isolated:

- Chase Mode continues
- local breadcrumbs continue
- MARK continues
- radar/map continue
- stale packets are dropped
- retries use bounded backoff

## Deferred

- Production Core deployment and route mounting
- secure credential storage
- overlay frontend graphics
- WebSocket/SSE push
- fleet management UI
- public tracker site
- breadcrumb history upload
