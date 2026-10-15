# Mesonet gateway

`codeblack-mesonet-gateway` owns the Cloudflare route
`ops.codeblackwx.com/api/chase/mesonet/*`. Cloudflare selects this route ahead
of the broader Chase gateway route at `ops.codeblackwx.com/api/chase/*`.
Deploying Chase, OBS, or Producer code no longer replaces Mesonet ingest,
signed OTA, or the sanitized public projection.

The Worker forwards device bearer tokens only to fixed Core Mesonet endpoints.
Core authenticates each device role. The public projection uses the separate
`MESONET_READ_TOKEN` Worker secret. The private Core connection is the existing
`CORE_VPC` binding. Do not add token values to this repository.

Run `npm ci` and `npm run deploy` from this directory. The deploy command runs
contract tests and then probes all three live routes for the `dedicated-v1`
response marker. Cloudflare route changes can take a few seconds to propagate;
if the immediate postdeploy probe fails, rerun `node scripts/verify-live.mjs`
before treating the deployment as failed. Keep the broader Chase gateway's
Mesonet handlers as a fallback, but do not rely on them for normal traffic.

For device acceptance, verify the local ESP reports `core_code: 200`, the Core
role's received age stays near two seconds, and the authenticated public OTA
check returns 200. A 200 from the public projection alone does not prove
device ingest works.
