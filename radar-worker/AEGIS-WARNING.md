# Warning-triggered Aegis radar screen

This is an **experimental supplemental screen**. Official NWS warnings are not
delayed, suppressed, modified, or replaced. A score is an uncalibrated evidence
score out of 100, **not** a probability of a tornado. Candidate map points are
radar-indicated locations, not ground-truth tornado coordinates. No automated
TDS confirmation is published.

The one-shot worker fetches actual, unexpired NWS Tornado and Severe
Thunderstorm Warning polygons, selects a nearby WSR-88D from NOAA/NCEI station
metadata, processes two recent completed Level II volumes on first sight and
then each new volume key once, and journals scan/evidence records. A candidate
can enter `alerts.jsonl` only if it lies inside the warning polygon, the scan
is fresh, the low-level velocity/ref/CC cuts are available and near-matched,
and a velocity couplet persists across volumes. `evidence_cutoff` is
configurable from 70 to 100; the example keeps execution disabled.

Output is private Core-local data under
`/srv/codeblack/data/radar-worker/aegis-warning/`:
`scans.jsonl`, `alerts.jsonl`, `state.json`, and `status.json`. These are not
official warnings or model-validated diagnoses. The site catalog is an
official NCEI station layer; TDWR stations are excluded because the decoder
uses WSR-88D Level II data. Site and warning feed failures fail closed and are
visible in the service journal/status.

Core's `/api/fabric/v1/aegis-status` and `/api/fabric/v1/aegis-alerts` now
proxy a loopback-only, read-only durable feed. The feed reports `shadow` and
returns no alerts until `delivery_enabled` is set true in the Core-local
configuration. The Edge Discord bot subscribes to this endpoint and will send
only fresh, schema-validated, threshold-qualified candidate events when that
same gate is enabled. The OPS Aegis Alerts route and authenticated gateway
allowlist are built and tested in source; OPS production deployment is separate.

## Canary as of 2026-10-11

- Core scanner timer, feed service, and Fabric read endpoints are running.
- Two radar sites maximum; this is **not nationwide coverage**. Official NWS
  warnings continue independently and nationwide through the existing bot.
- `delivery_enabled=false`: no Aegis Discord notification and no visible OPS
  alert. This is intentional while the score remains uncalibrated.
- The completed-volume Unidata feed lagged the wall clock by several minutes
  during the canary. The existing radar worker's faster chunk assembler covers
  REF/VEL only, not CC. Do not promise sub-minute full dual-pol analysis until
  a validated partial-volume CC path or faster source exists.
- Initial transient volume fetch failures recovered on later polls. The scanner
  records errors and never promotes missing evidence to an alert.

## Release gates

1. Run retrospective false-positive/false-negative review against human-labeled
   historical events, including null cases and distant/aliased radar samples.
2. Validate the score cutoff for the desired precision and latency. Keep the
   score labeled *evidence*, not a calibrated probability.
3. Deploy the authenticated OPS route and confirm its gateway reaches Core's
   bounded Fabric feed; verify map polygon/point rendering on desktop and iPad.
   An official warning feed must remain separate and immediate.
4. Canary on Core with file output only, measure load and scan lag during a
   multi-warning event, then explicitly enable downstream delivery.
5. A dedicated grounded Aegis model route may add prose review, but it must
   not invent measurements, increase a deterministic score, or be reported as
   active until its actual model and response have been verified.

NWS describes a TDS as a localized low-CC area co-located with circulation and
reflectivity. Low CC by itself is not a tornado. Distance, beam height,
velocity aliasing, scan latency, and missing moments can all invalidate this
screen. This implementation intentionally withholds rather than filling gaps.
