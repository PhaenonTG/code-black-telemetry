@"
# Atlas Production Gate

Decision: APPROVED for production default with legacy rollback retained for one release.

Passes:
- 30-minute corrected physical-device stress completed.
- Memory did not grow monotonically; idle dropped to PSS 514111 KB / Graphics 307256 KB.
- No fatal exception, ANR, SIGSEGV, OOM, or unrecovered WebGL context loss found in corrected stress log.
- REF, VEL, SRV, CC validated in Page 1 and expanded Atlas captures.
- Expanded radar topmost behavior verified.
- Android Back closes expanded radar and releases the temporary map.
- Weather Observations overflow fixed; pressure and update/source rows fit.
- Lint passes.
- Legacy rollback remains available.

Known limits:
- Expanded mode creates a temporary second Mapbox map instead of moving one persistent map; cleanup is balanced but graphics memory plateaus high under heavy stress.
- Chromium tile memory warnings can still appear during final cold startup; corrected stress log did not retain repeated warnings and no visible tile loss or context loss was observed.
- Final production launch may show basemap-only / NO RADAR FRAME when current selected site has no cached processed frame yet.
