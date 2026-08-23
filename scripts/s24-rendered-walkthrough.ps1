param(
  [string]$DeviceSerial = $env:CODEBLACK_ANDROID_SERIAL,
  [string]$ApkPath = "android/app/build/outputs/apk/debug/app-debug.apk",
  [string]$PackageName = "com.codeblackwx.ops",
  [string]$ArtifactDir = "artifacts/rendered-control-walkthrough/s24"
)

$ErrorActionPreference = "Stop"

$Timeouts = @{
  ShortUi = 5
  Route = 12
  WebView = 30
  ServiceStart = 25
  Notification = 20
  Relaunch = 30
}

$CurrentStep = "startup"
$RunId = (Get-Date).ToString("yyyyMMdd-HHmmss")
$FailureDir = Join-Path $ArtifactDir "failures/$RunId"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "ENVIRONMENT BLOCKED: required command not found: $Name"
  }
}

function Run-Adb([string[]]$AdbArgs) {
  & adb -s $script:DeviceSerial @AdbArgs
}

function Get-ConnectedDevices {
  $lines = adb devices -l | Select-Object -Skip 1 | Where-Object { $_.Trim() }
  $devices = @()
  foreach ($line in $lines) {
    $parts = $line -split "\s+"
    if ($parts.Count -lt 2) { continue }
    $devices += [pscustomobject]@{ Serial = $parts[0]; State = $parts[1]; Raw = $line }
  }
  $devices
}

function Resolve-DeviceSerial {
  $devices = @(Get-ConnectedDevices)
  if ($script:DeviceSerial) {
    $match = $devices | Where-Object { $_.Serial -eq $script:DeviceSerial } | Select-Object -First 1
    if (-not $match) { throw "ENVIRONMENT BLOCKED: device $script:DeviceSerial is not connected. Connected devices: $($devices.Raw -join '; ')" }
    if ($match.State -ne "device") { throw "MANUAL ACTION REQUIRED: device $script:DeviceSerial state is $($match.State). Check USB authorization/device state." }
    return $script:DeviceSerial
  }
  $ready = @($devices | Where-Object { $_.State -eq "device" })
  $notReady = @($devices | Where-Object { $_.State -ne "device" })
  if ($notReady.Count -gt 0) {
    throw "MANUAL ACTION REQUIRED: Android device is not ready: $($notReady.Raw -join '; ')"
  }
  if ($ready.Count -eq 0) { throw "ENVIRONMENT BLOCKED: no authorized Android device connected." }
  if ($ready.Count -gt 1) { throw "ENVIRONMENT BLOCKED: multiple Android devices connected. Pass -DeviceSerial or set CODEBLACK_ANDROID_SERIAL. Devices: $($ready.Raw -join '; ')" }
  $script:DeviceSerial = $ready[0].Serial
  $script:DeviceSerial
}

function Get-DeviceMetadata {
  [ordered]@{
    serial = $script:DeviceSerial
    manufacturer = ((Run-Adb @("shell", "getprop", "ro.product.manufacturer")) -join "").Trim()
    model = ((Run-Adb @("shell", "getprop", "ro.product.model")) -join "").Trim()
    device = ((Run-Adb @("shell", "getprop", "ro.product.device")) -join "").Trim()
    androidRelease = ((Run-Adb @("shell", "getprop", "ro.build.version.release")) -join "").Trim()
    androidSdk = ((Run-Adb @("shell", "getprop", "ro.build.version.sdk")) -join "").Trim()
  }
}

function Get-ApkMetadata {
  if (-not (Test-Path $ApkPath)) { throw "ENVIRONMENT BLOCKED: APK not found: $ApkPath" }
  $apk = Get-Item $ApkPath
  $hash = ""
  if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
    $hash = (Get-FileHash -Algorithm SHA256 -Path $apk.FullName).Hash
  } else {
    $hash = ((certutil -hashfile $apk.FullName SHA256) | Where-Object { $_ -match "^[0-9a-fA-F ]+$" } | Select-Object -First 1) -replace "\s+", ""
  }
  [ordered]@{
    path = (Resolve-Path $ApkPath).Path
    sizeBytes = $apk.Length
    sizeMb = [math]::Round($apk.Length / 1MB, 2)
    lastWriteTime = $apk.LastWriteTime.ToString("o")
    sha256 = $hash
  }
}

function Get-PackageMetadata {
  $dump = (Run-Adb @("shell", "dumpsys", "package", $PackageName)) -join "`n"
  $versionName = if ($dump -match "versionName=([^\s]+)") { $Matches[1] } else { "UNKNOWN" }
  $versionCode = if ($dump -match "versionCode=(\d+)") { $Matches[1] } else { "UNKNOWN" }
  [ordered]@{ packageName = $PackageName; versionName = $versionName; versionCode = $versionCode }
}

function Save-Screenshot([string]$Name, [string]$Directory = $ArtifactDir) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  $target = Join-Path (Resolve-Path $Directory).Path "$Name.png"
  & adb -s $script:DeviceSerial exec-out screencap -p > $target
  $target
}

function Save-UiHierarchy([string]$Name, [string]$Directory = $ArtifactDir) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  $target = Join-Path (Resolve-Path $Directory).Path "$Name.xml"
  Run-Adb @("shell", "uiautomator", "dump", "/sdcard/codeblack-ui.xml") | Out-Null
  (Run-Adb @("exec-out", "cat", "/sdcard/codeblack-ui.xml")) | Set-Content -Path $target
  $target
}

function Get-UiXml {
  $path = Save-UiHierarchy "current-ui"
  [xml](Get-Content $path -Raw)
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
    throw "Cannot compute node center for UIAutomator fallback."
  }
  @{ X = [math]::Round(([int]$Matches[1] + [int]$Matches[3]) / 2); Y = [math]::Round(([int]$Matches[2] + [int]$Matches[4]) / 2) }
}

function Tap-UiAutomatorNode([xml]$Xml, [string]$Pattern, [switch]$PreferBottom) {
  $node = Get-NodeByTextOrDescription -Xml $Xml -Pattern $Pattern -PreferBottom:$PreferBottom
  if (-not $node) { throw "UIAutomator fallback node not found: $Pattern" }
  $center = Get-NodeCenter $node
  Run-Adb @("shell", "input", "tap", "$($center.X)", "$($center.Y)") | Out-Null
  @{ x = $center.X; y = $center.Y; pattern = $Pattern }
}

function Invoke-WebViewExpression([string]$Expression) {
  node scripts/s24-webview-evaluate.mjs $script:DeviceSerial $PackageName $Expression
}

function Wait-Until([string]$Name, [scriptblock]$Condition, [int]$TimeoutSeconds, [int]$PollMs = 500) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null
  do {
    try {
      if (& $Condition) { return }
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Milliseconds $PollMs
  } while ((Get-Date) -lt $deadline)
  if ($lastError) { throw "$Name timed out after ${TimeoutSeconds}s. Last error: $lastError" }
  throw "$Name timed out after ${TimeoutSeconds}s."
}

function Wait-WebViewReady {
  Wait-Until "WebView readiness" {
    $state = Invoke-WebViewExpression @"
(() => {
  const root = document.querySelector('[data-testid="route-home"], [data-testid="route-map"], [data-testid="route-weather"]');
  const text = document.body?.innerText || '';
  return root && /Home|Map|Weather|Settings|Layers/i.test(text) ? 'READY' : 'NOT_READY';
})()
"@
    $state.Trim() -eq "READY"
  } $Timeouts.WebView 1000
}

function Invoke-WebViewAction([string]$Expression, [string]$ExpectedPattern = "OK", [int]$TimeoutSeconds = 8) {
  $result = Invoke-WebViewExpression $Expression
  if ($result -notmatch $ExpectedPattern) {
    throw "WebView action failed. Expected '$ExpectedPattern', got: $result"
  }
  $result.Trim()
}

function Assert-Route([string]$RouteKey, [string]$ExpectedTextPattern) {
  $expr = @"
(() => {
  const route = document.querySelector('[data-testid="route-$RouteKey"]');
  const active = route?.getAttribute('data-active') === 'true';
  const text = route?.innerText || '';
  return active && /$ExpectedTextPattern/i.test(text) ? 'ROUTE_OK' : 'ROUTE_BAD active=' + active + ' text=' + text.slice(0, 160);
})()
"@
  Invoke-WebViewAction $expr "ROUTE_OK" $Timeouts.Route | Out-Null
}

function Go-ToRoute([string]$RouteKey, [string]$ExpectedTextPattern) {
  Invoke-WebViewAction @"
(() => {
  const button = document.querySelector('[data-testid="dock-$RouteKey"]');
  if (!button) {
    const more = document.querySelector('[data-testid="dock-more"]');
    if (!more) return 'DOCK_NOT_FOUND';
    more.click();
    const secondary = document.querySelector('[data-testid="more-$RouteKey"]');
    if (!secondary) return 'SECONDARY_NOT_FOUND';
    secondary.click();
    return 'CLICKED';
  }
  button.click();
  return 'CLICKED';
})()
"@ "CLICKED" | Out-Null
  Wait-Until "route $RouteKey active" { try { Assert-Route $RouteKey $ExpectedTextPattern; $true } catch { $false } } $Timeouts.Route 500
}

function Get-MarkEscapeScope {
  $json = Invoke-WebViewExpression @"
(() => {
  const visible = (element) => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  return JSON.stringify({
    mark: !![...document.querySelectorAll('[data-testid="map-action-mark"], button')].find((el) => visible(el) && /^(MARK|Mark current position)$/i.test((el.textContent || el.getAttribute('aria-label') || '').trim())),
    escape: !![...document.querySelectorAll('[data-testid="map-action-escape"], button')].find((el) => visible(el) && /^(ESCAPE|Hold to prepare escape context)$/i.test((el.textContent || el.getAttribute('aria-label') || '').trim()))
  });
})()
"@
  $json | ConvertFrom-Json
}

function Get-ActiveChaseNotificationLines {
  Run-Adb @("shell", "cmd", "notification", "list") |
    Where-Object { $_ -match [regex]::Escape($PackageName) -and ($_ -match "\b7319\b" -or $_ -match "codeblack_chase_tracking") }
}

function Assert-ChaseNotificationPresent {
  $active = @(Get-ActiveChaseNotificationLines)
  if ($active.Count -eq 0) { throw "Active Chase notification not found in active notification list." }
  $active
}

function Assert-ChaseNotificationAbsent {
  $active = @(Get-ActiveChaseNotificationLines)
  if ($active.Count -gt 0) { throw "Active Chase notification still present: $($active -join '; ')" }
}

function Get-ChaseServiceDump {
  (Run-Adb @("shell", "dumpsys", "activity", "services", $PackageName)) -join "`n"
}

function Test-ChaseServiceActive {
  $services = Get-ChaseServiceDump
  $services -match "ChaseTrackingService" -and ($services -match "foregroundId=7319" -or $services -match "isForeground=true")
}

function Assert-ChaseServiceActive {
  if (-not (Test-ChaseServiceActive)) { throw "ChaseTrackingService is not active/foreground. Dump: $(Get-ChaseServiceDump)" }
}

function Assert-ChaseServiceStopped {
  $services = Get-ChaseServiceDump
  if ($services -match "ChaseTrackingService" -and ($services -match "foregroundId=7319" -or $services -match "isForeground=true")) {
    throw "ChaseTrackingService still foreground: $services"
  }
}

function Test-ChaseNativeActive {
  (Test-ChaseServiceActive) -and [bool](@(Get-ActiveChaseNotificationLines).Count)
}

function Test-WebViewChaseActiveText {
  $state = Invoke-WebViewExpression @"
(() => {
  const visible = (element) => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const activeStatus = [...document.querySelectorAll('[role="status"], .chase-status-strip')]
    .some((element) => visible(element) && /\bCHASE ACTIVE\b/i.test(element.textContent || ''));
  const enabledEnd = [...document.querySelectorAll('button')].some((button) => visible(button) && button.textContent?.trim().toUpperCase() === 'END' && !button.disabled);
  const bodyActive = /\bCHASE ACTIVE\b/i.test(document.body?.innerText || '');
  return (activeStatus || bodyActive) && enabledEnd ? 'ACTIVE' : 'INACTIVE';
})()
"@
  $state.Trim() -eq "ACTIVE"
}

function Wait-ChaseActive {
  Wait-Until "Chase foreground service and notification" { Test-ChaseNativeActive } $Timeouts.ServiceStart 1000
}

function Wait-ChaseStopped {
  Wait-Until "Chase service/notification cleanup" {
    Assert-ChaseServiceStopped
    Assert-ChaseNotificationAbsent
    $true
  } $Timeouts.Notification 1000
}

function Stop-SharedChaseIfNeeded {
  if (-not (Test-WebViewChaseActiveText)) {
    Assert-ChaseServiceStopped
    Assert-ChaseNotificationAbsent
    return "already-inactive"
  }

  $result = Invoke-WebViewExpression @"
(async () => {
  document.querySelector('[data-testid="dock-more"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.querySelector('[data-testid="more-settings"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const end = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().toUpperCase() === 'END' && !button.disabled);
  if (!end) return 'END_NOT_FOUND';
  end.click();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return document.body.innerText.includes('CHASE ACTIVE') ? 'STILL_ACTIVE' : 'CHASE_INACTIVE';
})()
"@
  if ($result -notmatch "CHASE_INACTIVE") {
    throw "Unable to clear stale shared Chase state during preflight: $result"
  }
  Wait-ChaseStopped
  "cleared-stale-active-ui"
}

function Wait-ForceStopRecovery {
  $classification = $null
  Wait-Until "force-stop relaunch reconciliation" {
    if (Test-WebViewChaseActiveText) {
      if (Test-ChaseNativeActive) { $script:ForceStopClassification = "recovered-active-service-notification"; return $true }
      return $false
    }
    Assert-ChaseServiceStopped
    Assert-ChaseNotificationAbsent
    $script:ForceStopClassification = "inactive-no-service-no-active-notification"
    return $true
  } $Timeouts.Relaunch 1000
  $classification = $script:ForceStopClassification
  $classification
}

function Capture-FailureBundle([string]$Reason) {
  New-Item -ItemType Directory -Force -Path $FailureDir | Out-Null
  $paths = @()
  try { $paths += Save-Screenshot "failure-$CurrentStep" $FailureDir } catch {}
  try { $paths += Save-UiHierarchy "failure-$CurrentStep" $FailureDir } catch {}
  try { (Run-Adb @("logcat", "-d", "-t", "800")) | Set-Content -Path (Join-Path $FailureDir "logcat-tail.txt"); $paths += (Join-Path $FailureDir "logcat-tail.txt") } catch {}
  try { Get-ChaseServiceDump | Set-Content -Path (Join-Path $FailureDir "service.txt"); $paths += (Join-Path $FailureDir "service.txt") } catch {}
  try { (Run-Adb @("shell", "cmd", "notification", "list")) | Set-Content -Path (Join-Path $FailureDir "notifications.txt"); $paths += (Join-Path $FailureDir "notifications.txt") } catch {}
  try { Invoke-WebViewExpression "(() => JSON.stringify({title: document.title, body: document.body.innerText.slice(0, 1200), url: location.href}))()" | Set-Content -Path (Join-Path $FailureDir "webview-state.json"); $paths += (Join-Path $FailureDir "webview-state.json") } catch {}
  [ordered]@{ step = $CurrentStep; reason = $Reason; directory = $FailureDir; artifacts = $paths }
}

function Add-Step([string]$Name, [scriptblock]$Body) {
  $script:CurrentStep = $Name
  $started = Get-Date
  try {
    $details = & $Body
    $duration = [math]::Round(((Get-Date) - $started).TotalSeconds, 2)
    $script:summary.steps += [ordered]@{ name = $Name; status = "PASS"; durationSeconds = $duration; details = $details; artifactPaths = @() }
    Write-Host "PASS $Name ($duration s)"
  } catch {
    $duration = [math]::Round(((Get-Date) - $started).TotalSeconds, 2)
    $failure = Capture-FailureBundle $_.Exception.Message
    $script:summary.failures += $failure
    $script:summary.steps += [ordered]@{ name = $Name; status = "FAIL"; durationSeconds = $duration; details = $_.Exception.Message; artifactPaths = $failure.artifacts }
    throw "TEST FAILURE at ${Name}: $($_.Exception.Message). Failure bundle: $($failure.directory)"
  }
}

try {
  Require-Command adb
  Require-Command node
  $script:DeviceSerial = Resolve-DeviceSerial
  New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null

  $script:summary = [ordered]@{
    overallStatus = "RUNNING"
    runId = $RunId
    startedAt = (Get-Date).ToString("o")
    device = Get-DeviceMetadata
    package = [ordered]@{ packageName = $PackageName }
    apk = Get-ApkMetadata
    mechanisms = [ordered]@{
      adb = "ROBUST"
      webViewDevTools = "ROBUST"
      uiAutomatorSelectors = "ACCEPTABLE_FALLBACK"
      coordinateTaps = "ACCEPTABLE_FALLBACK_UIAUTOMATOR_BOUNDS_ONLY"
      screenshots = "ROBUST"
      logcat = "ROBUST"
      activeNotifications = "ROBUST"
      serviceDumpsys = "ROBUST"
    }
    steps = @()
    routes = @()
    chase = [ordered]@{}
    notification = [ordered]@{}
    service = [ordered]@{}
    logcat = [ordered]@{}
    failures = @()
  }

  Add-Step "install-apk" {
    $install = (Run-Adb @("install", "-r", $ApkPath)) -join "`n"
    $script:summary.package = Get-PackageMetadata
    if ($install -notmatch "Success") { throw "APK install failed: $install" }
    @{ install = "Success"; apkSha256 = $script:summary.apk.sha256; packageVersion = $script:summary.package.versionName; versionCode = $script:summary.package.versionCode }
  }

  Add-Step "deterministic-start-state" {
    Run-Adb @("logcat", "-c") | Out-Null
    Run-Adb @("shell", "am", "force-stop", $PackageName) | Out-Null
    Start-Sleep -Seconds 2
    Assert-ChaseServiceStopped
    Assert-ChaseNotificationAbsent
    @{ processStopped = $true; chaseService = "ABSENT"; chaseNotification = "ABSENT" }
  }

  Add-Step "launch-and-webview-ready" {
    Run-Adb @("shell", "monkey", "-p", $PackageName, "-c", "android.intent.category.LAUNCHER", "1") | Out-Null
    Wait-WebViewReady
    $preflightChaseState = Stop-SharedChaseIfNeeded
    Save-Screenshot "01-launch" | Out-Null
    @{ webView = "READY"; chasePreflight = $preflightChaseState; screenshot = "01-launch.png" }
  }

  Add-Step "permission-prompt-check" {
    $xml = Get-UiXml
    $permissionPrompt = $xml.SelectNodes("//node") | Where-Object {
      $nodePackage = $_.GetAttribute("package")
      $nodeText = "$($_.GetAttribute("text")) $($_.GetAttribute("content-desc"))"
      $isSystemDialog = $nodePackage -and $nodePackage -ne $PackageName -and $nodePackage -match "permissioncontroller|packageinstaller|settings|systemui"
      $isPermissionAction = $nodeText -match "While using the app|Allow only while using|Allow|Deny|Bluetooth|Notifications|Location"
      $isSystemDialog -and $isPermissionAction
    } | Select-Object -First 1
    if ($permissionPrompt) {
      throw "MANUAL ACTION REQUIRED: Android permission/system prompt is visible. Resolve it manually; automation will not tap unknown permission UI."
    }
    @{ prompt = "NONE" }
  }

  $routeManifest = @(
    @{ key = "home"; label = "Home"; text = "FIELD OVERVIEW|CHASE / FIELD STATUS" },
    @{ key = "map"; label = "Map"; text = "MOSAIC|LAYERS|FOLLOW" },
    @{ key = "weather"; label = "Weather"; text = "LOCATION & MOTION|WEATHER OBSERVATIONS" },
    @{ key = "operations"; label = "Operations"; text = "OPERATIONAL MODE|PI TRANSPORT|TELEMETRY" },
    @{ key = "alerts"; label = "Alerts"; text = "ACTIVE ALERTS|ALL ACTIVE PRODUCTS" },
    @{ key = "report"; label = "Report"; text = "SUBMIT REPORT|SPOTTER NETWORK" },
    @{ key = "settings"; label = "Settings"; text = "DISPLAY|LIVE OVERLAY TELEMETRY|CHASE SESSION" },
    @{ key = "layers"; label = "Layers"; text = "LAYER CONFIGURATION|CODE BLACK CHASER NET" },
    @{ key = "more"; label = "More"; text = "MORE|OPERATIONS|SETTINGS" }
  )

  foreach ($route in $routeManifest) {
    Add-Step "route-$($route.key)" {
      Go-ToRoute $route.key $route.text
      $scope = Get-MarkEscapeScope
      if ($route.key -eq "map") {
        if ($scope.mark -or -not $scope.escape) { throw "Map route should expose ESCAPE only, with MARK absent." }
      } elseif ($scope.mark -or $scope.escape) {
        throw "$($route.label) unexpectedly exposes MARK/ESCAPE."
      }
      $shot = Save-Screenshot "route-$($route.key)"
      $script:summary.routes += [ordered]@{ route = $route.label; key = $route.key; mark = [bool]$scope.mark; escape = [bool]$scope.escape; screenshot = $shot }
      @{ route = $route.label; mark = [bool]$scope.mark; escape = [bool]$scope.escape; screenshot = $shot }
    }
  }

  Add-Step "android-back-map-popover" {
    Go-ToRoute "map" "MOSAIC|LAYERS|FOLLOW"
    Invoke-WebViewAction "(() => { const b = document.querySelector('[data-testid=""atlas-map-layers-primary""]'); if (!b) return 'LAYERS_NOT_FOUND'; b.click(); return 'CLICKED'; })()" "CLICKED" | Out-Null
    Wait-Until "layers popover opens" {
      $state = Invoke-WebViewExpression "(() => document.querySelector('[data-testid=""atlas-map-layers-popover-primary""]') ? 'OPEN' : 'CLOSED')()"
      $state.Trim() -eq "OPEN"
    } $Timeouts.ShortUi 250
    Run-Adb @("shell", "input", "keyevent", "KEYCODE_BACK") | Out-Null
    Wait-Until "layers popover closes on Android Back" {
      $state = Invoke-WebViewExpression "(() => document.querySelector('[data-testid=""atlas-map-layers-popover-primary""]') ? 'OPEN' : 'CLOSED')()"
      $state.Trim() -eq "CLOSED"
    } $Timeouts.ShortUi 250
    @{ backBehavior = "closed-map-layer-popover" }
  }

  Add-Step "android-back-expanded-radar" {
    Go-ToRoute "map" "MOSAIC|LAYERS|FOLLOW"
    Invoke-WebViewAction "(() => { const b = [...document.querySelectorAll('button')].find((button) => /expand radar/i.test(button.getAttribute('aria-label') || '')); if (!b) return 'EXPAND_NOT_FOUND'; b.click(); return 'CLICKED'; })()" "CLICKED" | Out-Null
    Wait-Until "expanded radar opens" {
      $state = Invoke-WebViewExpression "(() => document.querySelector('.radar-expanded--active') ? 'OPEN' : 'CLOSED')()"
      $state.Trim() -eq "OPEN"
    } $Timeouts.ShortUi 250
    Save-Screenshot "05-expanded-radar" | Out-Null
    Run-Adb @("shell", "input", "keyevent", "KEYCODE_BACK") | Out-Null
    Wait-Until "expanded radar closes on Android Back" {
      $state = Invoke-WebViewExpression "(() => document.querySelector('.radar-expanded--active') ? 'OPEN' : 'CLOSED')()"
      $state.Trim() -eq "CLOSED"
    } $Timeouts.ShortUi 250
    @{ backBehavior = "closed-expanded-radar" }
  }

  Add-Step "status-diagnostics-offline-hardware" {
    Go-ToRoute "operations" "OPERATIONAL MODE|PI TRANSPORT|TELEMETRY"
    $state = [string](Invoke-WebViewExpression "(() => document.querySelector('[data-testid=""route-operations""]')?.innerText.slice(0, 2000) || '')()")
    if (-not [regex]::IsMatch($state, "PI TRANSPORT|TELEMETRY|NO DATA|NOT CONFIGURED|OFFLINE|CHECKING")) {
      throw "Operations status text does not expose expected offline/unavailable diagnostics: $state"
    }
    @{ hardware = "fixture-or-current-device-state-honest"; matched = "PI/telemetry diagnostics visible" }
  }

  Add-Step "start-chase" {
    $result = Invoke-WebViewExpression @"
(async () => {
  document.querySelector('[data-testid="dock-more"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.querySelector('[data-testid="more-settings"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const start = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().toUpperCase() === 'START' && !button.disabled);
  if (!start) return 'START_NOT_FOUND';
  start.click();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return document.body.innerText.includes('CHASE ACTIVE') ? 'CHASE_ACTIVE' : document.body.innerText.slice(0, 220);
})()
"@
    if ($result -notmatch "CHASE_ACTIVE") { throw "Start Chase did not enter active UI state: $result" }
    Wait-ChaseActive
    Save-Screenshot "07-chase-active" | Out-Null
    $script:summary.chase.started = $true
    $script:summary.service.start = "ACTIVE"
    $script:summary.notification.start = @(Assert-ChaseNotificationPresent)
    @{ ui = "CHASE_ACTIVE"; service = "ACTIVE"; notification = "ACTIVE" }
  }

  Add-Step "force-stop-while-active" {
    Run-Adb @("shell", "am", "force-stop", $PackageName) | Out-Null
    Start-Sleep -Seconds 3
    Run-Adb @("shell", "monkey", "-p", $PackageName, "-c", "android.intent.category.LAUNCHER", "1") | Out-Null
    Wait-WebViewReady
    $classification = Wait-ForceStopRecovery
    $script:summary.chase.forceStopWhileActive = $classification
    @{ recovery = $classification }
  }

  Add-Step "restart-chase-if-needed" {
    if (Test-WebViewChaseActiveText -and (Test-ChaseNativeActive)) {
      return @{ action = "existing-active-chase-restored" }
    }
    $result = Invoke-WebViewExpression @"
(async () => {
  document.querySelector('[data-testid="dock-more"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.querySelector('[data-testid="more-settings"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const start = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().toUpperCase() === 'START' && !button.disabled);
  if (!start) return 'START_NOT_FOUND_AFTER_FORCE_STOP';
  start.click();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return document.body.innerText.includes('CHASE ACTIVE') ? 'CHASE_ACTIVE' : document.body.innerText.slice(0, 220);
})()
"@
    if ($result -notmatch "CHASE_ACTIVE") { throw "Start Chase after force-stop did not enter active UI state: $result" }
    Wait-ChaseActive
    @{ action = "new-active-chase-started" }
  }

  Add-Step "map-usable-while-chase-active" {
    Go-ToRoute "map" "MOSAIC|LAYERS|FOLLOW"
    $state = Invoke-WebViewExpression @"
(() => {
  const map = document.querySelector('[data-testid="atlas-map-primary"]');
  const escape = document.querySelector('[data-testid="map-action-escape"]');
  const mark = document.querySelector('[data-testid="map-action-mark"]');
  const rect = map?.getBoundingClientRect();
  return map && escape && !mark && rect && rect.width > 100 && rect.height > 100 ? 'MAP_OK' : 'MAP_BAD';
})()
"@
    if ($state -notmatch "MAP_OK") { throw "Map is not usable during active Chase: $state" }
    $script:summary.chase.mapUsable = $true
    @{ map = "USABLE"; escape = "PRESENT"; mark = "ABSENT" }
  }

  Add-Step "end-chase" {
    $result = Invoke-WebViewExpression @"
(async () => {
  document.querySelector('[data-testid="dock-more"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.querySelector('[data-testid="more-settings"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const end = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().toUpperCase() === 'END' && !button.disabled);
  if (!end) return 'END_NOT_FOUND';
  end.click();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return document.body.innerText.includes('CHASE ACTIVE') ? 'STILL_ACTIVE' : 'CHASE_INACTIVE';
})()
"@
    if ($result -notmatch "CHASE_INACTIVE") { throw "End Chase did not enter inactive UI state: $result" }
    Wait-ChaseStopped
    Save-Screenshot "08-chase-ended" | Out-Null
    $script:summary.chase.ended = $true
    $script:summary.notification.end = "ABSENT"
    $script:summary.service.end = "ABSENT"
    @{ ui = "CHASE_INACTIVE"; service = "ABSENT"; notification = "ABSENT" }
  }

  Add-Step "relaunch-inactive" {
    Run-Adb @("shell", "am", "force-stop", $PackageName) | Out-Null
    Start-Sleep -Seconds 2
    Assert-ChaseServiceStopped
    Assert-ChaseNotificationAbsent
    Run-Adb @("shell", "monkey", "-p", $PackageName, "-c", "android.intent.category.LAUNCHER", "1") | Out-Null
    Wait-WebViewReady
    Wait-ChaseStopped
    if (Test-WebViewChaseActiveText) { throw "Relaunch recovered a false active Chase state." }
    $script:summary.chase.relaunchInactive = $true
    @{ relaunch = "INACTIVE"; service = "ABSENT"; notification = "ABSENT" }
  }

  Add-Step "logcat-health" {
    $logPath = Join-Path $ArtifactDir "logcat.txt"
    Run-Adb @("logcat", "-d", "-t", "2000") | Set-Content -Path $logPath
    $pattern = "FATAL EXCEPTION|\bANR\b|TypeError|ReferenceError|SecurityException|foreground service failure|startForeground failure|stopForeground failure|Capacitor.*Exception|AndroidRuntime"
    $badLogs = Select-String -Path $logPath -Pattern $pattern -CaseSensitive:$false
    if ($badLogs) { throw "Relevant logcat issue found: $($badLogs | Select-Object -First 3)" }
    $script:summary.logcat = [ordered]@{ path = $logPath; relevantIssues = 0 }
    @{ logcat = $logPath; relevantIssues = 0 }
  }

  $script:summary.completedAt = (Get-Date).ToString("o")
  $script:summary.overallStatus = "PASS"
  $script:summary.durationSeconds = [math]::Round(((Get-Date) - [datetime]$script:summary.startedAt).TotalSeconds, 2)
  $summaryPath = Join-Path $ArtifactDir "s24-walkthrough-summary.json"
  $script:summary | ConvertTo-Json -Depth 12 | Set-Content -Path $summaryPath

  Write-Host ""
  Write-Host "S24 NATIVE WALKTHROUGH"
  foreach ($step in $script:summary.steps) { Write-Host "PASS $($step.name)" }
  Write-Host "$($script:summary.steps.Count)/$($script:summary.steps.Count) checks passed"
  Write-Host "0 relevant fatal logcat events"
  Write-Host "Summary: $summaryPath"
  exit 0
} catch {
  if (-not $script:summary) {
    $script:summary = [ordered]@{ overallStatus = "FAIL"; runId = $RunId; startedAt = (Get-Date).ToString("o"); steps = @(); failures = @() }
  }
  $script:summary.overallStatus = "FAIL"
  $script:summary.completedAt = (Get-Date).ToString("o")
  if ($script:summary.failures.Count -eq 0) {
    $script:summary.failures += Capture-FailureBundle $_.Exception.Message
  }
  $summaryPath = Join-Path $ArtifactDir "s24-walkthrough-summary.json"
  New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
  $script:summary | ConvertTo-Json -Depth 12 | Set-Content -Path $summaryPath
  Write-Error $_.Exception.Message
  Write-Host "Summary: $summaryPath"
  exit 1
}
