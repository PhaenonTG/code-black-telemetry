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

function Run-Adb([string[]]$AdbArgs) {
  & adb -s $DeviceSerial @AdbArgs
}

function Get-UiXml {
  Run-Adb @("shell", "uiautomator", "dump", "/sdcard/codeblack-ui.xml") | Out-Null
  $xmlText = (Run-Adb @("exec-out", "cat", "/sdcard/codeblack-ui.xml")) -join "`n"
  [xml]$xmlText
}

function Get-NodeByTextOrDescription([xml]$Xml, [string]$Pattern, [switch]$PreferBottom) {
  $nodes = $Xml.SelectNodes("//node") | Where-Object {
    if (-not (($_.text -match $Pattern) -or ($_."content-desc" -match $Pattern))) { return $false }
    if ($_.bounds -notmatch "\[(\d+),(\d+)\]\[(\d+),(\d+)\]") { return $false }
    $width = [int]$Matches[3] - [int]$Matches[1]
    $height = [int]$Matches[4] - [int]$Matches[2]
    $width -gt 0 -and $height -gt 0
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

function Tap-NodeWithScroll([string]$Pattern, [int]$MaxScrolls = 8) {
  for ($attempt = 0; $attempt -le $MaxScrolls; $attempt++) {
    $xml = Get-UiXml
    $node = Get-NodeByTextOrDescription -Xml $xml -Pattern $Pattern
    if ($node) {
      $center = Get-NodeCenter $node
      Run-Adb @("shell", "input", "tap", "$($center.X)", "$($center.Y)") | Out-Null
      return
    }
    Run-Adb @("shell", "input", "swipe", "540", "1900", "540", "760", "450") | Out-Null
    Start-Sleep -Milliseconds 500
  }
  throw "Visible UI node not found after scrolling: $Pattern"
}

function Save-Screenshot([string]$Name) {
  $path = Join-Path $ArtifactDir "$Name.png"
  $fullPath = (Resolve-Path $ArtifactDir).Path
  $target = Join-Path $fullPath "$Name.png"
  & adb -s $DeviceSerial exec-out screencap -p > $target
  $path
}

function Assert-NoActiveChaseNotification {
  $active = Get-ActiveChaseNotificationLines
  if ($active) {
    throw "Active Chase notification still present: $active"
  }
}

function Assert-NoChaseService {
  $service = Run-Adb @("shell", "dumpsys", "activity", "services", $PackageName) | Select-String -Pattern "ChaseTrackingService.*isForeground|foregroundId=7319"
  if ($service) {
    throw "ChaseTrackingService still foreground: $service"
  }
}

function Invoke-WebViewExpression([string]$Expression) {
  node scripts/s24-webview-evaluate.mjs $DeviceSerial $PackageName $Expression
}

function Test-ChaseActive {
  $services = (Run-Adb @("shell", "dumpsys", "activity", "services", $PackageName)) -join "`n"
  ($services -match "ChaseTrackingService" -and $services -match "foregroundId=7319") -and [bool](Get-ActiveChaseNotificationLines)
}

function Get-ActiveChaseNotificationLines {
  Run-Adb @("shell", "cmd", "notification", "list") |
    Where-Object {
      ($_ -match [regex]::Escape($PackageName) -and $_ -match "\b7319\b") -or
      ($_ -match [regex]::Escape($PackageName) -and $_ -match "codeblack_chase_tracking")
    }
}

function Wait-ChaseActive([int]$TimeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-ChaseActive) { return }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  throw "Chase did not start foreground service and active notification."
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

$devices = (adb devices -l) -join "`n"
if ($devices -notmatch $DeviceSerial -or $devices -notmatch "\bdevice\b") {
  throw "Device $DeviceSerial is not connected and authorized."
}

Run-Adb @("install", "-r", $ApkPath) | Out-Null
Run-Adb @("logcat", "-c") | Out-Null
Run-Adb @("shell", "am", "force-stop", $PackageName) | Out-Null
Run-Adb @("shell", "monkey", "-p", $PackageName, "-c", "android.intent.category.LAUNCHER", "1") | Out-Null
Start-Sleep -Seconds 5

$preflightResult = Invoke-WebViewExpression @"
(async () => {
  if (!document.body.innerText.includes('CHASE ACTIVE')) return 'ALREADY_INACTIVE';
  document.querySelector('[data-testid="dock-settings"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const end = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().toUpperCase() === 'END' && !button.disabled);
  if (!end) return 'ACTIVE_END_NOT_FOUND';
  end.click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  return document.body.innerText.includes('CHASE ACTIVE') ? 'STILL_ACTIVE' : 'ENDED';
})()
"@
if ($preflightResult -match "ACTIVE_END_NOT_FOUND|STILL_ACTIVE") {
  throw "Preflight could not clear restored Chase state: $preflightResult"
}
Start-Sleep -Seconds 5
Assert-NoChaseService
Assert-NoActiveChaseNotification

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

$startResult = Invoke-WebViewExpression @"
(async () => {
  document.querySelector('[data-testid="dock-settings"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const start = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().toUpperCase() === 'START' && !button.disabled);
  if (!start) return 'START_NOT_FOUND';
  start.click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  return document.body.innerText.includes('CHASE ACTIVE') ? 'CHASE_ACTIVE' : document.body.innerText.slice(0, 200);
})()
"@
if ($startResult -notmatch "CHASE_ACTIVE") {
  throw "WebView Start Chase did not enter active state: $startResult"
}
Wait-ChaseActive
$summary.chase.started = $true

Run-Adb @("shell", "am", "force-stop", $PackageName) | Out-Null
Start-Sleep -Seconds 5
Assert-NoChaseService
Assert-NoActiveChaseNotification
Run-Adb @("shell", "monkey", "-p", $PackageName, "-c", "android.intent.category.LAUNCHER", "1") | Out-Null
Start-Sleep -Seconds 5
$forceStopRecovery = Invoke-WebViewExpression @"
(() => document.body.innerText.includes('CHASE ACTIVE') ? 'FALSE_ACTIVE_AFTER_FORCE_STOP' : 'INACTIVE_AFTER_FORCE_STOP')()
"@
if ($forceStopRecovery -notmatch "INACTIVE_AFTER_FORCE_STOP") {
  throw "Force-stop while active left false Chase state: $forceStopRecovery"
}
Assert-NoChaseService
Assert-NoActiveChaseNotification
$summary.chase.forceStopWhileActive = "inactive-no-service-no-active-notification"

$startResult = Invoke-WebViewExpression @"
(async () => {
  document.querySelector('[data-testid="dock-settings"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const start = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().toUpperCase() === 'START' && !button.disabled);
  if (!start) return 'START_NOT_FOUND_AFTER_FORCE_STOP';
  start.click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  return document.body.innerText.includes('CHASE ACTIVE') ? 'CHASE_ACTIVE' : document.body.innerText.slice(0, 200);
})()
"@
if ($startResult -notmatch "CHASE_ACTIVE") {
  throw "WebView Start Chase after force-stop did not enter active state: $startResult"
}
Wait-ChaseActive

$xml = Get-UiXml
Tap-Node -Xml $xml -Pattern "Locate" -PreferBottom
Start-Sleep -Seconds 1
$xml = Get-UiXml
Tap-Node -Xml $xml -Pattern "Mark current position|^MARK$"
$summary.chase.markTapped = $true

$endResult = Invoke-WebViewExpression @"
(async () => {
  document.querySelector('[data-testid="dock-settings"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const end = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().toUpperCase() === 'END' && !button.disabled);
  if (!end) return 'END_NOT_FOUND';
  end.click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  return document.body.innerText.includes('CHASE ACTIVE') ? 'STILL_ACTIVE' : 'CHASE_INACTIVE';
})()
"@
if ($endResult -notmatch "CHASE_INACTIVE") {
  throw "WebView End Chase did not enter inactive state: $endResult"
}
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
$badLogs = Select-String -Path $logPath -Pattern "FATAL EXCEPTION|\bANR\b|TypeError|ReferenceError|SecurityException|foreground service failure|stopForeground failure" -CaseSensitive:$false
if ($badLogs) {
  throw "Relevant logcat issue found: $($badLogs | Select-Object -First 3)"
}
$summary.logcat = $logPath
$summary.completedAt = (Get-Date).ToString("o")

$summaryPath = Join-Path $ArtifactDir "s24-walkthrough-summary.json"
$summary | ConvertTo-Json -Depth 8 | Set-Content -Path $summaryPath
Write-Host "S24 walkthrough PASS"
Write-Host $summaryPath
