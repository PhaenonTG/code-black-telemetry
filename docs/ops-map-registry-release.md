# OPS map-source registry release

Status: **release candidate only; not deployed**. The production branch is `master` and the
Cloudflare Pages Git integration deploys that branch to `ops.codeblackwx.com`. Do not push the
unrelated-history `feature/chase-public-config-v1` branch to `master`.

The candidate branch is pushed and has a Pages preview at
`https://d7675f12.codeblack-ops.pages.dev` (initial deployment of `df04ae7`; subsequent
branch commits may have a newer preview URL). Public route and anonymous gateway smoke
checks passed, but authenticated map-registry QA remains pending. See
`docs/security-hardening-2026-10-11.md` for the independent radar and usage-monitor
production hotfixes; those do not imply this OPS candidate was promoted to production.

The candidate branch `release/ops-map-registry-20261011` starts at production commit `cdd9d70`
and ports only the requested camera audit and source-registry changes. The five additive
Supabase migrations are already applied to `codeblack-ops`; do not re-run them manually.

## Preflight

1. Fetch `origin/master` and confirm this candidate remains a descendant of the latest
   production commit. If production advanced, rebase/integrate and rerun every check below.
2. Confirm the diff is limited to OPS map, registry, camera-health, their tests, and docs.
   Confirm no credentials or `.env` files are staged.
3. Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/ops-map-registry-preflight.ps1`
   from the release worktree. It enforces clean-tree/production ancestry and runs root and OPS
   tests, typecheck, dependency audit, and build. For repeat local checks after installation,
   add `-SkipInstall`.
   In `web/ops`, the underlying commands are `npm ci`, `npm run typecheck`, `npm test`, `npm audit`, and `npm run build`.
   The build requires the Cloudflare Pages environment variables already used by OPS; no
   service-role credential belongs in the client.
4. The root audit currently reports
   vulnerable native Capacitor packages; those are **not** bundled into this OPS web release
   and require a separate mobile-app update before its next release.
5. Smoke the authenticated Map Sources screen at 390 px and desktop width. Review a camera,
   verify the status updates, hide a dot, refresh the map, and verify it remains hidden.
   Verify the hurricane page, Status Center, Radar Lab, and camera viewer still open.
6. Test a non-OPS account and an anonymous session: neither should read the registry or call
   `register_map_sources`. Current database RLS and grants deny anonymous access.
7. Deploy a Cloudflare Pages **preview** from the candidate branch and verify the same flows
   against production Supabase before advancing `master`.

## Production and rollback

After preview acceptance, fast-forward only this verified candidate into `master` (or use the
normal reviewed merge workflow). Record the pre-deploy `master` SHA and Cloudflare deployment ID.
Watch the Pages build and test `ops.codeblackwx.com/map-registry`, existing OPS routes,
and map camera/POI layers on phone and desktop. If there is a regression, roll back the
Cloudflare Pages deployment to the recorded previous deployment. The additive database schema
can remain in place; the prior frontend does not consume it.

Do not call this release fully verified until an authenticated live-session smoke test and
preview deployment pass. The local browser QA used mocked Supabase responses and cannot prove
the production auth/session path.
