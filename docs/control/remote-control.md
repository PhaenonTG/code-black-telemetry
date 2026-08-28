# Remote Control Architecture

Code Black Control should eventually let the user open a phone, tablet, or laptop browser and manage the system safely.

## Target Clients

- iPhone
- iPad
- Android phone
- Android tablet
- Laptop browser

## Primary Path

```text
Client browser
  -> authenticated CodeBlack-Core control plane
  -> node/service contracts
  -> Charger Pi and other fleet nodes
```

Use this path when internet/Core connectivity is available.

## Fallback Path

```text
Client browser on LAN/Tailscale
  -> direct Charger Pi control API
  -> local node/service contracts
```

Use this path when CodeBlack-Core is unavailable but the operator is on the local vehicle network or Tailscale.

## Safe Actions

- View system status
- View node status
- View service status
- Start chase profile
- Start stream
- Stop stream
- Restart telemetry bridge
- Restart weather bridge
- Reboot Pi
- View bounded sanitized logs
- Run System Doctor

## Guardrails

- Core must not be required for local chase operation.
- Direct Pi control must still require authentication or a strongly constrained local trust model.
- Reboot, stop, restart, and stream actions require audit logging.
- Destructive/disruptive actions require confirmation.
- ESP devices should expose only narrow status/health/version/reboot behavior if control is added.
- Phone UI must be control-plane focused, not a duplicate of the OPS cockpit.

## Product Boundary

Code Black OPS is the in-vehicle operational cockpit.

Code Black Control is the remote management/control interface.

CodeBlack-Core is the central backend/control authority when available.
