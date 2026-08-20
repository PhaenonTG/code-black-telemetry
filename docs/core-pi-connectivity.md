# Core / Pi Connectivity

Code Black OPS treats CodeBlack-Core and the Raspberry Pi vehicle node as separate providers. The
shared app must not show a green state just because an endpoint is configured or a UI component
rendered. Connection reachability, service health, and telemetry freshness are separate facts.

## Shared Status Model

The shared connection contract lives in `src/services/connection.ts`.

States:

- `NOT_CONFIGURED`: no endpoint or provider is available.
- `CONNECTING`: a bounded request or reconnect attempt is in progress.
- `CONNECTED`: the endpoint has recent successful evidence.
- `DEGRADED`: the endpoint responded or a fallback is active, but the data path is not fully healthy.
- `STALE`: last-known data exists, but its timestamp is outside the freshness policy.
- `DISCONNECTED`: configured provider is currently unreachable.
- `ERROR`: configured provider failed in a way that needs user or operator attention.

Common status fields include endpoint, transport, last attempt, last success, last data timestamp,
data age, latency, failure count, sanitized error code/summary, and next retry time.

## Endpoint Policy

User-entered Core/Pi endpoints are normalized before save/test:

- `192.168.4.1:8000` becomes `http://192.168.4.1:8000`.
- `http://192.168.4.1:8000`, `.local` hostnames, Tailscale hostnames/IPs, and HTTPS endpoints are
  accepted when structurally valid.
- trailing slashes are removed for stable request construction.
- query strings and fragments are not part of the stored base endpoint.
- unsafe schemes such as `javascript:`, `file:`, and `data:` are rejected.
- credential-bearing URLs are rejected so secrets are not stored or echoed in diagnostics.

HTTP is intentionally allowed for explicit local field-network and Tailscale endpoints. This is not
a blanket certificate-bypass policy and does not add global transport downgrades.

## Retry And Freshness

Automatic telemetry polling uses bounded retry/backoff with jitter through the shared connection
helpers. Manual tests can still be run from the UI. Failure count resets after stable success.

Freshness uses actual data timestamps:

- fresh: recent data is available.
- aging: data is still useful but no longer immediate.
- stale: the last-known payload should be treated as old.
- unavailable/offline: no useful current provider evidence is available.

Last-known telemetry can remain visible while disconnected, but it must be labeled as stale or
offline. The app must not fabricate fresh Pi/Core telemetry.

## Provider Boundaries

The current checkout owns the client-side app boundary:

- BLE remains the primary live vehicle telemetry path where available.
- HTTP Pi endpoint remains an optional fallback and stream-control path.
- CodeBlack-Core remains a future/service boundary, not UI-embedded business logic.
- The real Pi backend, NetworkManager profiles, recovery AP, watchdog, and systemd units are not in
  this repository and must be validated on the Pi-side codebase/live node.

Future transports can map into the same status model: local Wi-Fi, hotspot, Tailscale, BLE, Core
relay, external GPS, or Windows desktop network adapters.

## Diagnostics

Normal dashboard UI should stay compact. Settings/System diagnostics may show endpoint, transport,
last success, data age, retry timing, and sanitized error summaries.

Diagnostics must not print auth tokens, credentials, full sensitive headers, or raw stack traces.

