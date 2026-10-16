$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$records = [Collections.Generic.List[object]]::new()
function ReleaseLabel([string]$value) {
  $match = [regex]::Match($value, '(?i)C:[\\/]CodeBlack[\\/]releases[\\/]([a-zA-Z0-9_.-]+)[\\/]([a-zA-Z0-9_.-]+)')
  if ($match.Success) { return $match.Groups[1].Value + '/' + $match.Groups[2].Value }
  return $null
}
foreach ($task in (Get-ScheduledTask | Where-Object { $_.TaskName -match '^(CodeBlack|Spencer Labs)' -or $_.TaskPath -like '\CodeBlack\*' })) {
  if ($records.Count -ge 256) { throw 'Too many scoped scheduled tasks/services.' }
  $info = Get-ScheduledTaskInfo -InputObject $task
  $lastRun = if ($info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { $null }
  # Used only to derive a release label. Raw actions are never returned.
  $release = $null
  foreach ($action in $task.Actions) {
    $release = ReleaseLabel ([string]$action.WorkingDirectory + ' ' + [string]$action.Execute + ' ' + [string]$action.Arguments)
    if ($release) { break }
  }
  $records.Add([pscustomobject]@{ kind='task'; name=($task.TaskPath + $task.TaskName); state=[string]$task.State; result=$info.LastTaskResult; last_run=$lastRun; scheduled=(@($task.Triggers).Count -gt 0); release=$release })
}
foreach ($service in (Get-CimInstance Win32_Service | Where-Object { $_.Name -match '^CodeBlack' -or $_.DisplayName -match '^(Code Black|CodeBlack|Spencer Labs)' -or $_.PathName -match '(?i)C:[\\/]CodeBlack[\\/]' })) {
  if ($records.Count -ge 256) { throw 'Too many scoped scheduled tasks/services.' }
  $records.Add([pscustomobject]@{ kind='service'; name=$service.Name; state=[string]$service.State; result=$service.ExitCode; last_run=$null; scheduled=$false; release=(ReleaseLabel ([string]$service.PathName)) })
}
ConvertTo-Json -InputObject @($records.ToArray()) -Depth 4 -Compress
