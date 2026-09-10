#!/usr/bin/env sh
# Build and deploy web/overlay (classic.html, classic-v2.html, alert-feed.js) to the live,
# multi-location-accessible overlay URL.
#
# Run this from your DEV MACHINE -- it builds web/overlay locally and pushes the result to
# Cloudflare Pages via wrangler. It does NOT need to run on Core.
#
# Confirmed live (2026-09-10):
#   - Cloudflare Pages project: codeblack-overlay (no git integration -- deploys are manual,
#     via this script or a bare `wrangler pages deploy`, not triggered by git push).
#   - Stable URL: https://codeblack-overlay.pages.dev/classic-v2.html (also .../classic.html,
#     .../alert-feed.js). This is the one URL every OBS instance -- however many chase
#     locations are streaming at once -- should point Browser Source at, instead of each
#     needing its own local copy of the file.
#   - Per-operator identity comes entirely from URL query params, no code change needed per
#     location:
#       ?title=<name>&unitId=<cbwx-unit-id>              live GPS tracking (needs a unit_id
#                                                          already registered/publishing in Core)
#       ?title=<name>&latitude=<lat>&longitude=<lon>      fixed/manual position (no live GPS
#                                                          needed -- use this for a location
#                                                          without a registered chase unit yet)
#     Known registered units as of this commit: cbwx-unit-tessa (Nick), cbwx-unit-striker
#     (Spencer). A third+ location needs either its own registered unit_id in Core, or just
#     runs in manual lat/lon mode.
#
# Requires `npx wrangler` (already used ad-hoc for prior deploys of this project) and being
# logged in / having Cloudflare API credentials available to it.
set -eu

cd "$(dirname "$0")/web/overlay"

echo "== Building web/overlay =="
npm run build

echo "== Deploying dist/ to Cloudflare Pages (codeblack-overlay) =="
npx wrangler pages deploy dist --project-name=codeblack-overlay --branch=main --commit-dirty=true

echo "== Live at =="
echo "  https://codeblack-overlay.pages.dev/classic-v2.html"
echo "  https://codeblack-overlay.pages.dev/classic.html"
