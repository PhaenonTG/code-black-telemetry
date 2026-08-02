@"
# Operation Atlas Lock-In Report

Starting checkpoint: checkpoint-atlas-lock-in-20260729-162112
Source commit at start: fc724ab5c36f0f9594ebef837c27e1a9d079825b
Final APK: android/app/build/outputs/apk/debug/app-debug.apk
Final APK SHA256: E7291DB05665C0A1966B6AF02C233A547863A9E511B3E0C1F495759682208448
Final installed engine: Atlas
Legacy rollback: Page 2 Radar Engine controls / local map-engine setting

Changes made:
- Fixed Atlas one-time map effect dependency issue using latest refs for initial GPS/expanded values.
- Hid noisy Atlas runtime counters from production map status unless diagnostics are enabled.
- Reduced radar texture churn by only calling Mapbox ImageSource.updateImage when frame URL or bounds change.
- Added GPS deadband for camera/map source updates to prevent tiny GPS jitter from driving thousands of GeoJSON source updates.
- Repaired Weather Observations fixed-height grid overflow and pressure-value truncation.
- Switched source fallback default from legacy to Atlas after gate passed.

Memory result:
See atlas-memory-timeline.csv and atlas-memory-summary.txt. Corrected expanded stress peaked at PSS 690952 KB and Graphics 468184 KB, then ended idle at PSS 514111 KB and Graphics 307256 KB. Final production cold-ish launch measured PSS 464923 KB and Graphics 168112 KB.

Chromium warnings:
Tile memory warnings still appeared on final cold startup, but not as a sustained failure during corrected stress. No WebGL context loss, fatal exception, ANR, SIGSEGV, OOM, or visible tile loss was observed. Root cause is WebView/Chromium tile memory pressure under Mapbox GL surfaces and radar texture churn; app-level duplicate map leakage was not found.

Pixel ratio:
Samsung WebView DPR is 1.5. Page 1 canvas 538x257 CSS / 808x387 backing. Expanded canvas 903x827 CSS / 1356x1240 backing. No explicit pixel-ratio cap was applied because 1.5 is already moderate and readability was good.

Style/layers:
Style URI mapbox://styles/mapbox/navigation-night-v1. Runtime tuning still modifies 92 layers once per style load. Layer count 122-123. Roads and labels remain readable above radar in screenshots.

Validation:
- REF/VEL/SRV/CC product screenshots captured.
- Expanded REF/VEL/SRV/CC screenshots captured.
- Corrected expanded lifecycle stress completed with 150 expanded cycles.
- Background/resume completed 50 cycles.
- Final lint/build/sync/assemble/install completed.

Remaining limitations:
- Expanded uses temporary second map rather than a single moved map host.
- Graphics memory is high during aggressive expanded stress, though bounded.
- Final launch can be basemap-only if selected radar frame is missing for current GPS/site.
- Broader style optimization could reduce the 92 runtime paint edits in a future pass.

Recommended next sprint: OPERATION RADAR LOOP.
