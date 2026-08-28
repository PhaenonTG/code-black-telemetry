# Node Control Contract

This is the platform-neutral contract every controllable Code Black node should converge toward. It is a contract definition only; do not expose dangerous unauthenticated control endpoints.

## Action Vocabulary

Common node actions:

- `STATUS`: current node state, version, uptime, and identity.
- `HEALTH`: health details for critical local capabilities.
- `VERSION`: build/firmware/software version.
- `LOGS`: bounded, sanitized log retrieval.
- `START`: start a service where supported.
- `STOP`: stop a service where supported.
- `RESTART`: restart a service where supported.

ESP-class devices may only support:

- `STATUS`
- `HEALTH`
- `VERSION`
- `REBOOT`

## Node Status

`GET /api/v1/node/status`

```json
{
  "nodeId": "charger-pi",
  "name": "Spencer Charger Pi",
  "status": "online",
  "version": "unknown",
  "uptimeSeconds": 12345,
  "health": "healthy",
  "timestamp": "2026-08-27T00:00:00.000Z"
}
```

Allowed `status` values:

- `online`
- `degraded`
- `offline`
- `unknown`

Allowed `health` values:

- `healthy`
- `warning`
- `critical`
- `unknown`

## Node Health

`GET /api/v1/node/health`

```json
{
  "nodeId": "charger-pi",
  "overall": "warning",
  "checks": [
    {
      "id": "telemetry",
      "status": "healthy",
      "message": "Telemetry packets current",
      "updatedAt": "2026-08-27T00:00:00.000Z"
    },
    {
      "id": "codeblack-core",
      "status": "warning",
      "message": "Core not reachable; local chase operation unaffected",
      "updatedAt": "2026-08-27T00:00:00.000Z"
    }
  ]
}
```

## Services

`GET /api/v1/services`

```json
{
  "nodeId": "charger-pi",
  "services": [
    {
      "id": "telemetry-bridge",
      "displayName": "Telemetry Bridge",
      "state": "running",
      "health": "healthy",
      "startupType": "systemd",
      "remoteControlEligible": true,
      "criticality": "chase-critical"
    }
  ]
}
```

Service actions:

```text
POST /api/v1/services/{id}/start
POST /api/v1/services/{id}/stop
POST /api/v1/services/{id}/restart
```

Example action response:

```json
{
  "requestId": "01J7CONTROL0001",
  "serviceId": "telemetry-bridge",
  "action": "restart",
  "accepted": true,
  "state": "restarting",
  "message": "Restart requested",
  "requiresConfirmation": false,
  "auditId": "audit-unknown"
}
```

## Logs

`GET /api/v1/services/{id}/logs?limit=100`

```json
{
  "serviceId": "telemetry-bridge",
  "entries": [
    {
      "timestamp": "2026-08-27T00:00:00.000Z",
      "level": "info",
      "message": "Telemetry bridge heartbeat"
    }
  ],
  "truncated": false
}
```

Log responses must be bounded, sanitized, and free of secrets.

## Security Requirements

- Authentication required for all control actions.
- Authorization required per action and node.
- Audit log required for start/stop/restart/reboot.
- Destructive or disruptive actions require confirmation.
- Public unauthenticated reboot/control endpoints are forbidden.
- Read-only status may still require authentication outside trusted local development.
