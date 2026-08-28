# Chase-Critical Matrix

| Capability | Required? | Primary Provider | Fallback | Failure Impact |
| --- | --- | --- | --- | --- |
| Cockpit OPS | Required | Samsung cockpit tablet running root Capacitor app | Future iPad/iPhone or web preview only after validation | Primary vehicle interface unavailable |
| Atlas map | Required | Mapbox GL JS in OPS app | Cached/offline map strategy planned, not proven in this checkout | Spatial awareness degraded or unavailable |
| Radar | Required | Atlas mosaic radar layer | Cached radar where available; development radar worker is optional | Reduced storm awareness; may make chase not ready |
| GPS | Required | Vehicle/navigation ESP through Pi telemetry | Tablet GPS, then last-known GPS | Navigation and location-based alerting degraded |
| Vehicle weather | Important | Weather ESP through Pi telemetry | Nearest public weather observation, then last-known vehicle data | Local measurements unavailable |
| Wind | Important | Weather ESP wind telemetry | External station wind if trusted | Local wind awareness degraded |
| Vehicle telemetry | Important | BLE telemetry link | Pi HTTP API, then last-known telemetry | Sensor/power/system health stale or unavailable |
| Pi system health | Important | Charger Pi local API/telemetry | Last-known state | Vehicle services harder to trust/diagnose |
| Streaming | Optional | Charger Pi FFmpeg/MediaMTX stack | None currently documented | Broadcast unavailable, chase unaffected |
| Recording | Optional | Charger Pi recording path | None currently documented | Archive unavailable, chase unaffected |
| CodeBlack-Core | Optional | Central Linux backend concept | Direct local/Tailscale Charger Pi access | Cloud/control/archive unavailable, local chase unaffected |
| Code Black Control | Optional | `web/telemetry` future control-plane UI | Direct OPS app/Settings controls | Remote management unavailable |
| Road cameras | Optional | Public DOT providers and Cloudflare proxies | Source links/snapshots where available | Road/camera overlays unavailable |
| Fleet | Optional | Future Core-backed fleet coordination | Local vehicle-only operation | Other nodes invisible |

Conclusion: the vehicle remains chase-capable when CodeBlack-Core, streaming, recording, public website, road cameras, or remote control are unavailable, provided local cockpit, map/radar, and GPS remain operational or have acceptable local fallback.
