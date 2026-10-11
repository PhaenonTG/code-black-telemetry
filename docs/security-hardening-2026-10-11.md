# Security hardening release gate — 2026-10-11

This branch preserves the previously prepared OPS map registry release. It also includes
radar, Storm Intel, dependency, and usage-monitor hardening. **Only the standalone
usage-monitor Worker has been deployed.** Do not treat the repository changes as live.

## What was found

- A browser-bundled value authorized public writes to process-global radar selection and
  storm motion. The new contract is read-only at both the Cloudflare relay and Node worker;
  web SRV motion is per request and manual settings stay local to the browser. The native
  radar API remains unchanged.
- The same POST path buffered unbounded bodies in both layers. Removing the public
  mutation route removes that input path.
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

## Coordinated production release

1. Fetch production `master`; verify this branch is still a descendant. If it has advanced,
   integrate the new commits and repeat validation. Review the diff for credentials and
   unrelated changes. Never use a force dependency upgrade or a destructive Git reset.
2. Deploy an OPS Pages **preview** of this branch, then smoke authenticated map registry,
   radar REF/VEL/CC/SRV, camera viewer, hurricane page, and anonymous/unauthorized paths on
   phone and desktop. Verify SRV settings in two browsers do not affect each other.
3. Record the live radar worker file checksum and copy it to a dated backup on the Core host.
   Stage this branch's `radar-worker` files in a new directory on that host. Run `node --check`
   and `node --test` there with installed dependencies. Confirm the service's systemd unit
   and dependent files before switching anything. Keep the prior release intact.
4. Deploy the radar worker, radar relay, and OPS Pages candidate as one monitored release.
   The old browser uses the removed POST routes, while the new browser needs stateless SRV;
   avoid leaving a mixed version in service. Roll back all three together if smoke checks fail.
   Verify POST mutation returns 405 both publicly and on the private worker, radar health is
   200, and REF/SRV tiles remain available. Observe radar CPU, cache, and 429 responses.
5. After preview acceptance, advance only the verified candidate to `master` through the
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
