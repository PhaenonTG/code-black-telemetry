[CmdletBinding()]
param()

# Stage only the private preview receiver. Never start or publish Facebook output here.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
$base = 'http://127.0.0.1:18766'
try { $status = Invoke-RestMethod "$base/status" -TimeoutSec 3 } catch { $status = $null }
if (-not $status) {
    & (Join-Path $root 'run-native-broadcaster.ps1') -Background
    $deadline = (Get-Date).AddSeconds(12)
    do {
        Start-Sleep -Milliseconds 500
        try { $status = Invoke-RestMethod "$base/status" -TimeoutSec 2 } catch { $status = $null }
    } while (-not $status -and (Get-Date) -lt $deadline)
}
if (-not $status -or $status.service -ne 'Code Black Native Broadcaster') { throw 'Expected native broadcaster is not available on loopback.' }
if ($status.broadcast.requested -or $status.broadcast.state -ne 'OFF') { throw 'Facebook output is already active; staging will not change an on-air session.' }
if (-not $status.broadcast.configured) { throw 'Facebook output credential is not configured.' }
if ($status.recording.writeToDisk -ne $false) { throw 'Field staging requires automatic PROGRAM archiving to be disabled.' }
Invoke-RestMethod -Method Post -Uri "$base/record/start" -ContentType 'application/json' -Body '{}' | Out-Null
$status = Invoke-RestMethod "$base/status" -TimeoutSec 3
if (-not $status.recording.requested -or $status.broadcast.requested -or $status.broadcast.state -ne 'OFF') { throw 'Safe standby conditions were not met.' }
Write-Output 'STAGED: preview receiver is armed and will reconnect when Nick starts Chase.'
Write-Output 'Facebook output remains OFF. Open the local Producer console and verify moving video/audio before sending to Facebook.'
Write-Output 'Local Producer: http://127.0.0.1:18766/'
Write-Output 'OPS Producer: https://ops.codeblackwx.com/producer'
