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
- Route tools and more focused chase threat/road/official-warning rails remain integration work. A unit without a reported location is labeled as such; the map must not invent a vehicle position.

## Analysis

- Setup and Surveillance modes preserve the existing Chase Setup Drafts and Aegis Radar Alerts functionality, with a saved local mode choice. Selecting a draft remains inside the Analysis workspace. Setup detail maps official SPC geometry and actual HRRR screening candidate coordinates supplied by Core, explicitly separating those sources. A ranked table now shows the retained coordinate-bearing HRRR points, model index, classification, valid time, and run time; selecting a row focuses its map marker. Index is not confidence, and these are not named chase targets.
- Source chronology uses timestamps actually present in the current Core draft. Core exposes no previous-revision evidence, so the UI does not invent a “what changed” delta. A true change timeline, surveillance plot, and operator review/publish flow remain integration work. Setup approval stays disabled until evidence and exact-revision authorization are verified.

## Delivery boundary

This is an incremental desktop implementation of the previously approved project, not acceptance of the entire plan. Producer and Chase Mapbox surfaces, the shared location selector, and the desktop and phone layouts passed local rendered smoke tests before release. The live stream publishers were unavailable during testing, so playback, latency, and audio remain unverified. The private stream player still requires Tailscale; OPS sign-in alone does not grant playback access.

The shared location selector follows browser GPS when available, offers reported chaser fixes, and uses Pea Ridge, Arkansas (36.45, -94.12) as the fallback. A chaser fix expires after two minutes. The selected reference applies across the map, Chase, Producer, Weather, Soundings, and nearby results; choosing a map point temporarily makes that point the reference.
