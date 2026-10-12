<#
Publishes the tablet/PWA shell to its isolated Pages project only. It is
intentionally incapable of writing to the public codeblack-ops project.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$web = Join-Path $repo 'web\ops'
$tabletProject = 'codeblack-ops-tablet'
$tabletBranch = 'tablet-shell'

Push-Location $web
try {
  npm run typecheck
  if ($LASTEXITCODE -ne 0) { throw 'Tablet typecheck failed.' }
  npm run test
  if ($LASTEXITCODE -ne 0) { throw 'Tablet tests failed.' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Tablet build failed.' }
  npx wrangler pages deploy dist --project-name $tabletProject --branch $tabletBranch --commit-dirty=true
  if ($LASTEXITCODE -ne 0) { throw 'Tablet preview deploy failed.' }
} finally {
  Pop-Location
}

Write-Host 'Tablet shell published only to its isolated preview project.' -ForegroundColor Green
