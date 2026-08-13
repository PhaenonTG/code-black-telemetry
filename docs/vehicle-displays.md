# Vehicle Display Surfaces

Code Black OPS stays tablet-first. Vehicle display support is intentionally glance-only.

## Android Auto

The Android project includes a read-only Android Auto Weather app service for local testing:

- Service: `com.codeblackwx.ops.car.CodeBlackCarAppService`
- Category metadata: `weather`
- Template: `PaneTemplate`
- Data source: `codeblack.vehicleDisplaySnapshot` from Capacitor Preferences

The car surface shows:

- Current location as nearest city/state when resolved
- Conditions: temperature, dewpoint, humidity, pressure
- Wind: speed, direction, gust
- Snapshot age

The main app publishes the snapshot while it is running. If Android Auto opens before the tablet app has published data, it shows a waiting state.

### Current Status

This surface is experimental until tested on a real Android Auto host or head unit. The service
currently uses AndroidX Car App's permissive local-testing host validator so the app can be opened
outside Play review. Do not treat that as release-ready Android Auto hardening.

Before wider Android Auto distribution:

- Replace the local-testing host validator with a production host validation path supported by the
  target AndroidX Car App release.
- Confirm the app category and template behavior on the Android Auto Desktop Head Unit or a real
  vehicle head unit.
- Keep the surface glance-only: current location, conditions, wind, and update age.

## CarPlay

Do not build a full custom CarPlay dashboard. Apple CarPlay is entitlement and template controlled.

The intended iOS path is a Live Activity / widget style surface with the same glance-only payload:

- Current location as nearest city/state
- Conditions
- Wind

That requires a WidgetKit/ActivityKit target and Apple-side validation in Xcode/CodeMagic. The shared `codeblack.vehicleDisplaySnapshot` shape is the data contract to reuse when adding the iOS widget extension.
