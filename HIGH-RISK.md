# mobile-ui-20261019 — HIGH-RISK (not implemented)

Gatekeeper HELD items are in `CHANGES.md`. This file is findings that must not land here: HIGH, frozen/auth/worker files, or behavior/perf changes.

| ID | Description | Risk | Proposed fix (owner) |
| --- | --- | --- | --- |
| V-7 | Auth kicker/tagline/link text below 12px | Auth reserved (`auth.css`) | Raise kicker/tagline to ≥12px via task5 |
| V-11 | Signed-in views never reach network idle (~6.6s); continuous polling | Worker/poller reserved | Delay pollers until idle; pause while hidden. Needs perf trace |
| V-13 | Outlook map pinch/pan/scroll-hijack not verified (map below fold) | Map reserved | Expand map on device and run touch gesture tests |
| V-15 | Drafts loading spinner may be stuck | Logic, not CSS | Investigate AnalysisWorkspace loading state |
| VOLT-11 | Location chip popover does not close on Escape | Behavior change | Close on Escape / outside tap in ChaseWorkspace |
| P1 | Producer situation map traps one-finger vertical drags | Map gesture behavior | `cooperativeGestures: true` (or dragPan off until tap) |
| P2 | 3–7 long tasks on Producer load (max 124–167 ms) | Perf / chunk work | Profile Producer polling/render on load |
| RIP-14 | `/update-password` card pinned to bottom (no `.auth-screen__status`) | Auth layout + `UpdatePassword.tsx` | `margin-block: auto` on `.auth-card`, or render status on every auth screen |
| RIP-15 | Unauthorized card same bottom-pin as RIP-14 | AuthGate / Unauthorized | Same as RIP-14; verify with a no-profile account |
| RIP-16 | Landscape login card clipped; no scroll above 767px | `auth.css` reserved | `overflow-y: auto` + safe-area on `.auth-screen` at all sizes |
| RIP-17 | "Back to sign in" 23px / 11.5px on recovery screens | `auth.css` reserved | 44px `.auth-card__link` under `(pointer: coarse)` |
| RIP-18 | Update-password "Back to sign in" hit area is text-only | Auth reserved | `inline-flex` + padding or full width |
| RIP-19 | Auth inputs `outline: none` with only a 1px red border | Auth reserved | Visible `:focus-visible` ring |
| RIP-20 | Forgot/update status messages have no `role=alert`/`aria-live` | Auth TSX | `role="alert"` errors / `role="status"` ok |
| RIP-21 | Confirm password has no toggle; mismatch copy is generic | `UpdatePassword.tsx` | Distinct mismatch message + `aria-describedby` |
| RIP-22 | Unauthorized has only SIGN OUT; no admin contact | `Unauthorized.tsx` + auth.css | Admin contact link ≥44px; keep 13px body beyond phones |
| SON-1 | Status Center tap targets under 44px | `StatusCenter.tsx/.css` do-not-touch | min-height 44px on those controls via task5 |
| SON-2 | Status Center ~88 text nodes under 12px | `StatusCenter.css` do-not-touch | Raise labels/values to `--cb-text-min` ≥12px via task5 |
| SON-6 | `/ai` "RETURN TO OPS" 10px / 105×40 landscape | `AiHandoff` frozen | `.page-action-link` 12px / 44px via task5 |
| SON-8 | Chase/field/weather/hurricane 2.8–3.4s long tasks | Perf | Lazy-load map layers; split mapbox setup |
| SON-9 | CLS 0.056–0.092 on potential/outlook/alerts/telemetry | Layout shift | Reserve min-height for async panels |
| SON-10 | Chase/setup-review splash then "Loading…" 1–4s | Perf / UX | Skeleton UI; prefetch chase chunk |
| SON-11 | Hurricane "Loading the latest assessment…" 3.3–3.5s | Perf | Show cached last assessment; defer heavy work |
