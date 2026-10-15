param(
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$')]
  [string]$Version = ('ops-' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')),
  [string]$CoreHost = 'codeblack-core'
)
$ErrorActionPreference = 'Stop'
$opsDirectory = Split-Path $PSScriptRoot -Parent
$repositoryDirectory = (Resolve-Path (Join-Path $opsDirectory '..\..')).Path
if ($env:CODEBLACK_DEPLOY_REPORT_ACTIVE -ne '1') {
  & py -3 (Join-Path $repositoryDirectory 'scripts\deploy_with_status.py') --host $CoreHost --manifest (Join-Path $repositoryDirectory '.codeblack\projects\ops-alerting.json') --unit codeblack-private-ops --release "private-ops/$Version" -- powershell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Version $Version -CoreHost $CoreHost
  exit $LASTEXITCODE
}
Push-Location $opsDirectory
try {
  & npm.cmd run build:private
  if ($LASTEXITCODE -ne 0) { throw 'Private OPS build or sign-in verification failed.' }
  $bundlePath = Join-Path ([IO.Path]::GetTempPath()) "codeblack-$Version.tgz"
  & tar -czf $bundlePath dist
  if ($LASTEXITCODE -ne 0) { throw 'Could not package private OPS.' }
  & scp $bundlePath "${CoreHost}:/tmp/codeblack-$Version.tgz"
  if ($LASTEXITCODE -ne 0) { throw 'Private OPS upload failed.' }
  $releasePath = "/srv/codeblack/releases/private-ops/$Version"
  & ssh $CoreHost "test ! -e '$releasePath' && sudo mkdir -p '$releasePath' && sudo tar -xzf '/tmp/codeblack-$Version.tgz' -C '$releasePath' && sudo chown -R root:root '$releasePath' && sudo chmod -R a+rX '$releasePath' && test -f '$releasePath/dist/index.html'"
  if ($LASTEXITCODE -ne 0) { throw 'Release must be new and contain the built entry page.' }
  $overridePath = Join-Path ([IO.Path]::GetTempPath()) "codeblack-$Version.conf"
  [IO.File]::WriteAllText($overridePath, "[Service]`nEnvironment=OPS_PRIVATE_DIST=$releasePath/dist`n", [Text.UTF8Encoding]::new($false))
  & scp $overridePath "${CoreHost}:/tmp/codeblack-$Version.conf"
  if ($LASTEXITCODE -ne 0) { throw 'Could not upload the release configuration.' }
  & ssh $CoreHost "sudo install -m 0644 '/tmp/codeblack-$Version.conf' /etc/systemd/system/codeblack-private-ops.service.d/zzzz-landscape.conf && sudo systemctl daemon-reload && sudo systemctl restart codeblack-private-ops.service && systemctl is-active --quiet codeblack-private-ops.service"
  if ($LASTEXITCODE -ne 0) { throw 'Private OPS did not restart successfully.' }
  $asset = [regex]::Match((Get-Content dist/index.html -Raw), 'assets/index-[a-zA-Z0-9_-]+\.js').Value
  if (-not $asset) { throw 'Built entry page is missing its application asset.' }
  & ssh $CoreHost "curl --retry 5 --retry-connrefused --retry-delay 1 --fail --silent --show-error -H 'Accept: text/html' --resolve ops-private.codeblackwx.com:443:192.168.0.187 https://ops-private.codeblackwx.com/status-center | grep -F '$asset' >/dev/null && curl --fail --silent --show-error --resolve ops-private.codeblackwx.com:443:192.168.0.187 https://ops-private.codeblackwx.com/$asset >/dev/null"
  if ($LASTEXITCODE -ne 0) { throw 'Served private OPS does not match the new release.' }
  Write-Host "Private OPS is serving $Version; deployment result will be recorded."
} finally {
  Pop-Location
}
