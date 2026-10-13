# OPS desktop workspaces — locked architecture

The three desktop workspaces are **additions to the current sidebar**, not a replacement navigation system. Operations Map, Weather Analysis, Radar Lab, Chase Operations, Stream, Status Center, and the other existing destinations remain available in their existing sections.

## Producer

- The primary camera stage and source rail represent **live-stream camera feeds** (STRIKER/Spencer and TESSA/Nick) reported by Core's stream telemetry. Road/traffic cameras are supporting map context only and must never be substituted for a field live stream.
- The private MediaMTX WebRTC players are currently reachable only through Core's Tailscale address. OPS sign-in does not itself authorize playback. A secure public media-delivery design is required before claiming Producer playback works from any Internet connection.
- Publisher state is displayed honestly; an offline or stale source stays in standby rather than showing a fabricated frame. A live publishing session is required to validate end-to-end decode, latency, and audio.
- A Mapbox dark situation inset shows Fabric unit positions and allows choosing the point for official alerts. The existing Operations Map remains the expanded map/radar/road-camera context.
- Official NWS warnings take precedence over internal Aegis radar candidates. Aegis content remains clearly labeled advisory.

## Chase

- The workspace keeps the existing Mapbox operations map and map controls, with field-unit/Fabric context. Dedicated adjacent single-site radar, route tools, and optimized chase-specific controls are follow-on integration work; the Radar Lab and Fleet destinations remain accessible now.

## Analysis

- Setup and Surveillance modes preserve the existing Chase Setup Drafts and Aegis Radar Alerts functionality, with a saved local mode choice. An integrated target map, timeline, surveillance plot, and operator review/publish flow are follow-on integration work.

## Delivery boundary

This branch is an incremental desktop implementation of the previously approved project, not acceptance of the entire plan. Keep the public OPS site on its current stable release until the workspaces pass production-like Mapbox/media smoke tests and the outstanding integrations are reviewed. Avoid claiming that a public OPS session grants access to the private stream player.
