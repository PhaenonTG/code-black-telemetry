# Code Black release controls

There are two distinct web surfaces:

- `codeblack-ops` / `ops.codeblackwx.com`: the canonical OPS website.
- `codeblack-ops-tablet`: the Android/tablet shell, isolated to a preview branch.

## Safe workflow

1. Publish tablet work only with `release\publish-tablet-preview.ps1`.
2. Review its generated Pages preview URL.
3. Promote the OPS website only from `origin/master`, using
   `release\promote-ops-production.ps1` with the previous production deployment ID.
4. If a production promotion is wrong, use Cloudflare's deployment rollback API
   against the saved preceding ID. No deployment is deleted as part of rollback.

Never directly run `wrangler pages deploy` against `codeblack-ops` on the
`master` branch. That command bypasses every guard above.
