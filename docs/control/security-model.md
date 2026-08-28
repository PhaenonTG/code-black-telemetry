# Control-Plane Security Model

Remote control changes the risk profile of Code Black. Authentication and authorization must exist before dangerous actions are implemented.

## Principles

- Authenticate every control session.
- Authorize by action, node, and role.
- Use TLS where appropriate.
- Treat LAN, Tailscale, and public internet as distinct trust boundaries.
- Do not expose public unauthenticated reboot, stop, restart, stream, or token endpoints.
- Do not commit secrets.
- Use least privilege for service accounts and systemd permissions.
- Audit every control action.
- Require confirmation for destructive or disruptive actions.
- Store tokens and credentials in platform secure storage where available.
- Use device identity for nodes and clients.
- Sanitize logs and diagnostics before returning them to clients.

## Trust Boundaries

Local vehicle network:

- Useful for fallback control.
- Not automatically safe for destructive unauthenticated actions.

Tailscale:

- Stronger network identity than open LAN.
- Still not a replacement for application-level authorization.

CodeBlack-Core:

- Primary remote control authority when online.
- Must not become a local chase dependency.

Public internet:

- No direct unauthenticated node control.
- Public website must not expose private telemetry or control APIs.

## Credential Handling

- Android: use Android Keystore-backed credential plugin for sensitive OPS secrets.
- iOS/iPadOS: use Keychain adapter after native validation.
- Web preview: avoid storing sensitive control secrets in localStorage.
- Server-side tokens: keep in server/runtime configuration, never committed.
- Diagnostics: never print bearer tokens, command tokens, database passwords, service-role keys, or raw secret-bearing payloads.

## Audit Event Shape

```json
{
  "auditId": "audit-unknown",
  "timestamp": "2026-08-27T00:00:00.000Z",
  "actorId": "user-unknown",
  "clientId": "device-unknown",
  "nodeId": "charger-pi",
  "serviceId": "telemetry-bridge",
  "action": "restart",
  "result": "accepted",
  "sourceIpClass": "tailscale"
}
```

## Blocked Until Security Exists

- Remote Pi reboot
- Service start/stop/restart endpoints
- Stream start/stop endpoints exposed outside trusted native app flow
- Log retrieval that can leak tokens or locations
- Fleet-wide control actions
