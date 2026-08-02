# Lifecycle Results

- Final engine: Atlas default, legacy rollback retained through Page 2 map-engine controls/local setting.
- Expanded radar: top-level portal verified with corrected screenshot tlas-expanded-open-corrected.png.
- Expanded live state: two Mapbox canvases while expanded is open.
- After Android Back/close: diagnostics returned to one live map, one canvas, one WebGL context.
- Corrected expanded stress: 150 expanded open/close cycles over 30 minutes.
- Final corrected idle counters: mapConstructors 152, mapRemoves 151, mapInstanceCount 1, canvasCount 1, webglContextCount 1.
- Background/resume: 50 cycles during corrected stress; app remained running and responsive.
- Legacy isolation: Atlas mode diagnostics showed legacyMapMounted false. Legacy fallback remains selectable.
