# Telemetry and Weather Data Integrity

This pass hardens the current Code Black OPS Weather and Telemetry displays. It does not add new
providers, weather models, satellite products, or production mesonet ingest.

## Measurement Contract

Displayed measurements must distinguish a valid physical zero from missing data. Shared telemetry
logic now uses these quality concepts:

| Quality | Meaning |
| --- | --- |
| VALID | A finite value exists and is inside the freshness window. |
| AGING | A value exists but is older than the normal live window. |
| STALE | A value exists but is old enough that it must be treated as last-known. |
| MISSING | The source reported a packet/timestamp, but this field was absent. |
| INVALID | The source supplied NaN, Infinity, or an out-of-range value. |
| UNAVAILABLE | No value and no meaningful timestamp exist. |

Freshness defaults are centralized in `src/services/telemetry/measurement.ts`:

| Class | Aging | Stale |
| --- | ---: | ---: |
| GPS | 15s | 90s |
| Vehicle telemetry | 30s | 180s |
| Vehicle weather | 5m | 15m |
| External weather | 15m | 60m |

Existing cards still use compact source/age badges rather than per-field timestamps. Diagnostics can
expand later without changing the measurement semantics.

## Measurement Inventory

| Field | Source | Valid zero? | Missing representation | Freshness/source notes |
| --- | --- | --- | --- | --- |
| Latitude/longitude | Vehicle GPS, ESP GPS, tablet GPS | No, `0,0` rejected | No fix / `--` | Impossible coordinates rejected. Tablet GPS can fill when vehicle GPS is stale. |
| GPS speed | Vehicle/ESP/tablet GPS | Yes, stationary | `--` | Low tablet GPS drift is floored to valid `0 mph`; missing speed stays null. |
| GPS heading/course | Vehicle/ESP/tablet GPS | Yes if provider reports 0 deg | `--` | Heading is not forced to north when unavailable. |
| Altitude/elevation | Vehicle/ESP/tablet GPS | Yes | `--` | Out-of-range values rejected. |
| GPS accuracy/HDOP/satellites | GPS source metadata | Yes where physical | `--` / degraded state | Quality metadata preserved where provided. |
| Temperature | Vehicle weather node, external fallback | Yes | `--` | Vehicle weather wins when trustworthy; external station is labeled fallback. |
| Dewpoint | Vehicle weather node, external fallback | Yes | `--` | No fake derived dewpoint is produced from missing inputs. |
| Relative humidity | Vehicle weather node, external fallback | Yes | `--` | 0% is accepted only if explicitly reported. |
| Pressure | Vehicle weather node, external fallback | No practical sea-level zero | `--` | Range-limited to plausible mb values. |
| Rain rate/total | Vehicle weather node | Yes | `--` | Valid calm/no-rain zeros preserved. |
| Wind speed/gust | Vehicle wind node, external fallback | Yes, calm | `--` | Missing wind does not become calm wind. |
| Wind direction | Vehicle wind node, external fallback | Yes, north | `--` | Direction is not forced to 0/N when unavailable. |
| Main/aux voltage | Pi/vehicle power packet | Yes only if explicitly reported | `--` | Power fields are nullable; unavailable no longer renders `0.00 V`. |
| Charging state | Pi/vehicle power packet | False is valid | `--` | Missing charging state is null, not false. |
| CPU/RAM/storage | Pi system packet | Yes if explicitly reported | `--` | Pi metrics are nullable; no-data no longer renders `0%`. |
| Uptime | Pi system packet | Yes at boot if reported | `--` | Missing uptime is null, not `0h 0m`. |
| Sensor packet rate | BLE/Pi sensor metadata | Yes when online and idle | Offline / no packets | Offline sensors may display offline state with no packet timestamp. |

## Normalization Rules

- Partial packets are accepted per field. A packet with temperature but no humidity renders
  temperature and leaves humidity unavailable.
- Missing fields in a partial packet do not inherit a previous value while being marked fresh.
- Offline snapshots preserve last-known readings only when they came from real vehicle/Pi sources,
  and source changes to `last-known`.
- Simulator data is development-only and is not promoted to last-known production data.
- Malformed packets do not zero existing values and do not refresh observation timestamps.
- External weather fallback is cleared when current GPS/location becomes unavailable, preventing a
  station observation from a prior location from appearing current.

## Provenance

Current source labels remain distinct:

- `vehicle`: Pi/ESP/weather-node telemetry.
- `tablet`: device GPS fallback.
- `external`: public weather station fallback.
- `last-known`: retained vehicle data after disconnect.
- `simulator`: development-only fixture path.
- `unavailable`: no trustworthy data.

These are not official NWS warnings, Chaser Net reports, mobile mesonet production observations, or
Code Black probe observations.

## Remaining Limits

- Real Pi/ESP payloads were not available in this repository, so physical hardware reconnect and
  malformed-packet behavior still need field-node validation.
- Existing UI groups still use group-level timestamps. Per-field timestamps/QC metadata should be
  added with future mobile mesonet work.
- External weather and nearby/POI requests can produce CORS/no-network noise in browser tests; these
  are isolated in the walkthrough allowlist and should eventually move behind Core proxy/cache.
