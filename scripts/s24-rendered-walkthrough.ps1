param(
  [string]$DeviceSerial = "RFCWC0D36KV",
  [string]$ApkPath = "android/app/build/outputs/apk/debug/app-debug.apk",
  [string]$PackageName = "com.codeblackwx.ops",
  [string]$ArtifactDir = "artifacts/rendered-control-walkthrough/s24"
)

$ErrorActionPreference = "Stop"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Run-Adb([string[]]$Args) {
  & adb -s $DeviceSerial @Args
}

function Get-UiXml {
  Run-Adb @("shell", "uiautomator", "dump", "/sdcard/codeblack-ui.xml") | Out-Null
  $xmlText = Run-Adb @("exec-out", "cat", "/sdcard/codeblack-ui.xml")
  [xml]$xmlText
}

function Get-NodeByTextOrDescription([xml]$Xml, [string]$Pattern, [switch]$PreferBottom) {
  $nodes = $Xml.SelectNodes("//node") | Where-Object {
    (($_.text -match $Pattern) -or ($_."content-desc" -match $Pattern)) -and $_.bounds -match "\[(\d+),(\d+)\]\[(\d+),(\d+)\]"
  }
  if ($PreferBottom) {
    $nodes = $nodes | Sort-Object {
      if ($_.bounds -match "\[(\d+),(\d+)\]\[(\d+),(\d+)\]") { [int]$Matches[2] } else { 0 }
    } -Descending
  }
  $nodes | Select-Object -First 1
}

function Get-NodeCenter($Node) {
  if (-not $Node -or $Node.bounds -notmatch "\[(\d+),(\d+)\]\[(\d+),(\d+)\]") {
    throw "Cannot compute node center."
  }
  $x = [math]::Round(([int]$Matches[1] + [int]$Matches[3]) / 2)
  $y = [math]::Round(([int]$Matches[2] + [int]$Matches[4]) / 2)
  @{ X = $x; Y = $y }
}

function Tap-Node([xml]$Xml, [string]$Pattern, [switch]$PreferBottom) {
  $node = Get-NodeByTextOrDescription -Xml $Xml -Pattern $Pattern -PreferBottom:$PreferBottom
  if (-not $node) { throw "UI node not found: $Pattern" }
  $center = Get-NodeCenter $node
  Run-Adb @("shell", "input", "tap", "$($center.X)", "$($center.Y)") | Out-Null
}

function Save-Screenshot([string]$Name) {
  $path = Join-Path $ArtifactDir "$Name.png"
  $fullPath = (Resolve-Path $ArtifactDir).Path
  $target = Join-Path $fullPath "$Name.png"
  & adb -s $DeviceSerial exec-out screencap -p > $target
  $path
}

function Assert-NoActiveChaseNotification {
  $active = Run-Adb @("shell", "cmd", "notification", "list") | Select-String -Pattern "$PackageName|7319|codeblack_chase_tracking"
  if ($active) {
    throw "Active Chase notification still present: $active"
  }
  $getResult = Run-Adb @("shell", "cmd notification get '0|$PackageName|7319|null|10150'") 2>&1
  if ($getResult -notmatch "no active notification") {
    throw "Unexpected active notification get result: $getResult"
  }
}

function Assert-NoChaseService {
  $service = Run-Adb @("shell", "dumpsys", "activity", "services", $PackageName) | Select-String -Pattern "ChaseTrackingService.*isForeground|foregroundId=7319"
  if ($service) {
    throw "ChaseTrackingService still foreground: $service"
  }
}

Require-Command adb
if (-not (Test-Path $ApkPath)) {
  throw "APK not found: $ApkPath"
}

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null

$summary = [ordered]@{
  device = $DeviceSerial
  package = $PackageName
  apk = (Resolve-Path $ApkPath).Path
  startedAt = (Get-Date).ToString("o")
  routes = @()
  chase = [ordered]@{}
}

$devices = adb devices -l
if ($devices -notmatch $DeviceSerial -or $devices -notmatch "device") {
  throw "Device $DeviceSerial is not connected and authorized."
}

Run-Adb @("install", "-r", $ApkPath) | Out-Null
Run-Adb @("logcat", "-c") | Out-Null
Run-Adb @("shell", "am", "force-stop", $PackageName) | Out-Null
Run-Adb @("shell", "monkey", "-p", $PackageName, "-c", "android.intent.category.LAUNCHER", "1") | Out-Null
Start-Sleep -Seconds 5

$routePatterns = [ordered]@{
  Weather = "Weather"
  Operations = "Operations|Ops"
  Locate = "Locate"
  Alerts = "Alerts"
  Report = "Report"
  Settings = "Settings|Setup"
  Layers = "Layers|Map layer configuration"
}

foreach ($route in $routePatterns.Keys) {
  $xml = Get-UiXml
  Tap-Node -Xml $xml -Pattern $routePatterns[$route] -PreferBottom
  Start-Sleep -Seconds 2
  $xml = Get-UiXml
  $hasMark = [bool](Get-NodeByTextOrDescription -Xml $xml -Pattern "Mark current position|^MARK$")
  $hasEscape = [bool](Get-NodeByTextOrDescription -Xml $xml -Pattern "Hold to prepare escape context|^ESCAPE$")
  if ($route -eq "Locate") {
    if (-not $hasMark -or -not $hasEscape) { throw "Locate route is missing MARK or ESCAPE." }
  } elseif ($hasMark -or $hasEscape) {
    throw "$route route unexpectedly exposes MARK/ESCAPE."
  }
  $shot = Save-Screenshot "route-$($route.ToLowerInvariant())"
  $summary.routes += [ordered]@{ route = $route; mark = $hasMark; escape = $hasEscape; screenshot = $shot }
}

$xml = Get-UiXml
Tap-Node -Xml $xml -Pattern "Settings|Setup" -PreferBottom
Start-Sleep -Seconds 1
$xml = Get-UiXml
Tap-Node -Xml $xml -Pattern "^Start$"
Start-Sleep -Seconds 5
$activeService = Run-Adb @("shell", "dumpsys", "activity", "services", $PackageName) | Select-String -Pattern "ChaseTrackingService|foregroundId=7319"
$activeNotification = Run-Adb @("shell", "cmd", "notification", "list") | Select-String -Pattern "$PackageName|7319"
if (-not $activeService -or -not $activeNotification) {
  throw "Chase did not start foreground service and active notification."
}
$summary.chase.started = $true

$xml = Get-UiXml
Tap-Node -Xml $xml -Pattern "Locate" -PreferBottom
Start-Sleep -Seconds 1
$xml = Get-UiXml
Tap-Node -Xml $xml -Pattern "Mark current position|^MARK$"
$summary.chase.markTapped = $true

$xml = Get-UiXml
Tap-Node -Xml $xml -Pattern "Settings|Setup" -PreferBottom
Start-Sleep -Seconds 1
$xml = Get-UiXml
Tap-Node -Xml $xml -Pattern "^End$"
Start-Sleep -Seconds 10
Assert-NoChaseService
Assert-NoActiveChaseNotification
$summary.chase.ended = $true
$summary.chase.activeNotificationCleared = $true

Run-Adb @("shell", "am", "force-stop", $PackageName) | Out-Null
Start-Sleep -Seconds 3
Assert-NoChaseService
Assert-NoActiveChaseNotification
Run-Adb @("shell", "monkey", "-p", $PackageName, "-c", "android.intent.category.LAUNCHER", "1") | Out-Null
Start-Sleep -Seconds 5
Assert-NoChaseService
Assert-NoActiveChaseNotification
$summary.chase.relaunchInactive = $true

$logPath = Join-Path $ArtifactDir "logcat.txt"
Run-Adb @("logcat", "-d", "-t", "1500") | Set-Content -Path $logPath
$badLogs = Select-String -Path $logPath -Pattern "FATAL EXCEPTION|ANR|TypeError|ReferenceError|SecurityException|foreground service failure|stopForeground failure" -CaseSensitive:$false
if ($badLogs) {
  throw "Relevant logcat issue found: $($badLogs | Select-Object -First 3)"
}
$summary.logcat = $logPath
$summary.completedAt = (Get-Date).ToString("o")

$summaryPath = Join-Path $ArtifactDir "s24-walkthrough-summary.json"
$summary | ConvertTo-Json -Depth 8 | Set-Content -Path $summaryPath
Write-Host "S24 walkthrough PASS"
Write-Host $summaryPath
