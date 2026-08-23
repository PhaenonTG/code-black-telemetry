# CSS / Design-System Notes

Working notes from the 2026-08-23 CSS foundation pass. `src/index.css` is a single ~9,600-line
stylesheet; this documents what's canonical now, what was cleaned up, and what's still real debt
so a future pass doesn't have to re-derive it from scratch.

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
