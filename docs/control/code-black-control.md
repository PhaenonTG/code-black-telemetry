# Code Black Control Product Definition

Code Black Control is the remote management and control interface for the Code Black ecosystem.

## Product Boundaries

Code Black OPS:

- Vehicle operational cockpit.
- Primary active-chase interface.
- Owns tactical map, radar, alerts, reports, vehicle display, and cockpit workflows.
- Must continue locally without CodeBlack-Core.

Code Black Control:

- Remote management/control-plane UI.
- Runs from phone, tablet, or laptop browser.
- Shows system inventory, nodes, services, readiness, streams, telemetry, events, and settings.
- Sends safe authenticated control actions after the backend/security model exists.
- Must not duplicate the full OPS cockpit.

CodeBlack-Core:

- Central backend/control authority when available.
- Owns remote ingest, archive, control coordination, fleet, and producer workflows.
- Enhances the vehicle, but must not be required for local chase operation.

## Current Implementation

`web/telemetry` is the early Code Black Control frontend. It currently renders a simulated telemetry dashboard and exposes a provider boundary that can later target:

- system inventory
- node status
- service status
- readiness
- telemetry
- streams
- control actions
- events

## Navigation Plan

Primary future navigation:

- Dashboard
- Nodes
- Services
- Telemetry
- Streams
- Events
- Settings

Telemetry drilldowns may include:

- Wind
- Weather
- GPS
- Power
- System

The control-plane dashboard should answer "what is healthy, what is degraded, what can I safely control, and can the vehicle chase?" The OPS cockpit should answer "what do I need while actively chasing?"

## Near-Term Work

1. Replace the telemetry-only store with a control-plane store that can hold nodes, services, capabilities, readiness, telemetry, streams, and events.
2. Keep the simulator, but expand it to simulate node/service/readiness states.
3. Add read-only Nodes and Services pages before adding any control actions.
4. Add authentication and authorization requirements before wiring start/stop/restart/reboot actions.
5. Add direct Charger Pi fallback only after the node contract and security model are implemented.
