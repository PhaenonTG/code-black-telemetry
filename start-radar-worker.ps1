$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not $env:CODEBLACK_RADAR_PORT) {
  $env:CODEBLACK_RADAR_PORT = "8787"
}

node radar-worker/worker.cjs
