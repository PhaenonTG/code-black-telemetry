$ErrorActionPreference = 'Stop'

$taskName = 'CodeBlack-Silas-Aegis-Notify'
$pythonw = 'C:\Users\glenn\AppData\Local\Programs\Python\Python312\pythonw.exe'
$script = 'C:\CodeBlack\bin\silas-aegis-watch.py'
$config = 'C:\CodeBlack\private\ntfy\silas-aegis-notify.json'
foreach ($path in @($pythonw, $script, $config)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing required file: $path" }
}
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId 'glenn' -LogonType Interactive -RunLevel Limited
$action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"' + $script + '" "' + $config + '"')
$repeating = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$onLogon = New-ScheduledTaskTrigger -AtLogOn -User 'glenn'
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($repeating, $onLogon) `
    -Principal $principal -Settings $settings -Description 'Private Silas/AEGIS message alerts to Core ntfy' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed and started $taskName (pythonw; no console window)"
