# Code Black Dependency Graph

This graph distinguishes local chase dependencies from optional central services. CodeBlack-Core must enhance the system, not become a single point of failure for the vehicle.

## Required For Chase

```text
Samsung cockpit tablet
  -> Code Black OPS app
  -> Atlas map
  -> radar layer
  -> GPS source
```

```text
Navigation ESP
  -> Charger Pi telemetry bridge
  -> BLE telemetry link or Pi HTTP telemetry API
  -> Code Black OPS
```

Fallback:

```text
Samsung cockpit tablet GPS
  -> Code Black OPS canonical location
```

If the Navigation ESP, Pi bridge, or BLE link fails, the tablet GPS fallback should keep navigation usable with degraded labels.

## Important Local Systems

```text
Weather ESP
  -> Charger Pi weather bridge
  -> BLE telemetry link or Pi HTTP telemetry API
  -> Code Black OPS weather/wind cards
```

Fallback:

```text
Nearest public weather observation
  -> shared situational services
  -> Code Black OPS weather/wind cards
```

Vehicle weather loss degrades local measurements but should not stop the chase if map, radar, and GPS remain usable.

```text
Charger Pi
  -> power/system telemetry
  -> Code Black OPS system/power/sensor status
```

Pi health is important because it carries vehicle services, but the tablet must continue displaying local radar/map/GPS where possible.

## Optional Systems

```text
Charger Pi streaming stack
  -> FFmpeg / MediaMTX or equivalent
  -> KNWA output
  -> Code Black output
  -> recording
  -> OBS / CodeBlack-Core / producer systems
```

Streaming failure means broadcast or recording is unavailable. It must not make the vehicle unable to chase.

```text
CodeBlack-Core
  -> telemetry ingest
  -> remote control
  -> archive
  -> stream relay
  -> fleet coordination
```

Core outage removes central visibility and remote orchestration but local chase operation must remain possible.

```text
Windows development / producer PC
  -> builds and QA
  -> OBS production
  -> development radar worker
  -> diagnostics
```

The Windows system is operationally useful but not a chase-critical vehicle dependency.

## Future Systems

```text
Nick vehicle node
  -> CodeBlack-Core fleet ingest
  -> Code Black Control fleet/status views
```

```text
Future probes
  -> probe observation provider
  -> CodeBlack-Core or direct local ingest
  -> Atlas/probe layers
```

These systems must be added behind provider contracts so the first vehicle remains independently chase-capable.

## Single Points Of Failure To Watch

- Samsung cockpit tablet: current primary cockpit host.
- Atlas/radar online dependencies: map/radar usefulness can degrade when upstream map/radar networks are unavailable unless offline/cached workflows are added.
- Charger Pi: important for vehicle telemetry, ESP bridging, and streaming, but must not be required for tablet-local map/radar/GPS.
- BLE/HTTP command token handling: control actions depend on secure token design and must not be exposed as unauthenticated endpoints.
- Unknown Pi service definitions: systemd units and process supervision are not present in this checkout.
