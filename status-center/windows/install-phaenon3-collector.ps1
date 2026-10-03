# Installs the read-only Status Center collector on PHAENON3 (current user, no admin needed).
# - copies collector.py + registry.json to C:\CodeBlack\services\status-collector
# - registers scheduled task "CodeBlack-StatusCollector" (at logon, restarts on failure), runs it hidden
# - binds 127.0.0.1:9110 and exposes it tailnet-only via `tailscale serve --set-path=/status-collector`
# Rollback: Unregister-ScheduledTask CodeBlack-StatusCollector -Confirm:$false; tailscale serve --https=443 --set-path=/status-collector off
$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$dst = "C:\CodeBlack\services\status-collector"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item "$src\collector.py","$src\registry.json" $dst -Force
$py = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = "C:\Users\glenn\AppData\Local\Programs\Python\Python312\pythonw.exe" }
$action = New-ScheduledTaskAction -Execute $py -Argument "`"$dst\collector.py`" --host phaenon3" -WorkingDirectory $dst
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "CodeBlack-StatusCollector" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "CodeBlack-StatusCollector"
Start-Sleep 3
tailscale serve --bg --set-path=/status-collector http://127.0.0.1:9110 | Out-Null
Write-Output "installed; test: curl https://phaenon3.tail1d0673.ts.net/status-collector/v1/health"
