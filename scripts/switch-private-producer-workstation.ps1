$ErrorActionPreference = 'Stop'
$backup = 'C:\CodeBlack\backups\private-producer-switch-20261015'
$runtime = 'C:\CodeBlack\Projects\ObsProducerBridge\runtime'
$specs = @(
    @{ Name='CodeBlack-OBS-Producer-Bridge-Recovery'; Old='C:\CodeBlack\Worktrees\obs-dual-output-release-20261015'; New='C:\CodeBlack\Worktrees\obs-private-primary-release-20261015'; Entry='Start-BridgeSupervisor.ps1' },
    @{ Name='CodeBlack-Stream-Prepare-Agent'; Old='C:\CodeBlack\Worktrees\pc-prepare-agent-release-v2-20261015'; New='C:\CodeBlack\Worktrees\private-prepare-agent-release-20261015'; Entry='Start-PrepareAgent.ps1' }
)
function Assert-OutputsOff {
    $state = Get-Content -LiteralPath (Join-Path $runtime 'public-output-status.json') -Raw | ConvertFrom-Json
    $age = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $state.heartbeatAtUnixMs
    if ($age -lt -2000 -or $age -gt 3000 -or $state.facebookState -ne 'OFF' -or $state.youtubeState -ne 'OFF') { throw 'Public outputs are not proven freshly OFF.' }
}
Assert-OutputsOff
if (Test-Path -LiteralPath $backup) { throw 'Switch backup exists; inspect the previous attempt instead of retrying blindly.' }
if (-not (Test-Path -LiteralPath 'C:\CodeBlack\streaming\native-broadcaster\runtime\private-producer.credentials.json')) { throw 'Private credential missing.' }
$obs = @(Get-CimInstance Win32_Process -Filter "Name='obs64.exe'" | Where-Object ExecutablePath -eq 'C:\CodeBlack\streaming\obs-portable-test\bin\64bit\obs64.exe')
if ($obs.Count -ne 1) { throw 'Expected exactly one Nick portable OBS process.' }
foreach ($spec in $specs) {
    $task = Get-ScheduledTask -TaskName $spec.Name
    $expected = '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File "' + (Join-Path $spec.Old $spec.Entry) + '"'
    if (@($task.Actions).Count -ne 1 -or $task.Actions[0].Execute -ne 'powershell.exe' -or $task.Actions[0].Arguments -ne $expected) { throw "Unexpected task baseline: $($spec.Name)" }
    if (-not (Test-Path -LiteralPath (Join-Path $spec.New $spec.Entry))) { throw 'Pinned release entry missing.' }
}
$null = New-Item -ItemType Directory -Path $backup
foreach ($spec in $specs) { [IO.File]::WriteAllText((Join-Path $backup ($spec.Name + '.xml')), (Export-ScheduledTask -TaskName $spec.Name), [Text.UTF8Encoding]::new($false)) }
foreach ($name in @('command-journal.json','pc-prepare-journal.json')) { if (Test-Path -LiteralPath (Join-Path $runtime $name)) { Copy-Item -LiteralPath (Join-Path $runtime $name) -Destination (Join-Path $backup $name) } }
foreach ($name in @('Prepare-Nick-Stream.ps1','stream-readiness.cjs')) { Copy-Item -LiteralPath (Join-Path 'C:\CodeBlack\streaming' $name) -Destination (Join-Path $backup $name) }
Assert-OutputsOff
foreach ($spec in $specs) { Stop-ScheduledTask -TaskName $spec.Name }
Start-Sleep -Seconds 2
foreach ($spec in $specs) {
    $owned = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/','\').Contains($spec.Old + '\src\') })
    foreach ($process in $owned) {
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)"
        if ($current -and $current.CreationDate -eq $process.CreationDate -and $current.CommandLine.Replace('/','\').Contains($spec.Old + '\src\')) { Stop-Process -Id $process.ProcessId -ErrorAction Stop }
    }
}
Start-Sleep -Seconds 2
foreach ($spec in $specs) {
    if (@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/','\').Contains($spec.Old + '\src\') }).Count) { throw 'Original consumer still running; private consumer was not started.' }
    $args = '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File "' + (Join-Path $spec.New $spec.Entry) + '"'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args -WorkingDirectory $spec.New
    $null = Set-ScheduledTask -TaskName $spec.Name -Action $action
}
foreach ($name in @('Prepare-Nick-Stream.ps1','stream-readiness.cjs')) { Copy-Item -LiteralPath (Join-Path $specs[1].New $name) -Destination (Join-Path 'C:\CodeBlack\streaming' $name) }
Assert-OutputsOff
foreach ($spec in $specs) { Start-ScheduledTask -TaskName $spec.Name }
$after = Get-CimInstance Win32_Process -Filter "ProcessId=$($obs[0].ProcessId)"
if (-not $after -or $after.CreationDate -ne $obs[0].CreationDate) { throw 'OBS process changed during switch.' }
Write-Output 'PRIVATE_CONSUMERS_STARTED_OBS_UNCHANGED'
