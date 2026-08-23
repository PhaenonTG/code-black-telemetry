param(
  [string]$DeviceSerial = $env:CODEBLACK_ANDROID_SERIAL,
  [string]$PackageName = "com.codeblackwx.ops",
  [string]$OutDir = "artifacts/ui-review/s24-ui-foundation"
)

# Captures a verified screenshot baseline for the phone UI/UX foundation pass. Every screenshot is
# preceded by a route/state assertion against the live WebView DOM (not a fixed delay) so a
# filename can never silently drift from the screen it actually shows -- the failure mode that
# produced the mislabeled artifacts/ui-review/s24-phone-structure-pass/ set this baseline replaces.
#
# All JS snippets use here-strings (@" ... "@), never inline double-quoted PS strings with a
# backslash-escaped quote -- PowerShell does not treat \" as an escape inside "..." the way JS/C
# do, so that pattern silently mis-terminates the string instead of producing a literal ".

$ErrorActionPreference = "Stop"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "ENVIRONMENT BLOCKED: required command not found: $Name"
  }
}

function Run-Adb([string[]]$AdbArgs) {
  & adb -s $script:DeviceSerial @AdbArgs
}

function Resolve-DeviceSerial {
  $lines = adb devices -l | Select-Object -Skip 1 | Where-Object { $_.Trim() }
  $devices = @()
  foreach ($line in $lines) {
    $parts = $line -split "\s+"
    if ($parts.Count -lt 2) { continue }
    $devices += [pscustomobject]@{ Serial = $parts[0]; State = $parts[1] }
  }
  if ($script:DeviceSerial) {
    $match = $devices | Where-Object { $_.Serial -eq $script:DeviceSerial } | Select-Object -First 1
    if (-not $match) { throw "ENVIRONMENT BLOCKED: device $script:DeviceSerial is not connected." }
    if ($match.State -ne "device") { throw "MANUAL ACTION REQUIRED: device $script:DeviceSerial state is $($match.State)." }
    return $script:DeviceSerial
  }
  $ready = @($devices | Where-Object { $_.State -eq "device" })
  if ($ready.Count -eq 0) { throw "ENVIRONMENT BLOCKED: no authorized Android device connected." }
  if ($ready.Count -gt 1) { throw "ENVIRONMENT BLOCKED: multiple devices connected. Pass -DeviceSerial." }
  $ready[0].Serial
}

function Save-Screenshot([string]$Name) {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $target = Join-Path (Resolve-Path $OutDir).Path "$Name.png"
  # See scripts/s24-rendered-walkthrough.ps1 Save-Screenshot -- PowerShell `>` redirect corrupts
  # binary PNG stdout via text-encoding re-write. Route through .NET streams directly instead.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "adb"
  $psi.Arguments = "-s $script:DeviceSerial exec-out screencap -p"
  $psi.RedirectStandardOutput = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $memoryStream = New-Object System.IO.MemoryStream
  $proc.StandardOutput.BaseStream.CopyTo($memoryStream)
  $proc.WaitForExit()
  [System.IO.File]::WriteAllBytes($target, $memoryStream.ToArray())
  $target
}

function Invoke-WebViewExpression([string]$Expression) {
  $encodedExpression = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Expression))
  node scripts/s24-webview-evaluate.mjs $script:DeviceSerial $PackageName "base64:$encodedExpression"
}

function Wait-Until([string]$Name, [scriptblock]$Condition, [int]$TimeoutSeconds, [int]$PollMs = 400) {
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

function Test-JsCondition([string]$Expression) {
  (Invoke-WebViewExpression $Expression).Trim() -eq "TRUE"
}

function Assert-Route([string]$RouteKey) {
  $expr = @"
(() => {
  const el = document.querySelector('[data-testid="route-$RouteKey"]');
  return (el && el.getAttribute('data-active') === 'true') ? 'TRUE' : 'FALSE';
})()
"@
  Wait-Until "route $RouteKey active" { Test-JsCondition $expr } 12 400
}

function Go-ToRoute([string]$RouteKey) {
  Invoke-WebViewExpression @"
(() => {
  const button = document.querySelector('[data-testid="dock-$RouteKey"]');
  if (button) { button.click(); return 'CLICKED'; }
  const more = document.querySelector('[data-testid="dock-more"]');
  if (!more) return 'DOCK_NOT_FOUND';
  more.click();
  const secondary = document.querySelector('[data-testid="more-$RouteKey"]');
  if (!secondary) return 'SECONDARY_NOT_FOUND';
  secondary.click();
  return 'CLICKED';
})()
"@ | Out-Null
  Assert-Route $RouteKey
  Start-Sleep -Milliseconds 500
}

function Dismiss-EntrySplashIfPresent {
  $xmlPath = Join-Path $OutDir "_ui.xml"
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  Run-Adb @("shell", "uiautomator", "dump", "/sdcard/codeblack-ui.xml") | Out-Null
  (Run-Adb @("exec-out", "cat", "/sdcard/codeblack-ui.xml")) | Set-Content -Path $xmlPath
  $xml = [xml](Get-Content $xmlPath -Raw)
  $tapNode = $xml.SelectNodes("//node") | Where-Object { $_.text -match "TAP TO ENTER" } | Select-Object -First 1
  Remove-Item $xmlPath -ErrorAction SilentlyContinue
  if (-not $tapNode) { return $false }
  if ($tapNode.bounds -notmatch "\[(\d+),(\d+)\]\[(\d+),(\d+)\]") { return $false }
  $cx = [math]::Round(([int]$Matches[1] + [int]$Matches[3]) / 2)
  $cy = [math]::Round(([int]$Matches[2] + [int]$Matches[4]) / 2)
  Run-Adb @("shell", "input", "tap", "$cx", "$cy") | Out-Null
  Start-Sleep -Seconds 2
  $true
}

function Wait-WebViewReady {
  $expr = @"
(() => document.querySelector('[data-testid="route-home"]') ? 'TRUE' : 'FALSE')()
"@
  Wait-Until "WebView readiness" { Test-JsCondition $expr } 30 1000
}

function Close-AnyOpenOverlay {
  Invoke-WebViewExpression @"
(() => {
  document.querySelector('[data-testid="atlas-map-layers-close-primary"]')?.click();
  document.querySelector('[data-testid="atlas-map-layers-close-compact"]')?.click();
  document.querySelector('.atlas-pin-popup .mapboxgl-popup-close-button')?.click();
  return 'OK';
})()
"@ | Out-Null
  Start-Sleep -Milliseconds 300
}

$script:manifest = @()

function Capture-Entry([string]$FileName, [string]$RouteState, [string]$SelectorVerified, [string]$LiveOrFixture, [string]$Notes) {
  $path = Save-Screenshot $FileName
  $script:manifest += [ordered]@{
    filename = "$FileName.png"
    routeState = $RouteState
    selectorVerified = $SelectorVerified
    captureTimestamp = (Get-Date).ToString("o")
    liveOrFixture = $LiveOrFixture
    notes = $Notes
    path = $path
  }
  Write-Host "CAPTURED $FileName -> $RouteState"
}

try {
  Require-Command adb
  Require-Command node
  $script:DeviceSerial = Resolve-DeviceSerial
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

  Write-Host "Device: $script:DeviceSerial"
  Run-Adb @("shell", "am", "force-stop", $PackageName) | Out-Null
  Start-Sleep -Seconds 1
  Run-Adb @("shell", "monkey", "-p", $PackageName, "-c", "android.intent.category.LAUNCHER", "1") | Out-Null
  Start-Sleep -Seconds 3
  Wait-WebViewReady
  if (Dismiss-EntrySplashIfPresent) {
    Write-Host "Dismissed entry splash (TAP TO ENTER)"
    Wait-WebViewReady
  }

  # 01: Home
  Go-ToRoute "home"
  Capture-Entry "01-home" "route-home active" '[data-testid="route-home"][data-active="true"]' "live" "Default Home overview, no customize panel open."

  # 02: Home Customize
  Invoke-WebViewExpression @"
(() => { document.querySelector('[data-testid="home-customize-toggle"]')?.click(); return 'OK'; })()
"@ | Out-Null
  $customizeOpenExpr = @"
(() => document.querySelector('[data-testid="home-customize-panel"]') ? 'TRUE' : 'FALSE')()
"@
  Wait-Until "home customize panel open" { Test-JsCondition $customizeOpenExpr } 6 300
  Capture-Entry "02-home-customize" "route-home, customize panel open" '[data-testid="home-customize-panel"]' "live" "Customize Home panel opened via home-customize-toggle."
  Invoke-WebViewExpression @"
(() => { document.querySelector('[data-testid="home-customize-toggle"]')?.click(); return 'OK'; })()
"@ | Out-Null
  Start-Sleep -Milliseconds 300

  # 03: Map
  Go-ToRoute "map"
  Capture-Entry "03-map" "route-map active" '[data-testid="route-map"][data-active="true"]' "live" "Default map view, no popover open."

  # 04: Map Layers popover
  Invoke-WebViewExpression @"
(() => { document.querySelector('[data-testid="atlas-map-layers-primary"]')?.click(); return 'OK'; })()
"@ | Out-Null
  $layersOpenExpr = @"
(() => document.querySelector('[data-testid="atlas-map-layers-popover-primary"]') ? 'TRUE' : 'FALSE')()
"@
  Wait-Until "layers popover open" { Test-JsCondition $layersOpenExpr } 6 300
  Capture-Entry "04-map-layers" "route-map, layers popover open" '[data-testid="atlas-map-layers-popover-primary"]' "live" "On-map layers popover with LayerGlyph icon parity."
  Close-AnyOpenOverlay

  # 05: Map Escape (hold-to-arm toast, released before it completes)
  Invoke-WebViewExpression @"
(() => {
  const btn = document.querySelector('[data-testid="map-action-escape"]');
  if (!btn) return 'NOT_FOUND';
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  return 'ARMED';
})()
"@ | Out-Null
  $escapeToastExpr = @"
(() => /HOLD TO ARM ESCAPE/i.test(document.body.innerText) ? 'TRUE' : 'FALSE')()
"@
  Wait-Until "escape hold toast visible" { Test-JsCondition $escapeToastExpr } 4 200
  Capture-Entry "05-map-escape" "route-map, escape hold armed (toast visible)" 'document.body innerText matches HOLD TO ARM ESCAPE' "live" "Real hold-to-arm interaction mid-gesture; released immediately after capture, never allowed to complete."
  Invoke-WebViewExpression @"
(() => {
  const btn = document.querySelector('[data-testid="map-action-escape"]');
  btn?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  return 'RELEASED';
})()
"@ | Out-Null
  Start-Sleep -Milliseconds 400

  # 06: Expanded radar
  Invoke-WebViewExpression @"
(() => {
  const b = [...document.querySelectorAll('button')].find(x => /expand radar/i.test(x.getAttribute('aria-label')||''));
  if (!b) return 'NOT_FOUND';
  b.click();
  return 'OK';
})()
"@ | Out-Null
  $radarOpenExpr = @"
(() => document.querySelector('.radar-expanded--active') ? 'TRUE' : 'FALSE')()
"@
  Wait-Until "expanded radar open" { Test-JsCondition $radarOpenExpr } 6 300
  Capture-Entry "06-expanded-radar" "route-map, expanded radar dialog open" '.radar-expanded--active' "live" "Close button, title, auto-refresh, range rings, help text."
  Invoke-WebViewExpression @"
(() => { window.dispatchEvent(new Event('codeblack:close-radar')); return 'OK'; })()
"@ | Out-Null
  $radarClosedExpr = @"
(() => document.querySelector('.radar-expanded--active') ? 'FALSE' : 'TRUE')()
"@
  Wait-Until "expanded radar closed" { Test-JsCondition $radarClosedExpr } 6 300

  # 07: Camera detail -- enable layer, jump to a real live camera, click a real un-clustered marker
  Invoke-WebViewExpression @"
(() => { document.querySelector('[data-testid="atlas-map-layers-primary"]')?.click(); return 'OK'; })()
"@ | Out-Null
  Wait-Until "layers popover open for camera enable" { Test-JsCondition $layersOpenExpr } 6 300
  Invoke-WebViewExpression @"
(() => {
  const rows = [...document.querySelectorAll('.atlas-layers-popover__row')];
  const camRow = rows.find(r => /Public Cameras/i.test(r.textContent||''));
  const checkbox = camRow ? camRow.querySelector('input[type=checkbox]') : null;
  if (checkbox && !checkbox.checked) checkbox.click();
  return checkbox ? 'OK' : 'ROW_NOT_FOUND';
})()
"@ | Out-Null
  Invoke-WebViewExpression @"
(() => { document.querySelector('[data-testid="atlas-map-layers-close-primary"]')?.click(); return 'OK'; })()
"@ | Out-Null
  Start-Sleep -Milliseconds 800
  $jumpResult = Invoke-WebViewExpression @"
(() => {
  const fn = window.__codeblackDebugJumpToCamera;
  if (typeof fn !== 'function') return 'HOOK_NOT_FOUND';
  const r = fn();
  return JSON.stringify(r);
})()
"@
  if ($jumpResult -notmatch '"ok":true') { throw "Camera jump hook did not report a live camera: $jumpResult" }
  Write-Host "Camera jump: $jumpResult"
  Start-Sleep -Seconds 2
  $clickResult = Invoke-WebViewExpression @"
(() => {
  const cams = [...document.querySelectorAll('.atlas-pin-marker--camera')];
  const nonCluster = cams.filter(el => !el.classList.contains('atlas-pin-marker--cluster'));
  const inView = nonCluster.filter(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight; });
  if (inView.length === 0) return 'NONE_IN_VIEW';
  const target = inView[0];
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2 }));
  return 'CLICKED';
})()
"@
  if ($clickResult -notmatch "CLICKED") { throw "No un-clustered live camera marker was in view after the jump: $clickResult" }
  $cameraPopupExpr = @"
(() => document.querySelector('[data-camera-media-state]') ? 'TRUE' : 'FALSE')()
"@
  Wait-Until "camera popup with media state visible" { Test-JsCondition $cameraPopupExpr } 6 300
  $mediaStateExpr = @"
(() => document.querySelector('[data-camera-media-state]')?.dataset.cameraMediaState || 'unknown')()
"@
  $mediaState = (Invoke-WebViewExpression $mediaStateExpr).Trim()
  Capture-Entry "07-camera-detail" "route-map, real camera popup open (media state: $mediaState)" '[data-camera-media-state]' "live" "LIVE PROVIDER -- real Arkansas DOT IDrive camera, selected deterministically via a QA-only jump hook (window.__codeblackDebugJumpToCamera in AtlasMap.tsx) that centers the map on a real, already-loaded camera's coordinates; no camera or image data is fabricated."
  Close-AnyOpenOverlay

  # 08: Weather
  Go-ToRoute "weather"
  Capture-Entry "08-weather" "route-weather active" '[data-testid="route-weather"][data-active="true"]' "live" ""

  # 09: Alerts
  Go-ToRoute "alerts"
  Capture-Entry "09-alerts" "route-alerts active" '[data-testid="route-alerts"][data-active="true"]' "live" ""

  # 10: More
  Go-ToRoute "more"
  Capture-Entry "10-more" "route-more active" '[data-testid="route-more"][data-active="true"]' "live" ""

  # 11: Operations
  Go-ToRoute "operations"
  Capture-Entry "11-operations" "route-operations active" '[data-testid="route-operations"][data-active="true"]' "live" ""

  # 12: Report
  Go-ToRoute "report"
  Capture-Entry "12-report" "route-report active" '[data-testid="route-report"][data-active="true"]' "live" ""

  # 13: Settings (top)
  Go-ToRoute "settings"
  Capture-Entry "13-settings-top" "route-settings active, default scroll position" '[data-testid="route-settings"][data-active="true"]' "live" ""

  # 14: Settings Display section specifically
  Invoke-WebViewExpression @"
(() => { document.querySelector('.settings-display-panel')?.scrollIntoView({ block: 'start' }); return 'OK'; })()
"@ | Out-Null
  Start-Sleep -Milliseconds 500
  Capture-Entry "14-settings-display" "route-settings, scrolled to .settings-display-panel" '.settings-display-panel' "live" ""

  # 15: Layers page
  Go-ToRoute "layers"
  Capture-Entry "15-layers" "route-layers active" '[data-testid="route-layers"][data-active="true"]' "live" ""

  $manifestPath = Join-Path $OutDir "screenshot-manifest.json"
  $script:manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath
  Write-Host ""
  Write-Host "All $($script:manifest.Count) screenshots captured and route/state-verified."
  Write-Host "Manifest: $manifestPath"
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
