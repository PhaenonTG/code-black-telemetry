# CSS / Design-System Notes

Working notes from the 2026-08-23 CSS foundation pass, extended by the same-day flagship phone
visual polish pass. `src/index.css` is a single ~9,600-line stylesheet; this documents what's
canonical now, what was cleaned up, and what's still real debt so a future pass doesn't have to
re-derive it from scratch.

## Shared surface language (`.cb-panel`)

`.cb-panel` (used by nearly every card in the app, directly or via the shared `<Panel>` component)
had three superseded definitions layered in this file, each heavier than the last: a plain
bordered box, then one adding `clip-path` chamfered corners and a red-tinted `::before` wash, then
one adding a radial highlight and a three-layer box-shadow on top of that. The winning (heaviest)
version was confirmed visible on real hardware -- the chamfer is subtle at this radius but real,
and the always-on red wash meant every panel had a faint red tint regardless of whether it meant
anything.

A final override block (end of `src/index.css`, "FLAGSHIP PHONE VISUAL POLISH") replaces this with
one flat rounded corner (`var(--cb-radius)`), a single soft inset highlight, and no `::before` wash
except on `--red`/`--spc`-toned panels (a left border bar only, no glow). The three earlier
generations were left in place rather than deleted -- the override wins on source order and every
property it touches is `!important`, so deleting them was not required to get a clean, verified
result, and it kept this pass's diff scoped to what was actually visually verified rather than
re-opening the same full-file archaeology the CSS foundation pass already did once.

## Home module visual weight

`.home-module--radar` now gets real anchor treatment (240px+ min-height, matching map). Chase/
Alerts/System modules get a smaller min-height when not in their "expanded" size, so a quiet Chase/
Alerts state reads as quiet, not the same visual weight as an active one. This is presentation
only -- `HomeOverviewPage.tsx`'s module order, visibility, and size preferences are untouched and
remain fully user-controlled per module.

## Weather hero metric

`MetricTile` (`Panel.tsx`) gained an optional `hero` prop, applied only to Temp
(`WeatherObservationPanel`) and Speed (`WindCard`). This is additive, not a rewrite of the
`.metric-tile` cascade documented below -- deliberately, since that cascade is exactly as
fragmented as `.bottom-dock` was (see below) and fighting it directly was out of scope for a
polish pass.

## Canonical token system

`--cb-*` (defined in the second `:root` block, e.g. `--cb-black`, `--cb-red`, `--cb-header-h`,
`--cb-radius`, `--cb-shadow`, `--cb-glow-red`, `--cb-fast`/`--cb-medium`) is the source of truth.
It has strictly more tokens than the short-name set (radius/gap/shadow/timing have no short-name
equivalent) and is what every recently-touched component actually references.

The short names (`--bg`, `--panel`, `--text`, `--red`, `--amber`, `--green`, `--blue`, `--muted`,
`--secondary`, `--border`, `--top-h`, `--dock-h`, `--dots-h`, `--gap`) remain as a deliberate public
alias layer -- 183 existing `var(--red)`/`var(--text)`/etc. call sites depend on them, far more than
reference the `--cb-*` names directly for color. They used to be defined *twice*: once with literal
hex values in the first `:root` block, and again in the second block aliasing to `--cb-*`. The
second definition always won (same specificity, later in source order), so the first block's values
were dead weight -- removed. `--spc` and the `--z-*` stacking-order tokens have no `--cb-*`
equivalent and still live in the first block; that's correct, not leftover.

**If you need a new color/surface token:** add it to the `--cb-*` block, then alias a short name to
it in the second `:root` block only if it needs a terse call-site name. Don't add a second literal
definition anywhere else.

## The map-controls/legend bug (fixed) and what it teaches

The "FOLLOW NORTH overflows its container" symptom reported in the prior read-only audit was not a
text-overflow bug. `.atlas-radar-strip` (the legend) and `.atlas-map-controls` (the NORTH/CLEAR
TRAIL/MOSAIC/LAYERS toolbar) are two independently `position: absolute` elements. A dead rule left
over from an earlier icon-button toolbar design (`.map-controls { position: absolute; left: 12px;
top: 12px; ... }`, matching `<button>` children that no longer exist in the current DOM) had its
`top`/`left` values survive the cascade because no later, still-live rule happened to redeclare
those two specific properties -- everything else about that old rule lost to newer rules, but
`top`/`left` didn't have a competing declaration, so a three-generation-old value won by default.
The effect: the toolbar stretched to cover almost the entire map canvas and started at the exact
same corner as the legend, so the legend visually sat on top of the toolbar's first button and only
its tail ("...RTH") peeked out to the side.

This class of bug -- a property surviving from a rule whose *other* properties are all dead --
doesn't show up by reading any single rule in isolation, and grep alone won't find it. What worked:
`document.styleSheets` enumeration from the live WebView (via `s24-webview-evaluate.mjs`) to list
every rule actually matching the element, in cascade order, then reasoning about which rule wins
each *property* independently. `getComputedStyle()` alone is necessary but not sufficient here --
it tells you the final value, not why it's dead code waiting to matter again the next time someone
edits a neighboring rule.

## Percentage `max-height` on an absolutely-positioned popover: doesn't do what it looks like

While fixing the Layers popover/ESCAPE collision (map, phone), the first attempt set
`.atlas-layers-popover { max-height: calc(100% - 76px) }`. Measured on-device, this had **zero**
effect -- the popover's actual rendered height (295px) was already under the cap. The popover is
`position: absolute` with no explicit height on its containing block, and CSS resolves a percentage
`max-height` against the containing block's own height *only if that height is definite* -- against
an `auto`-height ancestor, a percentage max-height computes to `none`. The fix used `min(58dvh,
420px)` instead (viewport-relative, not containing-block-relative), and separately raised the
popover's own `bottom` offset above ESCAPE's height, since the real conflict turned out to be
vertical position (both bottom-anchored in the same strip), not height. Lesson for next time:
percentage sizing on an absolutely-positioned element needs the containing block's own height
verified as definite before trusting it to do anything.

## `MetricTile`/`.metric-tile`: same fragmentation pattern as `.bottom-dock`

Discovered while adding the Weather hero-metric treatment: `.metric-tile` and its size-scoped
descendants (`.cockpit-primary .metric-tile strong`, `.cockpit-primary--conditions .metric-tile
strong`, `.wx-panel .metric-tile strong`, etc.) are defined across roughly a dozen locations in
`index.css`, the same "many generations, later-wins" pattern documented for `.bottom-dock` and
`.cb-panel` above. There's even an existing but ineffective `.cockpit-primary--conditions
.metric-tile--temp strong` rule that suggests someone already attempted a hero-temp treatment once
and it got buried under later, equal-sized rules. This pass did not attempt to untangle it -- the
new `hero` prop and `.metric-tile--hero` class are additive and placed in the final override
section, which reliably wins on source order without needing to touch the existing rules. A future
full `.metric-tile` consolidation would follow the same live-cascade-verification method as
`.bottom-dock`, and is a reasonable candidate for the same kind of dedicated pass.

## Debug/QA hooks and multiple mounted map instances

`AtlasMap` can be mounted 2-3 times simultaneously on phone (Home's radar module in `compact`
mode, Weather's compact map, and the primary Map-page instance in `full` mode -- the swipeable
pager keeps every page alive, per the comment on `AtlasMapProps.active`). Any `window.*` debug
hook registered from inside `AtlasMap`'s render body needs an explicit guard (this pass added
`if (compact) return;` to `window.__codeblackDebugJumpToCamera`'s effect) or whichever instance's
effect runs last silently wins the shared global, regardless of which map a test script actually
intends to control. This cost real debugging time this pass (see
`docs/UI_POLISH_RECOMMENDATIONS.md`'s camera-detail note) before being traced to its root cause.

## `.bottom-dock`: real duplication, deliberately not fully rewritten this pass

`.bottom-dock` is touched by roughly 50 separate rule fragments across `index.css`'s ~51 media
query blocks (down from ~90 raw grep hits once you exclude ones that were just `z-index`/state
selectors on the same element). Two were exact, same-breakpoint duplicates and have been removed:
a stale rule whose own comment referenced a "7-button dock" that hasn't existed since before the
Home/Map/Weather/Alerts/More restructure (its `grid-template-columns: repeat(7, ...)` was
confirmed dead -- the real dock already renders 5 equal columns in both portrait and landscape --
so the whole declaration was removed, not just recolored), and a `width: min(1080px, calc(100vw -
24px))` rule tripled verbatim under the same `orientation: portrait` condition, collapsed to one
copy.

The other ~47 fragments are *not* byte-identical -- each is a distinct rule scoped to its own
breakpoint. Collapsing those into "one coherent base block plus minimal overrides" is a real,
valuable cleanup, but it requires the same live-cascade-computed-style verification technique used
for the map-controls fix, repeated across every meaningfully different viewport (phone portrait,
large-phone portrait, phone landscape, tablet landscape, desktop) before and after, to be sure no
breakpoint's actual rendered spacing/sizing silently changes. That's a full pass on its own, not a
"low-risk, narrow-scope" edit, and `.bottom-dock` is the one component that's on every screen in a
moving vehicle -- the wrong place to rush. Recommended as its own dedicated follow-up pass, using
the same methodology documented above.

**2026-08-23 update:** the flagship-polish pass added one more phone-portrait final-override block
codifying the live-cascade-verified ground truth (5-column grid, height/padding/gap) that was
already rendering, plus a calmer filled-pill active-tab treatment -- a safety/consolidation step,
not the full rewrite described above, which remains open.

## Other confirmed-dead code found but not touched

`.app-shell--page-locate` no longer matches anything -- the page key is `map`, not `locate`, after
the earlier Locate-to-Map rename (`App.tsx` sets `app-shell--page-${page}`). One dead
`.atlas-map-controls` media-query rule scoped to it was removed as part of the map-controls fix
since it was directly adjacent to the code being touched anyway. A `git grep -- "page-locate"` in
`src/index.css` will surface any others; none were touched in this pass to keep the diff scoped to
what was actually verified.

## Screenshot capture method for camera detail

See `docs/rendered-control-walkthrough.md`'s "UI Screenshot Baseline" section for how
`07-camera-detail.png` is captured deterministically from live provider data via the
`window.__codeblackDebugJumpToCamera()` QA hook in `AtlasMap.tsx`.
