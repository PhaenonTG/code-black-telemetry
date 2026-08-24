# Code Black OPS — Responsive Web Foundation

The first responsive web build of Code Black OPS, targeting `ops.codeblackwx.com`. This is
**not** a rewrite of the existing Capacitor app — it's a new, separately-packaged shell that
reuses the existing app's real map, weather, alerts, and settings logic directly via cross-package
import, and adds a genuinely responsive chrome (desktop sidebar, tablet rail, phone bottom nav)
that the existing single phone-shaped shell doesn't have.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full reasoning, what's reused vs. new,
the auth/deployment plan, and known limitations.

## Quick facts

- Package boundary: `web/ops/`, isolated the same way `web/public/` is (own `package.json`,
  `vite.config.ts`, and an intentionally empty `postcss.config.js` so it doesn't inherit the root
  app's Tailwind config).
- The map, weather, and alerts pages import real modules from the root app's `src/` directly
  (e.g. `import { AtlasMap } from "../../../../src/map/AtlasMap"`) rather than duplicating them.
  `vite.config.ts` grants Vite's dev server permission to serve files outside this package
  (`server.fs.allow`) so that works in both dev and build.
- Phone bottom nav is exactly **Home / Map / Weather / Alerts / More** — a locked product
  decision, not something this pass changed.
- No visible MARK button. ESCAPE stays inside the map UI (unchanged, reused as-is).
- Mosaic-only radar direction preserved; Level II product switching stays deferred.
- CodeBlack-Core is offline today — every status surface says so honestly instead of hiding it.

## Run

```bash
npm install
npm run dev      # http://localhost:5176 in this pass's testing; vite picks a free port by default
npm run build
```

Copy `.env.example` to `.env` and fill in a real Mapbox token to see the map/radar render locally
(same variable names as the root app: `VITE_MAPBOX_ACCESS_TOKEN`, `VITE_ATLAS_MAPBOX_STYLE`), plus
the Supabase project's URL and publishable key (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`) to see the login screen actually authenticate.

## Auth

Production auth is **Supabase Auth (email + password)**, enforced inside the app — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#auth-architecture) for the full model (the
`profiles` authorization table, RLS policy, and why a valid Supabase account alone isn't enough to
reach OPS). There's no public signup; accounts are created directly in the Supabase dashboard.
