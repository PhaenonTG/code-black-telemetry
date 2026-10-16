param([string]$SourceDirectory = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$destination = 'C:\CodeBlack\services\status-collector'
$backup = 'C:\CodeBlack\backups\status-collector-discovery-' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Force -Path $backup, "$destination\windows", 'C:\CodeBlack\config\project-landscape\projects.d' | Out-Null
Copy-Item -LiteralPath "$destination\collector.py" -Destination $backup
Export-ScheduledTask -TaskName CodeBlack-StatusCollector | Set-Content -LiteralPath "$backup\collector-task.xml" -Encoding UTF8
Stop-ScheduledTask -TaskName CodeBlack-StatusCollector
try {
  Copy-Item -LiteralPath "$SourceDirectory\collector.py", "$SourceDirectory\project_inventory.py" -Destination $destination -Force
  Copy-Item -LiteralPath "$SourceDirectory\windows\discover-projects.ps1", "$SourceDirectory\windows\push-project-inventory.ps1" -Destination "$destination\windows" -Force
  $manifestDirectory = Join-Path (Split-Path $SourceDirectory -Parent) '.codeblack\projects'
  Get-ChildItem -LiteralPath $manifestDirectory -Filter '*.json' | Copy-Item -Destination 'C:\CodeBlack\config\project-landscape\projects.d' -Force
} finally {
  Start-ScheduledTask -TaskName CodeBlack-StatusCollector
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\CodeBlack\services\status-collector\windows\push-project-inventory.ps1"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName CodeBlack-ProjectInventoryPush -Action $action -Trigger @($trigger, $logon) -Settings $settings -Force | Out-Null
Write-Output "Discovery collector updated. Previous collector and task saved in $backup"
