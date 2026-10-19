# System / Operations Diagnostics

Code Black OPS status UI uses operational states to describe what is actually known, not just what
is configured.

## Taxonomy

- `READY`: app or subsystem can accept local action.
- `LIVE`: current observation is fresh.
- `CONNECTED`: transport endpoint has recent successful evidence.
- `AGING`: observation is usable but no longer immediate.
- `STALE`: last-known observation is old and must be treated cautiously.
- `DEGRADED`: partial service health or fallback behavior.
- `OFFLINE`: configured system is unreachable or aged beyond the offline threshold.
- `UNAVAILABLE`: capability/provider cannot report useful data.
- `NOT CONFIGURED`: operator has not configured an endpoint/token/provider.
- `ERROR`: current fault requires attention.
- `DISABLED`: user intentionally turned the subsystem off.
- `OUTSIDE COVERAGE`: provider exists, but the current viewport/region is unsupported.

## Transport vs Data

Transport health and observation freshness are separate facts.

Example:

```text
PI TRANSPORT · CONNECTED
TELEMETRY · STALE 4m
```

This means the endpoint responded recently, but the latest telemetry observation is stale. The app
must not collapse that into a single green `ONLINE` state.

## Provider Coverage

Road Conditions and Public Cameras v0.1 are provider-backed only for Arkansas DOT IDrive coverage.
Viewports outside that region report `OUTSIDE COVERAGE`, not `PROVIDER ERROR` and not
`NOT CONFIGURED`.

## Hardware Validation

The current repository can validate UI state transitions, parsing, and freshness with deterministic
fixtures. Real Pi/ESP field-node validation remains blocked until the physical hardware is connected.
Do not report a live hardware pass from fixture-only tests.

## Diagnostics Safety

Diagnostics may show endpoint, transport, last success, last data age, retry state, safe error
category, and provider/source. Diagnostics must not show passwords, bearer tokens, auth headers, or
raw secret-bearing request payloads.
