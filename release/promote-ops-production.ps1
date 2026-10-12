<#
The only approved production publisher for ops.codeblackwx.com.

It refuses a feature branch, requires an explicit acknowledgement, and records
the preceding deployment ID before publishing. Never use raw `wrangler pages
deploy --project-name codeblack-ops --branch master` for OPS production.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f-]{36}$')]
  [string]$PreviousProductionDeploymentId,
  [Parameter(Mandatory = $true)]
  [ValidateSet('OPS-WEBSITE')]
  [string]$ReleaseIntent
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$web = Join-Path $repo 'web\ops'
$expected = (git -C $repo rev-parse origin/master).Trim()
$actual = (git -C $repo rev-parse HEAD).Trim()
if ($actual -ne $expected) {
  throw "Refusing OPS production promotion: HEAD $actual is not protected origin/master $expected. Publish a tablet preview instead."
}

$record = [ordered]@{
  schema = 'codeblack.ops-release/v1'
  previous_production_deployment = $PreviousProductionDeploymentId
  source_commit = $actual
  promoted_at_utc = (Get-Date).ToUniversalTime().ToString('o')
  project = 'codeblack-ops'
  hostname = 'ops.codeblackwx.com'
}
$recordPath = Join-Path $PSScriptRoot 'last-ops-promotion.json'
$record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding utf8

Push-Location $web
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'OPS dependency install failed.' }
  npm run typecheck
  if ($LASTEXITCODE -ne 0) { throw 'OPS typecheck failed.' }
  npm run test
  if ($LASTEXITCODE -ne 0) { throw 'OPS tests failed.' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'OPS build failed.' }
  npx wrangler pages deploy dist --project-name codeblack-ops --branch master --commit-dirty=false
  if ($LASTEXITCODE -ne 0) { throw 'OPS production deploy failed.' }
} finally {
  Pop-Location
}

Write-Host "OPS website production promotion completed. Rollback target recorded in $recordPath" -ForegroundColor Green
