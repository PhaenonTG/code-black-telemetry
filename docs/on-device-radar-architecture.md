# Retired On-Device Radar Architecture

Status: removed from the shipped app on 2026-08-12.

The app now uses the Iowa Environmental Mesonet NEXRAD N0Q composite mosaic as the radar layer on
Weather and Locate. That mosaic is a plain Mapbox raster tile source and does not require a laptop,
Pi, LAN worker, Capacitor plugin, JavaScript NEXRAD decoder package, JNI bridge, or packaged native
radar library.

The previous single-site radar experiment included:

- Android Capacitor plugin registration for a native radar bridge.
- Java plugin/service/site classes under `android/app/src/main/java/com/codeblackwx/ops/radar`.
- Packaged native radar library under `android/app/src/main/jniLibs`.
- Web service wrappers under `src/services/radar*.ts`.
- A Mapbox decoded-image overlay under `src/map/AtlasRadarLayer.ts`.
- Operations-page radar engine diagnostics.
- A Node desktop radar worker and NEXRAD decoder npm packages.

Those pieces were removed to keep radar behavior consistent across iOS, Android, and web preview
while the app settles around the mosaic-first field workflow.

Future single-site radar work should be treated as a fresh feature behind an explicit product
decision. Do not assume the retired files still exist or that the app has a native radar plugin.
