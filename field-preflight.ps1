[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$producer = 'http://127.0.0.1:18766'
$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check([string]$Name, [string]$State, [string]$Detail) {
    $checks.Add([pscustomobject]@{ Check = $Name; State = $State; Detail = $Detail })
}

try {
    $status = Invoke-RestMethod -Uri "$producer/status" -TimeoutSec 3
    Add-Check 'Native service' 'PASS' $status.state
    Add-Check 'Facebook config' $(if ($status.broadcast.configured) { 'PASS' } else { 'FAIL' }) $(if ($status.broadcast.configured) { $status.broadcast.destination } else { 'Stream key not configured' })
    Add-Check 'Public output' $(if ($status.broadcast.state -eq 'OFF') { 'PASS' } else { 'WARN' }) $status.broadcast.state
    Add-Check 'OPS bridge' $(if ($status.bridge.state -eq 'ONLINE') { 'PASS' } else { 'FAIL' }) $(if ($status.bridge.lastSuccessAt) { "Last success $($status.bridge.lastSuccessAt)" } else { $status.bridge.state })
    Add-Check 'Local disk mode' $(if ($status.recording.writeToDisk -eq $false) { 'PASS' } else { 'WARN' }) $(if ($status.recording.writeToDisk -eq $false) { 'PROGRAM archive disabled' } else { 'PROGRAM archive enabled' })
    $sourceReady = $status.source_state -eq 'SOURCE_LIVE' -and $status.previews.clean.state -eq 'ACTIVE' -and $status.previews.program.state -eq 'ACTIVE'
    Add-Check 'Nick source' $(if ($sourceReady) { 'PASS' } else { 'WAIT' }) $status.source_state
    $audioReady = $status.audio.process -eq 'RUNNING' -and $status.audio.available -and -not $status.audio.silence
    Add-Check 'Audio' $(if ($audioReady) { 'PASS' } elseif ($status.recording.requested) { 'FAIL' } else { 'WAIT' }) $(if (-not $status.recording.requested) { 'Preview pipeline stopped' } elseif ($status.audio.available) { "RMS $($status.audio.rmsDb) dB" } else { 'Preview not receiving audio' })
} catch {
    Add-Check 'Native service' 'FAIL' 'Producer is not reachable on loopback'
    $status = $null
}

$gpu = & "$env:WINDIR\System32\nvidia-smi.exe" --query-gpu=name,driver_version --format=csv,noheader 2>$null
Add-Check 'NVENC GPU' $(if ($LASTEXITCODE -eq 0 -and $gpu -match 'RTX 3070 Ti') { 'PASS' } else { 'FAIL' }) $(if ($gpu) { [string]$gpu } else { 'NVIDIA GPU unavailable' })

$freeGb = [math]::Round((Get-PSDrive -Name C).Free / 1GB, 1)
Add-Check 'Free disk' $(if ($freeGb -ge 2) { 'PASS' } else { 'FAIL' }) "$freeGb GB (camera archive is optional)"

try {
    $update = Invoke-RestMethod -Uri 'https://ops.codeblackwx.com/api/chase/v1/update' -TimeoutSec 8
    Add-Check 'Chase release' $(if ([int]$update.versionCode -ge 20) { 'PASS' } else { 'FAIL' }) "build $($update.versionCode) / $($update.versionName)"
} catch {
    Add-Check 'Chase release' 'FAIL' 'Production update channel unavailable'
}

$checks | Format-Table -AutoSize
$failures = @($checks | Where-Object State -eq 'FAIL')
if ($failures.Count -gt 0) {
    Write-Output "`nFIELD GATE: NOT READY ($($failures.Count) failed check(s))"
    exit 1
}
if (@($checks | Where-Object State -eq 'WAIT').Count -gt 0) {
    Write-Output "`nFIELD GATE: STAGED - start Nick's source and the preview pipeline for final green checks"
    exit 0
}
Write-Output "`nFIELD GATE: READY FOR FACEBOOK REHEARSAL"
