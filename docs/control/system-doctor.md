# System Doctor Design

`codeblack doctor` is a future read-only diagnostics command. It should evaluate the system against canonical inventories and readiness rules without faking results.

## Goals

- Show whether the vehicle is chase-capable.
- Separate local critical failures from optional remote/streaming failures.
- Identify configuration gaps before field use.
- Produce operator-readable output and machine-readable JSON.
- Avoid printing credentials, tokens, headers, or raw secret-bearing payloads.

## Inputs

- `config/system/nodes.yaml`
- `config/system/services.yaml`
- `config/system/capabilities.yaml`
- `config/system/readiness.yaml`
- `config/system/network.yaml`
- Live node status APIs where available
- Local app build/version metadata where available

## Checks

- Node reachability
- Critical service state
- Radar readiness
- GPS source and freshness
- Weather source and freshness
- BLE telemetry state
- Pi HTTP endpoint state
- Disk usage
- CPU/memory/temperature where available
- Stream stack state
- CodeBlack-Core reachability
- Credential/config presence without exposing values
- Android/iOS/web capability boundaries

## Example Output

```text
CODE BLACK SYSTEM DOCTOR

✓ Samsung cockpit tablet
✓ OPS app build
✓ GPS
✓ Weather fallback
✓ Radar
! Charger Pi telemetry unknown
! Streaming not configured
✗ CodeBlack-Core offline

CHASE CAPABLE
Core and streaming are unavailable, but local radar/GPS/map are operational.
```

## Machine Output

```json
{
  "overall": "CHASE_CAPABLE",
  "localChaseCapable": true,
  "checks": [
    {
      "id": "radar",
      "status": "pass",
      "criticality": "critical",
      "message": "Radar provider available"
    },
    {
      "id": "codeblack-core",
      "status": "fail",
      "criticality": "optional",
      "message": "Core unreachable"
    }
  ]
}
```

## Rules

- Read-only by default.
- No automatic restarts unless the operator explicitly chooses a repair profile later.
- No fake percentages or green states.
- Unknown is a first-class result.
- Optional failures cannot make the whole system `NOT_READY`.
