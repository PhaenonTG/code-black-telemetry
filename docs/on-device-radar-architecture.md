# Code Black OPS On-Device Radar Architecture

Status: Beta 1 Level II suite active on-device.

## Production Target

The production radar path is:

NOAA / Unidata radar source -> native Android download layer -> on-device decoder -> app-private processed cache -> Mapbox radar layer.

No laptop, Raspberry Pi, CodeBlack-Core host, LAN radar API, localhost endpoint, Tailscale endpoint, or adb reverse should be required for production radar.

## Sources

- Level II: `unidata-nexrad-level2` completed volume archive.
- Level II chunks: `unidata-nexrad-level2-chunks` is a future optional acceleration path only after reliable completed-volume handling is proven.
- Level III Echo Tops: deferred after Beta 1. Research notes are preserved here, but ET is not part of the normal Beta 1 product set.

## Decoder Candidate Audit

| Candidate | Language | License | Fit | Notes |
| --- | --- | --- | --- | --- |
| `danielway/nexrad` / `nexrad-data` | Rust | MIT | Selected for Beta 1 | Provides Archive II structures and decoding. Rust builds for Android arm64-v8a through NDK/JNI and powers REF, VEL, SRV, and CC on-device. |
| `netbymatt/nexrad-level-2-data` | JavaScript | MIT | Development/reference only | Already used by the desktop worker. Not acceptable for final production decoding because Level II processing would run in JS/WebView. |
| `netbymatt/nexrad-level-3-data` | JavaScript | MIT | Development/reference only | Useful as a Level III ET format reference, but not the requested native Android implementation. |
| Py-ART / xradar / wradlib / MetPy | Python | BSD-family/open source | Not selected | Scientifically strong but would require a Python runtime or server-side environment. Not credible for a lean native tablet APK in this sprint. |
| Custom C/C++ decoder | C/C++ | Project-owned | Fallback only | Highest control but highest risk. NOAA documents special Level II bzip2 block handling, so bounds-safe parsing and fuzz testing would be mandatory. |

## Native Bridge Landed

`RadarNative` is registered as a local Capacitor plugin in the Android app module.

Implemented bridge methods:

- `initialize`
- `getStatus`
- `getSites`
- `getNearestSites`
- `selectSite`
- `selectProduct`
- `selectTilt`
- `getAvailableTilts`
- `getFrames`
- `setStormMotion`
- `clearCache`
- `getCacheStatus`
- `startLiveUpdates`
- `stopLiveUpdates`

Beta 1 behavior is intentionally scoped to on-device Level II radar products:

- REF: Base Reflectivity
- VEL: Base Velocity
- SRV: Storm-Relative Velocity using an explicit manual storm-motion vector
- CC: Correlation Coefficient

Echo Tops and other Level III/NIDS products are future/deferred roadmap work and are not shown in the normal operational radar product tabs.

## Native Build

The native library is packaged as:

- `libcodeblack_radar.so`

The Rust crate uses `nexrad-data`, `nexrad-model`, and `nexrad-render`, pinned through Cargo, and exposes a JNI product renderer used by `RadarNative`.

## Deferred Roadmap

1. Add a native Level III/NIDS decoder path for Echo Tops.
2. Add longer radar frame loops.
3. Add foreground service polish and thermal policy.
4. Add optional Level II chunk acceleration after completed-volume handling remains stable.
