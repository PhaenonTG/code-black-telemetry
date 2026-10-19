# Device Test Checklist

Use this before pushing a mobile build to testers or burning another iOS build.

## Android Tablet

- Install `android/app/build/outputs/apk/debug/app-debug.apk`.
- Launch once and dismiss the Spotter Network prompt with either sign-in or Skip for now.
- Weather: confirm the six fixed cards fit in landscape with no page bleed from Operations.
- Weather: confirm map/radar renders and can be opened through Locate.
- Dock: confirm every bottom button is visible, anchored to the bottom edge, and tappable.
- Alerts: confirm summary cards and full alert wording are readable.
- Report: confirm the report form and nearby report feed both fit and scroll cleanly.
- Layers: confirm layer toggles and pin controls do not overlap text.
- Settings: confirm Display, Alerts, Pi Connection, Spotter Network, Report Feed, Diagnostics,
  Teams, Lighting, and Chase Session are reachable by scrolling.
- Settings > Diagnostics: screenshot this panel for any bug report.
- BLE: confirm no repeated Bluetooth pairing popup after dismissing or pairing.
- Radar: confirm Weather and Locate both show the wide-area mosaic and no retired single-site controls.

## Android Phone

- Repeat Weather, Alerts, Report, Layers, and Settings in portrait.
- Rotate to landscape briefly and confirm the icon-only dock does not clip.
- Confirm the front camera/notch area does not cover the top status/header text.

## iPad / iPhone

- Install through SideStore/AltStore after the source JSON has refreshed.
- Confirm the installed app version matches the newest `altstore-source.json` version.
- Weather: confirm tablet landscape remains fixed-card, not movable/swipe-reorder cards.
- Alerts: confirm the full warning wording is visible, not just shortened titles.
- Report: confirm Spotter Network sign-in and nearby feed settings render.
- Wireless update: confirm SideStore can find AltServer before using a wireless update path.
- Wired fallback: confirm USB install still works if wireless discovery fails.

## Tester Screenshot Set

Ask testers for these screenshots:

- Weather dashboard landscape
- Alerts page
- Report page
- Layers page
- Settings > Diagnostics
- Any Bluetooth permission/pairing prompt that repeats

## Stop Conditions

Do not push to wider testers if any of these happen:

- Dashboard shows neighboring pages clipped into view.
- Dock buttons are cut off or untappable.
- AltStore source reports invalid JSON or mismatched expected/downloaded version.
- Radar map is blank on both Weather and Locate.
- Bluetooth prompt repeats after pairing/dismissal.
- Settings > Diagnostics does not show build/commit/platform data.
