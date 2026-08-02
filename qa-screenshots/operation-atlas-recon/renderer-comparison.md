# Operation Atlas Recon Renderer Comparison

Checkpoint: `checkpoint-atlas-recon-20260729-121856`

Commit at checkpoint: `fc724ab5c36f0f9594ebef837c27e1a9d079825b`

Final installed default: `MAP_ENGINE=legacy`

Device: Samsung tablet `R5GL53J3Y4J`

## Device And Runtime

- Android: 16
- Resolution reported by `wm size`: 1200x1920
- Density reported by `wm density`: 240
- Android System WebView: `com.google.android.webview 150.0.7871.125`
- Mapbox GL JS: `3.27.0`
- Native Mapbox Maps SDK for Android POC: `11.27.0`, `android-ndk27` artifact
- Capacitor: `8.4.2`

## GL JS Findings

Minimal GL JS is not generally broken on the Samsung.

Evidence:

- `01-gljs-minimal-night.png` visibly renders `mapbox://styles/mapbox/navigation-night-v1`.
- `02-gljs-minimal-bright.png` visibly renders `mapbox://styles/mapbox/streets-v12`.
- Minimal diagnostics show `Loaded true`, `Style true`, render and idle events, and a non-black canvas pixel sample.
- WebGL renderer shown in screenshot: `Mali-G615 MC2`.

The full Atlas Page 1 issue is an integration/state problem, not a pure WebView or GL JS renderer failure.

Evidence:

- `03-full-atlas-page1.png` shows the dashboard map panel blocked by `RADAR_FRAME_MISSING`.
- `src/map/AtlasRadarLayer.ts` returns `RADAR_FRAME_MISSING` when `frame` is null.
- `src/map/AtlasMap.tsx` renders that error over the map and reports Atlas loading/status inside the panel.

Known GL JS risk remains:

- Prior full Atlas runs reached higher graphics memory than the isolated test.
- Final log scan still shows Chromium tile memory warnings.

## Native SDK POC Findings

The isolated native Mapbox Activity renders successfully on the Samsung.

Evidence:

- `07-native-night-basemap.png` renders a native Mapbox navigation-night basemap.
- `08-native-bright-basemap.png` renders a native bright comparison style.
- `19-native-poc-clean.png` renders native Mapbox without a WebView active.
- The native POC renders a vector basemap, road labels, city labels, a GeoJSON line, a vehicle marker, and a georeferenced raster image source.

Limitations:

- The radar raster used for the POC is an existing Beta REF screenshot fixture copied as `android/app/src/main/assets/recon-ref.png`, not a clean decoded transparent radar frame. It proves native raster/image-source rendering, opacity, and georeferencing mechanics, but not final radar visual quality.
- Camera animation was reduced to direct camera updates in the Java POC after the Java API did not expose the same direct `easeTo` call shape used in GL JS. A production native implementation should use the Maps SDK animation plugin deliberately.

## Memory Snapshot Summary

Values from `dumpsys meminfo com.codeblackwx.ops`.

| Scenario | Total PSS | Total RSS | Graphics | WebViews | Activities |
|---|---:|---:|---:|---:|---:|
| Legacy Page 1 | 372,509 KB | 508,328 KB | 163,912 KB | 1 | 1 |
| Minimal GL JS night | 301,663 KB | 434,092 KB | 110,448 KB | 1 | 1 |
| Minimal GL JS bright | 295,601 KB | 429,128 KB | 107,744 KB | 1 | 1 |
| Full Atlas Page 1 | 535,440 KB | 672,404 KB | 308,712 KB | 1 | 1 |
| Native POC clean | 328,005 KB | 431,924 KB | 88,776 KB | 0 | 1 |

Interpretation:

- The 520 MB graphics value from prior Atlas testing was not reproduced in the minimal GL JS route.
- Full Atlas still has substantially higher graphics memory than isolated GL JS and native POC.
- Native POC graphics memory was lower than legacy and full Atlas in the clean measurement.

## Comparison Matrix

| Criterion | GL JS / WebView | Native Maps SDK |
|---|---|---|
| Samsung basic rendering | Pass in minimal route | Pass |
| Full app current integration | Fails/gated by `RADAR_FRAME_MISSING` | Not integrated into app |
| Basemap labels/roads | Good in minimal route | Good |
| Radar image source | Existing Atlas path requires valid `RadarFrame`; not validated in full app here | POC image source renders |
| Layer ordering potential | Good if app integration is fixed | Excellent |
| Camera/gesture potential | Good; existing JS controller can be reused | Excellent but needs native bridge/controller |
| Memory in isolated test | Good | Good/better clean graphics memory |
| Full Atlas memory | High | Unknown in full app |
| Implementation cost | Lower because React UI already owns state | Higher because WebView/native bridge and lifecycle coordination are required |
| Debugging | Easier with browser tooling and React state | More Android-specific, but renderer is more predictable |
| Migration risk | Medium if Atlas state/lifecycle is fixed | High; requires a real bridge and dashboard/native surface strategy |

## Recommendation

Do not commit to a native Mapbox migration yet.

Recommended next step:

1. Repair the existing GL JS Atlas integration so the Mapbox basemap remains visible when `RadarFrame` is missing.
2. Validate Atlas with a real cached radar frame on the Samsung.
3. Re-measure full Atlas memory after that fix.
4. Keep the native SDK POC as evidence and fallback direction if full Atlas still shows high graphics memory or lifecycle instability.

Decision confidence: moderate.

Reasoning:

- GL JS itself renders correctly on the physical Samsung.
- The observed blank/dark Atlas panel is traceable to app state and overlay behavior, not a WebGL incapability.
- Native SDK rendering is viable and memory looks promising, but production integration cost is materially higher and not yet justified by the evidence gathered in this sprint.

## Artifacts

- `01-gljs-minimal-night.png`
- `02-gljs-minimal-bright.png`
- `03-full-atlas-page1.png`
- `07-native-night-basemap.png`
- `08-native-bright-basemap.png`
- `14-native-heading-up.png`
- `17-legacy-page1.png`
- `19-native-poc-clean.png`
- `final-installed-legacy.png`
- `final-main-after-recon.png`
- `memory-*.txt`
- `logcat-*.txt`

## Temporary Launch Commands

Native POC:

```powershell
adb -s R5GL53J3Y4J shell am start -a com.codeblackwx.ops.RECON_NATIVE_MAPBOX --es style night
adb -s R5GL53J3Y4J shell am start -a com.codeblackwx.ops.RECON_NATIVE_MAPBOX --es style bright
```

Normal app:

```powershell
adb -s R5GL53J3Y4J shell am start -n com.codeblackwx.ops/.MainActivity
```
