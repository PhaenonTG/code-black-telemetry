# Code Black Control API Contract

This document defines the future control-plane API. It is not an implementation plan for this sprint.

## API Groups

- `/api/v1/system`
- `/api/v1/nodes`
- `/api/v1/services`
- `/api/v1/capabilities`
- `/api/v1/telemetry`
- `/api/v1/streams`
- `/api/v1/readiness`
- `/api/v1/events`

## System

`GET /api/v1/system`

```json
{
  "systemId": "code-black",
  "name": "Code Black OPS",
  "mode": "local",
  "version": "unknown",
  "generatedAt": "2026-08-27T00:00:00.000Z"
}
```

## Nodes

`GET /api/v1/nodes`

Returns the node inventory plus live status when available.

```json
{
  "nodes": [
    {
      "id": "charger-pi",
      "displayName": "Spencer Charger Pi",
      "type": "raspberry-pi",
      "status": "unknown",
      "health": "unknown",
      "roles": ["telemetry", "streaming", "vehicle-control"]
    }
  ]
}
```

## Services

`GET /api/v1/services`

Returns canonical service inventory plus live state when available.

```json
{
  "services": [
    {
      "id": "pi-http-telemetry-api",
      "node": "charger-pi",
      "state": "unknown",
      "health": "unknown",
      "criticality": "important",
      "remoteControlEligible": true
    }
  ]
}
```

Control endpoints should follow `docs/control/node-contract.md`.

## Capabilities

`GET /api/v1/capabilities`

Answers what Code Black can do and which systems provide each capability.

```json
{
  "capabilities": [
    {
      "id": "vehicle-gps",
      "criticality": "critical",
      "state": "degraded",
      "primaryProvider": "navigation-esp",
      "activeProvider": "tablet-gps",
      "offlineCapable": true
    }
  ]
}
```

## Telemetry

`GET /api/v1/telemetry/latest`

Returns the latest normalized vehicle telemetry.

`GET /api/v1/telemetry/events`

Returns bounded telemetry/control events.

WebSocket option:

```text
GET /api/v1/telemetry/stream
```

The stream should emit normalized snapshot or patch messages. The UI should not know whether data came from REST polling or WebSocket push.

## Streams

`GET /api/v1/streams`

```json
{
  "camera": {
    "state": "unknown",
    "resolution": null,
    "fps": null
  },
  "targets": [
    {
      "id": "knwa",
      "state": "off",
      "desiredOn": false
    },
    {
      "id": "code-black",
      "state": "off",
      "desiredOn": false
    },
    {
      "id": "recording",
      "state": "off",
      "desiredOn": false
    }
  ]
}
```

Control actions must be authenticated and audited.

## Readiness

`GET /api/v1/readiness`

Do not return fake precision. Scores are allowed only after real scoring logic exists.

```json
{
  "overall": "CHASE_CAPABLE",
  "criticalFailures": [],
  "warnings": [
    "CodeBlack-Core offline",
    "Streaming unavailable"
  ],
  "localChaseCapable": true,
  "evaluatedAt": "2026-08-27T00:00:00.000Z"
}
```

Allowed readiness values:

- `READY`
- `CHASE_CAPABLE`
- `DEGRADED`
- `NOT_READY`

Optional service failures must not automatically produce `NOT_READY`.

## Events

`GET /api/v1/events`

```json
{
  "events": [
    {
      "id": "event-unknown",
      "timestamp": "2026-08-27T00:00:00.000Z",
      "source": "control-plane",
      "level": "info",
      "message": "System inventory loaded"
    }
  ]
}
```

Events should include status changes, control actions, readiness changes, and sanitized service faults.
