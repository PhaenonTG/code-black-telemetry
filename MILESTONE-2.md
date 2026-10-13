# Milestone 2 qualification — 2026-10-01

Historical note: this document records the October 1 private-output milestone. Public Facebook output was added later; see `README.md` and `facebook-output.js` for the current operating surface.

PHAENON3 Native Broadcaster qualification is complete. CORE remains the authoritative SRT ingest; PHAENON3 decodes, maintains separate CLEAN and PROGRAM paths, records locally, produces private test output, and uses NVENC for PROGRAM encoding.

Source health is separate from transport health. Fresh video under 3000 ms is `SOURCE_LIVE`; 3000–8000 ms is `SOURCE_STALE`; 8000 ms or more is `SOURCE_LOST`. Transport reconnect begins immediately and is reported independently.

Qualified capabilities: CLEAN/PROGRAM previews and isolation, PROGRAM overlays, audio/video telemetry, SSE and loopback producer UI, local recording, independent CLEAN sink, localhost-only private RTMP output, reconnect behavior, output ownership protection, and process-identity stale-lock recovery.

Public output remains prohibited. Facebook is not configured or accessed by this runtime. OBS remains the verified fallback and is not read or modified by Native Broadcaster.

Evidence: `test/evidence/milestone2-stale/` (runtime evidence, intentionally not source-controlled). The focused source-health test captures LIVE, STALE, LOST, and recovered LIVE PROGRAM frames plus status/event records.

Known limitations: no public destination is enabled; multi-source switching, chat, radar, and AI production controls remain outside Milestone 2.
