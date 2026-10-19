# mobile-ui-20261019 — CHANGES

Branch: `grokcli/ops-mobile-ui-20261019T2115Z`
Base: `d6fabf8`

## IMPLEMENTED (39)

### GO with conditions
| ID | What |
| --- | --- |
| VOLT-2 | One Mapbox ctrl rule, 44×44, scoped to `.potential-map` and `.hurricane-watch__map` under `(pointer: coarse)`. No global `.mapboxgl-ctrl`. |
| VOLT-5 | Same Mapbox rule. Hurricane chips 44px / 8px gap; Hide, NHC links, toolbar 44px; forecast markers `::after` hit area; horizontal scroller at ≤360. CSS-only. |
| VOLT-6 | Chase desk 44px targets and 16px radar select in `Workspaces.css`. `ChaseRadarPanel.tsx` untouched. |
| RIP-2 | `.page-settings .switch input { inset: -11px -3px }` keeps 38×22 visual, expands hit area. |
| RIP-6 | `.statusbar > a` min-height 44px only (not global `.ops-pill`). |
| RIP-9 | `.shell` / `.sidebar` `env(safe-area-inset-left/right)` only inside `@media (max-height: 500px)`. |
| RIP-10 | Auth 16px inputs / 44–48px controls duplicated under `@media (pointer: coarse)` in `mobile.css` only. Covers V-6. No `auth/**`, no `AuthGate.tsx`. |
| RIP-12 | Unmatched routes: `activePhoneRoute` returns `""` (no bottom-nav tab). More children still `/more`. NotFound kicker is `Page not found` (no ADMIN). Tests added. |

### GO
| ID | What |
| --- | --- |
| VOLT-3 | Tornado Potential checkbox label min-height 44px; box 22px. |
| VOLT-4 | `.analysis-time-stepper` buttons 44px / 14px, nowrap. |
| RIP-1 | `.location-control select { font-size: 16px }`. |
| RIP-3 | `.segmented button { min-width: 44px }`. |
| RIP-4 | `.page-settings input, select { font-size: 16px }` at ≤767px. |
| RIP-7 | `.shell .ops-not-found__actions :is(a,button) { min-height: 44px }` beats beauty 36px reset. |
| RIP-8 | `.bottom-nav__link` and `.location-control__name` 12px. |

### Unreviewed LOW (CSS/layout)
| ID | What |
| --- | --- |
| V-1 | Outlook source links `inline-flex` min-height 44px under `(pointer: coarse)`. |
| V-2 | Source/link containers `min-width: 0; overflow-wrap: anywhere` at ≤480px. |
| V-3 | Day-cell labels `word-break: normal; hyphens: auto` (no mid-word "Withhel/d"). |
| V-4 / V-14 | Setup Review tab rail: overflow-x, scroll-padding, snap, wider fade; wrap below 400px. |
| V-5 | Statusbar pill links 44px at all widths (same as RIP-6), so landscape phones are covered. |
| V-8 | 12px floor for kicker/pill/route/name/nav/`time`/`small` at ≤767px; `.setup-review-desk small` 12px; `--cb-text-min: 12px`. |
| V-9 | Today briefing checkbox label full-width 44px row; input 22px. |
| V-10 | Chase "Open Aegis Alerts →" / intel links `inline-flex` min-height 44px. |
| V-16 | Setup Review `…` summary min 44×44. |
| VOLT-9 | Hour-step group nowrap + overflow-x so +1 h does not wrap under −1 h. |
| P3 | Phone `.soundings-main` sizes to content (`min-height: auto; overflow: visible`), override after beauty.css. |
| P4 | Soundings inputs 16px / 44px; Search ≥12px / 44px at ≤767px. |
| P5 | Producer inputs `font-size: 16px`. |
| P6 | Producer / sources Refresh buttons min-height 44px. |
| P7 | Control/Sources `.section-tabs` min-height 44px. |
| P8 | Reconnect Facebook / Team / Facebook Live Producer links min-height 44px. |
| P9 | "Open private PROGRAM monitor →" padded to 44px. |
| P10 | "Producer › Sources →" padded to 44px. |
| P11 | Producer unit labels / map link ≥12px; map link 44px. |
| SON-3 | `.page-header__kicker` and `.ops-pill` 12px. |
| SON-4 | `.automation-lab__check` and feed link min-height 44px (not only at 360). |
| SON-5 | `.page-action-link` and operations inline links min-height 44px. |
| SON-7 | Same statusbar pill 44px hit area as RIP-6. |

V-6 is the same `mobile.css` coarse-pointer auth fix as RIP-10 (counted once).

## HELD (3) — Gatekeeper, not implemented

| ID | Why held |
| --- | --- |
| RIP-5 | Protected map overlay (`OpsWorkstation.tsx` / `ContextualMapPanel.css`). |
| RIP-11 | `MobileHome.tsx` frozen; needs task5 sign-off. |
| RIP-13 | New drawer/nav sheet is a product decision; keep More hub. |

## SKIPPED (1)

| ID | Reason |
| --- | --- |
| V-12 | INFO only. `viewport-fit=cover` is already on `web/ops/index.html`. No CSS change. |

## HIGH-RISK — not implemented

See `HIGH-RISK.md` (23 items: V-7, V-11, V-13, V-15, VOLT-11, P1, P2, RIP-14..RIP-22, SON-1, SON-2, SON-6, SON-8..SON-11).
