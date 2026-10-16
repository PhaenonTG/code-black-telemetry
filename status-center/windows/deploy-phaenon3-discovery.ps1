param(
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$')]
  [string]$Version = 'phaenon3-discovery-20261015',
  [string]$CoreHost = 'codeblack-core'
)
$ErrorActionPreference = 'Stop'
$statusDirectory = Split-Path $PSScriptRoot -Parent
$repository = Split-Path $statusDirectory -Parent
if ($env:CODEBLACK_DEPLOY_REPORT_ACTIVE -ne '1') {
  & py -3 "$repository\scripts\deploy_with_status.py" --host $CoreHost --manifest "$repository\.codeblack\projects\ops-alerting.json" --unit codeblack-status-center --release "status-center/$Version" -- powershell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Version $Version -CoreHost $CoreHost
  exit $LASTEXITCODE
}
$bundle = Join-Path ([IO.Path]::GetTempPath()) "codeblack-$Version.tgz"
Push-Location $repository
try {
  & tar -czf $bundle --exclude=__pycache__ --exclude=.pytest_cache status-center .codeblack scripts/deploy_with_status.py
  if ($LASTEXITCODE -ne 0) { throw 'Could not package the discovery update.' }
  & scp $bundle "${CoreHost}:/tmp/codeblack-$Version.tgz"
  if ($LASTEXITCODE -ne 0) { throw 'Could not upload the Core discovery update.' }
  & ssh $CoreHost "mkdir -p '/tmp/$Version' && tar -xzf '/tmp/codeblack-$Version.tgz' -C '/tmp/$Version' && python3 -m unittest discover -s '/tmp/$Version/status-center/tests' -p test_project_automation.py -q && sh '/tmp/$Version/status-center/install-project-automation.sh' core"
  if ($LASTEXITCODE -ne 0) { throw 'Core discovery tests or receiver installation failed.' }
  & "$PSScriptRoot\update-phaenon3-discovery.ps1" -SourceDirectory $statusDirectory
  & ssh $CoreHost "sh '/tmp/$Version/status-center/deploy-project-automation.sh' '$Version'"
  if ($LASTEXITCODE -ne 0) { throw 'Core discovery deployment failed.' }
  # Wait only for the existing local collector to listen; the first request
  # performs the bounded Windows discovery query.
  $ready = $false
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    try { $null = Invoke-RestMethod 'http://127.0.0.1:9110/v1/health' -TimeoutSec 3; $ready = $true; break } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { throw 'Phaenon3 collector did not restart.' }
  & "$PSScriptRoot\push-project-inventory.ps1"
  Start-ScheduledTask -TaskName CodeBlack-ProjectInventoryPush
  $verified = $false
  for ($attempt = 0; $attempt -lt 4; $attempt++) {
    $raw = & ssh $CoreHost 'curl -fsS http://127.0.0.1:8795/api/status/project_coverage'
    if ($LASTEXITCODE -eq 0) {
      $coverage = $raw | ConvertFrom-Json
      $hostReport = $coverage.hosts | Where-Object { $_.host -eq 'phaenon3' }
      if ($hostReport.state -eq 'CURRENT' -and $hostReport.transport -eq 'SSH PUSH') { $verified = $true; break }
    }
    Start-Sleep -Seconds 2
  }
  if (-not $verified) { throw 'Core has not accepted the new Windows discovery report.' }
  Write-Output 'Phaenon3 discovery verified in Core; recurring outbound reporting is enabled.'
} finally {
  Pop-Location
}
