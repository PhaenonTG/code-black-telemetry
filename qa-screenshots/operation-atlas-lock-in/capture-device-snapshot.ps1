param(
  [Parameter(Mandatory=$true)][string]$Label,
  [string]$Serial = 'R5GL53J3Y4J',
  [string]$Package = 'com.codeblackwx.ops',
  [string]$OutDir = 'qa-screenshots\operation-atlas-lock-in',
  [switch]$Screenshot
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$base = Join-Path $OutDir "$Label-$stamp"
if ($Screenshot) {
  adb -s $Serial shell screencap -p "/sdcard/$Label.png" | Out-Null
  adb -s $Serial pull "/sdcard/$Label.png" "$base.png" | Out-Null
  adb -s $Serial shell rm "/sdcard/$Label.png" | Out-Null
}
adb -s $Serial shell dumpsys meminfo $Package > "$base-meminfo.txt"
$socketLine = adb -s $Serial shell cat /proc/net/unix | Select-String -Pattern 'webview_devtools_remote' | Select-Object -Last 1
if ($socketLine) {
  $socket = ($socketLine.ToString() -split '@')[-1].Trim()
  adb -s $Serial forward --remove tcp:9229 2>$null | Out-Null
  adb -s $Serial forward tcp:9229 "localabstract:$socket" | Out-Null
  node "$OutDir\devtools-dump.cjs" 9229 "$base-devtools.json"
}
adb -s $Serial logcat -d -v time AndroidRuntime:E chromium:W cr_AwContents:V Mapbox:D '*:S' > "$base-logcat.txt"
Write-Output $base
