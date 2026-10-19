# Code Black WX Overlay — Design System v1 (derived from Brand Reference v1)

Status: DEVELOPMENT. Implements `code-black-brand-reference-v1.md` for `web/overlay`.

## 1. Screen composition

- One persistent **Command Rail** anchored to the bottom edge, inside the safe margin. Everything
  persistent (brand mark, location, freshness, Storm Intel) lives in this one chassis instead of
  three floating boxes.
- The Hodograph docks to the Command Rail's left end as an attached module (shares the same
  chassis material/edge), not a separate floating panel elsewhere on screen.
- The entire vertical span above the rail (~86% of frame height) is permanent video safe area —
  nothing is ever placed there in the persistent state.
- EventTakeover is the only element allowed to temporarily dominate more of the frame (upper-center
  band), then retracts cleanly back to the rail.

## 2. Primary chassis

- Field: near-black gradient (`#000000` → `#171A1D`), not translucent glass. No `backdrop-filter`.
- Identity edge: a 2px Signal Red top edge on every chassis surface (rail, hodograph module,
  takeover card).
- Geometry: corners clipped via `clip-path` (angled cut), not `border-radius`. One shared clip
  shape (`--cb-clip`) reused everywhere for visual consistency.
- Dividers between rail segments are 1px white-10%-opacity hairlines, not gaps/shadows.

## 3. Typography hierarchy

1. Brand kicker ("CODE BLACK WX") — smallest, Signal Red, condensed caps, wide tracking. Present
   but quiet.
2. Location — white, bold condensed, largest identity text.
3. Featured metric value — white, bold, tabular numerals, largest data text.
4. Metric labels / secondary values — Utility Gray, small condensed caps.
5. Source/time/freshness — Utility Gray, smallest, monospace.
6. Alert headline — largest text on screen, condensed caps, semantic color (never brand red for
   non-tornado alerts).

Condensed feel achieved with `Oswald` (headlines/labels) + existing Inter/mono for data, since no
licensed condensed typeface is confirmed available yet (brand doc: don't mimic logo lettering
without a known licensed face).

## 4. Storm Intel language

Replaces six equal rotating cards with a **featured-metric bay + secondary strip** inside the
Command Rail:

- One large featured metric rotates through a fixed priority order (STP/SCP -> MLCAPE -> 0-6km
  Shear -> 0-1km SRH -> LCL -> lapse rate), each shown large with source/age in restrained text.
- A compact secondary strip (Temp/Dewpoint/CIN/RH) sits beside it, always visible, small.
- Storm Environment Score stays fixed (it's the synthesized headline, not part of the rotation).
- Hodograph is visually part of the same rail package, not a separate widget.

## 5. Alert language

All EventTakeover kinds share one chassis (angled card, red top edge, brand bug) with only the
semantic accent color changing (Tornado Warning/Observed = red, Severe/Watch = yellow, MD = neutral
white/gray -- never brand red for a discussion). Entry/exit is a clipped horizontal wipe, not a
fade+scale pop.

## 6. Motion

- Entrances: `clip-path` wipe reveals, ~280-360ms, ease-out, one direction (left-to-right or
  top-down), no bounce/scale-overshoot.
- No infinite pulsing anywhere (fixes the current stale-freshness dot violation) — a state change
  gets a single one-shot flash, not a perpetual animation.
- Featured-metric rotation crossfades quickly (180ms) with a small clipped slide, not a scale pop.
- `prefers-reduced-motion` continues to collapse all durations to ~1ms (existing token behavior
  preserved).

## 7. Brand presence

- Persistent small corner bug: the shield mark (`src/assets/codeblack-shield.png`), ~56px, top-left
  corner of the frame, quiet.
- EventTakeover shows a larger version of the same mark for identity during alerts.
- Full logo is never used as a background pattern, watermark, or repeated texture.
