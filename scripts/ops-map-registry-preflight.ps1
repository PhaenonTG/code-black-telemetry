param([switch]$SkipInstall)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ops = Join-Path $repo 'web\ops'

function Assert-Exit([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed (exit $LASTEXITCODE)" }
}

Push-Location $repo
try {
  $branch = (git branch --show-current).Trim()
  Assert-Exit 'Read branch'
  if ($branch -eq 'master') { throw 'Run preflight on the release candidate, not the production branch.' }
  git merge-base --is-ancestor origin/master HEAD
  Assert-Exit 'Production ancestry check (fetch origin/master first)'
  if (git status --porcelain) { throw 'Release candidate has uncommitted files.' }

  if (-not $SkipInstall) { npm ci; Assert-Exit 'Root npm ci' }
  npm test; Assert-Exit 'Root tests'

  Push-Location $ops
  try {
    if (-not $SkipInstall) { npm ci; Assert-Exit 'OPS npm ci' }
    npm run typecheck; Assert-Exit 'OPS typecheck'
    $oldUrl = $env:VITE_SUPABASE_URL
    $oldKey = $env:VITE_SUPABASE_PUBLISHABLE_KEY
    try {
      $env:VITE_SUPABASE_URL = 'https://example.supabase.co'
      $env:VITE_SUPABASE_PUBLISHABLE_KEY = 'test-public-key'
      npm test; Assert-Exit 'OPS tests'
    } finally {
      $env:VITE_SUPABASE_URL = $oldUrl
      $env:VITE_SUPABASE_PUBLISHABLE_KEY = $oldKey
    }
    npm audit; Assert-Exit 'OPS dependency audit'
    npm run build; Assert-Exit 'OPS production build'
  } finally { Pop-Location }

  Write-Host "Preflight passed on $branch. Preview deployment and authenticated live-session QA are still required." -ForegroundColor Green
} finally { Pop-Location }
