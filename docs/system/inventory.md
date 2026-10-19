# Operation Genesis Inventory

Starting checkpoint: `checkpoint-operation-genesis-start-20260827-192222`

Starting commit: `3a0f5b30e1e5845b946f942e8e8f86ade45be743`

Branch: `experiment/veteran-chaser-pass`

## Dirty Work At Start

Modified before this sprint:

- `scripts/pass1-domain-tests.mjs`
- `src/components/home/HomeOverviewPage.tsx`
- `src/components/situational/WindCard.css`
- `src/components/situational/WindCard.tsx`
- `src/hooks/useThreatHero.ts`
- `src/index.css`

Untracked before this sprint:

- `src/hooks/useStormMotion.ts`
- `web/telemetry/`

These were treated as existing work and were not reverted.

## Applications

| Component | Path | Platform | Startup | Maturity |
| --- | --- | --- | --- | --- |
| Code Black OPS root app | `src/` | React/Vite/Capacitor | `npm run dev`, `npm run build`, `npm run android:debug` | beta |
| Android host | `android/` | Android/Capacitor/Java | `npm run android:debug`, `cap open android` | beta |
| iOS host | `ios/` | iOS/iPadOS/Capacitor/Swift | `npm run cap:sync:ios`; Xcode build requires macOS | partial |
| Code Black OPS Web | `web/ops/` | Vite/React/Supabase/Cloudflare Pages | `cd web/ops && npm run dev/build` | partial |
| Code Black Control | `web/telemetry/` | Vite/React/TypeScript | `cd web/telemetry && npm run dev/build` | partial |
| Public site | `web/public/` | Vite/React | `cd web/public && npm run dev/build` | partial |

## Services And Utilities

| Component | Path | Purpose | Health Check | Maturity |
| --- | --- | --- | --- | --- |
| Telemetry client provider | `src/services/telemetry/` | BLE-first telemetry, HTTP fallback, last-known/simulator states | OPS diagnostics/build | beta |
| BLE client | `src/services/telemetry/ble-client.ts` | BLE telemetry notifications and command channel | BLE status in app | partial |
| Streaming client | `src/services/streaming.ts` | Pi stream status/control client | `/api/local/stream/status` | partial |
| Radar worker | `radar-worker/worker.cjs` | Development Level II/III radar API | `/api/v1/radar/health` | partial |
| Live overlay telemetry | `src/services/liveOverlayTelemetry*.ts` | Off-by-default Core overlay publisher/read model | domain tests/docs | partial |
| Cloudflare MoDOT proxy | `functions/api/modot/[[path]].ts` | Same-origin public road-data proxy | provider request | partial |
| Cloudflare ODOT proxy | `functions/api/odot/[[path]].ts` | Same-origin ODOT proxy with server-side token | provider request | partial |

## Native Code

| Component | Path | Purpose | Maturity |
| --- | --- | --- | --- |
| Android Chase Tracking | `android/app/src/main/java/com/codeblackwx/ops/chase/` | Foreground location service and plugin | beta |
| Android Tablet Location | `android/app/src/main/java/com/codeblackwx/ops/location/` | Native last-known location bridge | beta |
| Android Secure Credentials | `android/app/src/main/java/com/codeblackwx/ops/security/` | Keystore-backed credential plugin | beta |
| Android Car App Service | `android/app/src/main/java/com/codeblackwx/ops/car/` | Android Auto/weather category service shell | partial |
| Android Native Recon | `android/app/src/main/java/com/codeblackwx/ops/recon/` | Diagnostic Mapbox activity | partial |
| iOS Secure Credentials | `ios/App/App/CodeBlackSecureCredentialsPlugin.swift` | Keychain adapter source | partial |
| Rust Radar Reference | `native/radar-ref/` | Retired/deferred Level II Android radar reference | deprecated |

## Config

- `.env.example`: Mapbox, Pi API base, radar worker base, simulator flag, Atlas diagnostics.
- `web/ops/.env.example`: Supabase/Mapbox shape for private OPS web app.
- `web/public/.env.example`: public site environment shape.
- `capacitor.config.ts`: app id `com.codeblackwx.ops`, app name `Code Black OPS`, webDir `dist`.
- `android/app/src/main/res/xml/network_security_config.xml`: cleartext allowed for trusted local/Tailscale Pi endpoints.
- `ios/App/App/Info.plist`: location, Bluetooth, local network, and App Transport Security text/settings.

## Scripts

- `scripts/launch-webapp.ps1`
- `scripts/pass1-domain-tests.mjs`
- `scripts/release-sanity.mjs`
- `scripts/s24-rendered-walkthrough.ps1`
- `scripts/s24-ui-screenshot-baseline.ps1`
- `scripts/s24-webview-evaluate.mjs`
- `scripts/capture-and-upload-appearance.ps1`
- `install-codeblack-ops.ps1`
- `start-radar-worker.ps1`
- `start-radar-worker.sh`

## QA And Artifacts

- `tests/walkthrough/app-walkthrough.spec.ts`
- `qa-screenshots/`
- `artifacts/`
- `PROJECT_STATE.md`
- `CHANGELOG.md`
- device and walkthrough docs under `docs/`

## Known Gaps

- Real Pi-side codebase is not included.
- Pi systemd units are not included.
- ESP firmware is not included.
- Production CodeBlack-Core implementation is not included.
- Streaming supervisor/MediaMTX/FFmpeg configs are not included.
- Actual Pi/Core port map is unknown beyond documented examples.
- iOS native runtime validation requires macOS/Xcode/device.
