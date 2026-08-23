# UI Polish Recommendations — 2026-08-23

Companion doc to the flagship phone visual polish pass. Keeps what was actually implemented
separate from what's recommended for later, per that pass's own instructions.

## What changed this pass

See `CHANGELOG.md`'s "Flagship Phone Visual Polish" entry for the full list. Summary: flattened
`.cb-panel` surface language app-wide, trimmed header height and hid the phone subtitle, gave
Home's radar module real visual anchor weight and quieted Chase/Alerts/System when calm, added a
Weather hero metric (Temp, Wind Speed), added an Operations "Field Status" summary panel, fixed a
duplicate-icon bug on two Operations panel titles, fixed the map's landscape toolbar/expand-button
collision, fixed the Layers popover/ESCAPE tap-zone collision, and reworked camera/pin popup
placement to be room-aware instead of assuming a fixed width always fits.

## Design system decisions

- `.cb-panel` is now visually flat (rounded corner, one soft inset highlight) instead of chamfered
  with a triple-layer shadow. Red is reserved for panels flagged `--red`/`--spc`.
- `MetricTile` gained a `hero` prop (bigger, bolder, hides its leading icon letter) for exactly one
  metric per card where a true glance-value exists (Temp, Wind Speed). Not applied broadly --
  applying it everywhere would just recreate the "everything is equally weighted" problem it fixes.
- Home module visual weight (size) is now differentiated by module type + state (radar large,
  Chase/Alerts/System small when quiet) while module order/visibility stays 100% user-controlled.
  See `docs/css-design-system-notes.md` for the full technical writeup, including two real
  debugging lessons from this pass (percentage `max-height` on an absolutely-positioned element,
  and multiple simultaneously-mounted `AtlasMap` instances racing to register the same debug hook).

## Screenshots

- Before: `artifacts/ui-review/s24-ui-foundation/` (15 files, from the CSS foundation pass)
- After: `artifacts/ui-review/s24-flagship-polish/` (14 of 15 files -- `07-camera-detail.png` was
  not captured this run; see the Camera Detail section below)

## Route-by-route review

**Home** -- Clearly better. Radar module now reads as the page's visual anchor instead of one card
among six identical-looking cards. Field Status/Chase/Alerts modules read calm-vs-active correctly.

**Home Customize** -- Unchanged from the CSS foundation baseline (flattened panel styling carries
through, functionally identical). Up/Down + checkbox + size dropdown remains functional but plain.

**Map** -- Clearly better. Flat legend, compact bottom-right toolbar (already fixed last pass),
landscape collision now fixed, Layers popover no longer competes with ESCAPE.

**Map Layers popover** -- Better (icon parity from last pass, collision fixed this pass).

**Map Escape (hold-to-arm)** -- Unchanged functionally; toast/button now sit in a visually calmer
map. Real hold-to-arm state captured live in the screenshot.

**Expanded Radar** -- Unchanged structurally; inherits the flatter panel language and fixed toolbar.

**Camera Detail** -- Not captured this pass. See dedicated section below.

**Weather** -- Clearly better. Temp/Wind now read as hero numbers; RH/Dew/Pressure correctly
secondary. Phone-only system panels visually quieted, not removed.

**Alerts** -- Better (flatter panel language, calmer no-alert state). Severity-specific styling
(tornado/PDS/severe/watch/MD) is pre-existing and was not touched or re-verified against a live
severe product this pass (none was active in Arkansas at test time).

**More** -- Better. Flatter row treatment, less "menu card" feel.

**Operations** -- Clearly better; the biggest structural win in the pass. Field Status answers
"is anything down" in one glance; detailed cards below are unchanged but read calmer.

**Report** -- Unchanged functionally; inherits flatter panel language.

**Settings** -- Unchanged by design (explicitly out of scope beyond shared-token inheritance).
Verified no regression.

**Layers page** -- Unchanged by design (explicitly out of scope). Verified no regression.

## Camera Detail: what's real, what isn't

The placement fix in `AtlasPinMarkers.ts` (`pinPopupPlacementFor`) is real, implemented code with
verified-correct math: it measures actual room on each side of the marker within the map's own
container width (confirmed on-device to be as narrow as 312px on a phone-width card, not the full
device width), picks whichever side has more room, and sizes the popup to what that side can
actually hold (floored at 160px so it never becomes unreadable). This was arrived at after
diagnosing, with real on-device measurements, that the original attempt (a fixed anchor threshold
based on half the popup's preferred width) was mathematically insufficient for a container this
narrow relative to the popup's preferred width.

What's missing: a final on-device screenshot showing a clicked popup with zero clipping. Repeated
attempts to reproduce the exact scenario via the screenshot script hit live-provider marker
clustering that made a specific un-clustered marker unreliable to land on within the automation's
timeout, even after raising the jump zoom level and retrying. This is a test-automation limitation,
not a sign the fix is wrong -- but it means the fix should be treated as **implemented and
reasoned-through, not yet visually confirmed**, and worth a specific manual check next time someone
is on the device.

## Recommendations (not implemented this pass)

### MUST FIX
- Finish visually confirming the camera popup placement fix on a real device (open several camera
  markers near different screen positions -- left edge, right edge, bottom edge -- and confirm no
  clipping on any of them).
- Investigate the S24 `force-stop-while-active` hardware-walkthrough failure. Confirmed this pass
  (via isolation testing against an unmodified master build, and a full device reboot) to be
  pre-existing and environment/device-related, not caused by any change in this pass -- but it
  still blocks a clean S24 suite run and deserves its own root-cause pass.

### HIGH VALUE
- `.bottom-dock` full consolidation (the ~47 non-duplicate breakpoint-scoped fragments documented
  in `docs/css-design-system-notes.md`) -- this pass only added one more phone-portrait
  ground-truth override, the full rewrite remains open.
- `.metric-tile` consolidation, now that a second component (`.cb-panel`, `.bottom-dock` being the
  first two) has been found with the same "many generations, one silently wins" fragmentation.
  Newly discovered this pass; not previously documented.
- Extend the Weather hero-metric treatment's *reasoning* (one true glance-value per card, everything
  else secondary) to other multi-metric cards that still show equally-weighted tiles, once
  `.metric-tile` is consolidated enough to do so safely.
- A true ALL-CAPS reduction pass (the read-only audit's Phase 23/24 items) -- this pass did not
  attempt it; literal JSX caps and CSS `text-transform: uppercase` still double up in places.

### NICE TO HAVE
- Home Customize: evaluate drag-and-drop reordering vs. the current Up/Down buttons. Up/Down is
  functionally fine and lower-risk; drag-and-drop is a genuine UX improvement but real
  implementation risk (touch conflicts with the page's own scroll) for a config screen used rarely.
  Recommend leaving as-is unless a future pass has room to test drag interactions thoroughly on
  real hardware.
- Camera Detail as a bottom sheet instead of a Mapbox popup: would sidestep the entire
  anchor/width-fitting problem class this pass spent real effort on, at the cost of a bigger UI
  change (a sheet component doesn't exist yet in this app). Worth considering specifically because
  Mapbox popups are fighting the map's own coordinate system for something that's really "show me
  detail about what I tapped," which is a bottom-sheet-shaped problem on phone.
- More page as a bottom sheet instead of a full route: reasonable, low-urgency; the current full
  page reads clean and isn't a problem, just a slightly heavier navigation pattern than necessary.
- Operations: expandable/collapsible diagnostic groups below Field Status, now that Field Status
  answers the "is anything down" question -- would let the detail cards stay reachable without
  always occupying full scroll height. Not attempted this pass since Operations' detail cards
  weren't flagged as a problem, just denser-by-design (matches the read-only audit's own guidance
  that Operations may stay dense).
- Alerts: verify severity-specific card treatment (tornado/PDS should visually dominate a plain
  watch) against a real active severe product, not just code review -- none was active in Arkansas
  during this pass's testing window.

### DO NOT CHANGE
- Settings and Layers page visual language -- both explicitly confirmed reference-quality in the
  prior read-only audit and re-confirmed unregressed this pass. Any future token/shared-component
  work should treat these two as the bar to match, not touch directly.
- Home/Map/Weather/Alerts/More primary nav and Operations/Report/Layers/Settings secondary grouping
  -- locked product decision, unrelated to visual polish.
- ESCAPE's placement inside the map and hold-to-arm interaction -- unrelated to visual polish,
  explicitly out of scope.
- Mosaic-radar-as-default, MARK-hidden-but-internally-present, and all other product/data-honesty
  decisions locked in prior passes -- untouched, and should stay untouched by a visual-only pass.

## Tablet implications

Not tested this pass (S24 was the only physical target; per the read-only audit's own note, phone
CSS fragmentation is the reason tablet breakpoints inherit risk from phone-breakpoint duplication).
The `.cb-panel` flattening applies at every breakpoint (not phone-scoped), so tablet should inherit
the calmer surface language automatically -- worth a screenshot check next time a tablet is
available, but no tablet-specific code was written or assumed in this pass.

## Recommended next pass

A dedicated `.bottom-dock` + `.metric-tile` consolidation pass, using the same
live-cascade-verification methodology proven twice now (`.cb-panel`'s map-controls bug in the CSS
foundation pass, and this pass's popover/`max-height` lesson). Both are now clearly identified,
bounded, and documented -- the remaining work is mechanical rigor (measure every breakpoint before
and after), not further investigation.
