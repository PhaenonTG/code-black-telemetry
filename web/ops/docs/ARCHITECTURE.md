# Code Black OPS Web — Architecture

## Public vs. OPS boundary

- `codeblackwx.com` (`web/public/`) — public brand/story/content. No telemetry, no private data,
  no auth.
- `ops.codeblackwx.com` (`web/ops/`, this package) — the actual operational tool: map, weather,
  alerts, fleet, system status, settings. Private. Not indexed (`robots: noindex, nofollow` in
  `index.html`).
- The existing root app (`src/`, wrapped by Capacitor for Android/iOS) is the current production
  OPS product. This package is the beginning of a shared web surface for the same product, not a
  competing implementation.

## Why cross-package import instead of copying files

Before committing to this architecture, I spiked importing `src/map/AtlasMap.tsx` directly into
`web/ops` via a relative path and running a real build. It worked cleanly — 71+ modules
(mapbox-gl, every `AtlasMap` layer file, the road-condition/camera/settings services it depends
on) transformed with zero errors. That result drove the whole strategy: **reuse the real modules
via relative import rather than duplicating or rebuilding them.**

```ts
// web/ops/src/pages/Map.tsx
import { AtlasMap } from "../../../../src/map/AtlasMap"
```

This works because:
- The root app has no path aliases (`tsconfig.app.json` has no `paths`/`baseUrl`) — everything is
  relative imports already, so an import reaching outside the package resolves exactly like any
  other relative import would, including that file's *own* internal relative imports (they
  resolve against the imported file's real location on disk, not against `web/ops`).
- `AtlasMap.tsx` and its dependency tree have no Capacitor-native-only imports that would break in
  a plain browser tab. The one thing it touches that's Capacitor-backed is `@capacitor/preferences`
  (via `services/settings.ts`), which ships a genuine web fallback (confirmed:
  `node_modules/@capacitor/preferences/dist/esm/web.js` exists and is what runs when
  `Capacitor.isNativePlatform()` is false).
- `web/ops/vite.config.ts` sets `server.fs.allow` to include the repo root, since Vite otherwise
  refuses to serve files outside a package's own directory in dev.
- `web/ops/package.json` declares the same key dependencies (`react`, `mapbox-gl`, `zustand`,
  `@capacitor/core`, `@capacitor/preferences`, `@capacitor/geolocation`) so they resolve locally
  rather than needing a workspace/monorepo tooling change — deliberately avoided per the "don't
  perform a giant repository migration" instruction.

### A real bug this surfaced, and how it was fixed

`AtlasMap` renders correctly on screen but relies on companion CSS (`.atlas-map-shell`,
`.atlas-layers-popover`, `.atlas-pin-popup`, the mosaic/camera/range-ring styling — about 105
`.atlas-*`-prefixed rule references) defined in the root app's `src/index.css`, which this package
doesn't have on its own. That file is large (~9,900 lines) and, per prior passes' own documented
findings, heavily fragmented with duplicate/`!important` overrides — hand-extracting "just the map
part" would mean guessing which fragments are the real cascade winners, which is exactly the kind
of mistake earlier passes had to spend real effort un-breaking.

Instead: `web/ops/src/styles/index.css` imports the root `src/index.css` wholesale (`@import
"../../../../src/index.css"`), guaranteeing the real, currently-correct cascade comes along
intact. Before doing that, I checked every class name this package defines itself against the
root file and found real collisions — `.metric-tile` (131 matches in root CSS), `.home-module`
(16), `.more-grid` (8), `.alert-list` (22), `.metric-grid` (42), `.status-badge` (3) — and renamed
all of this package's own versions with an `ops-` prefix (`.ops-metric-tile`, `.ops-home-module`,
etc.) so importing the full root stylesheet can't silently corrupt this package's own layout.
`.page-header`, `.status-row`, `.status-table`, `.settings-group`, `.empty-state`, `.segmented`,
and `.page-empty` had zero collisions and were left as-is.

One real cost of this approach: `web/ops`'s CSS bundle is larger than it would be with a hand-
extracted subset (~214KB unminified in this pass's test build, including all of the root app's
phone-dock/panel CSS this package doesn't otherwise use). Acceptable for a foundation pass;
extracting a real shared design-token/component CSS package is listed under Future Extractions.

## What's reused vs. new

| Area | Status | Notes |
|---|---|---|
| Map (mosaic radar, layers, road conditions, cameras, ESCAPE) | **Reused directly** | `src/map/AtlasMap.tsx` + its full layer-file tree, imported as-is |
| Weather data | **Reused directly** | `src/services/situational.ts` (`getNearestObservation`) |
| Alerts data | **Reused directly** | `src/hooks/useAlertProducts.ts` |
| Operational status vocabulary | **Reused directly** | `src/services/operationalStatus.ts` (`OperationalState`, `stateTone`) |
| Settings storage (theme, map layers) | **Reused directly** | `src/services/settings.ts` load/save/subscribe functions |
| Shell (sidebar, bottom nav, status bar, routing) | **New** | Nothing like this exists in the root app, which has one phone-shaped chrome for all screen sizes |
| Home/Weather/Alerts/Operations/Settings/Fleet presentational components | **New** | New, lighter presentational wrappers around the reused data/services — not the root app's `Panels.tsx`/`SettingsPage.tsx` components, which are built for the phone-shaped shell's own CSS and interaction model |
| Fleet | **New** | Nothing named "Fleet" exists anywhere in the current app (confirmed by direct search) — built as a generic `FLEET NODE` concept (vehicle or station) rather than hard-coded around one person's setup, per instruction |
| Auth | **New (architecture only)** | See below |

### Why components were rebuilt instead of reused, but data wasn't

The root app's presentational components (`src/components/situational/Panels.tsx`,
`src/components/settings/SettingsPage.tsx`) are written for one specific shell (the phone-shaped
pager/dock) and its specific CSS. Importing them as-is into a shell with a fundamentally different
layout model (sidebar/rail/bottom-nav switching by viewport) would mean fighting their built-in
assumptions rather than reusing them cleanly — exactly the "risky, would create two divergent
implementations" case the brief said to document rather than force. The underlying data/fetch
layer has no such assumption (it just returns data), so reusing *that* directly was safe and is
what actually matters for "don't refetch/reimplement the same NWS calls twice."

## Future extractions (documented, not done this pass)

- A shared `packages/domain` for `AlertProduct`, `ExternalObservation`, `OperationalState`,
  `RoadConditionEvent`, `TrafficCamera` etc. — today these are imported directly from `src/services/*`,
  which works but keeps the root app as the sole source of truth in a way that will get more
  awkward as `web/ops` grows. Low risk to extract later; deferred because it touches import paths
  in the root app too, which this pass deliberately avoided touching.
- A shared CSS/design-token package so the map's companion styling doesn't require importing the
  entire root `index.css`. Blocked on that file's own fragmentation being cleaned up first (partially
  underway in a separate branch, `work/home-direct-action-ui-cleanup`) — extracting from a moving,
  still-fragmented target now would be wasted work.
- Presentational component reuse (Panels.tsx-equivalent) once/if the root app's own components
  are refactored to not assume the phone-shaped shell.

## Platform adapters (`src/adapters/`)

Each adapter is an interface with a browser-default implementation that degrades honestly instead
of crashing or faking success:

| Adapter | Browser behavior | Native (future) behavior |
|---|---|---|
| `LocationAdapter` | Standard `navigator.geolocation`, single denial (no re-prompt loop) | `@capacitor/geolocation` (same web fallback under the hood when not native) |
| `NotificationAdapter` | `Notification` API where supported | Native push |
| `SecureStorageAdapter` | `localStorage` — **explicitly not secure**, non-sensitive prefs only | Keychain/Keystore |
| `BleAdapter` | `supported: false` — Web Bluetooth is a different API surface than `@capacitor-community/bluetooth-le` and treating them as equivalent would be dishonest | Real BLE telemetry link |
| `BackgroundTrackingAdapter` | `supported: false` — a browser tab cannot run a foreground service | Android foreground service (already exists, `src/services/nativeChaseTracking.ts`) |
| `NativeBackAdapter` | No-op (browser back is just history nav) | Android hardware back button |

## Auth architecture

There is no OPS account/login system in the codebase today (confirmed by direct search — the only
password-flow code, `src/services/spotterAccount.ts`, is an *optional, explicitly non-gating*
sign-in to the external Spotter Network service, unrelated to protecting this app).

This pass builds the **state machine** (`AUTH_REQUIRED → AUTHENTICATING → AUTHENTICATED |
AUTH_ERROR`, `src/status/auth.ts`) the UI is built around, without a backend behind it. In
development (`import.meta.env.DEV`), an `AuthGate` component shows a clearly-labeled
"development preview, not a real login" screen with a single button that sets a `localStorage`
flag — explicitly documented as not security, only so local dev doesn't look identical to a real
authenticated state. In a production build, the gate renders nothing (`AUTHENTICATED, mode:
"production"` immediately) because production protection is meant to happen **before** the
browser ever receives this JS bundle.

### Recommendation: Cloudflare Access

For the first private deployment, **Cloudflare Access** in front of the Pages project is the right
call, not a bespoke login:

- No credentials in the app bundle, ever — Access authenticates at Cloudflare's edge, before any
  request reaches the static site.
- Fastest safe path to a working private preview without building/hosting a real backend this
  pass, which the brief explicitly didn't ask for.
- Straightforward to layer real backend auth in later without changing this app's `AuthGate`
  contract — swap what `AUTHENTICATED`/`AUTH_ERROR` mean, not the state machine itself.

**Not done in this pass**: no Cloudflare Pages project was created for `ops`, and Access was not
configured — per the brief's own stop condition ("do NOT deploy publicly without secure access
protection"), and because actually verifying Access is configured correctly needs the user's own
Cloudflare account interaction the same way the public site's deployment did. See "Deployment
plan" below for the exact steps once that's greenlit.

## Deployment plan (documented, not executed this pass)

- **Project root:** `web/ops`
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Framework:** Vite / React (same pattern as the already-deployed `web/public` → `codeblackwx.com`)
- **Domain:** `ops.codeblackwx.com`
- **Access protection steps** (to run when ready to actually deploy):
  1. Create the Cloudflare Pages project scoped to `web/ops` (same GitHub App connection already
     authorized for this repo, scoped to `PhaenonTG/code-black-telemetry` only — see `web/public`'s
     deployment history for how that connection was set up).
  2. Attach `ops.codeblackwx.com` as a custom domain on that project.
  3. In Cloudflare Zero Trust → Access → Applications, add a Self-hosted application for
     `ops.codeblackwx.com`, with a policy restricted to the specific email(s)/identity provider
     that should have access — not "Everyone."
  4. Verify Access actually blocks an unauthenticated request (curl or a private browser window)
     before considering it live.
- **Environment variables:** `VITE_MAPBOX_ACCESS_TOKEN`, `VITE_ATLAS_MAPBOX_STYLE` — same public
  Mapbox token convention as the root app; no secrets.
- **Auth limitation to flag when this is actually deployed:** Access protects the *site*, not
  individual API calls the app makes client-side (NWS, Mapbox, the mosaic radar tile source) — 
  those are all public data sources already, so this is fine today, but if/when this app starts
  calling private CodeBlack-Core endpoints directly from the browser, those endpoints need their
  own auth, independent of Access sitting in front of the static site.

## Core-offline behavior

CodeBlack-Core (the vehicle Pi / BLE telemetry link) is offline as current product state, not
simulated for this pass. `src/status/systemStatus.ts` keeps Core/Telemetry/Fleet's state
independent from Radar/Weather/Alerts, which are public data sources with no Core dependency —
so the app stays useful (live radar, live weather, live alerts) even with Core fully offline,
exactly as required. Nothing here fabricates a value Core would normally provide; every "offline"
field shows a real state string (`OFFLINE`, `NOT_CONFIGURED`, `NO_DATA`), never a fake zero.

## Locked product decisions carried forward unchanged

- **Mosaic radar only.** No Level II product switching (REF/VEL/SRV/CC) was added; the existing
  Level II code in the root app remains untouched/deferred, consistent with `AtlasMap.tsx` already
  defaulting to mosaic.
- **ESCAPE** stays inside the map UI (reused as-is from `AtlasMap.tsx`) — not promoted to global
  chrome.
- **No visible MARK button** anywhere in this shell.
- **Streaming** — not built this pass; `Operations` reports it as `NOT_CONFIGURED` honestly.
- **Chaser Net** — not built this pass; the existing map layer code remains reachable through
  `AtlasMap` but nothing in this shell surfaces a dedicated Chaser Net UI.
- **Phone bottom nav** — exactly Home / Map / Weather / Alerts / More.

## Browser limitations to know about

- **BLE**: unavailable in any browser tab regardless of vendor — the vehicle telemetry link is a
  native-only capability until/unless a native shell wraps this same web build.
- **Background location**: a browser tab can't track location while backgrounded/closed. Android's
  existing foreground service (`src/services/nativeChaseTracking.ts`) is unaffected by this and
  keeps working in the native app.
- **Secure storage**: falls back to `localStorage`, which is not secure storage. Nothing sensitive
  should be written through `SecureStorageAdapter` in a browser context.

## Future iOS / Android / Windows relationship

The long-term shape this pass is scaffolding toward: this same `web/ops` React app becomes the
shared UI layer, wrapped by a native Capacitor shell (iOS/Android, same pattern the root app
already uses) or packaged for Windows (Tauri/Electron-class wrapper, not decided/attempted this
pass) — with the platform adapters above being exactly the seam where each shell swaps in real
native implementations (BLE, background tracking, secure storage, notifications) behind the same
interfaces already defined here. This pass does not attempt that packaging; it only makes sure the
web app itself doesn't assume native-only capabilities it can't have in a browser.
