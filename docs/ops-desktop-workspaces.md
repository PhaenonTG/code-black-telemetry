# OPS desktop workspaces — locked architecture

The three desktop workspaces are **additions to the current sidebar**, not a replacement navigation system. Operations Map, Weather Analysis, Radar Lab, Chase Operations, Stream, Status Center, and the other existing destinations remain available in their existing sections.

## Producer

- The primary camera stage and source rail represent **live-stream camera feeds** (STRIKER/Spencer and TESSA/Nick) reported by Core's stream telemetry. Road/traffic cameras are supporting map context only and must never be substituted for a field live stream.
- The private MediaMTX WebRTC players are currently reachable only through Core's Tailscale address. OPS sign-in does not itself authorize playback. A secure public media-delivery design is required before claiming Producer playback works from any Internet connection.
- Publisher state is displayed honestly; an offline or stale source stays in standby rather than showing a fabricated frame. A live publishing session is required to validate end-to-end decode, latency, and audio.
- A Mapbox dark situation inset shows Fabric unit positions and allows choosing the point for official alerts. The existing Operations Map remains the expanded map/radar/road-camera context.
- Official NWS warnings take precedence over internal Aegis radar candidates. Aegis content remains clearly labeled advisory.

## Chase

- The workspace keeps the existing Mapbox operations map and map controls, with a selectable Fabric field unit and adjacent single-site radar. Radar uses the existing worker, nearest-site fallback, REF/VEL/CC controls, and honest scan age/freshness. SRV is available only when storm motion is present. The Radar Lab and Fleet destinations remain accessible.
- A point-specific official warning banner queries Core, while a supporting rail shows NWS state-polygon warnings, DOT road events, the field reference, and nearby recent Aegis candidates. The rail labels nearest-vertex distances as approximate, distinguishes reported vehicle GPS from a manually selected point, and never treats absent data as an all-clear. Road event coverage varies by provider; Aegis remains explicitly internal and unconfirmed.
- Chase can now choose a destination separately from its official-warning reference. With a fresh browser or chaser GPS origin, it draws a Mapbox route up to 80 miles and shows provider road events approximately within five miles of the route. Routing and provider coverage are explicitly incomplete and are not turn-by-turn navigation or a route-safety check. More focused threat and official-warning rails remain integration work. A unit without a reported location is labeled as such; the map must not invent a vehicle position.

## Analysis

- Setup and Surveillance modes preserve the existing Chase Setup Drafts and Aegis Radar Alerts functionality, with a saved local mode choice. Selecting a draft remains inside the Analysis workspace. Setup detail maps official SPC geometry and actual HRRR screening candidate coordinates supplied by Core, explicitly separating those sources. A ranked table now shows the retained coordinate-bearing HRRR points, model index, classification, valid time, and run time; selecting a row focuses its map marker. Index is not confidence, and these are not named chase targets.
- Source chronology uses timestamps present in the selected Core draft. Revision history preserves evidence snapshots as Core collects them, names the SPC/HRRR fields that changed between adjacent captured revisions, and lets the operator select a revision to inspect its evidence, screening points, and map. Existing drafts start with a captured baseline; older evidence is explicitly unavailable. The desk shows the latest 20 captured revisions and identifies historical views.
- The private review desk sends the same bounded SPC/HRRR packet independently to Aegis (`qwen3:8b`) and local 30B (`qwen3-coder:30b`) through PHAENON3's existing guarded endpoint. One setup job runs at a time, with sequential model calls and durable per-revision results. Findings, missing inputs, and differing hazard/attention fields are shown side by side; textual differences are not a calibrated disagreement score. Failed or interrupted reviews remain unavailable and can be retried. Paid calls remain disabled.
- OWNER/ADMIN operators can record approval or request changes with a note. The server requires the current active revision and fingerprint; approval also requires both validated reviews, their exact packet digest, valid identity and validity period, and a successful source check within 30 minutes. The gateway reads the live role from the user's RLS-protected profile and signs each write over the private VPC binding. Core verifies the signature, actor, exact body, and timestamp. Decisions are private records, never public publication or operational warnings. A changed revision has no inherited decision; historical decisions remain inspectable. Public delivery and the surveillance plot remain integration work.

## Delivery boundary

This is an incremental desktop implementation of the previously approved project, not acceptance of the entire plan. Producer and Chase Mapbox surfaces, the shared location selector, and the desktop and phone layouts passed local rendered smoke tests before release. The live stream publishers were unavailable during testing, so playback, latency, and audio remain unverified. The private stream player still requires Tailscale; OPS sign-in alone does not grant playback access.

The shared location selector follows browser GPS when available, offers reported chaser fixes, and uses Pea Ridge, Arkansas (36.45, -94.12) as the fallback. A chaser fix expires after two minutes. The selected reference applies across the map, Chase, Producer, Weather, Soundings, and nearby results; choosing a map point temporarily makes that point the reference.
