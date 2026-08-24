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

Production auth is **Supabase Auth, email + password**, enforced inside the app itself — not an
edge gate. A dedicated Supabase project (`codeblack-ops`, Free plan, Auth only) holds the identity;
Supabase handles password storage, hashing, session issuance, and refresh. Code Black owns only the
UI and the authorization boundary on top of that identity (see below). This replaced an earlier
Cloudflare Access edge gate, which is documented at the bottom of this section for history.

- **`src/lib/supabase.ts`** — the Supabase client, built from `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` (client-safe, non-secret; see "Client environment variables"
  below). Session persistence is Supabase's own default (`localStorage`-backed, auto-refreshing) —
  no custom token handling anywhere in this app.
- **`src/auth/AuthProvider.tsx`** — bootstraps the session on load (`supabase.auth.getSession()`),
  subscribes to `onAuthStateChange` for login/logout/refresh, and cross-checks every signed-in user
  against `public.profiles` before treating them as authorized. State machine:
  `loading → signed-out | unauthorized | authorized`. A valid Supabase account is necessary but not
  sufficient — a user with no `profiles` row, or an `active = false` row, lands in `unauthorized`,
  never `authorized`.
- **`src/components/AuthGate.tsx`** — the actual gate. Protected content (`AppShell` and every
  route inside it) only renders in the `authorized` branch; `loading`/`signed-out`/`unauthorized`
  each render their own screen (`LoadingScreen`, `Login`, `Unauthorized`). Nothing protected mounts
  before the session + authorization check resolves, so there is no flash of OPS content before
  auth is known.
- **`src/pages/Login.tsx`** — the tactical login screen (email/password, visibility toggle,
  generic "AUTHENTICATION FAILED" / "CONNECTION FAILED" states, "Forgot password?"). Calls
  `supabase.auth.signInWithPassword()` only — no custom credential handling.
- **`src/pages/UpdatePassword.tsx`** — the landing route (`/update-password`) for the link
  Supabase emails from `resetPasswordForEmail()`. Reachable regardless of auth state (it's outside
  `AuthGate` in `App.tsx`) because the recovery link itself establishes a temporary session; the
  page just waits for that, then calls `supabase.auth.updateUser({ password })`.

### Authorization: `public.profiles` (not "any valid Supabase user")

Public signup is disabled at the Supabase project level (Authentication → Providers → Email →
"Allow new users to sign up" off), so the only way an account exists is an administrator creating
it directly in the Supabase dashboard. But a valid account still isn't automatic OPS access — that
boundary is a second, explicit table:

```sql
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'OPERATOR' check (role in ('OWNER', 'ADMIN', 'OPERATOR')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (auth.uid() = user_id);
```

RLS is enabled with exactly one policy: a signed-in user may `select` only their own row. There is
no `insert`/`update`/`delete` policy for `authenticated` or `anon` — authorization records are
managed by an administrator via the Supabase SQL editor/dashboard, never by the client app, and
never via the `service_role` key in frontend code. `AuthProvider` reads this row after every sign-in
and treats a missing row, or `active = false`, as `unauthorized` — the frontend never uses an
email-comparison shortcut as the authorization boundary.

### History: Cloudflare Access (superseded)

The previous pass put **Cloudflare Access** in front of the Cloudflare Pages project as the only
protection, since no backend auth existed yet. That was a reasonable bridge at the time (no
credentials in the bundle, fast to stand up) but meant the app itself trusted the edge completely —
anyone who reached the JS bundle was treated as authenticated. Once Supabase auth was implemented,
built, deployed, and verified working on the live Cloudflare Pages deployment, the Access
application/policy in front of `ops.codeblackwx.com` was removed — auth now lives in the app, so
both the custom domain and the default `*.pages.dev` URL present the same Supabase login gate
rather than one being Access-protected and the other not.

## Client environment variables

```
VITE_MAPBOX_ACCESS_TOKEN=       # public, maps/styles read access only
VITE_ATLAS_MAPBOX_STYLE=        # public
VITE_SUPABASE_URL=              # project API URL, not secret
VITE_SUPABASE_PUBLISHABLE_KEY=  # publishable key, not secret -- protected by RLS, not by hiding it
```

None of these are secrets by design — the Mapbox token is a `pk.`-scoped public token, and the
Supabase publishable key is meant to ship in a browser bundle (Supabase's own security model is
"this key is public, RLS is the boundary," matching the `profiles` policy above). What must never
appear here or anywhere client-side: the Supabase `service_role` key, the database password, a
Supabase management API token, or any Cloudflare/Core/stream credential. Real values live only in
`web/ops/.env` (gitignored) locally and in the Cloudflare Pages project's environment variables in
production — `web/ops/.env.example` documents the shape with empty values, never real ones.

## Deployment

Live: **Cloudflare Pages**, project `codeblack-ops`, root directory `web/ops`, build command
`npm run build`, output directory `dist`, auto-deploying from `master`. Reachable at both
`ops.codeblackwx.com` (custom domain) and `codeblack-ops.pages.dev` (default Pages URL) — both
present the same Supabase login gate, since auth is enforced in-app rather than at the edge.

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
