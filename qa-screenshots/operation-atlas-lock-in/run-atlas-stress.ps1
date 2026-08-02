param(
  [string]$Serial = 'R5GL53J3Y4J',
  [string]$Package = 'com.codeblackwx.ops',
  [string]$OutDir = 'qa-screenshots\operation-atlas-lock-in'
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$timeline = Join-Path $OutDir 'atlas-memory-timeline.csv'
$statusPath = Join-Path $OutDir 'atlas-stress-status.json'
$logPath = Join-Path $OutDir 'atlas-stress-runner.log'
"elapsedSeconds,label,totalPssKb,totalRssKb,nativeHeapKb,javaHeapKb,graphicsKb,eglKb,glMtrackKb,webViews,mapInstances,canvasCount,webglContexts,styleLoads,sourceCreations,layerCreations,sourceUpdates,radarImageUpdates,product,radarFrameId,cameraMode" | Set-Content -Path $timeline -Encoding utf8
function Get-MemValue([string[]]$lines, [string]$pattern) {
  $line = $lines | Select-String -Pattern $pattern | Select-Object -First 1
  if (-not $line) { return '' }
  return ($line.ToString() -replace '^\s*[^:]+:\s*','' -split '\s+')[0]
}
function Capture([string]$label, [int]$elapsed) {
  $memPath = Join-Path $OutDir ("stress-$label-meminfo.txt")
  adb -s $Serial shell dumpsys meminfo $Package > $memPath
  $lines = Get-Content $memPath
  $totalLine = $lines | Select-String -Pattern 'TOTAL PSS:' | Select-Object -First 1
  $totalPss = ''; $totalRss = ''
  if ($totalLine) {
    if ($totalLine.ToString() -match 'TOTAL PSS:\s*(\d+)') { $totalPss = $Matches[1] }
    if ($totalLine.ToString() -match 'TOTAL RSS:\s*(\d+)') { $totalRss = $Matches[1] }
  }
  $graphics = Get-MemValue $lines 'Graphics:'
  $native = Get-MemValue $lines 'Native Heap:'
  $java = Get-MemValue $lines 'Java Heap:'
  $eglLine = $lines | Select-String -Pattern '^\s*EGL mtrack' | Select-Object -First 1
  $glLine = $lines | Select-String -Pattern '^\s*GL mtrack' | Select-Object -First 1
  $egl = if($eglLine){ (($eglLine.ToString().Trim() -split '\s+')[1]) } else { '' }
  $glm = if($glLine){ (($glLine.ToString().Trim() -split '\s+')[1]) } else { '' }
  $webViewsLine = $lines | Select-String -Pattern 'WebViews:' | Select-Object -First 1
  $webViews = if($webViewsLine -and $webViewsLine.ToString() -match 'WebViews:\s*(\d+)') { $Matches[1] } else { '' }
  $devtoolsPath = Join-Path $OutDir ("stress-$label-devtools.json")
  try {
    $socketLine = adb -s $Serial shell cat /proc/net/unix | Select-String -Pattern 'webview_devtools_remote' | Select-Object -Last 1
    if ($socketLine) {
      $socket = ($socketLine.ToString() -split '@')[-1].Trim()
      adb -s $Serial forward --remove tcp:9229 2>$null | Out-Null
      adb -s $Serial forward tcp:9229 "localabstract:$socket" | Out-Null
      node "$OutDir\devtools-dump.cjs" 9229 $devtoolsPath | Out-Null
    }
  } catch { Add-Content $logPath "devtools capture failed ${label}: $_" }
  $mapInstances=''; $canvasCount=''; $webglContexts=''; $styleLoads=''; $sourceCreations=''; $layerCreations=''; $sourceUpdates=''; $radarImageUpdates=''; $product=''; $frameId=''; $cameraMode=''
  if (Test-Path $devtoolsPath) {
    try {
      $json = Get-Content $devtoolsPath -Raw | ConvertFrom-Json
      $mapInstances = $json.atlas.mapInstanceCount
      $canvasCount = $json.canvasCount
      $webglContexts = $json.atlas.webglContextCount
      $styleLoads = $json.atlas.lifecycle.styleLoads
      $sourceCreations = $json.atlas.lifecycle.sourceCreations
      $layerCreations = $json.atlas.lifecycle.layerCreations
      $sourceUpdates = $json.atlas.lifecycle.sourceUpdates
      $radarImageUpdates = $json.atlas.lifecycle.radarImageUpdates
      $product = $json.atlas.selectedProduct
      $frameId = $json.atlas.radarFrameId
      $cameraMode = $json.atlas.cameraMode
    } catch { Add-Content $logPath "json parse failed ${label}: $_" }
  }
  "$elapsed,$label,$totalPss,$totalRss,$native,$java,$graphics,$egl,$glm,$webViews,$mapInstances,$canvasCount,$webglContexts,$styleLoads,$sourceCreations,$layerCreations,$sourceUpdates,$radarImageUpdates,$product,$frameId,$cameraMode" | Add-Content -Path $timeline -Encoding utf8
  @{ elapsedSeconds=$elapsed; label=$label; totalPssKb=$totalPss; graphicsKb=$graphics; product=$product; mapInstances=$mapInstances; canvasCount=$canvasCount; sourceUpdates=$sourceUpdates; radarImageUpdates=$radarImageUpdates; timestamp=(Get-Date).ToString('o') } | ConvertTo-Json | Set-Content $statusPath -Encoding utf8
}
function Tap([int]$x,[int]$y){ adb -s $Serial shell input tap $x $y | Out-Null; Start-Sleep -Milliseconds 420 }
function Swipe([int]$x1,[int]$y1,[int]$x2,[int]$y2,[int]$ms=350){ adb -s $Serial shell input swipe $x1 $y1 $x2 $y2 $ms | Out-Null; Start-Sleep -Milliseconds 500 }
adb -s $Serial logcat -c | Out-Null
adb -s $Serial shell am start -n "$Package/.MainActivity" | Out-Null
Start-Sleep -Seconds 5
$start = Get-Date
$samples = @(0,300,600,900,1200,1500,1800)
$sampleIndex = 0
$productSwitches = 0; $expandedCycles = 0; $followCycles = 0; $bgCycles = 0
Capture 'start' 0
while (((Get-Date) - $start).TotalSeconds -lt 1800) {
  foreach ($pt in @(@(542,1002),@(620,1002),@(700,1002),@(764,1002))) { Tap $pt[0] $pt[1]; $productSwitches++ }
  Swipe 875 755 760 755 300
  Tap 552 754; $followCycles++
  Tap 552 754; $followCycles++
  Tap 840 626; Start-Sleep -Milliseconds 900; $expandedCycles++
  foreach ($pt in @(@(570,1090),@(650,1090),@(730,1090),@(810,1090))) { Tap $pt[0] $pt[1]; $productSwitches++ }
  adb -s $Serial shell input keyevent BACK | Out-Null; Start-Sleep -Milliseconds 900
  Tap 455 1115; Start-Sleep -Milliseconds 650
  Tap 165 1115; Start-Sleep -Milliseconds 650
  if (($expandedCycles % 3) -eq 0) {
    adb -s $Serial shell input keyevent HOME | Out-Null; Start-Sleep -Seconds 1
    adb -s $Serial shell am start -n "$Package/.MainActivity" | Out-Null; Start-Sleep -Seconds 2
    $bgCycles++
  }
  $elapsed = [int]((Get-Date) - $start).TotalSeconds
  while ($sampleIndex -lt $samples.Count -and $elapsed -ge $samples[$sampleIndex]) {
    Capture ("t$($samples[$sampleIndex])") $elapsed
    $sampleIndex++
  }
  @{ running=$true; elapsedSeconds=$elapsed; productSwitches=$productSwitches; expandedCycles=$expandedCycles; followCycles=$followCycles; backgroundResumeCycles=$bgCycles; timestamp=(Get-Date).ToString('o') } | ConvertTo-Json | Set-Content $statusPath -Encoding utf8
}
Capture 't1800-final' 1800
Start-Sleep -Seconds 120
Capture 'idle-plus-120s' 1920
adb -s $Serial logcat -d -v time AndroidRuntime:E chromium:W cr_AwContents:V Mapbox:D '*:S' > (Join-Path $OutDir 'atlas-logcat-filtered.txt')
Select-String -Path (Join-Path $OutDir 'atlas-logcat-filtered.txt') -Pattern 'tile memory|FATAL|ANR|SIGSEGV|OOM|WebGL context|EGL|Mapbox|chromium' | Set-Content (Join-Path $OutDir 'atlas-chromium-warnings.txt') -Encoding utf8
@{ running=$false; elapsedSeconds=1920; productSwitches=$productSwitches; expandedCycles=$expandedCycles; followCycles=$followCycles; backgroundResumeCycles=$bgCycles; timestamp=(Get-Date).ToString('o') } | ConvertTo-Json | Set-Content $statusPath -Encoding utf8
