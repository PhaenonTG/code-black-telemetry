# Security hardening release gate — 2026-10-11

This branch preserves the previously prepared OPS map registry release. It also includes
radar, Storm Intel, dependency, and usage-monitor hardening. The usage-monitor Worker,
radar worker, and radar relay have been deployed; the OPS Pages candidate, Storm Intel
projection, and frontend/dependency changes are **preview only**. Do not treat all
repository changes as live.

## What was found

- A browser-bundled value authorized public writes to process-global radar selection and
  storm motion. The new Node worker is read-only; web SRV motion is per request and manual
  settings stay local to the browser. The relay temporarily accepts a bounded legacy motion
  POST, but only sets that viewer's scoped cookie and never forwards a mutation to Node.
  This keeps already deployed browser clients functional during rollout. The native radar
  API remains unchanged.
- The former POST path buffered unbounded bodies in both layers. Node no longer accepts it;
  the relay's legacy compatibility handler reads at most 512 bytes and is rate-limited.
- The public manual usage-monitor trigger was open when its secret was absent. It now
  fails closed; scheduled checks are unaffected. Production verification: anonymous GET
  returned HTTP 503 after Worker deployment.
- The public Storm Intel point relay can impose Core compute work. Point input is now
  bounded, repeat responses have a 20-second edge cache, and output is projected to a
  public allowlist that excludes unit identity. Arbitrary distinct valid coordinates can
  still bypass the cache. Provision a Cloudflare rate limit or a dedicated bounded public
  computation service before calling this fully resolved.

## Preservation and validation

The live radar worker contains newer chase-selection, chunk-assembly, KRAX, and off-thread
decode behavior than the old checked-in file. This branch includes those live modules and
the live worker as the baseline for its security patch. Do not deploy the old repository
version over the host. The radar tests, relay tests, root build/test, OPS typecheck/test/build,
and relevant production dependency audits pass locally. OPS tests require placeholder
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` when run outside Cloudflare; no real
credential is needed for unit tests.

## Radar production state and remaining OPS release

Radar deployment on 2026-10-11 used a preserved copy of the previous live release at
`/srv/codeblack/releases/radar-worker/v2-security-20261011` and the reversible systemd
drop-in `99-security-release.conf`. The old `v1` release remains intact. The public
relay version is `c46fc934-51c7-40a9-8379-9e91d7ef55e0`; usage monitor version is
`12d2cfd9-06f1-4658-a567-fa9cecfc9e07`. Production checks: radar health 200,
selection POST 405, legacy per-viewer motion POST 200 with scoped cookie, REF/SRV one-frame
reads 200, and status/sites/products 200. The OPS Pages preview is
`https://d7675f12.codeblack-ops.pages.dev`; anonymous Core health returns 401 and an
invalid public point returns 400. A valid public point returned a sanitized selected-target
snapshot with null unit ID. Authenticated preview QA is still outstanding.

To roll back radar, move the exact systemd drop-in to a `.disabled` name, run
`systemctl daemon-reload`, restart `codeblack-radar-worker`, and deploy the prior relay
version. Do not erase either radar release directory. The relay and Node worker should be
rolled back as a pair.

## Remaining coordinated release

1. Fetch production `master`; verify this branch is still a descendant. If it has advanced,
   integrate the new commits and repeat validation. Review the diff for credentials and
   unrelated changes. Never use a force dependency upgrade or a destructive Git reset.
2. Deploy an OPS Pages **preview** of this branch, then smoke authenticated map registry,
   radar REF/VEL/CC/SRV, camera viewer, hurricane page, and anonymous/unauthorized paths on
   phone and desktop. Verify SRV settings in two browsers do not affect each other.
3. After authenticated preview acceptance, release the OPS Pages candidate. It uses
   stateless per-request SRV directly; the relay compatibility cookie can then be retired
   after older browser versions are no longer in use.
4. After preview acceptance, advance only the verified candidate to `master` through the
   normal reviewed merge. Record Cloudflare deployment IDs and keep the prior version for
   rollback. The additive Supabase map-registry migrations are already applied; do not
   re-run them.

## Remaining boundary checks

- Apply and test a real public rate limit to `/overlay-core/api/storm-intel/v1/point`; the
  present cache is not a per-client quota. Confirm Core's own point query budget and data
  classification. The static scan did not prove live Core, firewall, or Cloudflare policy.
- Run authenticated and anonymous OPS preview checks against actual production policies,
  including map-registry RLS. Unit tests cannot prove the live session boundary.
- Root development dependencies still have Tailwind 3 transitive advisories; resolving them
  requires a separately tested Tailwind 4 migration. Production-only audit is clean. The
  native Capacitor packages were updated to patched 8.5.3; rebuild/release mobile binaries
  before claiming existing installed apps are patched.
